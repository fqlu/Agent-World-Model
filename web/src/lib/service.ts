import { q } from "./db";
import { connectorFor } from "./hub";
import { runAudit, AuditResult } from "./linter";
import { buildScaffoldPlan, ScaffoldOptions } from "./scaffold";
import { buildAdoptionPlan } from "./adopt";
import { Op, applyOps, journalAgentActivity, OpResult } from "./ops";
import { readDecl, readMounts, resolveMounts, updateDecl } from "./config";
import { normalizeIgnoreList, normalizeIgnorePath } from "./ignore";
import { writeIndex } from "./index-gen";
import { writeModel } from "./model-gen";
import {
  buildManifest,
  detectChanges,
  reflectionScaffold,
  diffCount,
  Manifest,
  SyncReport,
} from "./sync";

export type PlanPayload = { ops: Op[]; notes: string[]; manual?: string[] };

function scaffoldOpts(wsId: number): ScaffoldOptions {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  return {
    workspaceName: ws.name,
    ownerName: process.env.HUB_OWNER_NAME ?? ws.name,
    ownerEmail: process.env.HUB_OWNER_EMAIL ?? ws.account_email ?? "owner@unknown",
    profile: ws.profile,
  };
}

export async function runAuditSvc(wsId: number): Promise<{ auditId: number; result: AuditResult }> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const result = await runAudit(connectorFor(ws), ws.profile);
  const auditId = q.insertAudit(wsId, result.findings, result.stats);
  return { auditId, result };
}

export async function createProposalSvc(
  wsId: number,
  kind: "scaffold" | "adopt" | "migrate",
): Promise<number> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  let payload: PlanPayload;
  if (kind === "scaffold") {
    payload = { ops: buildScaffoldPlan(scaffoldOpts(wsId)), notes: [], manual: [] };
  } else if (kind === "migrate") {
    // v0.15 → v0.16 (SPEC §13): one reviewable plan; originals archived first
    const { buildMigrationPlan } = await import("./migrate");
    const o = scaffoldOpts(wsId);
    const plan = await buildMigrationPlan(connectorFor(ws), o);
    payload = {
      ops: plan.ops,
      notes: [...plan.notes, `Summary: ${Object.entries(plan.summary).map(([k, v]) => `${v} ${k}`).join(", ")}`],
      manual: plan.manual,
    };
  } else {
    payload = await buildAdoptionPlan(connectorFor(ws), scaffoldOpts(wsId));
  }
  return q.insertProposal(wsId, kind, payload);
}

export async function applyProposalSvc(
  proposalId: number,
  selected: number[],
): Promise<OpResult[]> {
  const proposal = q.getProposal(proposalId);
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
  if (proposal.status === "applied") throw new Error("Proposal already applied");
  const ws = q.getWorkspace(proposal.workspace_id);
  if (!ws) throw new Error("Workspace not found");

  const c = connectorFor(ws);
  const plan = JSON.parse(proposal.plan) as PlanPayload;
  const results = await applyOps(c, plan.ops, new Set(selected));

  // Journal the application (SPEC §7.3). Best-effort — the apply itself stands.
  try {
    const journalMount = (await readMounts(c)).journal;
    const applied = results.filter((r) => !r.skipped && r.ok).length;
    const failed = results.filter((r) => !r.skipped && !r.ok).length;
    await journalAgentActivity(
      c,
      journalMount,
      `${ws.name} — applied ${proposal.kind} proposal #${proposalId}: ${applied} operation(s)${failed ? `, ${failed} failed` : ""}`,
    );
  } catch {
    // workspace may not have a journal yet (e.g. partial scaffold) — fine
  }

  const failed = results.some((r) => !r.skipped && !r.ok);
  q.finishProposal(proposalId, failed ? "applied_with_errors" : "applied", results);

  // Regenerate derived artifacts (SPEC §6.5, §6.8) — best-effort
  try {
    await writeIndex(c, ws.name);
    await writeModel(c);
  } catch {
    // generation must never fail an apply
  }
  return results;
}

export async function detectSyncSvc(
  wsId: number,
): Promise<SyncReport & { syncedAt: string | null }> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const row = q.getSyncState(wsId);
  const stored: Manifest | null = row ? (JSON.parse(row.manifest) as Manifest) : null;
  const report = await detectChanges(connectorFor(ws), stored);
  return { ...report, syncedAt: row?.synced_at ?? null };
}

export async function applySyncSvc(wsId: number): Promise<{
  report: SyncReport;
  scaffold: string;
  syncedAt: string | null;
}> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const row = q.getSyncState(wsId);
  const stored: Manifest | null = row ? (JSON.parse(row.manifest) as Manifest) : null;

  // 1. detect drift (pre-write)
  const report = await detectChanges(c, stored);

  // 2. re-derive projections so they match the files again
  try {
    await writeIndex(c, ws.name);
    await writeModel(c);
  } catch {
    /* generation is best-effort */
  }

  // 3. journal the sync (skipped on first baseline to keep it quiet)
  if (!report.firstRun && diffCount(report.diff) > 0) {
    try {
      const journal = (await readMounts(c)).journal;
      const d = report.diff;
      await journalAgentActivity(
        c,
        journal,
        `synced — ${d.modified.length} modified, ${d.added.length} added, ${d.removed.length} removed`,
      );
    } catch {
      /* journal best-effort */
    }
  }

  // 4. re-snapshot (captures the journal write + refreshed state) so the same
  //    drift isn't reported again next time
  const finalManifest = await buildManifest(c);
  q.saveSyncState(wsId, finalManifest);

  return {
    report,
    scaffold: reflectionScaffold(report.diff, row?.synced_at ?? null),
    syncedAt: row?.synced_at ?? null,
  };
}

export async function getRulesSvc(wsId: number) {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const decl = await readDecl(c);
  const { resolveRuleConfig } = await import("./rules");
  const cfg = resolveRuleConfig(decl);
  return {
    rules: cfg.rules,
    conventions: cfg.conventions,
    houseRules: decl?.house_rules ?? [],
    ignore: normalizeIgnoreList(decl?.ignore),
    profile: ws.profile,
    layout: decl?.layout ?? null,
  };
}

// Persist rule overrides + tunable conventions + house rules into the config
// header of AGENTS.md, which re-renders the rulebook from it (SPEC §9.1, §9.2).
// Only non-default overrides are written, keeping the header clean.
export async function saveRulesSvc(
  wsId: number,
  overrides: Record<string, string>,
  conventions: { relationship_predicates?: string[]; wip_required_sections?: string[] },
  houseRules?: import("./workspace").HouseRule[],
): Promise<{ ok: true }> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  await updateDecl(
    c,
    (doc) => {
      const cleanOverrides: Record<string, string> = {};
      for (const [id, sev] of Object.entries(overrides)) {
        if (["off", "error", "warn", "info"].includes(sev)) cleanOverrides[id] = sev;
      }
      const rulesBlock: Record<string, unknown> = {};
      if (Object.keys(cleanOverrides).length) rulesBlock.overrides = cleanOverrides;
      // v0.16: relationship predicates are fixed by the spec; only WIP sections are tunable
      if (conventions.wip_required_sections?.length)
        rulesBlock.conventions = { wip_required_sections: conventions.wip_required_sections };
      if (Object.keys(rulesBlock).length) doc.rules = rulesBlock;
      else delete doc.rules;

      if (houseRules) {
        const clean = houseRules
          .filter((h) => h && typeof h.text === "string" && h.text.trim())
          .map((h) => {
            const out: Record<string, unknown> = { text: h.text.trim() };
            if (h.severity && ["off", "error", "warn", "info"].includes(h.severity)) out.severity = h.severity;
            if (h.check?.type === "filename_prefix" && Array.isArray(h.check.allowed) && h.check.allowed.length) {
              out.check = { type: "filename_prefix", allowed: h.check.allowed, ...(h.check.applies_to ? { applies_to: h.check.applies_to } : {}) };
            } else if (h.check?.type === "forbidden_substring" && Array.isArray(h.check.values) && h.check.values.length) {
              out.check = { type: "forbidden_substring", values: h.check.values, ...(h.check.applies_to ? { applies_to: h.check.applies_to } : {}) };
            }
            return out;
          });
        if (clean.length) doc.house_rules = clean;
        else delete doc.house_rules;
      }
    },
    { workspaceName: ws.name, profile: ws.profile, root: ws.root },
  );
  await journalQuiet(c, "rule config updated; AGENTS.md re-rendered");
  return { ok: true };
}

async function journalQuiet(c: ReturnType<typeof connectorFor>, message: string) {
  try {
    await journalAgentActivity(c, (await readMounts(c)).journal, message);
  } catch {
    /* journal best-effort */
  }
}

// Dreaming settings (spec/DREAMING.md) live in the AGENTS.md header; saving
// re-renders AGENTS.md and the dreaming brief.
export async function getDreamingSvc(wsId: number) {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const decl = await readDecl(c);
  const { resolveDreaming, briefPath, kickoffMessage } = await import("./dreaming");
  const ctx = { workspaceName: ws.name, root: ws.root };
  const path = briefPath(decl);
  return {
    layout: decl?.layout ?? null,
    settings: resolveDreaming(decl, ctx),
    briefPath: path,
    briefExists: await c.exists(path),
    kickoff: kickoffMessage(decl, ctx),
  };
}

export async function saveDreamingSvc(wsId: number, patch: Record<string, unknown>) {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const allowed = ["agent_name", "mode", "runtime", "drive_path", "timezone", "nightly", "weekly", "report_channel", "budget", "other_agents", "notes"];
  await updateDecl(
    c,
    (doc) => {
      const cur = (doc.dreaming ?? {}) as Record<string, unknown>;
      for (const k of allowed) {
        if (!(k in patch)) continue;
        const v = patch[k];
        if (v === "" || v === null || (Array.isArray(v) && !v.length)) delete cur[k];
        else cur[k] = v;
      }
      if (Object.keys(cur).length) doc.dreaming = cur;
      else delete doc.dreaming;
    },
    { workspaceName: ws.name, profile: ws.profile, root: ws.root },
  );
  await journalQuiet(c, "dreaming settings updated; AGENTS.md and the dreaming brief re-rendered");
  return getDreamingSvc(wsId);
}

// Re-generate just the brief (e.g. after an app upgrade changed the template).
export async function regenerateDreamingBriefSvc(wsId: number) {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const decl = await readDecl(c);
  if (decl?.layout !== "v0.16") throw new Error("Migrate this workspace to v0.16 first");
  const { writeDreamingBrief } = await import("./dreaming");
  const path = await writeDreamingBrief(c, { workspaceName: ws.name, root: ws.root });
  await journalQuiet(c, `dreaming brief re-generated → ${path}`);
  return getDreamingSvc(wsId);
}

export async function getIgnoreSvc(wsId: number): Promise<{ ignore: string[] }> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const decl = await readDecl(connectorFor(ws));
  return { ignore: normalizeIgnoreList(decl?.ignore) };
}

// Persist the ignore list into the AGENTS.md config header (the knowledge
// layer, not the app DB); the rulebook re-renders so agents see the exclusions.
export async function saveIgnoreSvc(wsId: number, paths: unknown): Promise<{ ignore: string[] }> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  if (!Array.isArray(paths)) throw new Error("ignore must be a list of paths");
  const c = connectorFor(ws);
  const decl = await readDecl(c);
  const mm = resolveMounts(decl);
  const protectedFiles = new Set(["AGENTS.md"]);
  const mounts = [...mm.areas, mm.journal, mm.templates, mm.archive, mm.entities, mm.proposals].filter(
    (x): x is string => Boolean(x),
  );

  const clean: string[] = [];
  for (const item of paths) {
    const p = typeof item === "string" ? normalizeIgnorePath(item) : null;
    if (!p) throw new Error(`"${String(item)}" isn't a workspace-relative path`);
    if (protectedFiles.has(p)) throw new Error(`"${p}" is a protocol file and can't be ignored`);
    const mount = mounts.find((x) => x === p || x.startsWith(`${p}/`));
    if (mount) {
      throw new Error(
        `"${p}" ${mount === p ? "is" : "contains"} the declared mount "${mount}" — ignore folders inside it instead`,
      );
    }
    if (!(await c.exists(p))) throw new Error(`"${p}" doesn't exist in this workspace`);
    if (!clean.includes(p)) clean.push(p);
  }

  await updateDecl(
    c,
    (doc) => {
      if (clean.length) doc.ignore = clean;
      else delete doc.ignore;
    },
    { workspaceName: ws.name, profile: ws.profile, root: ws.root },
  );
  await journalQuiet(
    c,
    clean.length ? `ignore list updated (${clean.join(", ")}); AGENTS.md re-rendered` : "ignore list cleared; AGENTS.md re-rendered",
  );
  return { ignore: clean };
}

export async function exportOkfSvc(wsId: number) {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const { exportOkfBundle } = await import("./okf-export");
  const result = await exportOkfBundle(c, ws.id, ws.name);
  try {
    const journal = (await readMounts(c)).journal;
    await journalAgentActivity(c, journal, `exported OKF bundle — ${result.concepts} concept(s)`);
  } catch {
    /* journal best-effort */
  }
  return result;
}

// ---- Bundles ---------------------------------------------------------------
// A bundle is a named, generated OKF projection of the workspace (or a slice
// of it). Rows in the DB + directories in the app data dir only — the Drive
// is never written. "The Drive is the workshop; the bundle is the product."

export type BundleView = {
  id: number;
  name: string;
  slug: string;
  scopeKind: "workspace" | "scope" | "group";
  scopeRef: string | null;
  path: string;
  stats: { concepts: number; entities: number; scopes: number; groups: number; references?: number } | null;
  includeContent: boolean;
  createdAt: string;
  updatedAt: string;
};

function bundleView(r: import("./db").BundleRow): BundleView {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    scopeKind: r.scope_kind,
    scopeRef: r.scope_ref,
    path: r.path,
    stats: r.stats ? JSON.parse(r.stats) : null,
    includeContent: r.include_content === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listBundlesSvc(wsId: number): Promise<BundleView[]> {
  return q.listBundles(wsId).map(bundleView);
}

// Options for the create form: every promoted scope (any folder with an
// _Overview.md, at any depth) plus root-level context groups. The export
// engine slices on any path, so the picker shouldn't be narrower than it.
export async function bundleOptionsSvc(
  wsId: number,
): Promise<{ scopes: string[]; groups: { slug: string; title: string }[] }> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const decl = await readDecl(c);
  const scopes: string[] = [];
  async function walk(path: string, depth: number) {
    for (const e of await c.list(path)) {
      if (e.kind !== "folder" || e.name.startsWith("_") || e.name.startsWith(".")) continue;
      if (e.name.endsWith("| WIP Notes")) continue;
      const children = await c.list(e.path);
      const promoted = children.some((x) => x.name === "_Overview.md");
      if (promoted) scopes.push(e.path);
      if (depth < 3) await walk(e.path, depth + 1);
    }
  }
  for (const area of decl?.mounts?.areas ?? []) {
    if (await c.exists(area)) await walk(area, 1);
  }
  scopes.sort();
  if (decl?.layout === "v0.15") {
    const { listGroups } = await import("./context");
    const { groups } = await listGroups(c, "");
    return { scopes, groups: groups.map((g) => ({ slug: g.slug, title: g.title })) };
  }
  // v0.16: "group" bundles slice by facet (an entity with attributes.facet)
  const { listEntities } = await import("./entities");
  const { entities } = await listEntities(c);
  const facets = entities.filter((e) => e.attributes.facet);
  return { scopes, groups: facets.map((e) => ({ slug: e.slug, title: e.name })) };
}

export async function createBundleSvc(
  wsId: number,
  name: string,
  scopeKind: "workspace" | "scope" | "group",
  scopeRef?: string | null,
  includeContent?: boolean,
): Promise<BundleView> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  if (!name.trim()) throw new Error("Bundle needs a name");
  if (scopeKind !== "workspace" && !scopeRef) throw new Error(`A ${scopeKind} bundle needs a ${scopeKind} reference`);
  const { exportOkfBundle, bundleSlugify } = await import("./okf-export");
  const slug = bundleSlugify(name);
  if (q.getBundleBySlug(wsId, slug)) throw new Error(`A bundle named "${name}" (slug ${slug}) already exists`);
  const c = connectorFor(ws);
  const filter =
    scopeKind === "workspace" ? ({ kind: "workspace" } as const) : ({ kind: scopeKind, ref: scopeRef! } as const);
  const withContent = !!includeContent && scopeKind !== "workspace";
  const result = await exportOkfBundle(c, ws.id, ws.name, { slug, filter, includeContent: withContent });
  const id = q.createBundle({
    workspace_id: wsId,
    name: name.trim(),
    slug,
    scope_kind: scopeKind,
    scope_ref: scopeRef ?? null,
    path: result.path,
    include_content: withContent,
  });
  q.touchBundle(id, { concepts: result.concepts, entities: result.entities, scopes: result.scopes, groups: result.groups, references: result.references });
  try {
    const journal = (await readMounts(c)).journal;
    await journalAgentActivity(c, journal, `built OKF bundle "${name.trim()}" — ${result.concepts} concept(s)`);
  } catch {
    /* journal best-effort */
  }
  return bundleView(q.getBundle(id)!);
}

export async function refreshBundleSvc(wsId: number, bundleId: number): Promise<BundleView> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const b = q.getBundle(bundleId);
  if (!b || b.workspace_id !== wsId) throw new Error(`Bundle ${bundleId} not found in workspace ${wsId}`);
  const { exportOkfBundle } = await import("./okf-export");
  const c = connectorFor(ws);
  const filter =
    b.scope_kind === "workspace"
      ? ({ kind: "workspace" } as const)
      : ({ kind: b.scope_kind, ref: b.scope_ref! } as const);
  const result = await exportOkfBundle(c, ws.id, ws.name, {
    slug: b.slug,
    filter,
    includeContent: b.include_content === 1,
  });
  q.touchBundle(b.id, { concepts: result.concepts, entities: result.entities, scopes: result.scopes, groups: result.groups, references: result.references });
  return bundleView(q.getBundle(b.id)!);
}

// Deletes the bundle row + its generated directory in app scratch space.
// Never touches the workspace's files.
export async function deleteBundleSvc(wsId: number, bundleId: number): Promise<{ removed: string }> {
  const b = q.getBundle(bundleId);
  if (!b || b.workspace_id !== wsId) throw new Error(`Bundle ${bundleId} not found in workspace ${wsId}`);
  const { removeBundleDir } = await import("./okf-export");
  await removeBundleDir(wsId, b.slug);
  q.deleteBundle(b.id);
  return { removed: b.name };
}

export async function regenerateIndexSvc(wsId: number): Promise<boolean> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const ok = await writeIndex(c, ws.name);
  try {
    await writeModel(c);
  } catch {}
  if (ok) {
    try {
      await journalAgentActivity(c, (await readMounts(c)).journal, `${ws.name} — regenerated _Index.md`);
    } catch {
      // journal is best-effort here too
    }
  }
  return ok;
}
