import YAML from "yaml";

export type Mounts = {
  areas: string[];
  journal: string;
  templates: string;
  archive: string;
  context?: string; // optional capability (SPEC §6.4)
  entities?: string; // optional capability (SPEC §6.6)
};

export type RuleOverride = "off" | "error" | "warn" | "info";

export type HouseRuleCheck =
  | { type: "filename_prefix"; allowed: string[]; applies_to?: string }
  | { type: "forbidden_substring"; values: string[]; applies_to?: string };

export type HouseRule = {
  text: string;
  severity?: RuleOverride;
  check?: HouseRuleCheck;
};

export type WorkspaceDecl = {
  spec_version?: string;
  profile?: string;
  owner?: { name?: string; email?: string };
  mounts?: Partial<Mounts> & { areas?: string[] };
  rules?: {
    overrides?: Record<string, RuleOverride>;
    conventions?: {
      relationship_predicates?: string[];
      wip_required_sections?: string[];
    };
  };
  house_rules?: HouseRule[];
};

// Parse leading YAML frontmatter from any markdown file (e.g. _Overview.md).
export function parseFrontmatter(md: string): { data: Record<string, unknown>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: md };
  try {
    const d = YAML.parse(m[1]);
    return { data: d && typeof d === "object" ? (d as Record<string, unknown>) : {}, body: m[2] };
  } catch {
    return { data: {}, body: m[2] };
  }
}

export function parseWorkspaceYaml(content: string): WorkspaceDecl | null {
  try {
    const parsed = YAML.parse(content);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as WorkspaceDecl;
  } catch {
    return null;
  }
}

// A pipe-name segment can be referred to by its full form, the text before a
// trailing parenthetical, or the parenthetical itself:
//   "Hanesbrands (Hanes)"            → Hanes (short in parens)
//   "NVI (New Vehicle Inventory)"    → NVI (long in parens)
export function allowedForms(segment: string): Set<string> {
  const forms = new Set<string>([segment.trim()]);
  const m = segment.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    if (m[1].trim()) forms.add(m[1].trim());
    if (m[2].trim()) forms.add(m[2].trim());
  }
  return forms;
}

export const PIPE = " | ";

// Check a scope/collection folder name against its ancestor chain.
// chain: allowedForms for each ancestor segment, outermost first.
export function checkPipeName(
  name: string,
  chain: Set<string>[],
): { ok: boolean; expectedPrefix: string; ownSegment: string | null } {
  const parts = name.split(PIPE);
  const expectedPrefix = chain.map((s) => [...s][0]).join(PIPE);
  if (parts.length !== chain.length + 1) {
    return { ok: false, expectedPrefix, ownSegment: parts[parts.length - 1] ?? null };
  }
  for (let i = 0; i < chain.length; i++) {
    if (!chain[i].has(parts[i].trim())) {
      return { ok: false, expectedPrefix, ownSegment: parts[parts.length - 1] };
    }
  }
  return { ok: true, expectedPrefix, ownSegment: parts[parts.length - 1] };
}

export function headings(md: string): string[] {
  return md
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.slice(3).trim());
}

export function sectionLines(md: string, section: string): string[] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${section}`);
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    out.push(lines[i]);
  }
  return out;
}
