import YAML from "yaml";
import { Connector } from "./connector";
import { parseFrontmatter, parseWorkspaceYaml, WorkspaceDecl } from "./workspace";

// Where a workspace's configuration lives (SPEC §2).
//  - v0.16: the YAML header of AGENTS.md (the only protocol file at the root).
//  - v0.15 (legacy): a separate _Workspace.yaml next to a generated AGENTS.md.
// Every tool reads the config through readDecl(), so both layouts audit and
// display; only v0.16 workspaces can be edited (legacy ones migrate first).

export const AGENTS_FILE = "AGENTS.md";
export const LEGACY_CONFIG_FILE = "_Workspace.yaml";

export type DeclSource = "agents-header" | "workspace-yaml";

export type DeclInfo = {
  decl: WorkspaceDecl | null;
  source: DeclSource | null;
  // raw header object (v0.16) or YAML document object (v0.15), for round-trips
  raw: Record<string, unknown> | null;
  // AGENTS.md exists but its header doesn't parse (v0.16 ST-001)
  invalidHeader?: boolean;
};

// "dcp/0.16" → "0.16.0"; "0.16" → "0.16.0"; anything else passes through.
export function protocolToVersion(protocol: unknown): string | undefined {
  if (typeof protocol !== "string") return undefined;
  const m = protocol.trim().match(/^(?:dcp\/)?(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!m) return protocol;
  return `${m[1]}.${m[2]}.${m[3] ?? "0"}`;
}

export function versionToProtocol(version: string): string {
  const m = version.match(/^(\d+)\.(\d+)/);
  return m ? `dcp/${m[1]}.${m[2]}` : `dcp/${version}`;
}

// A header is a v0.16 config when it carries `protocol` (or, tolerantly,
// `mounts`). A plain AGENTS.md (no header) is not a config.
export function headerToDecl(h: Record<string, unknown>): WorkspaceDecl | null {
  if (!("protocol" in h) && !("mounts" in h)) return null;
  const decl = { ...h } as WorkspaceDecl & { protocol?: unknown };
  decl.spec_version = protocolToVersion(h.protocol) ?? decl.spec_version;
  decl.layout = "v0.16";
  return decl;
}

export async function readDeclInfo(c: Connector): Promise<DeclInfo> {
  const agents = await c.read(AGENTS_FILE);
  if (agents !== null && /^---\r?\n/.test(agents)) {
    const { data } = parseFrontmatter(agents);
    const decl = headerToDecl(data);
    if (decl) return { decl, source: "agents-header", raw: data };
    if (!Object.keys(data).length) {
      // a header block that doesn't parse
      const legacy = await readLegacy(c);
      return legacy.decl ? legacy : { decl: null, source: null, raw: null, invalidHeader: true };
    }
  }
  return readLegacy(c);
}

async function readLegacy(c: Connector): Promise<DeclInfo> {
  const raw = await c.read(LEGACY_CONFIG_FILE);
  if (raw === null) return { decl: null, source: null, raw: null };
  const decl = parseWorkspaceYaml(raw);
  if (decl) decl.layout = "v0.15";
  return {
    decl,
    source: decl ? "workspace-yaml" : null,
    raw: decl ? (decl as unknown as Record<string, unknown>) : null,
  };
}

export async function readDecl(c: Connector): Promise<WorkspaceDecl | null> {
  return (await readDeclInfo(c)).decl;
}

export type ResolvedMounts = {
  areas: string[];
  journal: string;
  templates: string;
  archive: string;
  entities: string;
  proposals: string;
  context?: string; // legacy only
};

// Mount names with protocol defaults applied — v0.16 defaults are the
// _-prefixed folders; a legacy workspace keeps its declared (or old default) names.
export function resolveMounts(decl: WorkspaceDecl | null): ResolvedMounts {
  const legacy = decl?.layout === "v0.15";
  const m = decl?.mounts ?? {};
  return {
    areas: m.areas ?? [],
    journal: m.journal ?? (legacy ? "Journal" : "_Journal"),
    templates: m.templates ?? (legacy ? "Templates" : "_Templates"),
    archive: m.archive ?? "Archive",
    entities: m.entities ?? "_Entities",
    proposals: m.proposals ?? "_Proposals",
    context: legacy ? (m.context ?? undefined) : undefined,
  };
}

export async function readMounts(c: Connector): Promise<ResolvedMounts> {
  return resolveMounts(await readDecl(c));
}

// Order of keys in a rendered header — config first, rules last.
const HEADER_ORDER = ["protocol", "profile", "owner", "about", "mounts", "ignore", "rules", "house_rules"];

export function renderHeader(h: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  for (const k of HEADER_ORDER) if (h[k] !== undefined) ordered[k] = h[k];
  for (const [k, v] of Object.entries(h)) {
    if (!(k in ordered) && v !== undefined && k !== "layout" && k !== "spec_version") ordered[k] = v;
  }
  return `---\n${YAML.stringify(ordered).trimEnd()}\n---\n`;
}

// Edit a v0.16 workspace's config: mutate the header, then re-render the whole
// AGENTS.md (header + body) so the rulebook always matches the config. Legacy
// workspaces are read-only here — they migrate first (SPEC §13).
export async function updateDecl(
  c: Connector,
  mutate: (header: Record<string, unknown>) => void,
  ctx: { workspaceName: string; profile: string; ownerName?: string; ownerEmail?: string },
): Promise<WorkspaceDecl> {
  const info = await readDeclInfo(c);
  if (info.source === "workspace-yaml") {
    throw new Error(
      "This workspace uses the v0.15 layout (_Workspace.yaml). Migrate it to v0.16 first (workspace page → Migrate).",
    );
  }
  if (info.source !== "agents-header" || !info.raw) {
    throw new Error("Workspace has no config header in AGENTS.md");
  }
  const header = structuredClone(info.raw);
  mutate(header);
  const decl = headerToDecl(header);
  if (!decl) throw new Error("Config header lost its protocol/mounts keys");
  const { renderAgentsMd } = await import("./scaffold");
  const owner = (header.owner ?? {}) as { name?: string; email?: string };
  const text = renderAgentsMd(
    {
      workspaceName: ctx.workspaceName,
      ownerName: owner.name ?? ctx.ownerName ?? ctx.workspaceName,
      ownerEmail: owner.email ?? ctx.ownerEmail ?? "owner@unknown",
      profile: (header.profile as string | undefined) ?? ctx.profile,
    },
    resolveMounts(decl),
    decl,
    header,
  );
  await c.write(AGENTS_FILE, text, { overwrite: true });
  return decl;
}
