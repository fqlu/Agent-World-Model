import Link from "next/link";

export const metadata = { title: "Glossary — Agent World Model" };

type Term = { term: string; def: string };
type Group = { heading: string; blurb: string; terms: Term[] };

const GROUPS: Group[] = [
  {
    heading: "Structure",
    blurb: "How a Drive is organised under the protocol.",
    terms: [
      { term: "Workspace", def: "A folder managed under the Drive Context Protocol — your Drive (or any folder) once it's set up. The whole thing the app operates on." },
      { term: "Area", def: "A top-level folder that holds scopes — e.g. Clients/ or Internal/. A workspace declares one or more. Names are free." },
      { term: "Scope", def: "A folder that represents a unit of work and carries an _Overview.md (a client, a product, a project). The addressable units of the workspace." },
      { term: "Entity (structural)", def: "The depth-1 folder inside an area — e.g. Clients/Hanesbrands (Hanes)/. The one level that must have an overview. (Note: different from a world-model entity below.)" },
      { term: "Promoted scope", def: "A deeper folder you've chosen to make a scope by giving it an _Overview.md. Promotion is opt-in — deeper folders are plain content until promoted." },
      { term: "Content folder", def: "Any folder without an overview — documents, exports, assets. Needs no context files; it inherits context from the scope above it." },
      { term: "Collection", def: "A folder of dated records, recognised by a reserved suffix — chiefly “… | WIP Notes” holding YYYY-MM-DD.md meeting notes." },
      { term: "Mount", def: "Where a protocol primitive lives in this workspace, declared in _Workspace.yaml — e.g. journal: Journal. Layout is data, not hard-coded." },
      { term: "Capability", def: "A protocol feature a workspace can mount: journal, templates, archive (required); context and entities (optional)." },
    ],
  },
  {
    heading: "The world model",
    blurb: "The layer of meaning on top of the files — the “cast” and how it connects.",
    terms: [
      { term: "World-model entity", def: "A first-class, addressable node for a person, system, or concept that recurs across the workspace — one markdown file in _Entities/." },
      { term: "Kind", def: "An entity's type: person, system, or concept. (Exports to OKF's required “type” field.)" },
      { term: "Relationship / predicate", def: "A typed edge between an entity and another entity or scope. The predicate is the verb — leads, owns, works-on, uses, deployed-for, depends-on, etc. (a closed vocabulary)." },
      { term: "Context group", def: "A named, cross-cutting set of folders (“MMM clients”, “Offline-conversions deployments”). Lives in a _Context/ directory; membership inherits to subfolders." },
      { term: "Provenance", def: "How a fact is known. source: asserted = human-confirmed; source: derived = extracted by an agent and pending your confirmation. confirmed = the date a human last vouched for it." },
      { term: "Projection (_Model.json)", def: "The generated, queryable snapshot of the whole world model — every node and edge in one file an agent can load to traverse it all at once." },
    ],
  },
  {
    heading: "Generated files",
    blurb: "Artifacts the app produces — derived, never hand-edited, rebuildable from the source.",
    terms: [
      { term: "_Workspace.yaml", def: "The topology declaration: which folders are areas, where the capabilities mount, the profile, and any rule overrides / house rules." },
      { term: "AGENTS.md", def: "The agent rulebook at the workspace root — the map, the operating rules, the enforced rules, and house rules. Any AI agent reads this one file to learn how to behave here. (Cross-vendor auto-discovery standard.)" },
      { term: "_Overview.md", def: "A scope's context file: what it is, active workstreams, key people, recent activity, reference. Free-form; the only required one is at each entity." },
      { term: "_Index.md", def: "A generated map of every scope and group — the high-recall document a search/RAG-based assistant retrieves to orient itself." },
    ],
  },
  {
    heading: "Governance",
    blurb: "How the protocol is checked and tuned.",
    terms: [
      { term: "Audit", def: "A read-only health check of the workspace against the rules. Reports findings; changes nothing." },
      { term: "Lint rule", def: "A built-in, machine-checkable rule (e.g. ST-001, NM-001). Each has an id and a severity." },
      { term: "Severity", def: "How a finding is weighted: error, warn, or info — or off to disable a rule for this workspace." },
      { term: "Convention", def: "A tunable parameter behind certain rules — the relationship vocabulary, the WIP-note sections, the pipe separator." },
      { term: "House rule", def: "A rule you write in plain language. Its text goes into AGENTS.md so agents follow it; an optional check (e.g. filename prefix) lets the audit enforce the mechanical part." },
      { term: "Profile", def: "An org-specific layer over the neutral core — starter topology, template overrides, rituals (e.g. the “incubeta” profile's Draft_ → [INT]/[EXT] lifecycle). “core” is the neutral baseline." },
    ],
  },
  {
    heading: "Operations",
    blurb: "What the app does to a workspace.",
    terms: [
      { term: "Scaffold", def: "Provision a fresh, spec-compliant workspace in an empty (or new) folder." },
      { term: "Repair / adoption proposal", def: "A reviewable plan that brings an existing folder into compliance. You approve operation by operation; nothing is deleted (superseded files move to Archive/)." },
      { term: "Sync (maintenance loop)", def: "Detect what changed in the Drive since last sync, refresh the generated artifacts, and hand an agent a reflection scaffold. Detection is read-only." },
      { term: "Reflection scaffold", def: "The list of changed files, framed as a task to give an agent so it can propose world-model updates grounded in those changes." },
    ],
  },
  {
    heading: "Interoperability",
    blurb: "Speaking the emerging open standard.",
    terms: [
      { term: "OKF (Open Knowledge Format)", def: "Google's open standard (v0.1, 2026) for portable, agent-readable knowledge — a directory of markdown concept files. We position DCP as a governed superset that exports to it." },
      { term: "OKF concept", def: "An OKF file with a required “type” field. Our entities, scopes, and groups export as typed concepts." },
      { term: "Bundle", def: "An OKF directory — concept docs plus reserved index.md and log.md — produced by the Export action. A generated artifact, not your canonical workspace." },
    ],
  },
];

export default function GlossaryPage() {
  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← Workspaces
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">Glossary</h1>
        <p className="mt-1 text-sm text-zinc-600">
          The vocabulary of the Drive Context Protocol and this app, in plain terms. New to it?
          Start with <Link href="/about" className="text-indigo-600 hover:underline">What is this?</Link>
        </p>
      </div>
      {GROUPS.map((g) => (
        <section key={g.heading}>
          <h2 className="text-lg font-semibold text-zinc-900">{g.heading}</h2>
          <p className="text-sm text-zinc-500">{g.blurb}</p>
          <dl className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {g.terms.map((t) => (
              <div key={t.term} className="grid gap-1 px-4 py-3 sm:grid-cols-[200px_1fr] sm:gap-4">
                <dt className="font-medium text-zinc-900">{t.term}</dt>
                <dd className="text-sm text-zinc-600">{t.def}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
