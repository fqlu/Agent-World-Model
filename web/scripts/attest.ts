/**
 * Attester (SPEC §12, v0.15) — deterministic, no LLM.
 *
 * Compares the SANCTIONED computation inside an Attested Computation concept
 * file against the SQL that actually ran, after canonicalisation (comments
 * stripped, whitespace collapsed) and parameter substitution. A FAIL means
 * the logic was changed — surface it, never swallow it.
 *
 * Usage:
 *   npm run attest -- "<path to computation .md>" "<path to ran .sql>" [--param name=value ...]
 *
 * Exit code 0 = PASS, 1 = FAIL, 2 = usage/parse error.
 */
import fs from "node:fs";

function canonicalise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

function firstSqlBlock(md: string): string | null {
  const m = md.match(/```sql\r?\n([\s\S]*?)```/);
  return m ? m[1] : null;
}

function fail(msg: string, code = 2): never {
  process.stderr.write(msg + "\n");
  process.exit(code);
}

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--param"));
const params: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--param" && args[i + 1]?.includes("=")) {
    const [k, ...rest] = args[i + 1].split("=");
    params[k] = rest.join("=");
  }
}
if (files.length !== 2) fail("Usage: attest <computation.md> <ran.sql> [--param name=value ...]");

const [conceptPath, ranPath] = files;
const md = fs.readFileSync(conceptPath, "utf-8");
if (!/^---[\s\S]*?type:\s*Attested Computation/m.test(md.slice(0, 2000))) {
  fail(`${conceptPath} does not declare "type: Attested Computation" in frontmatter`);
}
let sanctioned = firstSqlBlock(md);
if (!sanctioned) fail(`${conceptPath} has no \`\`\`sql block (the sanctioned computation)`);
const ran = fs.readFileSync(ranPath, "utf-8");

// Substitute declared parameters ({{name}} placeholders) before comparing.
for (const [k, v] of Object.entries(params)) {
  sanctioned = sanctioned!.split(`{{${k}}}`).join(v);
}
const unfilled = sanctioned!.match(/\{\{[a-zA-Z0-9_]+\}\}/g);
if (unfilled) fail(`Sanctioned SQL still has unfilled parameter(s): ${[...new Set(unfilled)].join(", ")} — pass --param name=value`);

const a = canonicalise(sanctioned!);
const b = canonicalise(ran);

if (a === b) {
  process.stdout.write(`ATTESTED: PASS — the run matches the sanctioned computation.\n`);
  process.stdout.write(`Append a receipt to ${conceptPath}: {at, by, params, attested: pass}\n`);
  process.exit(0);
}

// locate first divergence for a useful message
let i = 0;
while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
const ctx = (s: string) => s.slice(Math.max(0, i - 60), i + 60);
process.stdout.write(
  [
    `ATTESTED: FAIL — the run DIVERGES from the sanctioned computation.`,
    ``,
    `First divergence (canonicalised, ±60 chars):`,
    `  sanctioned: …${ctx(a)}…`,
    `  ran:        …${ctx(b)}…`,
    ``,
    `This is either an incident (unsanctioned change — investigate) or a`,
    `deliberate update (change the sanctioned SQL in the concept file and have`,
    `the owner re-verify it). Record the verdict either way: {attested: fail}.`,
    ``,
  ].join("\n"),
);
process.exit(1);
