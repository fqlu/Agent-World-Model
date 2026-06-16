import { loadManifest } from "./spec";
import { WorkspaceDecl } from "./workspace";

export type Severity = "error" | "warn" | "info";
export type EffectiveSeverity = Severity | "off";

export type RuleView = {
  id: string;
  summary: string;
  group: string;
  defaultSeverity: Severity;
  severity: EffectiveSeverity;
  overridden: boolean;
};

export type Conventions = {
  relationshipPredicates: string[];
  wipRequiredSections: string[];
  // display-only in v1 (not per-workspace editable yet)
  pipeSeparator: string;
  entityKinds: string[];
};

export type RuleConfig = {
  rules: RuleView[];
  severityOf: (id: string) => EffectiveSeverity;
  conventions: Conventions;
};

const GROUP: Record<string, string> = {
  ST: "Structure",
  SC: "Scopes",
  CL: "Collections",
  NM: "Naming",
  JR: "Journal",
  AR: "Archive",
  CX: "Context groups",
  EN: "Entities",
  RL: "Relationships",
  TK: "Tasks",
};

const VALID: EffectiveSeverity[] = ["off", "error", "warn", "info"];

export function resolveRuleConfig(decl: WorkspaceDecl | null): RuleConfig {
  const m = loadManifest();
  const overrides = decl?.rules?.overrides ?? {};
  const conv = decl?.rules?.conventions ?? {};

  const rules: RuleView[] = m.rules.map((r) => {
    // Tolerate YAML 1.1 consumers that coerce the unquoted string `off` to the
    // boolean false on round-trip.
    const rawValue = (overrides as Record<string, unknown>)[r.id];
    const raw = rawValue === false ? "off" : (rawValue as EffectiveSeverity | undefined);
    const ovr = raw && VALID.includes(raw) ? raw : undefined;
    return {
      id: r.id,
      summary: r.summary,
      group: GROUP[r.id.split("-")[0]] ?? "Other",
      defaultSeverity: r.severity,
      severity: ovr ?? r.severity,
      overridden: Boolean(ovr) && ovr !== r.severity,
    };
  });

  const sevMap = new Map<string, EffectiveSeverity>(rules.map((r) => [r.id, r.severity]));

  return {
    rules,
    severityOf: (id) => sevMap.get(id) ?? "info",
    conventions: {
      relationshipPredicates:
        conv.relationship_predicates ?? m.relationships?.predicates ?? [],
      wipRequiredSections:
        conv.wip_required_sections ?? m.collections.wip_notes.required_sections,
      pipeSeparator: " | ",
      entityKinds: m.entities?.kinds ?? ["person", "system", "concept"],
    },
  };
}

// Rendered into AGENTS.md so agents see the same rules the linter enforces.
export function renderRulesSummary(cfg: RuleConfig): string {
  const active = cfg.rules.filter((r) => r.severity !== "off");
  const off = cfg.rules.filter((r) => r.severity === "off");
  const byGroup = new Map<string, RuleView[]>();
  for (const r of active) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group)!.push(r);
  }
  const lines: string[] = [];
  for (const [group, rs] of byGroup) {
    lines.push(`- **${group}:** ${rs.map((r) => `${r.id} (${r.severity})`).join(", ")}`);
  }
  if (off.length) lines.push(`- **Disabled here:** ${off.map((r) => r.id).join(", ")}`);
  lines.push(
    `- **Relationship vocabulary:** ${cfg.conventions.relationshipPredicates.join(", ")}`,
  );
  lines.push(`- **WIP note sections:** ${cfg.conventions.wipRequiredSections.join(", ")}`);
  return lines.join("\n");
}
