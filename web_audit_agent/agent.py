"""
HTTP crawl, status checks, and OpenAI-backed reporting for the Web Audit Agent.

Author: Stuart McKay (HCLSoftware)
"""

from __future__ import annotations

import json
import os
import re
import secrets
from collections import deque
from typing import Any, Literal
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from openai import OpenAI

from web_audit_agent.enterprise_dx import fetch_pagespeed_lighthouse, merge_enterprise_dx_audit
from web_audit_agent.models import (
    BestPracticesAnalysis,
    LinkAuditItem,
    LinkIssueType,
    UxAuditAnalysis,
    WebAuditReport,
)

OPENAI_MODEL = "gpt-4o"
DEFAULT_USER_AGENT = (
    "WebAuditAgent/1.0 (+https://example.local; technical site audit; contact: none)"
)

# ---------------------------------------------------------------------------
# URL / origin helpers
# ---------------------------------------------------------------------------


def _normalize_netloc(netloc: str) -> str:
    n = netloc.lower()
    return n[4:] if n.startswith("www.") else n


def _same_origin(base: str, candidate: str) -> bool:
    b, c = urlparse(base), urlparse(candidate)
    if not c.scheme or not c.netloc:
        return False
    return _normalize_netloc(b.netloc) == _normalize_netloc(c.netloc)


def _absolute_url(base: str, href: str) -> str | None:
    if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
        return None
    joined = urljoin(base, href)
    no_frag, _ = urldefrag(joined)
    parsed = urlparse(no_frag)
    if parsed.scheme not in ("http", "https"):
        return None
    return no_frag


def _collect_internal_hrefs(base_url: str, soup: BeautifulSoup) -> list[str]:
    """Same-origin ``<a href>`` discovery only (no semantic content extraction)."""
    seen: set[str] = set()
    out: list[str] = []
    for a in soup.find_all("a", href=True):
        abs_u = _absolute_url(base_url, a["href"].strip())
        if abs_u and _same_origin(base_url, abs_u) and abs_u not in seen:
            seen.add(abs_u)
            out.append(abs_u)
    return out


def _norm_url_key(u: str) -> str:
    """Normalize URL for deduplication (fragment stripped, trailing slash trimmed, lowercased)."""
    return urldefrag(u.strip())[0].rstrip("/").lower()


# ---------------------------------------------------------------------------
# HTTP status classification and checks
# ---------------------------------------------------------------------------


_SOFT404_PATH_404 = re.compile(r"(^|/)404(/|$)", re.I)
_SOFT404_PATH_ERROR = re.compile(r"(^|/)error(/|$)", re.I)
_SOFT404_PATH_NOTFOUND = re.compile(r"(^|/)not-found(/|$)", re.I)
_SOFT404_WORD_ERROR = re.compile(r"\berror\b", re.I)


def _soft_404_url_reasons(final_url: str) -> list[str]:
    """
    Treat final URL path as error-like when it contains /404, /error, or /not-found
    as path segments (after redirects, e.g. 302 → 200 friendly error page).
    """
    path = (urlparse(final_url).path or "").lower()
    reasons: list[str] = []
    if _SOFT404_PATH_404.search(path):
        reasons.append("url_path_contains_/404_segment")
    if _SOFT404_PATH_ERROR.search(path):
        reasons.append("url_path_contains_/error_segment")
    if _SOFT404_PATH_NOTFOUND.search(path):
        reasons.append("url_path_contains_/not-found_segment")
    return reasons


def _soft_404_content_reasons(html: str) -> list[str]:
    """Flag likely soft 404s from visible <title> and <h1> copy."""
    if not html or not html.strip():
        return []
    soup = BeautifulSoup(html, "lxml")
    chunks: list[tuple[str, str]] = []
    if soup.title and soup.title.string:
        chunks.append(("title", soup.title.string.strip()))
    for h1 in soup.find_all("h1", limit=6):
        t = h1.get_text(separator=" ", strip=True)
        if t:
            chunks.append(("h1", t))
    raw: list[str] = []
    for kind, text in chunks:
        low = text.lower()
        if "page not found" in low:
            raw.append(f"content_{kind}_phrase_page_not_found")
        if "oops" in low:
            raw.append(f"content_{kind}_phrase_oops")
        if _SOFT404_WORD_ERROR.search(text):
            raw.append(f"content_{kind}_word_error")
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _resolve_issue_type_with_soft(
    status_code: int,
    url_reasons: list[str],
    content_reasons: list[str],
) -> tuple[LinkIssueType, list[str], bool]:
    """
    Merge URL + content soft-404 signals. For HTTP 200 with any signal, issue_type is soft_404.
    Hard 404 stays broken. Returns (issue_type, combined_signals, soft_404_flag).
    """
    combined: list[str] = []
    seen: set[str] = set()
    for r in url_reasons + content_reasons:
        if r not in seen:
            seen.add(r)
            combined.append(r)
    if status_code == 0:
        return LinkIssueType.error, combined, False
    if status_code == 404:
        return LinkIssueType.broken, combined, False
    if status_code == 401:
        return LinkIssueType.unauthorized, combined, False
    if status_code == 403:
        return LinkIssueType.forbidden, combined, False
    if 400 <= status_code < 500:
        return LinkIssueType.client_error, combined, False
    if 500 <= status_code < 600:
        return LinkIssueType.server_error, combined, False
    if status_code == 200 and combined:
        return LinkIssueType.soft_404, combined, True
    if status_code == 200:
        return LinkIssueType.ok, [], False
    return LinkIssueType.ok, combined, False


def _check_url(
    client: httpx.Client,
    url: str,
    *,
    check_kind: Literal["entry", "internal"],
) -> tuple[LinkAuditItem, str | None]:
    """
    HEAD then GET on 200/405 so we can fingerprint title/h1 for soft 404s (masked error pages).
    Returns ``(item, html_snippet_or_none)`` for BFS link discovery on 200 responses.
    """
    status, final = 0, url
    html: str | None = None
    try:
        r = client.head(url, follow_redirects=True)
        status, final = r.status_code, str(r.url)
        if status == 405:
            r2 = client.get(url, follow_redirects=True)
            status, final = r2.status_code, str(r2.url)
            html = r2.text[:120000] if r2.text else None
        elif status == 200:
            r2 = client.get(url, follow_redirects=True)
            status, final = r2.status_code, str(r2.url)
            html = r2.text[:120000] if r2.text else None
    except httpx.HTTPError:
        try:
            r2 = client.get(url, follow_redirects=True)
            status, final = r2.status_code, str(r2.url)
            html = r2.text[:120000] if r2.text else None
        except httpx.HTTPError:
            status, final = 0, url
    url_r = _soft_404_url_reasons(final) if final else []
    content_r = _soft_404_content_reasons(html) if html else []
    it, sigs, is_soft = _resolve_issue_type_with_soft(status, url_r, content_r)
    item = LinkAuditItem(
        url=final,
        status_code=status,
        issue_type=it,
        check_kind=check_kind,
        soft_404=is_soft,
        soft_404_signals=sigs,
    )
    return item, html


def _crawl_internals_bfs(
    client: httpx.Client,
    *,
    entry_final: str,
    entry_html: str,
    max_internal_links: int,
    crawl_max_depth: int,
) -> tuple[list[LinkAuditItem], list[str]]:
    """
    Same-origin BFS: depth 1 = links on entry; depth 2+ = links from fetched internal pages (HTTP 200).
    ``max_internal_links`` caps how many **non-entry** URLs are checked total.
    """
    if crawl_max_depth < 1:
        crawl_max_depth = 1
    entry_key = _norm_url_key(entry_final)
    soup0 = BeautifulSoup(entry_html, "lxml")
    discovered_order: list[str] = []
    discovered_keys: set[str] = set()

    def _note_discovered(u: str) -> None:
        k = _norm_url_key(u)
        if k == entry_key or k in discovered_keys:
            return
        discovered_keys.add(k)
        discovered_order.append(u)

    queue: deque[tuple[str, int]] = deque()
    enqueued: set[str] = set()

    for u in _collect_internal_hrefs(entry_final, soup0):
        _note_discovered(u)
        k = _norm_url_key(u)
        if k not in enqueued:
            enqueued.add(k)
            queue.append((u, 1))

    checked_keys: set[str] = {entry_key}
    internal_checks: list[LinkAuditItem] = []

    while queue and len(internal_checks) < max_internal_links:
        raw_url, link_depth = queue.popleft()
        nk = _norm_url_key(raw_url)
        if nk in checked_keys:
            continue
        checked_keys.add(nk)
        item, html = _check_url(client, raw_url, check_kind="internal")
        internal_checks.append(item)

        if crawl_max_depth > link_depth and html and item.status_code == 200:
            soup = BeautifulSoup(html, "lxml")
            base = item.url
            for v in _collect_internal_hrefs(base, soup):
                _note_discovered(v)
                vk = _norm_url_key(v)
                if vk not in enqueued:
                    enqueued.add(vk)
                    queue.append((v, link_depth + 1))

    return internal_checks, discovered_order


# ---------------------------------------------------------------------------
# HTML snapshots (UX audit only)
# ---------------------------------------------------------------------------


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _snapshot_landing_page(html: str, page_url: str) -> dict[str, Any]:
    """Structured snapshot from one parse: headings, CTAs, then stripped text preview."""
    soup = BeautifulSoup(html, "lxml")
    title = soup.title.string.strip() if soup.title and soup.title.string else None
    meta_desc = None
    m = soup.find("meta", attrs={"name": lambda x: x and str(x).lower() == "description"})
    if m and m.get("content"):
        meta_desc = m["content"].strip()
    h1s = [h.get_text(strip=True) for h in soup.find_all("h1", limit=12)]
    h2s = [h.get_text(strip=True) for h in soup.find_all("h2", limit=18)]
    ctas: list[str] = []
    for el in soup.find_all(["button", "a"], limit=70):
        t = el.get_text(separator=" ", strip=True)
        if t and len(t) < 120:
            ctas.append(t[:120])
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    preview = text[:5500] + ("\n\n… [truncated]" if len(text) > 5500 else "")
    return {
        "page_url": page_url,
        "title": title,
        "meta_description": meta_desc,
        "h1": h1s,
        "h2": h2s,
        "cta_and_link_labels_sample": _dedupe_preserve_order(ctas)[:35],
        "visible_text_preview": preview,
    }


def _html_to_text_preview(html: str, max_chars: int) -> str:
    """Strip noisy tags and return truncated plain text (404 probe bodies)."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()
    text = re.sub(r"\n{3,}", "\n\n", soup.get_text(separator="\n", strip=True))
    if len(text) > max_chars:
        return text[:max_chars] + "\n\n… [truncated]"
    return text


def _fetch_404_probe(client: httpx.Client, base: str) -> dict[str, Any]:
    slug = f"__dx_auditor_404_{secrets.token_hex(6)}"
    parsed = urlparse(base)
    path = (parsed.path or "").rstrip("/")
    probe_path = f"{path}/{slug}" if path else f"/{slug}"
    if not probe_path.startswith("/"):
        probe_path = "/" + probe_path
    probe_url = f"{parsed.scheme}://{parsed.netloc}{probe_path}"
    try:
        r = client.get(probe_url, follow_redirects=True)
        preview = _html_to_text_preview(r.text, 4000) if r.text else ""
        return {
            "probe_url": probe_url,
            "status_code": r.status_code,
            "final_url": str(r.url),
            "text_preview": preview,
        }
    except httpx.HTTPError as e:
        return {
            "probe_url": probe_url,
            "status_code": 0,
            "final_url": None,
            "text_preview": "",
            "error": str(e),
        }


# ---------------------------------------------------------------------------
# OpenAI: UX research + synthesis + HTTP-only qualitative
# ---------------------------------------------------------------------------

_UX_RESEARCH_QUERY = (
    "Act as a UX research assistant. Use web search to find current, authoritative guidance "
    "(prioritize 2025–2026 sources where available) on:\n"
    "(1) **404 pages**: tone, helpfulness, navigation options (home/search/support), branding, accessibility.\n"
    "(2) **HTTP 200 landing / conversion pages**: clarity of value proposition, primary CTA, trust signals, "
    "friction, mobile-first patterns.\n"
    "Produce a bullet-point summary suitable as evaluation criteria. Mention source names or sites when possible."
)


def _ux_web_research(oai: OpenAI) -> tuple[str, str]:
    """
    Prefer Responses API + ``web_search_preview``; fall back to chat completion without web.
    Returns ``(research_text, source_note)``.
    """
    web_error: str | None = None
    try:
        resp = oai.responses.create(
            model=OPENAI_MODEL,
            tools=[{"type": "web_search_preview", "search_context_size": "medium"}],
            tool_choice="auto",
            input=_UX_RESEARCH_QUERY,
        )
        text = (resp.output_text or "").strip()
        if text:
            return text, "Research via OpenAI **web_search_preview** (live web)."
    except Exception as e:  # noqa: BLE001
        web_error = str(e)

    try:
        fb = oai.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": _UX_RESEARCH_QUERY
                    + "\n\nNote: You do not have live web access in this fallback. "
                    "Summarize widely cited UX guidance and state that the user should verify recency.",
                },
            ],
        )
        msg = (fb.choices[0].message.content or "").strip()
        note = "Research via **model-only fallback** (web search tool unavailable"
        if web_error:
            note += f": {web_error}"
        note += "). Verify against current sources."
        return msg, note
    except Exception as e2:  # noqa: BLE001
        return "", f"Research failed: {web_error or e2}"


def _run_ux_audit_synthesis(
    oai: OpenAI,
    *,
    research: str,
    research_source_note: str,
    audited_url: str,
    landing_snapshot: dict[str, Any] | None,
    probe: dict[str, Any] | None,
    entry_soft_404: bool = False,
    entry_soft_404_signals: list[str] | None = None,
) -> tuple[UxAuditAnalysis | None, str | None]:
    payload = {
        "audited_url": audited_url,
        "research_criteria_summary": research,
        "research_source_note": research_source_note,
        "entry_page_snapshot": landing_snapshot,
        "not_found_probe": probe,
        "entry_soft_404_detected": entry_soft_404,
        "entry_soft_404_signals": entry_soft_404_signals or [],
        "note_masking": (
            "If entry_soft_404_detected is true, the entry may be a 200 'friendly' error (e.g. after redirect). "
            "Comment on whether the experience feels jarring and whether recovery path (search, home, links) is prominent."
        ),
    }
    system = (
        "You are a **UX Auditor**. You receive (a) research-backed criteria for 404 sentiment and 200 landing "
        "conversion, and (b) structured snapshots from fetching the user's entry URL and a synthetic missing path "
        "on the same host (the probe). "
        "If **entry_soft_404_detected** is true, prioritize empathy, clarity, and recovery-path prominence for that "
        "masked-error case in your narrative fields. "
        "Compare the snapshots to the criteria. Say where the site falls short. "
        "If a snapshot is missing, state what you cannot assess. "
        "Do not invent on-page content that is not in the snapshots. "
        "Return structured fields per schema."
    )
    try:
        completion = oai.beta.chat.completions.parse(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": "```json\n"
                    + json.dumps(payload, ensure_ascii=False, indent=2)
                    + "\n```",
                },
            ],
            response_format=UxAuditAnalysis,
        )
        message = completion.choices[0].message
        if message.refusal:
            return None, f"Model refusal: {message.refusal}"
        if message.parsed:
            parsed = message.parsed
            if research_source_note and not parsed.research_source_note:
                parsed = parsed.model_copy(update={"research_source_note": research_source_note})
            return parsed, None
        return None, "No parsed UX audit response"
    except Exception as e:  # noqa: BLE001
        return None, str(e)


def _merge_ux_audit(
    report: WebAuditReport,
    *,
    landing_html: str | None,
    main_final: str | None,
    audited_url: str,
    probe_data: dict[str, Any] | None,
) -> WebAuditReport:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return report.model_copy(
            update={"ux_audit_error": "OPENAI_API_KEY is not set (required for UX audit)"}
        )
    oai = OpenAI(api_key=key)
    research, src_note = _ux_web_research(oai)
    if not research.strip():
        return report.model_copy(
            update={"ux_audit_error": src_note or "UX research produced no text"}
        )
    landing_snap = (
        _snapshot_landing_page(landing_html, main_final or audited_url)
        if landing_html
        else None
    )
    entry = report.page_checks[0] if report.page_checks else None
    entry_soft = bool(entry and entry.check_kind == "entry" and entry.soft_404)
    entry_sigs = list(entry.soft_404_signals) if entry and entry_soft else []
    ux, ux_err = _run_ux_audit_synthesis(
        oai,
        research=research,
        research_source_note=src_note,
        audited_url=audited_url,
        landing_snapshot=landing_snap,
        probe=probe_data,
        entry_soft_404=entry_soft,
        entry_soft_404_signals=entry_sigs,
    )
    if ux_err:
        return report.model_copy(update={"ux_audit_error": ux_err})
    return report.model_copy(update={"ux_audit": ux})


def _build_http_qualitative_prompt(report_payload: dict[str, Any]) -> str:
    return (
        "You are a web operations and HTTP-health reviewer. "
        "You are given ONLY a JSON summary of URLs that were checked and their HTTP status codes "
        "(2xx success, 4xx client errors such as 404/401/403, 5xx server errors, 0 = request failed). "
        "Some rows may be **soft_404**: HTTP 200 with URL or title/h1 heuristics suggesting a masked error page "
        "(e.g. redirect to a friendly 404). Treat those as reliability/content issues, not healthy 200s. "
        "You did NOT see full page HTML beyond soft_404_signals.\n\n"
        "Assess:\n"
        "1) Whether the status pattern suggests a healthy site (mostly 2xx on entry and key internal links) "
        "or problems (many 4xx, especially 404s on linked URLs; unexpected 401/403).\n"
        "2) Operational best practices *as inferable from this data only*: e.g. HTTPS on the entry URL, "
        "whether redirects seem involved (entry final URL vs seed), broken links in the sampled crawl, "
        "overuse of auth errors on public-looking paths.\n"
        "3) Clear recommendations and concerns. Do not invent specific HTML or content you did not receive.\n\n"
        "Return structured fields matching the response schema.\n\n"
        f"```json\n{json.dumps(report_payload, ensure_ascii=False, indent=2)}\n```"
    )


def _finish_openai_http_qualitative(
    audited_url: str,
    main_final: str | None,
    main_err: str | None,
    page_checks: list[LinkAuditItem],
    links_discovered_count: int,
    internal_checked: int,
    payload: dict[str, Any],
    *,
    crawl_max_depth: int,
) -> WebAuditReport:
    qualitative: BestPracticesAnalysis | None = None
    openai_error: str | None = None
    entry_https = bool(main_final and urlparse(main_final).scheme == "https")
    entry_redirected = bool(
        main_final
        and audited_url.rstrip("/") != main_final.rstrip("/")
        and urldefrag(audited_url)[0].rstrip("/") != urldefrag(main_final)[0].rstrip("/")
    )

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        openai_error = "OPENAI_API_KEY is not set"
    else:
        prompt = _build_http_qualitative_prompt(payload)
        try:
            oai = OpenAI(api_key=api_key)
            completion = oai.beta.chat.completions.parse(
                model=OPENAI_MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": "You output only valid structured HTTP-health and best-practices analysis.",
                    },
                    {"role": "user", "content": prompt},
                ],
                response_format=BestPracticesAnalysis,
            )
            message = completion.choices[0].message
            if message.refusal:
                openai_error = f"Model refusal: {message.refusal}"
            elif message.parsed:
                qualitative = message.parsed
            else:
                openai_error = "No parsed response from model"
        except Exception as e:  # noqa: BLE001
            openai_error = str(e)

    return WebAuditReport(
        audited_url=audited_url,
        main_page_final_url=main_final,
        main_page_error=main_err,
        entry_https=entry_https,
        entry_redirected=entry_redirected,
        page_checks=page_checks,
        crawl_max_depth=crawl_max_depth,
        links_discovered_count=links_discovered_count,
        internal_links_checked_count=internal_checked,
        qualitative=qualitative,
        openai_error=openai_error,
    )


def _payload_for_openai(
    audited_url: str,
    main_final: str | None,
    page_checks: list[LinkAuditItem],
    discovered: list[str],
    max_internal_links: int,
    main_err: str | None,
    crawl_max_depth: int,
) -> dict[str, Any]:
    return {
        "audited_url": audited_url,
        "entry_final_url": main_final,
        "main_page_error": main_err,
        "crawl_max_depth": crawl_max_depth,
        "internal_links_discovered": len(discovered),
        "internal_links_check_cap": max_internal_links,
        "pages": [
            {
                "url": p.url,
                "status_code": p.status_code,
                "issue_type": p.issue_type.value,
                "check_kind": p.check_kind,
                "soft_404": p.soft_404,
                "soft_404_signals": p.soft_404_signals,
            }
            for p in page_checks
        ],
    }


def _load_dotenv_optional() -> None:
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def audit_site(
    url: str,
    *,
    max_internal_links: int = 50,
    crawl_max_depth: int = 2,
    timeout: float = 25.0,
    user_agent: str = DEFAULT_USER_AGENT,
    ux_audit: bool = False,
    enterprise_dx: bool = False,
) -> WebAuditReport:
    """
    GET the entry URL, discover same-origin ``<a href>`` links in a **BFS** up to ``crawl_max_depth``
    (default **2**: links on the entry page, then links found on those pages when responses are 200),
    and check statuses (HEAD with GET fallback) up to ``max_internal_links`` non-entry URLs.

    If ``ux_audit=True``, also runs web research (when available) and compares criteria to a landing
    snapshot plus a synthetic 404 probe (``UxAuditAnalysis``).

    If ``enterprise_dx=True``, runs a **Senior DX Strategist** pass: web-informed 2026 enterprise rubric,
    HTML structural signals, recovery-path heuristics, optional **Google PageSpeed Insights** (set
    ``GOOGLE_PAGESPEED_API_KEY``), and structured ``EnterpriseDxStrategistAnalysis`` (friction score,
    critical fixes, sentiment improvements).

    Requires ``OPENAI_API_KEY`` for OpenAI features. Loads ``.env`` when ``python-dotenv`` is installed.
    """
    _load_dotenv_optional()
    crawl_max_depth = max(1, crawl_max_depth)

    page_checks: list[LinkAuditItem] = []
    discovered: list[str] = []
    main_final: str | None = None
    main_err: str | None = None
    landing_html: str | None = None
    probe_data: dict[str, Any] | None = None
    capture_html = ux_audit or enterprise_dx
    run_404_probe = ux_audit or enterprise_dx

    with httpx.Client(timeout=timeout, headers={"User-Agent": user_agent}, follow_redirects=True) as client:
        try:
            r = client.get(url)
            main_final = str(r.url)
            url_r = _soft_404_url_reasons(main_final)
            content_r = _soft_404_content_reasons(r.text) if r.text else []
            it, sigs, is_soft = _resolve_issue_type_with_soft(r.status_code, url_r, content_r)
            page_checks.append(
                LinkAuditItem(
                    url=main_final,
                    status_code=r.status_code,
                    issue_type=it,
                    check_kind="entry",
                    soft_404=is_soft,
                    soft_404_signals=sigs,
                )
            )
            if r.status_code >= 400:
                main_err = f"HTTP {r.status_code}"
                landing_html = r.text if capture_html else None
            else:
                html = r.text
                landing_html = html if capture_html else None
                base = main_final or url
                if run_404_probe:
                    probe_data = _fetch_404_probe(client, base)
                internal_items, discovered = _crawl_internals_bfs(
                    client,
                    entry_final=base,
                    entry_html=html,
                    max_internal_links=max_internal_links,
                    crawl_max_depth=crawl_max_depth,
                )
                page_checks.extend(internal_items)
        except httpx.HTTPError as e:
            main_err = str(e)
            discovered = []
            page_checks = [
                LinkAuditItem(
                    url=url,
                    status_code=0,
                    issue_type=LinkIssueType.error,
                    check_kind="entry",
                    soft_404=False,
                    soft_404_signals=[],
                )
            ]
            main_final = None

    payload = _payload_for_openai(
        url,
        main_final,
        page_checks,
        discovered,
        max_internal_links,
        main_err,
        crawl_max_depth,
    )
    report = _finish_openai_http_qualitative(
        url,
        main_final,
        main_err,
        page_checks,
        len(discovered),
        max(len(page_checks) - 1, 0),
        payload,
        crawl_max_depth=crawl_max_depth,
    )
    if ux_audit:
        report = _merge_ux_audit(
            report,
            landing_html=landing_html,
            main_final=main_final,
            audited_url=url,
            probe_data=probe_data,
        )
    if enterprise_dx:
        ps_key = (os.environ.get("GOOGLE_PAGESPEED_API_KEY") or "").strip()
        ps_url = main_final or url
        pagespeed_data = None
        if ps_key and ps_url:
            pagespeed_data = fetch_pagespeed_lighthouse(
                ps_url,
                ps_key,
                timeout=min(max(timeout, 30.0), 120.0),
            )
        report = merge_enterprise_dx_audit(
            report,
            landing_html=landing_html,
            audited_url=url,
            main_final=main_final,
            probe_data=probe_data,
            pagespeed=pagespeed_data,
        )
    return report


def audit_site_json_and_markdown(url: str, **kwargs: object) -> tuple[str, str]:
    """Return ``(report.model_dump_json(indent=2), report.to_markdown_summary())``."""
    report = audit_site(url, **kwargs)  # type: ignore[arg-type]
    return report.model_dump_json(indent=2), report.to_markdown_summary()


def main() -> None:
    import argparse
    import sys

    from web_audit_agent.__about__ import __author__, __organization__, __version__

    parser = argparse.ArgumentParser(
        prog="web_audit_agent",
        description=(
            f"Web Audit Agent v{__version__} — HTTP status crawl + OpenAI review. "
            f"Author: {__author__} ({__organization__})."
        ),
    )
    parser.add_argument("url", help="Entry page URL")
    parser.add_argument(
        "--max-links",
        type=int,
        default=50,
        help="Max distinct internal URLs to check (HEAD/GET), across all BFS depths",
    )
    parser.add_argument(
        "--crawl-depth",
        type=int,
        default=2,
        metavar="N",
        help=(
            "BFS link depth from entry (default 2): 1 = only links on entry page; "
            "2 = also follow links on those pages (same origin); higher = deeper (watch max-links)"
        ),
    )
    parser.add_argument(
        "--ux-audit",
        action="store_true",
        help="UX Auditor: web research + landing snapshot + 404 probe",
    )
    parser.add_argument(
        "--enterprise-dx",
        action="store_true",
        help="Enterprise DX strategist: CWV/PageSpeed, WCAG-oriented signals, friction score, AI-readiness",
    )
    parser.add_argument("--json-out", default="", help="Write JSON report path")
    parser.add_argument("--md-out", default="", help="Write Markdown summary path")
    args = parser.parse_args()
    if args.crawl_depth < 1:
        parser.error("--crawl-depth must be >= 1")
    rep = audit_site(
        args.url,
        max_internal_links=args.max_links,
        crawl_max_depth=args.crawl_depth,
        ux_audit=args.ux_audit,
        enterprise_dx=args.enterprise_dx,
    )
    json_out = rep.model_dump_json(indent=2)
    md_out = rep.to_markdown_summary()
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            f.write(json_out)
    if args.md_out:
        with open(args.md_out, "w", encoding="utf-8") as f:
            f.write(md_out)
    if not args.json_out and not args.md_out:
        print(md_out)
    else:
        print("Wrote:", args.json_out or "(no json)", args.md_out or "(no md)", file=sys.stderr)


if __name__ == "__main__":
    main()
