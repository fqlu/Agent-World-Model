# Drive Context Protocol — Specification

**Version:** 0.8.0 (draft)
**Status:** 🟠 Draft — under review by James Lu
**Reference implementation:** Incubeta Master Folder (jamesfqlu@gmail.com Drive)

---

## 1. Purpose

This spec defines a standard structure for a knowledge Drive that both humans and
AI agents can navigate, edit, and extend without ambiguity. It exists so that:

- **Agents retrieve by address, not by search.** Any agent that knows the protocol
  knows exactly where context lives for a given client, project, or day — no
  embeddings, no retrieval guesswork, full transparency about what was read.
- **People are interoperable.** Two people running this structure on separate
  Drives can hand work (and agents) to each other; the rituals are identical.
- **Memory is durable and inspectable.** What agents and humans did, decided, and
  still owe is written into the structure itself, in plain markdown.

A Drive that follows this spec is called a **workspace**.

### Design principles

1. **Files are the database.** Markdown and folders are canonical. Any app or
   index built on top must be rebuildable from the files alone.
2. **Humans and agents share one substrate.** No agent-only side-channel state.
   Anything an agent knows or did is readable (and editable) by a human.
3. **Non-destructive by contract.** Nothing in a workspace is ever deleted by an
   agent or tool — superseded material moves to `Archive/`.
4. **Convention over enforcement, enforcement over chaos.** The spec defines a
   small set of MUSTs (machine-lintable) and a larger set of SHOULDs. Tools lint
   and propose; humans approve.
5. **Core vs profile.** Rules in this spec are universal. Organisation-specific
   rituals (e.g. Incubeta's `Draft_` lifecycle) live in a named **profile**
   (§10) layered on top.

Keywords MUST / SHOULD / MAY follow RFC 2119 usage. Every MUST and SHOULD maps
to a lint rule in §9 and in `manifest.yaml`.

---

## 2. Workspace topology (declarative)

A workspace's folder layout is **data, not spec**. The spec fixes only the
primitives — scopes (§3), collections (§4), context files (§6), and the three
capabilities **journal**, **templates**, and **archive** — and each workspace
declares where those primitives are mounted in a root topology manifest,
`_Workspace.yaml`:

```yaml
spec_version: 0.8.0
profile: incubeta
mounts:
  areas: [Clients, Internal]   # scope-bearing folders (≥1, any names)
  journal: Journal             # memory capability (§7)
  templates: Templates         # canonical templates for this workspace
  archive: Archive             # non-destruction capability (§8)
  context: _Context            # OPTIONAL: context groups (§6.4)
```

- The workspace root MUST contain `_Workspace.yaml`, `AGENTS.md`, and
  `_Overview.md`. `[ST-001]`
- Every mount declared in `_Workspace.yaml` MUST exist. `[ST-002]`
- The three capabilities — journal, templates, archive — MUST each be mounted
  somewhere; their paths and names are free. Without them the memory (§7) and
  safety (§8) contracts have no home. `[ST-003]`
- The **context** capability (§6.4) is OPTIONAL. When declared, its mount must
  exist like any other (`[ST-002]`) and its group files must be valid.
- At least one **area** MUST be declared. Areas hold scopes; their names are
  free (`Clients`, `Projects`, `Research`…). `[ST-003]`
- Root items not declared in the manifest are flagged for triage. Profiles MAY
  whitelist extra root files (e.g. `CLAUDE.md`). `[ST-004]`
- `AGENTS.md` is generated from the spec + profile + `_Workspace.yaml` and
  MUST stay in sync with it — its Map section *is* the declared topology, so
  agents learn the layout by reading one file. Retrieval by address survives
  because the address book is declared, not assumed. `[ST-005]`

**Profiles ship starter topologies, not laws.** The `incubeta` profile default
is `Clients/ + Internal/ + Journal/ + Templates/ + Archive/` (the reference
workspace). A teammate might mount `Projects/ + Knowledge/` instead; both lint
clean, and both speak the same protocol.

> **Divergence from reference:** the reference workspace keeps `CLAUDE.md` at
> root with no root `_Overview.md` or `AGENTS.md`. Under this spec the agent
> rulebook is the tool-agnostic `AGENTS.md`; a `CLAUDE.md` (allowed by the
> Incubeta profile) should reduce to pointers at `AGENTS.md` plus
> tool-specific notes.

---

## 3. Scopes — content by default, promotion by choice

The protocol deliberately does NOT demand context files everywhere. Folders
are **content by default**; a folder becomes a **scope** only when someone
gives it an `_Overview.md`. Governance lives at a few mandatory anchors plus
whatever depth *you* choose to maintain — ceremony never exceeds value.

| Kind | How recognised | Obligations |
|---|---|---|
| **Entity** | depth-1 folder in an area (`Clients/Hanesbrands (Hanes)/`) | MUST have `_Overview.md` `[SC-001]`; no pipes in name `[NM-003]` |
| **Promoted scope** | any deeper folder containing `_Overview.md` | pipe-name mirrors ancestry `[NM-001]`; ISO dates `[NM-002]` |
| **Collection** | reserved suffix (`… \| WIP Notes`) | collection rules (§4) |
| **Content folder** | everything else | **none** — documentation bundles, asset dumps, working files need no context machinery |

- Entities are the mandatory context anchor: the level agents always need.
  For a typical workspace this is a handful of files, not hundreds.
- **Promotion is the act of adding an `_Overview.md`** to a deeper folder —
  do it when a folder is a living workstream whose context you'll maintain.
  The linter validates what exists; it never demands new overviews below
  entity level.
- Content folders inherit their context from the nearest scope above them and
  from context groups (§6.4) — wiring a content folder into a group is the
  cheap way to give it semantics without maintaining a context file.
- Scopes MAY contain working files directly, collections, child scopes, and
  content folders.

---

## 4. Collections

Collections are folders of homogeneous, dated records.

### 4.1 WIP Notes

- Name: `<scope pipe-name> | WIP Notes`.
- Contents: meeting / working-session notes named `YYYY-MM-DD.md`, following
  the WIP Note template. Same-day follow-ups merge into the day's file rather
  than creating a second file. `[CL-001]` `[CL-002]`
- Placement rule: notes scoped to one unit/sub-project live in that scope's
  WIP Notes; cross-unit entity meetings live in the entity-level WIP Notes.

### 4.2 Journal

- Path: `<journal mount>/YYYY/YYYY-MM/YYYY-MM-DD.md`. `[JR-001]`
- One file per day with activity. The journal is an **index**: one line per
  event, each line linking to where the substance lives. No substance in the
  journal itself. `[JR-002]`
- The journal is also the **agent activity log** (§7.3).

---

## 5. Naming

### 5.1 The pipe convention

Promoted scopes below entity level and collections MUST be named as
pipe-separated paths that mirror their ancestry (content folders MAY follow
the convention — it helps search — but are not linted): `[NM-001]`

```
<Entity short name> | <Unit>
<Entity short name> | <Unit short name> | <Sub-project>
```

- **Short names** are declared in parentheses at the end of a folder's own
  segment — `Hanesbrands (Hanes)`, `TMCA | NVI (New Vehicle Inventory)` — and
  descendants use the short form: `Hanes | Bonds`, `TMCA | NVI | Floodlight`.
  If no parenthesised short name exists, the full segment is the short name.
- Rationale: every folder is self-describing in Drive search results and in
  agent tool output, at the cost of renames cascading. Tools MUST treat a
  parent rename as a propagating operation (§8).

### 5.2 Special files

- Context files are prefixed `_` so they sort first: `_Overview.md`,
  `_Tasks.md`, `_Index.md`. (`AGENTS.md` is unprefixed deliberately — it
  follows the cross-vendor agent auto-discovery naming standard.)
- Dates in the names of promoted scopes MUST be ISO `YYYY-MM-DD` (or
  `YYYY-MM` for months); content folders are not linted. `[NM-002]`
- Entity folder names MUST NOT contain pipes. `[NM-003]`

---

## 6. Context files

### 6.1 `_Overview.md` (entities and promoted scopes)

The workhorse — and deliberately **free-form**: its presence is what makes a
folder a scope; its content is not linted. The template recommends a proven
skeleton, but a two-line overview that a human actually maintains beats a
five-section stub nobody fills in.

Recommended sections (the template ships these; tooling like the index
generator reads "What it is" when present):

| Section | Content |
|---|---|
| `## What it is` | 1–3 sentences: what this scope is, the org's remit, who owns it |
| `## Active workstreams` | bullet list: **name** — one-line status → folder/file link |
| `## Key people` | client side / org side, with roles and emails where known |
| `## Recent activity` | newest-first dated one-liners → links; keep ~10 |
| `## Reference` | links: key docs, dashboards, production folders, related scopes |

The **root** `_Overview.md` identifies the workspace owner and what the
workspace covers. (Topology is declared in `_Workspace.yaml`, not here.)

### 6.2 `_Tasks.md` (optional per scope)

Open commitments that outlive a single meeting. Format:

```markdown
# <Scope> — Tasks

## Open
- [ ] YYYY-MM-DD · @owner — task description → [source](link)

## Done (recent)
- [x] YYYY-MM-DD · @owner — task description → [outcome](link)
```

- Agents MUST read `_Tasks.md` (if present) before starting work in a scope
  and MUST move completed items to `## Done` rather than deleting them.
  `[TK-001]`
- Action items in WIP notes are the *origin* of tasks; promoting one to
  `_Tasks.md` is a judgement call — promote what must survive the week.

### 6.3 `AGENTS.md` (workspace root, required)

The agent-facing rulebook, generated by the provisioning tool from this spec,
the active profile, and `_Workspace.yaml`. It declares the spec version and
profile, renders the declared topology as its Map section, and condenses the
operating rules (§7–8) so that *any* agent — regardless of vendor — can be
pointed at the workspace root and behave correctly. `[ST-005]`

The filename follows the cross-vendor `AGENTS.md` convention that agentic
tools increasingly auto-discover, minimising per-agent configuration. Vendor
files (`CLAUDE.md`, `GEMINI.md`…) SHOULD reduce to a pointer at `AGENTS.md`
plus vendor-specific notes. (Renamed from `_PROTOCOL.md` in spec v0.5;
adoption tooling archives the legacy file.)

---

### 6.4 Context groups (optional capability)

The folder tree answers "where does X live"; **context groups** answer "what
belongs together" — a semantic layer of cross-cutting, many-to-many
associations between folders. Examples: *Companies I've worked at*, *MMM
clients*, *Offline-conversions deployments*.

Groups are declared **per folder**. Any folder MAY contain a context
directory (its name fixed workspace-wide by the `context` mount declaration,
default `_Context`) holding one markdown file per group. A group's members are
**descendant folders of the folder that contains the context directory**,
referenced by path relative to that folder:

```markdown
# at Clients/_Context/companies-i-worked-at.md
---
name: companies-i-worked-at        # slug, kebab-case, matches filename
title: Companies I've worked at
members:
  - path: Incubeta                  # = Clients/Incubeta
    note: current employer, 2024–present
  - path: Old Holdings/Previous Co  # any descendant depth is allowed
---

Free-text description. Both humans and agents read this to understand what
membership in this group means.
```

- A group file MUST have `name`, `title`, and a `members` list; each member's
  `path` is a folder path relative to the folder containing the context
  directory; `note` is optional. `[CX-001]`
- Member paths SHOULD exist under that folder; a missing member is flagged,
  not fatal (folders get renamed). `[CX-002]`
- A folder may belong to any number of groups. v0.4 members are folders only.
- Declare a group in the context directory of the **lowest common ancestor**
  of its members — root-level groups can span the whole workspace; a
  client-folder group stays local and travels with the folder.
- **Inheritance flows down.** A folder's effective context is the set of
  groups it is directly a member of, plus every group any of its ancestors is
  a member of. Declare membership at the highest folder where it is true;
  never repeat it for descendants.
- The `context` mount in `_Workspace.yaml` declares the root level's context
  directory and fixes the directory *name* used at every level.
- Agents resolving a folder's context MUST check each ancestor level's context
  directory for memberships. Expanding a group means: each member folder and
  all of its descendants. Group files are the authoritative source of declared
  associations — consult them before falling back to search.
- Removing a group follows the archive rule (§8): its file moves to the
  archive mount, never deleted.

### 6.5 `_Index.md` (workspace root, generated, recommended)

A single generated map of the workspace — every scope with its one-line "what
it is", every context group with its members — regenerated by tooling whenever
a repair plan is applied or context groups are saved.

Its purpose is the **retrieval tier**: assistants that reach the workspace
through embedding/search connectors (rather than agentic file access) cannot
be relied on to walk the tree or read rulebooks, but a single high-recall
document surfaces for almost any broad query about the workspace. `_Index.md`
is the `llms.txt` pattern applied to a Drive.

- `_Index.md` is a derived artifact: never edit it by hand, never treat it as
  canonical — the tree and the context dirs are the source of truth.
- It is exempt from ST-004 (it does not need declaring in `_Workspace.yaml`).

### 6.6 Entities (optional capability) — the "cast" of the world model

Scopes answer "where does work live"; **entities** answer "who and what are
the things the work is about." An entity is a first-class, addressable node
for a person, system, or concept that recurs across scopes — a colleague, a
GTM container, a cross-cutting topic. Entities turn facts that were buried in
prose ("Sally Wilson — decision-maker", "GTM-WMW3QT") into nodes an agent can
resolve consistently everywhere they appear.

- Entities live in the **entities mount** (conventionally `_Entities/`), one
  markdown file per entity, slug = filename:

```markdown
# _Entities/sally-wilson.md
---
name: Sally Wilson
kind: person                       # person | system | concept
aliases: [Sally]
source: derived                    # derived (extracted) | asserted (human-confirmed)
confirmed: 2026-06-10              # last time a human confirmed this is current
attributes:
  role: Senior decision-maker
  org: Hanes
  email: sally.wilson@hanes.com
---

Free-text notes. Both humans and agents read this to understand the entity.
```

- An entity file MUST have `name` and a `kind` of `person`, `system`, or
  `concept`. `[EN-001]`
- The slug (`name` field) SHOULD match the filename. `[EN-002]`
- **Derived-first.** Tooling seeds entities by extracting them from existing
  overviews (Key people, infrastructure lists); a human confirms and enriches.
  `source` and `confirmed` record provenance so the model can show its own
  freshness rather than hide staleness. Extraction proposes; it never
  overwrites human-asserted entities.
- Entities are cross-cutting and so live at the workspace root, not per-scope.
- The entities capability is OPTIONAL; when its mount is declared it must
  exist (`[ST-002]`) and its files must be valid (`[EN-001]`).
- Entities are the **cast** of the world model. Typed relationships (§6.7) are
  the edges between them.

### 6.7 Relationships (the "edges" of the world model)

Entities are nouns; **relationships** are the typed verbs between them — the
edges that turn a list of things into a model an agent can traverse. "Who
leads Hanes? What does Bonds run on? Which deployments depend on this system?"
are relationship queries.

- A relationship is stored as an **outgoing edge in the subject entity's
  frontmatter**, so reading one entity reveals its connections:

```markdown
# _Entities/james-lu.md
---
name: James Lu
kind: person
relations:
  - predicate: leads
    target: hanesbrands-hanes        # an entity slug
    note: lead since 2024
  - predicate: works-on
    target: "Clients/Hanesbrands (Hanes)/Hanes | Offline CAPI"   # a scope path
---
```

- `predicate` MUST be drawn from the workspace's **closed vocabulary**
  (manifest `relationships.predicates`; default: `leads`, `owns`, `works-on`,
  `member-of`, `reports-to`, `uses`, `deployed-for`, `depends-on`,
  `related-to`). A closed set keeps the graph queryable and dodges the
  open-ontology maintenance trap. `[RL-001]`
- `target` resolves to an **entity slug** if one matches, otherwise to a
  **scope path** (workspace-relative). A target that resolves to neither is a
  dangling edge — flagged, not fatal. `[RL-002]`
- `note` is optional free text. Edges carry the subject entity's provenance.
- The full graph (including inverse traversal — "who leads X?") is assembled
  by tooling into the projection (§6.8); humans don't maintain back-links.

### 6.8 `_Model.json` (workspace root, generated) — the world-model projection

The structured, queryable snapshot of the whole world model: every node
(entity or scope) and every edge (typed relationship, plus context-group
membership), compiled from the markdown into one JSON document.

- It is the machine-readable twin of `_Index.md`: an agent loads `_Model.json`
  to get the entire model at once and traverse it, rather than walking files.
- Derived artifact — regenerated whenever entities, relationships, or context
  groups change; never hand-edited; the files remain canonical.
- Exempt from ST-004 (it does not need declaring in `_Workspace.yaml`).

## 7. Memory

The workspace gives agents three memory surfaces, from coarse to fine:

1. **`_Overview.md` / Recent activity** — curated highlights. The first thing
   read when entering a scope; capped so it stays signal.
2. **Journal** — the chronological record. "What happened on/around date X,
   across everything?"
3. **WIP Notes + `_Tasks.md`** — full substance and open loops per scope.

### 7.3 Agent activity attribution

Any agent session that creates, edits, moves, or archives files MUST append to
that day's journal entry, under a `## Agent activity` heading: `[JR-003]`

```markdown
## Agent activity
- HH:MM · <agent/tool name> · <scope> — what was done → [link]
```

This is the transparency contract: a human can always reconstruct what agents
did to the workspace and when, with no tool-specific log access.

---

## 8. Operating rules (humans and agents)

1. **Read before write.** Entering a scope: read its `_Overview.md`, then
   `_Tasks.md` if present, then recent WIP notes as needed.
2. **Merge, don't overwrite.** Same-date WIP notes and journal files are merged
   into. Overviews are edited surgically, never regenerated wholesale.
3. **Close the loop after changes.** File changed → update the scope's
   `Recent activity` → add a journal line (agents: under `## Agent activity`).
4. **Archive, never delete.** Superseded material moves to the archive mount,
   preserving its path relative to the workspace root
   (`Archive/Clients/Hanes…/file.md`). The move is journaled. `[AR-001]`
5. **Propose, then apply.** Structural operations (renames, moves, new scopes,
   adoption migrations) are proposed as a reviewable plan and executed only on
   human approval. Content edits within the rituals above don't need proposals.
6. **Renames cascade.** Renaming a scope with a pipe-name updates all
   descendant folder names and intra-workspace links; tools must do this
   atomically or not at all.
7. **Ask when ambiguous.** Wrong-but-confident filing is worse than a question.

---

## 9. Lint rules

Severities: **error** (violates a MUST), **warn** (violates a SHOULD),
**info** (worth a look). Machine-readable form lives in `manifest.yaml`.

| ID | Sev | Rule |
|---|---|---|
| ST-001 | error | Root contains `_Workspace.yaml`, `AGENTS.md`, `_Overview.md` |
| ST-002 | error | Every mount declared in `_Workspace.yaml` exists |
| ST-003 | error | Journal, templates, and archive capabilities are mounted; ≥1 area declared |
| ST-004 | warn | No undeclared loose files / top-level folders at root |
| ST-005 | error | `AGENTS.md` in sync with `_Workspace.yaml` (version, profile, map) |
| SC-001 | error | Every **entity** (depth-1 folder in an area) has `_Overview.md` |
| CL-001 | error | WIP note files are named `YYYY-MM-DD.md` |
| CL-002 | warn | WIP note follows template sections (Discussion/Decisions/Actions) |
| NM-001 | error | **Promoted scopes** and collections: pipe-name mirrors ancestry |
| NM-002 | warn | **Promoted scopes**: dates in names are ISO format |
| NM-003 | error | Entity folder names contain no pipes |
| TK-001 | warn | `_Tasks.md` items follow the open/done format |
| JR-001 | error | Journal files at `<journal mount>/YYYY/YYYY-MM/YYYY-MM-DD.md` |
| JR-002 | info | Journal lines link out (index, not substance) |
| JR-003 | warn | File-changing agent sessions appear in `## Agent activity` |
| AR-001 | error | `Archive/` mirrors original paths; nothing deleted |
| CX-001 | error | Context group files have valid `name`, `title`, `members` |
| CX-002 | warn | Context group member paths exist under the declaring folder |
| EN-001 | error | Entity files have valid `name` and `kind` (person/system/concept) |
| EN-002 | warn | Entity slug (name) matches filename |
| RL-001 | error | Relationship `predicate` is in the workspace vocabulary |
| RL-002 | warn | Relationship `target` resolves to an entity or existing scope |

Removed in v0.6 (content-by-default pivot): SC-002 (per-type subfolders),
SC-003 (asset registration), SC-004 (unclassifiable folders), OV-001
(required overview sections), OV-002 (recent-activity cap). Content folders
are not lint subjects; overview content is free-form.

---

## 10. Profiles

A profile layers org-specific ritual onto the core: lint allowances, starter
topology, and **template overrides** (`templates/profiles/<profile>/` falls
back to the organisation-neutral base templates). The **`core`** profile is
the neutral baseline — generic topology (`Projects/` + capabilities), no org
rituals, no client vocabulary — and is the right starting point for any
non-Incubeta structure. The **`incubeta`** profile adds (full definition in
`manifest.yaml`):

- **Draft lifecycle:** working files are prefixed `Draft_`; promotion to the
  production Drive strips the prefix and adds `[INT]`/`[EXT]`. Draft files
  never leave the workspace; sharing happens only from production copies.
- **Status flags:** 🟢 Production/Active · 🟡 Beta · 🟠 Draft/Pending · 🔴 Deprecated.
- **Production mapping:** client entity overviews record their production
  Drive folder ID under `## Reference`.
- **Root allowance:** `CLAUDE.md` permitted at workspace root.
- **Internal taxonomy:** `Internal/Solutions/` follows the same scope rules as
  clients (`Solutions | <Category> | <Platform>`), holding cross-client IP with
  deployments cross-linked both ways.

---

## 11. Out of scope for v0.1 (deliberate)

- **Shared zones** — multiple humans co-owning one structure (Shared Drives).
  The multi-user model for now is *same protocol, separate Drives*.
- **Modules** — domain plug-ins (first planned: GTM container audits) that
  read/write inside the structure. Modules must follow §8 like any agent.
- **Non-markdown context** — Sheets/Docs/Slides are first-class *content* but
  not *context*; context files are markdown only.
