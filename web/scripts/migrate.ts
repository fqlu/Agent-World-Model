/**
 * Migrate a local workspace from protocol v0.15 to v0.16 (SPEC §13).
 * No app database needed — point it at the workspace folder.
 *
 *   npm run migrate -- --root "/path/to/workspace"            # dry run: print the plan
 *   npm run migrate -- --root "/path/to/workspace" --apply    # apply it
 *   options: --profile <name> (default: the workspace's own), --name <display name>
 *
 * Nothing is deleted: originals of every changed file are copied to
 * <archive>/_protocol-v0.15/ first, and retired protocol files are moved there.
 */
import path from "node:path";
import { LocalFsConnector } from "../src/lib/connectors/localfs";
import { IgnoringConnector } from "../src/lib/ignore";
import { buildMigrationPlan } from "../src/lib/migrate";
import { applyOps, journalAgentActivity } from "../src/lib/ops";
import { readDecl, readMounts } from "../src/lib/config";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const root = arg("root");
  if (!root) throw new Error('Usage: npm run migrate -- --root "/path/to/workspace" [--apply]');
  const apply = process.argv.includes("--apply");
  const c = new IgnoringConnector(new LocalFsConnector(path.resolve(root)));
  const decl = await readDecl(c);
  const plan = await buildMigrationPlan(c, {
    workspaceName: arg("name") ?? path.basename(path.resolve(root)),
    profile: arg("profile") ?? decl?.profile ?? "core",
    ownerName: decl?.owner?.name,
    ownerEmail: decl?.owner?.email,
  });
  console.log(`\n${plan.notes.join("\n")}\n`);
  console.log("Summary:", plan.summary);
  console.log(`Operations: ${plan.ops.length}`);
  for (const op of plan.ops) {
    if (op.path.includes("/_protocol-v0.15/") && op.action === "write") continue; // archive copies: counted above
    console.log(`  ${op.action.padEnd(5)} ${op.path}${op.to ? ` → ${op.to}` : ""}  — ${op.note}`);
  }
  if (plan.manual.length) console.log(`\nNeeds a human:\n${plan.manual.map((m) => `  - ${m}`).join("\n")}`);
  if (!apply) {
    console.log("\nDry run — nothing changed. Re-run with --apply to migrate.");
    return;
  }
  if (!plan.ops.length) return;
  const results = await applyOps(c, plan.ops, new Set(plan.ops.map((_, i) => i)));
  const failed = results.filter((r) => !r.skipped && !r.ok);
  const ok = results.filter((r) => !r.skipped && r.ok).length;
  console.log(`\nApplied ${ok} operation(s); ${failed.length} failed.`);
  for (const f of failed) console.log(`  FAILED ${f.op.action} ${f.op.path}: ${f.error}`);
  const after = await readMounts(new IgnoringConnector(new LocalFsConnector(path.resolve(root))));
  await journalAgentActivity(
    c,
    after.journal,
    `workspace — migrated protocol v0.15 → v0.16: ${ok} operations${failed.length ? `, ${failed.length} failed` : ""}; originals in Archive/_protocol-v0.15/ → [AGENTS.md](../../../AGENTS.md)`,
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
