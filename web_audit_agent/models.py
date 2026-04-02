"""
Pydantic models and Markdown rendering for the Web Audit Agent report.

Author: Stuart McKay (HCLSoftware)
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, computed_field


class LinkIssueType(str, Enum):
    """Bucket for HTTP outcome of a checked URL."""

    ok = "ok"
    broken = "broken"
    soft_404 = "soft_404"
    unauthorized = "unauthorized"
    forbidden = "forbidden"
    client_error = "client_error"
    server_error = "server_error"
    error = "error"


class LinkAuditItem(BaseModel):
    """One URL check: final URL, status, classification, and whether it was entry vs internal."""

    url: str
    status_code: int = Field(description="HTTP status or 0 if request failed")
    issue_type: LinkIssueType
    check_kind: Literal["entry", "internal"] = Field(
        default="internal",
        description="entry = seed URL (after redirects); internal = discovered same-origin link",
    )
    soft_404: bool = Field(
        default=False,
        description="True when status is 200 but URL path or title/h1 content suggests a masked error page",
    )
    soft_404_signals: list[str] = Field(
        default_factory=list,
        description="Machine-readable reasons (e.g. url_path_indicates_404, content_h1_error_word)",
    )


class UxAuditAnalysis(BaseModel):
    """Structured UX Auditor verdict (404 + landing) after research and page snapshots."""

    research_summary: str = Field(
        description="Concise synthesis of current best practices for 404 sentiment and 200 landing conversion, from web research or fallback knowledge",
    )
    research_source_note: str = Field(
        default="",
        description="How research was obtained, e.g. OpenAI web search vs model-only fallback",
    )
    landing_page_gaps: str = Field(
        description="Where the audited 200-level entry URL falls short vs those landing/conversion practices",
    )
    not_found_page_gaps: str = Field(
        description="Assessment of the site's 404 experience using the probe response (or explain if probe was not 404 / unavailable)",
    )
    prioritized_recommendations: list[str] = Field(
        default_factory=list,
        description="Ordered, actionable fixes",
    )
    executive_summary: str = Field(
        default="",
        description="Short paragraph tying research to gaps",
    )


class EnterpriseDxStrategistAnalysis(BaseModel):
    """
    Senior DX strategist audit: enterprise-oriented rubric applied to captured signals.
    Contrast ratios and true CWV lab values require tooling beyond static HTML unless PageSpeed data is present.
    """

    friction_score_1_10: int = Field(
        ge=1,
        le=10,
        description="1 = severe friction / risk, 10 = low friction; enterprise portal lens",
    )
    critical_fixes: list[str] = Field(
        default_factory=list,
        description="Highest-impact fixes (security, A11y blockers, broken flows, performance)",
    )
    sentiment_improvements: list[str] = Field(
        default_factory=list,
        description="Copy/tone changes for empathy, clarity, anxiety reduction",
    )
    status_connectivity_recovery: str = Field(
        description="200/4xx/5xx patterns from sample; recovery path (search, home, links) for error contexts",
    )
    performance_core_web_vitals: str = Field(
        description="LCP/CLS (and related) from PageSpeed when provided; else cautious inference from HTML weight",
    )
    accessibility_wcag_22: str = Field(
        description="Semantic HTML, keyboard, ARIA heuristics; contrast only where inferable—state limits",
    )
    sentiment_human_first: str = Field(
        description="Empathy, professionalism, anxiety reduction, 5-second value prop clarity",
    )
    friction_diagnostic: str = Field(
        description="Rage-click risk, forms, navigation cognitive load",
    )
    ai_readiness_schema_org: str = Field(
        description="JSON-LD / structured data and machine-readable content for LLM-oriented crawlers",
    )
    soft_404_redirect_sentiment_and_recovery: str = Field(
        default="",
        description=(
            "For pages flagged soft_404 or URL/content suggesting masked errors (e.g. 302→200 friendly 404): "
            "is the transition jarring? Is recovery path (search, home, nav) prominent and empathetic?"
        ),
    )
    enterprise_dx_executive_summary: str = Field(
        default="",
        description="Short synthesis for stakeholders",
    )
    research_context_note: str = Field(
        default="",
        description="How 2026 enterprise rubric research was obtained (web search vs fallback)",
    )


class BestPracticesAnalysis(BaseModel):
    """gpt-4o structured commentary from HTTP status data only (no page body)."""

    http_health_score_1_5: int = Field(
        ge=1,
        le=5,
        description="1=many failures/risks, 5=healthy status patterns",
    )
    http_status_assessment: str = Field(
        description="Interpret the mix of 2xx vs 4xx/5xx and what it implies for site health",
    )
    operational_best_practices: str = Field(
        description="HTTPS, redirects, broken links in sampled nav, auth walls (401/403), and similar operational practices",
    )
    recommendations: list[str] = Field(
        default_factory=list,
        description="Concrete next steps based only on the status data provided",
    )
    concerns: list[str] = Field(
        default_factory=list,
        description="Risks or gaps inferred from status codes (e.g. many 404s, inconsistent auth)",
    )
    executive_summary: str = Field(
        default="",
        description="Short synthesis of HTTP health and operational best practices",
    )


class WebAuditReport(BaseModel):
    """Full audit output: crawl, HTTP qualitative review, optional UX audit, optional enterprise DX strategist."""

    audited_url: str
    audited_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    main_page_final_url: str | None = None
    main_page_error: str | None = None
    entry_https: bool = Field(
        default=False,
        description="Whether the final entry URL uses https",
    )
    entry_redirected: bool = Field(
        default=False,
        description="True if the entry request ended on a different URL than audited_url (normalized)",
    )
    page_checks: list[LinkAuditItem] = Field(
        default_factory=list,
        description="First item is always the entry page (if checked); following items are sampled internal URLs",
    )
    crawl_max_depth: int = Field(
        default=2,
        ge=1,
        description=(
            "BFS depth from entry: 1 = only links on the entry page are checked; "
            "2 = also follow links found on those pages (same origin), up to max_internal_links"
        ),
    )
    links_discovered_count: int = 0
    internal_links_checked_count: int = 0
    qualitative: BestPracticesAnalysis | None = None
    openai_error: str | None = None
    ux_audit: UxAuditAnalysis | None = None
    ux_audit_error: str | None = None
    enterprise_dx: EnterpriseDxStrategistAnalysis | None = None
    enterprise_dx_error: str | None = None
    pagespeed_lighthouse: dict[str, Any] | None = Field(
        default=None,
        description="Mobile Lighthouse-derived metrics when GOOGLE_PAGESPEED_API_KEY is set",
    )

    @computed_field
    @property
    def main_page_status_code(self) -> int:
        if not self.page_checks or self.page_checks[0].check_kind != "entry":
            return 0
        return self.page_checks[0].status_code

    def to_markdown_summary(self) -> str:
        """Render a human-readable Markdown report (tables + sections)."""
        lines: list[str] = []
        lines.append("# Web audit summary")
        lines.append("")
        lines.append(f"- **URL:** {self.audited_url}")
        lines.append(f"- **Audited at:** {self.audited_at}")
        if self.main_page_final_url and self.main_page_final_url != self.audited_url:
            lines.append(f"- **Final URL:** {self.main_page_final_url}")
        lines.append(f"- **Entry HTTPS:** {'yes' if self.entry_https else 'no'}")
        lines.append(f"- **Entry redirected:** {'yes' if self.entry_redirected else 'no'}")
        lines.append(f"- **Main page status:** {self.main_page_status_code}")
        lines.append(f"- **Crawl max depth:** {self.crawl_max_depth}")
        if self.main_page_error:
            lines.append(f"- **Fetch error:** {self.main_page_error}")
        lines.append("")
        lines.append("## HTTP status by URL")
        lines.append("")
        lines.append("| Kind | URL | Status | Issue | Soft 404? | Signals |")
        lines.append("|------|-----|--------|-------|-----------|---------|")
        for p in self.page_checks:
            kind = "entry" if p.check_kind == "entry" else "internal"
            u = p.url.replace("|", "\\|")
            sf = "yes" if p.soft_404 else "no"
            sig = ", ".join(p.soft_404_signals[:4]) if p.soft_404_signals else "—"
            if len(sig) > 70:
                sig = sig[:67] + "…"
            sig = sig.replace("|", "\\|")
            lines.append(f"| {kind} | `{u}` | {p.status_code} | {p.issue_type.value} | {sf} | {sig} |")
        lines.append("")
        ok_n = sum(1 for p in self.page_checks if 200 <= p.status_code < 300)
        r3 = sum(1 for p in self.page_checks if 300 <= p.status_code < 400)
        c4 = sum(1 for p in self.page_checks if 400 <= p.status_code < 500)
        s5 = sum(1 for p in self.page_checks if 500 <= p.status_code < 600)
        err0 = sum(1 for p in self.page_checks if p.status_code == 0)
        lines.append("## Status buckets (sampled pages)")
        lines.append("")
        lines.append(f"- **2xx:** {ok_n} · **3xx:** {r3} · **4xx:** {c4} · **5xx:** {s5} · **Failed (0):** {err0}")
        lines.append(
            f"- **Internal URLs discovered (unique, all depths):** {self.links_discovered_count} · "
            f"**Internal URLs checked:** {self.internal_links_checked_count}"
        )
        lines.append("")
        broken = [x for x in self.page_checks if x.issue_type == LinkIssueType.broken]
        unauth = [x for x in self.page_checks if x.issue_type == LinkIssueType.unauthorized]
        forb = [x for x in self.page_checks if x.issue_type == LinkIssueType.forbidden]
        if broken:
            lines.append(f"- **404 (broken):** {len(broken)}")
            for item in broken[:15]:
                lines.append(f"  - `{item.url}` → {item.status_code}")
            if len(broken) > 15:
                lines.append(f"  - … and {len(broken) - 15} more")
        else:
            lines.append("- **404 (broken):** none in sample")
        if unauth:
            lines.append(f"- **401 (restricted):** {len(unauth)}")
            for item in unauth[:10]:
                lines.append(f"  - `{item.url}` → {item.status_code}")
        else:
            lines.append("- **401 (restricted):** none in sample")
        if forb:
            lines.append(f"- **403 (forbidden):** {len(forb)}")
            for item in forb[:10]:
                lines.append(f"  - `{item.url}` → {item.status_code}")
        else:
            lines.append("- **403 (forbidden):** none in sample")
        soft = [x for x in self.page_checks if x.issue_type == LinkIssueType.soft_404]
        if soft:
            lines.append(f"- **Soft 404 (masked error, HTTP 200):** {len(soft)}")
            for item in soft[:12]:
                sig = "; ".join(item.soft_404_signals[:5]) if item.soft_404_signals else "—"
                lines.append(f"  - `{item.url}` → {sig}")
            if len(soft) > 12:
                lines.append(f"  - … and {len(soft) - 12} more")
        else:
            lines.append("- **Soft 404 (masked):** none detected in sample")
        lines.append("")
        lines.append("## Best practices review (OpenAI)")
        lines.append("")
        if self.openai_error:
            lines.append(f"_(OpenAI step failed: {self.openai_error})_")
        elif self.qualitative:
            q = self.qualitative
            lines.append(f"**HTTP health score (1–5):** {q.http_health_score_1_5}")
            lines.append("")
            lines.append("### HTTP status patterns")
            lines.append(q.http_status_assessment)
            lines.append("")
            lines.append("### Operational best practices")
            lines.append(q.operational_best_practices)
            if q.concerns:
                lines.append("")
                lines.append("**Concerns:**")
                for c in q.concerns:
                    lines.append(f"- {c}")
            if q.recommendations:
                lines.append("")
                lines.append("**Recommendations:**")
                for r in q.recommendations:
                    lines.append(f"- {r}")
            if q.executive_summary:
                lines.append("")
                lines.append("### Executive summary")
                lines.append(q.executive_summary)
        elif self.main_page_error:
            lines.append(
                "_Best practices review was skipped because the entry page could not be loaded._"
            )
        else:
            lines.append("_(No qualitative analysis.)_")
        lines.append("")
        lines.append("## UX Auditor (404 sentiment + landing conversion)")
        lines.append("")
        if self.ux_audit_error:
            lines.append(f"_(UX audit failed: {self.ux_audit_error})_")
        elif self.ux_audit:
            u = self.ux_audit
            if u.research_source_note:
                lines.append(f"_{u.research_source_note}_")
                lines.append("")
            lines.append("### Research-backed criteria (summary)")
            lines.append(u.research_summary)
            lines.append("")
            lines.append("### Where the entry URL falls short (200-level landing)")
            lines.append(u.landing_page_gaps)
            lines.append("")
            lines.append("### 404 experience (from probe URL)")
            lines.append(u.not_found_page_gaps)
            if u.prioritized_recommendations:
                lines.append("")
                lines.append("### Prioritized recommendations")
                for rec in u.prioritized_recommendations:
                    lines.append(f"- {rec}")
            if u.executive_summary:
                lines.append("")
                lines.append("### Executive summary")
                lines.append(u.executive_summary)
        else:
            lines.append("_UX audit not run (pass `ux_audit=True` or use `--ux-audit`)._")
        lines.append("")
        lines.append("## Enterprise DX Strategist (2026-oriented)")
        lines.append("")
        if self.pagespeed_lighthouse:
            ps = self.pagespeed_lighthouse
            lines.append("### PageSpeed Insights (mobile Lighthouse) — snapshot")
            lines.append("")
            for k in (
                "performance_score",
                "accessibility_score",
                "lcp_display",
                "cls_display",
                "total_blocking_time_display",
                "render_blocking_resources_count",
            ):
                if k in ps and ps[k] is not None:
                    lines.append(f"- **{k}:** {ps[k]}")
            lines.append("")
        if self.enterprise_dx_error:
            lines.append(f"_(Enterprise DX audit failed: {self.enterprise_dx_error})_")
        elif self.enterprise_dx:
            d = self.enterprise_dx
            if d.research_context_note:
                lines.append(f"_{d.research_context_note}_")
                lines.append("")
            lines.append(f"### Friction score (1–10): **{d.friction_score_1_10}**")
            lines.append("")
            lines.append("### Critical fixes")
            for x in d.critical_fixes:
                lines.append(f"- {x}")
            if not d.critical_fixes:
                lines.append("_(none listed)_")
            lines.append("")
            lines.append("### Sentiment improvements")
            for x in d.sentiment_improvements:
                lines.append(f"- {x}")
            if not d.sentiment_improvements:
                lines.append("_(none listed)_")
            lines.append("")
            lines.append("### Status, connectivity & recovery")
            lines.append(d.status_connectivity_recovery)
            lines.append("")
            lines.append("### Performance (Core Web Vitals / bloat)")
            lines.append(d.performance_core_web_vitals)
            lines.append("")
            lines.append("### Accessibility (WCAG 2.2-oriented)")
            lines.append(d.accessibility_wcag_22)
            lines.append("")
            lines.append("### Human-first sentiment & copy")
            lines.append(d.sentiment_human_first)
            lines.append("")
            lines.append("### Friction diagnostic")
            lines.append(d.friction_diagnostic)
            lines.append("")
            lines.append("### AI-readiness (Schema.org / structured data)")
            lines.append(d.ai_readiness_schema_org)
            if d.soft_404_redirect_sentiment_and_recovery.strip():
                lines.append("")
                lines.append("### Soft 404 / masked errors — sentiment & recovery")
                lines.append(d.soft_404_redirect_sentiment_and_recovery)
            if d.enterprise_dx_executive_summary:
                lines.append("")
                lines.append("### Executive summary (DX)")
                lines.append(d.enterprise_dx_executive_summary)
        else:
            lines.append(
                "_Enterprise DX strategist not run (pass `enterprise_dx=True` or use `--enterprise-dx`)._"
            )
        lines.append("")
        lines.append("---")
        lines.append("_Web Audit Agent · Stuart McKay (HCLSoftware)_")
        return "\n".join(lines)
