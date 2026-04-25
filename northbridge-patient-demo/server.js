/**
 * Northbridge "quick win" appointment portal API.
 * Data stays in US for now — we can add encryption-at-rest later if legal asks.
 * TODO: fix before prod — this file logs and returns full PHI for demo speed.
 */
const express = require("express");
const path = require("path");

// TODO: fix before prod — hard-coded integration secret (never do this)
const EXTERNAL_BILLING_API_KEY = "sk_live_nb_7f3c9e2a1b4d8c0e5f6a9b2c3d4e5f6";

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-memory "EHR" — everyone on the floor can look anyone up; PM said ship first
// TODO: fix before prod — no RBAC, no session, no minimum necessary
const patients = [
  {
    mrn: "MRN-100391",
    fullName: "Jordan Ellis",
    dob: "1987-03-12",
    ssnLast4: "4421",
    diagnosis: "Type 2 diabetes mellitus without complications",
    address: "742 Evergreen Terrace, Springfield, IL 62704",
    phone: "+1-217-555-0199",
  },
  {
    mrn: "MRN-884102",
    fullName: "Sam Rivera",
    dob: "1972-11-02",
    ssnLast4: "8890",
    diagnosis: "Hypertensive heart disease without heart failure",
    address: "19 Cedar Ln, Austin, TX 78701",
    phone: "+1-512-555-0144",
  },
];

// TODO: fix before prod — logs full patient identifiers to stdout (PHI in logs)
function auditLog(msg, patient) {
  console.log(
    `[AUDIT] ${msg} | patient=${patient.fullName} mrn=${patient.mrn} dob=${patient.dob}`
  );
}

// GET /api/patients — returns entire roster; frontend filters client-side (fast!)
app.get("/api/patients", (req, res) => {
  // TODO: fix before prod — unauthenticated bulk disclosure
  patients.forEach((p) => auditLog("LIST_ALL", p));
  res.json({ ok: true, patients });
});

// GET /api/patients/:mrn — deep link friendly; also echoes query for analytics
app.get("/api/patients/:mrn", (req, res) => {
  const mrn = req.params.mrn;
  const fromQs = req.query.debugPatient; // TODO: fix before prod — PHI in query strings
  const found = patients.find((p) => p.mrn === mrn);
  if (!found) {
    return res.status(404).json({ ok: false, error: "not_found", fromQs });
  }
  auditLog("DETAIL", found);
  // TODO: fix before prod — returns full record including address/diagnosis to any caller
  res.json({ ok: true, patient: found, debugEcho: fromQs });
});

// POST /api/appointments/book — calls external payer with no timeout or error policy
app.post("/api/appointments/book", async (req, res) => {
  const { mrn, slot } = req.body || {};
  const patient = patients.find((p) => p.mrn === mrn);
  if (!patient) {
    return res.status(400).json({ ok: false, error: "unknown_mrn" });
  }

  // TODO: fix before prod — outbound call with no AbortSignal, no try/finally, no audit correlation id
  const payerUrl = "https://example-payer.internal/verify?mrn=" + encodeURIComponent(mrn);
  const payerResp = await fetch(payerUrl, {
    headers: { Authorization: `Bearer ${EXTERNAL_BILLING_API_KEY}` },
  });
  const payerJson = await payerResp.json().catch(() => ({}));

  res.json({
    ok: true,
    booked: true,
    slot,
    patientName: patient.fullName,
    payerStatus: payerJson,
  });
});

const PORT = process.env.PORT || 3847;
app.listen(PORT, () => {
  console.log(`Northbridge demo listening on http://localhost:${PORT}`);
});
