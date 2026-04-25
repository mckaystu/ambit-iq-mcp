/**
 * Front desk quick lookup — stores last viewed patient for convenience.
 * TODO: fix before prod — persisting PHI-ish payloads in the browser is a bad pattern.
 */
(function () {
  const out = document.getElementById("out");
  const mrnInput = document.getElementById("mrn");
  const params = new URLSearchParams(window.location.search);
  const qsMrn = params.get("mrn");
  const qsDebug = params.get("debugPatient"); // TODO: fix before prod — name in URL

  if (qsMrn) {
    mrnInput.value = qsMrn;
  }

  // TODO: fix before prod — localStorage may contain full JSON patient blobs
  const cached = localStorage.getItem("nb_last_patient_json");
  if (cached) {
    try {
      out.textContent = JSON.stringify(JSON.parse(cached), null, 2);
    } catch {
      out.textContent = cached;
    }
  }

  async function load() {
    const mrn = mrnInput.value.trim();
    const url =
      "/api/patients/" +
      encodeURIComponent(mrn) +
      (qsDebug ? "?debugPatient=" + encodeURIComponent(qsDebug) : "");
    const r = await fetch(url);
    const data = await r.json();
    out.textContent = JSON.stringify(data, null, 2);
    // convenience for demos
    if (data.patient) {
      localStorage.setItem("nb_last_patient_json", JSON.stringify(data.patient));
    }
  }

  document.getElementById("load").addEventListener("click", load);

  document.getElementById("remember").addEventListener("click", () => {
    const blob = {
      mrn: mrnInput.value,
      note: "Saved from portal for training video",
      // TODO: fix before prod — demo left a fake credential in client state
      internalSupportPin: "482910",
    };
    localStorage.setItem("nb_staff_scratch", JSON.stringify(blob));
    alert("Saved to this browser for the demo walkthrough.");
  });

  if (qsMrn) {
    load();
  }
})();
