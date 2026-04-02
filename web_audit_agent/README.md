# Web Audit Agent

Fetches a URL, samples same-origin links, records **HTTP status codes** (2xx vs 4xx/5xx), and produces a **Pydantic** `WebAuditReport` with optional **OpenAI (gpt-4o)** commentary. An optional **UX Auditor** mode adds web-informed criteria and compares them to your entry page and a synthetic **404 probe**.

**Author:** Stuart McKay · **Organization:** HCLSoftware

## Requirements

- Python 3.10+ (this monorepo uses 3.12+)
- `httpx`, `beautifulsoup4`, `lxml`, `openai`, `pydantic`, `python-dotenv` (optional)

Set `OPENAI_API_KEY` for any OpenAI step. A `.env` file is loaded automatically if `python-dotenv` is installed.

**Soft 404 detection:** Final URLs containing path segments `/404`, `/error`, or `/not-found` are flagged as **`soft_404`** (HTTP 200 treated as a masked error). `<title>` / `<h1>` text matching *Page Not Found*, *Oops*, or word *Error* also flags. Internal links use an extra GET on 200 responses to read title/h1. Use **`--enterprise-dx`** for structured commentary on **jarring redirects** and **recovery-path** prominence for those cases.

## Install (from repo root)

The package lives at `web_audit_agent/` inside the `agents` project. With `uv`:

```bash
uv sync
```

## Command line

```bash
uv run python -m web_audit_agent https://example.com
uv run python -m web_audit_agent https://example.com --max-links 30 --crawl-depth 2
uv run python -m web_audit_agent https://example.com --ux-audit --json-out report.json --md-out report.md
```

| Flag | Meaning |
|------|--------|
| `URL` | Entry page to audit |
| `--max-links` | Cap on distinct internal URLs checked across all BFS depths (default 50) |
| `--crawl-depth` | BFS depth from entry: `1` = links on entry only; `2` (default) = also links on those pages; higher goes deeper (respects `--max-links`) |
| `--ux-audit` | Enable UX Auditor (research + entry snapshot + 404 probe) |
| `--enterprise-dx` | Senior DX strategist audit (2026-oriented rubric, friction score, PageSpeed if key set) |
| `--json-out` | Write full JSON report |
| `--md-out` | Write Markdown summary |

Optional: set **`GOOGLE_PAGESPEED_API_KEY`** for mobile Lighthouse **LCP/CLS** (and related) snapshots in the enterprise section.

## Python API

```python
from web_audit_agent import audit_site, audit_site_json_and_markdown, WebAuditReport

report: WebAuditReport = audit_site(
    "https://example.com",
    max_internal_links=50,
    crawl_max_depth=2,
    ux_audit=False,
    enterprise_dx=False,
)
print(report.model_dump_json(indent=2))
print(report.to_markdown_summary())

json_str, md_str = audit_site_json_and_markdown("https://example.com", ux_audit=True)
```

### `audit_site(url, *, max_internal_links=50, crawl_max_depth=2, timeout=25.0, user_agent=..., ux_audit=False, enterprise_dx=False)`

1. **GET** the entry URL; first row in `page_checks` has `check_kind="entry"`.
2. If the response is **2xx**, same-origin `<a href>` links are discovered in a **BFS** up to `crawl_max_depth` (default **2**): depth 1 is links on the entry page; deeper levels follow links found on **200** internal pages. Up to `max_internal_links` non-entry URLs are checked (**HEAD**, **GET** on 405 or transport failure).
3. **Best practices (HTTP-only):** sends a JSON summary of statuses to **gpt-4o** → `qualitative` (`BestPracticesAnalysis`). No page body is sent for this step.
4. If **`ux_audit=True`:** runs **Responses API** `web_search_preview` when available for research, then **gpt-4o** structured output comparing **landing snapshot** (title, meta, headings, CTA labels, text preview) and **404 probe** results → `ux_audit` (`UxAuditAnalysis`).
5. If **`enterprise_dx=True`:** web research for enterprise / CWV / WCAG context, **PageSpeed Insights** (if `GOOGLE_PAGESPEED_API_KEY`), HTML structural signals, recovery heuristics, and **gpt-4o** structured **`EnterpriseDxStrategistAnalysis`** (friction score 1–10, critical fixes, sentiment improvements, and narrative sections).

### Report highlights

- `crawl_max_depth`: configured BFS depth (see above).
- `page_checks`: list of `LinkAuditItem` (`url`, `status_code`, `issue_type`, `check_kind`).
- `main_page_status_code`: computed from the entry row.
- `qualitative` / `openai_error`: HTTP-health narrative from statuses only.
- `ux_audit` / `ux_audit_error`: optional UX Auditor output.

## Module layout

| Module | Role |
|--------|------|
| `__init__.py` | Public exports |
| `__about__.py` | Version and author metadata |
| `models.py` | Pydantic models and Markdown rendering |
| `agent.py` | Fetching, link checks, OpenAI calls, CLI |
| `enterprise_dx.py` | PageSpeed fetch, HTML/A11y heuristics, enterprise DX strategist merge |
| `__main__.py` | `python -m web_audit_agent` entry point |

## License / usage

Confirm compliance with your organization’s policies and the target sites’ terms of use before automated crawling. The default `User-Agent` identifies the tool as an audit script; customize `user_agent=` if required.
