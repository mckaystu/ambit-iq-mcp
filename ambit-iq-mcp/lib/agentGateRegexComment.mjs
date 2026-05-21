/** Extract first `# AGENT_GATE:test <regex>` line from Rego for shadow impact simulation. */
export function extractAgentGateTestPattern(regoCode) {
  const text = String(regoCode || "");
  const m = text.match(/^\s*#\s*(?:AGENT_GATE|AMBIT):test\s+(.+)$/im);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw || raw.length > 256) return null;
  return raw;
}

/**
 * Models often emit PCRE-style (?i) at the start; `new RegExp("(?i)foo", "i")` throws in JavaScript.
 * Strip leading (?imsux...) clusters and map m/s into RegExp flags (outer "i" stays default).
 * @returns {{ source: string, flags: string, hadInline: boolean }}
 */
export function normalizeAgentGateRegexSource(raw) {
  const original = String(raw || "").trim();
  let p = original;
  let hadInline = false;
  let mFlag = false;
  let sFlag = false;
  while (true) {
    const m = p.match(/^\(\?([imsux]+)\)/i);
    if (!m) break;
    const chars = m[1].toLowerCase();
    if (!/^[imsux]+$/.test(chars)) break;
    hadInline = true;
    if (chars.includes("m")) mFlag = true;
    if (chars.includes("s")) sFlag = true;
    p = p.slice(m[0].length).trimStart();
  }
  let flags = "i";
  if (mFlag) flags += "m";
  if (sFlag) flags += "s";
  return { source: p, flags, hadInline: hadInline && p !== original };
}
