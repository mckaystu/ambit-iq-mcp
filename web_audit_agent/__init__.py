"""
Web Audit Agent — HTTP crawl, status checks, and OpenAI-backed reporting.

Author: Stuart McKay (HCLSoftware)
"""

from web_audit_agent.__about__ import __author__, __organization__, __version__
from web_audit_agent.agent import audit_site, audit_site_json_and_markdown
from web_audit_agent.models import (
    BestPracticesAnalysis,
    EnterpriseDxStrategistAnalysis,
    LinkAuditItem,
    UxAuditAnalysis,
    WebAuditReport,
)

__all__ = [
    "__author__",
    "__organization__",
    "__version__",
    "audit_site",
    "audit_site_json_and_markdown",
    "BestPracticesAnalysis",
    "EnterpriseDxStrategistAnalysis",
    "LinkAuditItem",
    "UxAuditAnalysis",
    "WebAuditReport",
]
