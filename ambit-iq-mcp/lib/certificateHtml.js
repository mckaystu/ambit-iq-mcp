function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function badgeClass(gate) {
  return gate === "pass" ? "pass" : "blocked";
}

function generatedAtIso() {
  return new Date().toISOString();
}

/** HCL Software Enchanted–inspired certificate (light shell, blue accents). */
export function buildAuditCertificateHtml({
  result,
  appName = "Unnamed Application",
  targetEnvironment = "unspecified",
  scannerName = "agent.gate",
}) {
  const rows =
    result.findings.length === 0
      ? `<tr><td colspan="5" class="muted">No findings detected for this scan profile.</td></tr>`
      : result.findings
          .map(
            (f) => `
      <tr>
        <td><code>${esc(f.ruleId)}</code></td>
        <td>${esc(f.domain)}</td>
        <td><span class="sev sev-${esc(f.severity)}">${esc(f.severity)}</span></td>
        <td>${esc(f.title)}</td>
        <td>${esc(f.remediation)}</td>
      </tr>`,
          )
          .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(scannerName)} — scan certificate</title>
  <style>
    :root{
      --bg:#f6f8fb;--card:#ffffff;--line:#d3deec;--text:#1d2a3b;--muted:#4b6078;
      --brand:#0f62fe;--brand-weak:#eaf2ff;--ok:#00843d;--bad:#da1e28;--warn:#e8a317;
    }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font-family:"Source Sans 3",system-ui,Segoe UI,Arial,sans-serif;line-height:1.45}
    .strip{height:4px;background:linear-gradient(105deg,#0a3d91 0%,#0f62fe 45%,#4589ff 100%)}
    .wrap{max-width:1080px;margin:0 auto;padding:20px 16px 32px}
    .brandline{font-size:.75rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);margin-bottom:6px}
    .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:14px;box-shadow:0 8px 24px rgba(12,35,64,.06)}
    h1{margin:0 0 6px 0;font-size:1.5rem;font-weight:600;letter-spacing:-.02em}
    h2{margin:0 0 10px 0;font-size:1.05rem;font-weight:600}
    .sub{color:var(--muted);font-size:.9rem}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .k{font-size:.75rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
    .v{font-size:1.05rem;font-weight:600;color:var(--text)}
    .badge{display:inline-block;padding:6px 12px;border-radius:999px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;font-size:.72rem}
    .badge.pass{background:#e6f5ec;color:var(--ok);border:1px solid rgba(0,132,61,.35)}
    .badge.blocked{background:#ffecec;color:var(--bad);border:1px solid rgba(218,30,40,.25)}
    table{width:100%;border-collapse:collapse}
    th,td{border-top:1px solid var(--line);padding:10px;vertical-align:top;text-align:left;font-size:.9rem}
    th{color:var(--text);font-weight:600;background:var(--brand-weak)}
    .muted{color:var(--muted)}
    .sev{padding:3px 8px;border-radius:999px;font-size:.72rem;font-weight:700}
    .sev-low{background:#e6f5ec;color:var(--ok)}
    .sev-medium{background:#fff6e0;color:#8a5b00}
    .sev-high,.sev-critical{background:#ffecec;color:var(--bad)}
    .disclaimer{font-size:.86rem;line-height:1.5;color:var(--muted)}
    @media (max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style>
</head>
<body>
  <div class="strip" aria-hidden="true"></div>
  <div class="wrap">
    <p class="brandline">HCL Software · ${esc(scannerName)}</p>
    <section class="card">
      <h1>Deployment scan certificate</h1>
      <div class="sub">Generated at ${esc(generatedAtIso())}</div>
      <p><span class="badge ${badgeClass(result.gate)}">${esc(result.gate)}</span></p>
      <div class="grid">
        <div><div class="k">Application</div><div class="v">${esc(appName)}</div></div>
        <div><div class="k">Environment</div><div class="v">${esc(targetEnvironment)}</div></div>
        <div><div class="k">Profile</div><div class="v">${esc(result.profile.id)}</div></div>
        <div><div class="k">Compliance score</div><div class="v">${esc(result.metrics?.complianceScore ?? "n/a")}/100</div></div>
      </div>
    </section>

    <section class="card">
      <h2>Scan summary</h2>
      <div class="grid">
        <div><div class="k">Active rules</div><div class="v">${esc(result.totals.activeRules)}</div></div>
        <div><div class="k">Findings</div><div class="v">${esc(result.totals.findings)}</div></div>
        <div><div class="k">Blocking findings</div><div class="v">${esc(result.totals.blockingFindings)}</div></div>
        <div><div class="k">Fail threshold</div><div class="v">${esc(result.profile.failOn)}</div></div>
      </div>
      <p class="sub">Severity counts: low ${esc(result.metrics?.severityCounts?.low ?? 0)}, medium ${esc(result.metrics?.severityCounts?.medium ?? 0)}, high ${esc(result.metrics?.severityCounts?.high ?? 0)}, critical ${esc(result.metrics?.severityCounts?.critical ?? 0)}</p>
    </section>

    <section class="card">
      <h2>Findings and remediations</h2>
      <table>
        <thead>
          <tr><th>Control</th><th>Domain</th><th>Severity</th><th>Finding</th><th>Recommended fix</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    <section class="card">
      <h2>Certificate disclaimer</h2>
      <p class="disclaimer">
        This document certifies that an automated ${esc(scannerName)} policy scan was executed against the submitted code sample
        using the selected profile. It is an engineering governance artifact to support deployment decisions and does
        not constitute legal advice, regulatory attestation, or a guarantee of full compliance, security, or usability.
        Final approval should include human review, legal/compliance validation, and environment-specific controls.
      </p>
    </section>
  </div>
</body>
</html>`;
}
