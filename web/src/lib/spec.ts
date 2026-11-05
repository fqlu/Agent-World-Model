import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

// The spec lives in the repo at <repo root>/spec. The app runs from web/.
const SPEC_DIR = process.env.SPEC_DIR ?? path.resolve(process.cwd(), "..", "spec");

export type LintRuleDef = { id: string; severity: "error" | "warn" | "info"; summary: string };

export type SpecManifest = {
  spec_version: string;
  workspace: {
    config_file: string; // v0.16: AGENTS.md (YAML header)
    required_root_files: string[];
    required_header_keys?: string[];
    required_capabilities: string[];
    areas_min: number;
    legacy_root_files?: string[]; // v0.15 leftovers → ST-004 migration hint
  };
  scopes: {
    context_file: string;
    promotion: string;
    entity_overview_required: boolean;
    optional_files: string[];
    recommended_sections: string[];
    scope_types?: string[];
    scope_type_required_at_depth?: number;
  };
  collections: {
    wip_notes: { suffix: string; file_pattern: string; required_sections: string[] };
    journal: { path_pattern: string; agent_activity_heading: string; line_format?: string };
  };
  entities?: {
    default_mount: string;
    template: string;
    kinds: string[];
    required_frontmatter: string[];
  };
  relationships?: {
    stored_in: string;
    predicates: string[];
    target: string;
  };
  rules: LintRuleDef[];
  // The protocol's own fallback when a workspace names no (or a missing) profile.
  // Profiles themselves live outside the spec — see lib/profiles.ts.
  baseline?: Pick<ProfileDef, "default_topology" | "root_file_allowance">;
};

export type ProfileTopology = {
  areas: string[];
  journal: string;
  templates: string;
  archive: string;
  context?: string; // legacy (v0.15)
  entities?: string;
  proposals?: string;
};

export type ProfileDef = {
  description?: string;
  default_topology?: ProfileTopology;
  draft_lifecycle?: {
    working_prefix: string;
    production_prefixes: string[];
    sharing_only_from_production?: boolean;
  };
  status_flags?: Record<string, string>;
  root_file_allowance?: string[];
  [k: string]: unknown;
};

// Org-specific profiles: <repo root>/profiles/<name>/{profile.yaml,templates/}.
export const PROFILES_DIR =
  process.env.PROFILES_DIR ?? path.resolve(process.cwd(), "..", "profiles");
export const BASE_TEMPLATES_DIR = path.join(SPEC_DIR, "templates");

// Lowercase slug; also what keeps profile names from escaping PROFILES_DIR.
export const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

let cached: SpecManifest | null = null;

export function loadManifest(): SpecManifest {
  if (!cached) {
    const raw = fs.readFileSync(path.join(SPEC_DIR, "manifest.yaml"), "utf-8");
    cached = YAML.parse(raw) as SpecManifest;
  }
  return cached;
}

// Profile template overrides (profiles/<profile>/templates/<name>) take
// precedence over the organisation-neutral base templates in spec/templates/.
export function loadTemplate(name: string, profile?: string): string {
  if (profile && PROFILE_NAME_RE.test(profile) && path.basename(name) === name) {
    const override = path.join(PROFILES_DIR, profile, "templates", name);
    if (fs.existsSync(override)) return fs.readFileSync(override, "utf-8");
  }
  return fs.readFileSync(path.join(BASE_TEMPLATES_DIR, name), "utf-8");
}

export function relationshipPredicates(): string[] {
  return loadManifest().relationships?.predicates ?? [];
}

export function ruleDef(id: string): LintRuleDef {
  const def = loadManifest().rules.find((r) => r.id === id);
  if (!def) throw new Error(`Unknown lint rule: ${id}`);
  return def;
}
