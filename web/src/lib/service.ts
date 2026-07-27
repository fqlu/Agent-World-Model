import { q } from "./db";
import { connectorFor } from "./hub";
import { runAudit, AuditResult } from "./linter";
import { buildScaffoldPlan, ScaffoldOptions } from "./scaffold";
import { buildAdoptionPlan } from "./adopt";
import { Op, applyOps, journalAgentActivity, OpResult } from "./ops";
import { parseWorkspaceYaml } from "./workspace";
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
  kind: "scaffold" | "adopt",
): Promise<number> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  let payload: PlanPayload;
  if (kind === "scaffold") {
    payload = { ops: buildScaffoldPlan(scaffoldOpts(wsId)), notes: [], manual: [] };
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
    const declRaw = await c.read("_Workspace.yaml");
    const decl = declRaw ? parseWorkspaceYaml(declRaw) : null;
    const journalMount = decl?.mounts?.journal ?? "Journal";
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
      const declRaw = await c.read("_Workspace.yaml");
      const journal = (declRaw ? parseWorkspaceYaml(declRaw) : null)?.mounts?.journal ?? "Journal";
      const d = report.diff;
      await journalAgentActivity(
        c,
        journal,
        `synced — ${d.modified.length} modified, ${d.added.length} added, ${d.removed.length} removed; projections refreshed`,
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
  const raw = await c.read("_Workspace.yaml");
  const decl = raw ? parseWorkspaceYaml(raw) : null;
  const { resolveRuleConfig } = await import("./rules");
  const cfg = resolveRuleConfig(decl);
  return {
    rules: cfg.rules,
    conventions: cfg.conventions,
    houseRules: decl?.house_rules ?? [],
    profile: ws.profile,
  };
}

// Persist rule overrides + tunable conventions into _Workspace.yaml, then
// regenerate AGENTS.md so the rulebook matches. Only non-default overrides are
// written, keeping the file clean.
export async function saveRulesSvc(
  wsId: number,
  overrides: Record<string, string>,
  conventions: { relationship_predicates?: string[]; wip_required_sections?: string[] },
  houseRules?: import("./workspace").HouseRule[],
): Promise<{ ok: true }> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const YAML = (await import("yaml")).default;
  const raw = await c.read("_Workspace.yaml");
  if (!raw) throw new Error("Workspace has no _Workspace.yaml");
  const doc = YAML.parse(raw) as Record<string, unknown>;

  const cleanOverrides: Record<string, string> = {};
  for (const [id, sev] of Object.entries(overrides)) {
    if (["off", "error", "warn", "info"].includes(sev)) cleanOverrides[id] = sev;
  }
  const rulesBlock: Record<string, unknown> = {};
  if (Object.keys(cleanOverrides).length) rulesBlock.overrides = cleanOverrides;
  const conv: Record<string, unknown> = {};
  if (conventions.relationship_predicates?.length)
    conv.relationship_predicates = conventions.relationship_predicates;
  if (conventions.wip_required_sections?.length)
    conv.wip_required_sections = conventions.wip_required_sections;
  if (Object.keys(conv).length) rulesBlock.conventions = conv;

  if (Object.keys(rulesBlock).length) doc.rules = rulesBlock;
  else delete doc.rules;

  // House rules (§9.2): keep only ones with non-empty text
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

  await c.write("_Workspace.yaml", YAML.stringify(doc), { overwrite: true });

  // Regenerate AGENTS.md from the new effective config
  try {
    const newDecl = parseWorkspaceYaml(YAML.stringify(doc));
    const mounts = {
      areas: newDecl?.mounts?.areas ?? [],
      journal: newDecl?.mounts?.journal ?? "Journal",
      templates: newDecl?.mounts?.templates ?? "Templates",
      archive: newDecl?.mounts?.archive ?? "Archive",
      context: newDecl?.mounts?.context,
      entities: newDecl?.mounts?.entities,
    };
    const { renderAgentsMd } = await import("./scaffold");
    const agents = renderAgentsMd(
      {
        workspaceName: ws.name,
        ownerName: process.env.HUB_OWNER_NAME ?? ws.name,
        ownerEmail: process.env.HUB_OWNER_EMAIL ?? ws.account_email ?? "owner@unknown",
        profile: ws.profile,
      },
      mounts,
      newDecl,
    );
    await c.write("AGENTS.md", agents, { overwrite: true });
    const journal = newDecl?.mounts?.journal ?? "Journal";
    await journalAgentActivity(c, journal, `rule config updated; AGENTS.md regenerated`);
  } catch {
    /* AGENTS regen / journal best-effort */
  }
  return { ok: true };
}

export async function exportOkfSvc(wsId: number) {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const { exportOkfBundle } = await import("./okf-export");
  const result = await exportOkfBundle(c, ws.id, ws.name);
  try {
    const declRaw = await c.read("_Workspace.yaml");
    const journal = (declRaw ? parseWorkspaceYaml(declRaw) : null)?.mounts?.journal ?? "Journal";
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
  stats: { concepts: number; entities: number; scopes: number; groups: number } | null;
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listBundlesSvc(wsId: number): Promise<BundleView[]> {
  return q.listBundles(wsId).map(bundleView);
}

// Options for the create form: client-level scopes (depth-1 in each area) and
// root-level context groups.
export async function bundleOptionsSvc(
  wsId: number,
): Promise<{ scopes: string[]; groups: { slug: string; title: string }[] }> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const declRaw = await c.read("_Workspace.yaml");
  const decl = declRaw ? parseWorkspaceYaml(declRaw) : null;
  const scopes: string[] = [];
  for (const area of decl?.mounts?.areas ?? []) {
    if (!(await c.exists(area))) continue;
    for (const e of await c.list(area)) {
      if (e.kind === "folder" && !e.name.startsWith("_") && !e.name.includes("|")) scopes.push(e.path);
    }
  }
  const { listGroups } = await import("./context");
  const { groups } = await listGroups(c, "");
  return { scopes, groups: groups.map((g) => ({ slug: g.slug, title: g.title })) };
}

export async function createBundleSvc(
  wsId: number,
  name: string,
  scopeKind: "workspace" | "scope" | "group",
  scopeRef?: string | null,
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
  const result = await exportOkfBundle(c, ws.id, ws.name, { slug, filter });
  const id = q.createBundle({
    workspace_id: wsId,
    name: name.trim(),
    slug,
    scope_kind: scopeKind,
    scope_ref: scopeRef ?? null,
    path: result.path,
  });
  q.touchBundle(id, { concepts: result.concepts, entities: result.entities, scopes: result.scopes, groups: result.groups });
  try {
    const declRaw = await c.read("_Workspace.yaml");
    const journal = (declRaw ? parseWorkspaceYaml(declRaw) : null)?.mounts?.journal ?? "Journal";
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
  const result = await exportOkfBundle(c, ws.id, ws.name, { slug: b.slug, filter });
  q.touchBundle(b.id, { concepts: result.concepts, entities: result.entities, scopes: result.scopes, groups: result.groups });
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
      const declRaw = await c.read("_Workspace.yaml");
      const decl = declRaw ? parseWorkspaceYaml(declRaw) : null;
      await journalAgentActivity(
        c,
        decl?.mounts?.journal ?? "Journal",
        `${ws.name} — regenerated _Index.md`,
      );
    } catch {
      // journal is best-effort here too
    }
  }
  return ok;
}
