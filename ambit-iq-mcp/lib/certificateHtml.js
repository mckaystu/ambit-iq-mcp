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

export function buildAuditCertificateHtml({
  result,
  appName = "Unnamed Application",
  targetEnvironment = "unspecified",
  scannerName = "Ambit.IQ",
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
  <title>${esc(scannerName)} Audit Certificate</title>
  <style>
    :root{--bg:#0b1020;--card:#121a33;--line:#2b3b72;--text:#e9efff;--muted:#9fb1e6;--ok:#1ec28b;--bad:#ff5f7a;--warn:#f8c146}
    *{box-sizing:border-box} body{margin:0;background:linear-gradient(135deg,#0b1020,#0f1730);color:var(--text);font-family:Inter,system-ui,Segoe UI,Arial,sans-serif}
    .wrap{max-width:1080px;margin:24px auto;padding:0 16px}
    .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px}
    h1{margin:0 0 6px 0;font-size:1.6rem} h2{margin:0 0 10px 0;font-size:1.1rem}
    .sub{color:var(--muted);font-size:.94rem}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    .k{font-size:.8rem;color:var(--muted)} .v{font-size:1.1rem;font-weight:700}
    .badge{display:inline-block;padding:6px 12px;border-radius:999px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
    .badge.pass{background:rgba(30,194,139,.15);color:var(--ok);border:1px solid rgba(30,194,139,.4)}
    .badge.blocked{background:rgba(255,95,122,.14);color:var(--bad);border:1px solid rgba(255,95,122,.35)}
    table{width:100%;border-collapse:collapse} th,td{border-top:1px solid var(--line);padding:10px;vertical-align:top;text-align:left;font-size:.92rem}
    th{color:#c9d6ff;font-weight:600}
    .muted{color:var(--muted)}
    .sev{padding:3px 8px;border-radius:999px;font-size:.78rem;font-weight:700}
    .sev-low{background:rgba(30,194,139,.15);color:var(--ok)}
    .sev-medium{background:rgba(248,193,70,.18);color:var(--warn)}
    .sev-high,.sev-critical{background:rgba(255,95,122,.15);color:var(--bad)}
    .disclaimer{font-size:.88rem;line-height:1.45;color:#c9d6ff}
    @media (max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="card">
      <h1>${esc(scannerName)} Deployment Scan Certificate</h1>
      <div class="sub">Generated at ${esc(generatedAtIso())}</div>
      <p><span class="badge ${badgeClass(result.gate)}">${esc(result.gate)}</span></p>
      <div class="grid">
        <div><div class="k">Application</div><div class="v">${esc(appName)}</div></div>
        <div><div class="k">Environment</div><div class="v">${esc(targetEnvironment)}</div></div>
        <div><div class="k">Profile</div><div class="v">${esc(result.profile.id)}</div></div>
        <div><div class="k">Compliance Score</div><div class="v">${esc(result.metrics?.complianceScore ?? "n/a")}/100</div></div>
      </div>
    </section>

    <section class="card">
      <h2>Scan Summary</h2>
      <div class="grid">
        <div><div class="k">Active Rules</div><div class="v">${esc(result.totals.activeRules)}</div></div>
        <div><div class="k">Findings</div><div class="v">${esc(result.totals.findings)}</div></div>
        <div><div class="k">Blocking Findings</div><div class="v">${esc(result.totals.blockingFindings)}</div></div>
        <div><div class="k">Fail Threshold</div><div class="v">${esc(result.profile.failOn)}</div></div>
      </div>
      <p class="sub">Severity counts: low ${esc(result.metrics?.severityCounts?.low ?? 0)}, medium ${esc(result.metrics?.severityCounts?.medium ?? 0)}, high ${esc(result.metrics?.severityCounts?.high ?? 0)}, critical ${esc(result.metrics?.severityCounts?.critical ?? 0)}</p>
    </section>

    <section class="card">
      <h2>Findings and Remediations</h2>
      <table>
        <thead>
          <tr><th>Control</th><th>Domain</th><th>Severity</th><th>Finding</th><th>Recommended Fix</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    <section class="card">
      <h2>Certificate Disclaimer</h2>
      <p class="disclaimer">
        This document certifies that an automated Ambit.IQ policy scan was executed against the submitted code sample
        using the selected profile. It is an engineering governance artifact to support deployment decisions and does
        not constitute legal advice, regulatory attestation, or a guarantee of full compliance, security, or usability.
        Final approval should include human review, legal/compliance validation, and environment-specific controls.
      </p>
    </section>
  </div>
</body>
</html>`;
}
