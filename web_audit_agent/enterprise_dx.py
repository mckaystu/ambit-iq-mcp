"""
Enterprise Digital Experience strategist audit: signals + OpenAI synthesis.

Author: Stuart McKay (HCLSoftware)
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
from bs4 import BeautifulSoup
from openai import OpenAI

from web_audit_agent.models import EnterpriseDxStrategistAnalysis, WebAuditReport

OPENAI_MODEL = "gpt-4o"
PAGESPEED_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"


def extract_html_signals(html: str) -> dict[str, Any]:
    """Structural heuristics for A11y, bloat, and AI-readiness (not a full audit)."""
    soup = BeautifulSoup(html, "lxml")
    scripts_src = soup.find_all("script", src=True)
    scripts_inline = [s for s in soup.find_all("script") if not s.get("src")]
    imgs = soup.find_all("img")
    img_no_alt = sum(1 for i in imgs if not (i.get("alt") or "").strip())
    json_ld_samples: list[str] = []
    for s in soup.find_all("script", type=lambda t: t and "ld+json" in str(t).lower()):
        raw = s.string or s.get_text() or ""
        if raw.strip():
            json_ld_samples.append(raw.strip()[:3500])
    h1 = soup.find_all("h1")
    landmarks = {
        "has_main": bool(soup.find("main") or soup.find(attrs={"role": "main"})),
        "has_nav": bool(soup.find("nav")),
        "has_banner": bool(soup.find("header") or soup.find(attrs={"role": "banner"})),
    }
    inputs = soup.find_all(["input", "select", "textarea"])
    buttons = soup.find_all("button")
    empty_buttons = sum(1 for b in buttons if not (b.get_text(strip=True) or b.get("aria-label")))
    return {
        "h1_count": len(h1),
        "script_with_src_count": len(scripts_src),
        "inline_script_count": len(scripts_inline),
        "img_count": len(imgs),
        "img_missing_alt_count": img_no_alt,
        "form_control_count": len(inputs),
        "button_count": len(buttons),
        "buttons_missing_accessible_name_estimate": empty_buttons,
        "landmarks": landmarks,
        "json_ld_block_count": len(json_ld_samples),
        "json_ld_type_hints": _json_ld_type_hints(json_ld_samples[:5]),
    }


def _json_ld_type_hints(samples: list[str]) -> list[str]:
    hints: list[str] = []
    for raw in samples:
        try:
            data = json.loads(raw)
            items = data if isinstance(data, list) else [data]
            for it in items[:3]:
                if isinstance(it, dict) and "@type" in it:
                    hints.append(str(it.get("@type")))
        except json.JSONDecodeError:
            hints.append("(unparseable JSON-LD snippet)")
    return hints[:12]


def extract_recovery_path_signals(html: str) -> dict[str, Any]:
    """Heuristics for error-page recovery (search, home, navigation density)."""
    soup = BeautifulSoup(html, "lxml")
    has_search = bool(soup.find("input", attrs={"type": "search"})) or bool(
        soup.find(attrs={"role": "search"})
    )
    for inp in soup.find_all("input", limit=50):
        t = (inp.get("type") or "").lower()
        n = (inp.get("name") or "").lower()
        ph = (inp.get("placeholder") or "").lower()
        if t == "search" or "search" in n or "search" in ph:
            has_search = True
            break
    home_like = False
    for a in soup.find_all("a", href=True, limit=100):
        h = a["href"].strip().lower()
        if h in ("/", "./", "../", "") or h.endswith("/index.html"):
            home_like = True
            break
        if "home" in (a.get_text(strip=True) or "").lower():
            home_like = True
            break
    return {
        "likely_has_search_ui": has_search,
        "likely_has_home_or_root_link": home_like,
        "internal_nav_link_count": len(soup.find_all("a", href=True)),
    }


def fetch_pagespeed_lighthouse(
    page_url: str,
    api_key: str,
    *,
    timeout: float = 90.0,
) -> dict[str, Any] | None:
    """
    Google PageSpeed Insights API v5 (performance + accessibility Lighthouse metrics).
    Set env ``GOOGLE_PAGESPEED_API_KEY`` (or pass key). Returns None on failure.
    """
    if not api_key.strip():
        return None
    try:
        r = httpx.get(
            PAGESPEED_URL,
            params=[
                ("url", page_url),
                ("strategy", "mobile"),
                ("key", api_key),
                ("category", "performance"),
                ("category", "accessibility"),
            ],
            timeout=timeout,
        )
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return None
    lh = data.get("lighthouseResult") or {}
    audits = lh.get("audits") or {}
    cats = lh.get("categories") or {}

    def audit_display(name: str) -> str | None:
        a = audits.get(name) or {}
        return a.get("displayValue")

    def audit_num(name: str) -> float | None:
        a = audits.get(name) or {}
        v = a.get("numericValue")
        return float(v) if isinstance(v, (int, float)) else None

    rb = audits.get("render-blocking-resources") or {}
    rb_items = (rb.get("details") or {}).get("items") or []

    return {
        "strategy": "mobile",
        "performance_score": (cats.get("performance") or {}).get("score"),
        "accessibility_score": (cats.get("accessibility") or {}).get("score"),
        "lcp_display": audit_display("largest-contentful-paint"),
        "lcp_numeric_ms": audit_num("largest-contentful-paint"),
        "cls_display": audit_display("cumulative-layout-shift"),
        "cls_numeric": audit_num("cumulative-layout-shift"),
        "total_blocking_time_display": audit_display("total-blocking-time"),
        "render_blocking_resources_count": len(rb_items),
        "server_response_time_display": audit_display("server-response-time"),
    }


def _enterprise_web_research(oai: OpenAI) -> tuple[str, str]:
    q = (
        "Act as a research assistant. Use web search for **2025–2026** enterprise digital experience standards:\n"
        "- Core Web Vitals (LCP, CLS, INP) and what “good” thresholds mean for enterprise portals.\n"
        "- **WCAG 2.2** expectations for semantic structure, keyboard use, and contrast (e.g. 4.5:1 for body text).\n"
        "- Enterprise / **HCL Digital Experience**-style portal expectations: clarity, governance, heavy JS risk.\n"
        "Output concise bullets the auditor can use as a rubric. Cite sources or domains when possible."
    )
    web_error: str | None = None
    try:
        resp = oai.responses.create(
            model=OPENAI_MODEL,
            tools=[{"type": "web_search_preview", "search_context_size": "medium"}],
            tool_choice="auto",
            input=q,
        )
        text = (resp.output_text or "").strip()
        if text:
            return text, "Enterprise criteria via OpenAI **web_search_preview**."
    except Exception as e:  # noqa: BLE001
        web_error = str(e)
    try:
        fb = oai.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": q
                    + "\n\nFallback: no live web. Summarize widely cited guidance; user must verify recency.",
                },
            ],
        )
        msg = (fb.choices[0].message.content or "").strip()
        note = "Enterprise criteria via **model-only fallback**"
        if web_error:
            note += f" ({web_error})"
        note += "."
        return msg, note
    except Exception as e2:  # noqa: BLE001
        return "", f"Research failed: {web_error or e2}"


def _run_dx_synthesis(
    oai: OpenAI,
    *,
    research: str,
    research_note: str,
    audited_url: str,
    entry_status: int,
    landing_snapshot: dict[str, Any] | None,
    html_signals: dict[str, Any],
    recovery_signals: dict[str, Any],
    probe: dict[str, Any] | None,
    pagespeed: dict[str, Any] | None,
    page_checks_summary: list[dict[str, Any]],
) -> tuple[EnterpriseDxStrategistAnalysis | None, str | None]:
    payload = {
        "role": "Senior Digital Experience (DX) Strategist and Full-Stack Auditor",
        "context": (
            "Assess against 2026 enterprise standards relevant to HCL Digital Experience–class portals. "
            "Some sites mask errors with **302/301 → 200** 'friendly' error pages; entries with "
            "**soft_404: true** or **issue_type soft_404** are HTTP 200 but flagged via final URL path "
            "(/404, /error, /not-found) or **title/h1** phrases (Page Not Found, Error, Oops). "
            "For those pages you MUST assess: (1) whether the redirect/reveal feels **jarring**; "
            "(2) whether **recovery path** (search, home, clear nav) is **prominent** and calming. "
            "Use ONLY the JSON facts provided; note uncertainty where signals are incomplete "
            "(e.g. contrast cannot be proven without computed styles)."
        ),
        "audited_url": audited_url,
        "entry_http_status": entry_status,
        "sampled_page_checks": page_checks_summary,
        "landing_page_structured_snapshot": landing_snapshot,
        "html_structure_signals": html_signals,
        "recovery_path_heuristics_entry_or_error_body": recovery_signals,
        "synthetic_404_probe": probe,
        "pagespeed_lighthouse_mobile": pagespeed,
        "external_research_rubric_summary": research,
        "research_note": research_note,
    }
    system = (
        "You are a Senior Digital Experience (DX) Strategist and Full-Stack Auditor for enterprise web properties. "
        "You must cover: (1) Status & connectivity and recovery path for non-200 experiences using recovery heuristics "
        "and probe; (1b) **soft_404_redirect_sentiment_and_recovery** — for any soft_404 or masked-error rows, "
        "evaluate jarring transitions vs helpful recovery UX (if none apply, state that); "
        "(2) Performance / Core Web Vitals using PageSpeed data when present, else infer cautiously from "
        "script counts; (3) Accessibility vs WCAG 2.2 *as inferable from structure only*—do not claim contrast ratios "
        "without CSS; (4) Human-first sentiment and copy quality from the text preview; (5) Friction / rage-click risk; "
        "(6) AI-readiness via JSON-LD signals. "
        "Output must match the response schema. "
        "friction_score_1_10: 1 = severe friction, 10 = low friction."
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
            response_format=EnterpriseDxStrategistAnalysis,
        )
        msg = completion.choices[0].message
        if msg.refusal:
            return None, f"Model refusal: {msg.refusal}"
        if msg.parsed:
            p = msg.parsed
            if research_note and not p.research_context_note.strip():
                p = p.model_copy(update={"research_context_note": research_note})
            return p, None
        return None, "No parsed enterprise DX response"
    except Exception as e:  # noqa: BLE001
        return None, str(e)


def merge_enterprise_dx_audit(
    report: WebAuditReport,
    *,
    landing_html: str | None,
    audited_url: str,
    main_final: str | None,
    probe_data: dict[str, Any] | None,
    pagespeed: dict[str, Any] | None,
) -> WebAuditReport:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return report.model_copy(
            update={"enterprise_dx_error": "OPENAI_API_KEY is not set (required for enterprise DX audit)"}
        )
    entry_status = report.main_page_status_code
    oai = OpenAI(api_key=key)
    research, rnote = _enterprise_web_research(oai)
    if not research.strip():
        return report.model_copy(
            update={"enterprise_dx_error": rnote or "Enterprise research produced no text"}
        )

    landing_snapshot: dict[str, Any] | None = None
    html_signals: dict[str, Any] = {}
    recovery_signals: dict[str, Any] = {}
    if landing_html:
        from web_audit_agent.agent import _snapshot_landing_page

        landing_snapshot = _snapshot_landing_page(landing_html, main_final or audited_url)
        html_signals = extract_html_signals(landing_html)
        recovery_signals = extract_recovery_path_signals(landing_html)

    page_checks_summary = [
        {
            "url": p.url,
            "status_code": p.status_code,
            "issue_type": p.issue_type.value,
            "check_kind": p.check_kind,
            "soft_404": p.soft_404,
            "soft_404_signals": p.soft_404_signals,
        }
        for p in report.page_checks[:80]
    ]

    dx, err = _run_dx_synthesis(
        oai,
        research=research,
        research_note=rnote,
        audited_url=audited_url,
        entry_status=entry_status,
        landing_snapshot=landing_snapshot,
        html_signals=html_signals,
        recovery_signals=recovery_signals,
        probe=probe_data,
        pagespeed=pagespeed,
        page_checks_summary=page_checks_summary,
    )
    if err:
        return report.model_copy(update={"enterprise_dx_error": err})
    return report.model_copy(
        update={
            "enterprise_dx": dx,
            "pagespeed_lighthouse": pagespeed,
        }
    )
