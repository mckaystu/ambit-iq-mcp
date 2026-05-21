import { createHash } from "node:crypto";

/**
 * Stable dollar-quote tag derived from YAML so delimiter collisions are extremely unlikely.
 * @param {string} yaml
 */
export function dollarDelimiterTag(yaml) {
  return `v${createHash("sha256").update(yaml).digest("hex").slice(0, 20)}`;
}

/**
 * Single UPDATE merging `viml_document` into `rule_logic` JSONB.
 * @param {string} ruleId — uuid string
 * @param {string} yaml — full VIML document text
 */
export function buildRulesLibraryVimlDocumentUpdateSql(ruleId, yaml) {
  const tag = dollarDelimiterTag(yaml);
  const delim = `$${tag}$`;
  if (yaml.includes(delim)) {
    throw new Error(
      `VIML text contains delimiter ${delim}; edit YAML or regenerate tag (collision).`,
    );
  }
  const quoted = `${delim}${yaml}${delim}`;
  return `-- rule_id=${ruleId}\nUPDATE rules_library SET rule_logic = COALESCE(rule_logic, '{}'::jsonb) || jsonb_build_object('viml_document', ${quoted}::text) WHERE rule_id = '${ruleId}'::uuid;\n`;
}
