# Drive Context Protocol v0.16 — changes to SPEC.md (draft)

**Status:** 🟢 Applied 2026-11-05 — folded into `SPEC.md` (v0.16.0) and `manifest.yaml`; the app supports
v0.16. Kept as the change record. Machine-readable twin: [`manifest-0.16.yaml`](manifest-0.16.yaml).
**Approved direction:** the minimal protocol, approved by James on 2026-11-05 (workspace doc
`Internal/Solutions/Solutions _ Agent World Model/Draft_ Protocol Folder Layout v0.16.md`).

Each section below says what to **replace**, **remove** or **add** in `SPEC.md`. Wording marked
"Replace with" is the proposed final text. When the draft is approved, apply it to `SPEC.md`,
copy the manifest over, and bump the version.

## Summary of v0.16

**One rule drives every change:** a protocol file exists only if it is a *source* someone relies on.
Copies stored in the Drive go stale, so derived views are served by tooling, not written as files.

| v0.15 | v0.16 |
|---|---|
| `_Workspace.yaml` + generated `AGENTS.md` (kept in sync by ST-005) | `AGENTS.md` only: YAML header = config, body = rulebook rendered from it |
| Root `_Overview.md` (owner + project list) | Owner and `about` in the `AGENTS.md` header; the project list is a tooling view |
| `_Index.md`, `_Model.json`, `_Digest.md` written to the Drive | Served by tooling on demand; never stored |
| Context groups (`_Context/` dirs at any level, inheritance, CX rules) | **Facets**: a scope lists entity slugs in `facets:`, which inherit downward |
| 9–10 relationship predicates per workspace (`leads`, `owns`, `uses`, …) | **2 predicates** (`member-of`, `related-to`) + a short `as` description + optional `since` / `until` |
| Entity kinds: person, system, concept | person, **organization**, system, concept |
| Journal = daily index + agent log + "Needs review" | Journal = agent activity log only |
| — | **Proposals** capability (`_Proposals/`): agents ask and propose, the owner decides |
| `Journal/`, `Templates/` (7 templates) | `_Journal/`, `_Templates/` (4 templates) by default; `Archive/` unchanged |
| Root: 6 protocol files + 4 folders | Root: `AGENTS.md` + protocol folders |

Rules removed: **ST-005, CX-001, CX-002, JR-002.** Rules changed: **ST-001, ST-004, EN-001, RL-001,
RL-002.** No rules added.

---

## §1 Design principles: add principle 6

**Add** after principle 5:

> 6. **Sources, not copies.** The protocol stores only canonical sources in the Drive. Anything
>    derivable (maps, graphs, digests, project lists) is computed by tooling when asked. A derived
>    file in the Drive is a second copy that silently goes stale.

## §2 Workspace topology: replace the manifest and root rules

**Replace** the `_Workspace.yaml` example and the bullet list with:

> A workspace declares its layout in the **YAML header of `AGENTS.md`**, the one protocol file at
> the workspace root:
>
> ```markdown
> ---
> protocol: dcp/0.16
> profile: vivanti-master-workspace
> owner: { name: James Lu, email: james.lu@vivanti.com }
> about: Workspace of James Lu at Vivanti — client delivery, presales, practice and internal tooling.
> mounts:
>   areas: [Clients, Internal]   # scope-bearing folders (≥1, any names)
>   journal: _Journal            # agent activity log (§4.2, §7.3)
>   templates: _Templates        # 4 canonical templates
>   archive: Archive             # superseded content (§8)
>   entities: _Entities          # OPTIONAL: the cast (§6.6)
>   proposals: _Proposals        # OPTIONAL: agent proposals and owner decisions (§6.10)
> ignore: [Internal/Solutions/some-code-repo]
> rules: { overrides: {}, conventions: {} }   # §9.1
> house_rules: []                              # §9.2
> ---
> # AGENTS.md — Workspace Protocol
> …rulebook rendered from the header, the spec and the profile…
> ```
>
> - The workspace root MUST contain `AGENTS.md` with a header that parses and carries `protocol`,
>   `owner` and `mounts`. `[ST-001]`
> - Every declared mount MUST exist. `[ST-002]`
> - Journal, templates and archive MUST be mounted, and at least one area declared. `[ST-003]`
> - Entities and proposals are OPTIONAL capabilities.
> - Protocol mounts SHOULD use a `_` prefix (`_Journal`, `_Templates`, `_Entities`, `_Proposals`), so
>   that a workspace's protocol is exactly `AGENTS.md` plus its `_` folders and can be copied,
>   upgraded or removed without touching content. The archive holds content, so it is not prefixed
>   by default.
> - `ignore:` works as before.
> - Root items that are not declared are flagged. v0.15 leftovers (`_Workspace.yaml`, `_Overview.md`,
>   `_Index.md`, `_Model.json`, `_Digest.md`, `_Context/`) are flagged with a migration hint.
>   Profiles MAY whitelist extra root files (e.g. `CLAUDE.md`). `[ST-004]`
> - **The header is canonical; the body is rendered.** Tooling edits the header (or a human does,
>   carefully) and re-renders the body from it. There is no second config file, so there's nothing to
>   keep in sync.

**Remove** the ST-005 bullet and the "Divergence from reference" note (obsolete).

## §3 Scopes: content folders inherit facets

**Replace** the bullet "Content folders inherit their context from the nearest scope above them and
from context groups (§6.4)…" with:

> - Content folders inherit their context from the nearest scope above them, including that scope's
>   effective facets (§3.1).

## §3.1 Decomposition: facets without context groups

**Replace** the paragraph starting "That single ongoing-vs-time-bound split…" through "A group MAY
set `kind: pillar`…" with:

> That single ongoing-vs-time-bound split is the structural hierarchy. Every other way you'd want to
> see the work — **platform** (GA4, BigQuery), **discipline** (analytics, SEO), **brand**,
> **strategic pillar** — is a **facet, not a folder**.
>
> A facet is an **entity** (§6.6) with `attributes.facet: pillar | platform | discipline | brand`. A
> scope joins a facet by listing its slug in the `_Overview.md` frontmatter:
>
> ```yaml
> ---
> scope_type: project
> facets: [cloud-data-platform, databricks]
> ---
> ```
>
> - **Facets inherit downward.** A scope's effective facets are its own plus those of every ancestor
>   scope. Declare a facet at the highest scope where it is true.
> - "Show me everything in the Cloud Data Platform pillar" means every scope whose effective facets
>   include `cloud-data-platform`, plus each one's descendants.
> - Facet slugs MUST resolve to an entity. `[RL-002]`

**In the filing decision, replace** step 3 with:

> 3. A platform, discipline, brand, or strategic theme? → a **facet**: an entity, listed in the
>    scope's `facets:`. Never a folder.

## §4.2 Journal: log only

**Replace** with:

> - Path: `<journal mount>/YYYY/YYYY-MM/YYYY-MM-DD.md`. `[JR-001]`
> - One file per day with activity. The journal is the **agent activity log** (§7.3) and nothing
>   else. One line per change, linking to where the substance lives:
>   `- HH:MM · <agent> · <scope> — <what> → [link]`.
> - It is not a daily index (each scope's Recent activity covers that) and not a request channel.
>   Questions and proposals for the owner go to the proposals capability (§6.10).
> - Daily files limit how many agents write to one file at once. Agents append and never rewrite
>   existing lines.

## §5.2 Special files

**Replace** the first bullet with:

> - Scope context files are prefixed `_` so they sort first: `_Overview.md`, `_Tasks.md`. Protocol
>   folders are prefixed `_` (`_Journal/`, `_Templates/`, `_Entities/`, `_Proposals/`). `AGENTS.md`
>   is unprefixed deliberately: it follows the cross-vendor agent auto-discovery convention.

## §6.1 `_Overview.md`: no root overview

**Replace** "The **root** `_Overview.md` identifies the workspace owner…" with:

> There is no root `_Overview.md`. The owner and a one-line `about` live in the `AGENTS.md` header.
> The cross-workspace project list ("what's active?") is a tooling view built from scope overviews,
> not a hand-maintained file that duplicates them.

**Add** to the frontmatter description: `facets:` (§3.1).

## §6.3 `AGENTS.md`: config and rulebook

**Replace** with:

> The workspace's single protocol file: a **YAML header** (the workspace config, §2) and a **body**
> (the agent rulebook). Tooling renders the body from the header, the spec and the active profile:
> the map of mounts, the operating rules (§7–8), the enforced rules (§9.1), the house rules (§9.2), the
> journal line format, and how to raise a proposal. Any agent, from any vendor, can be pointed at the
> workspace root and behave correctly.
>
> - Keep it short. It is loaded into every agent session, so every line costs tokens on every run.
>   It links to scope files rather than inlining them.
> - Vendor files (`CLAUDE.md`, `GEMINI.md`…) SHOULD reduce to a pointer at `AGENTS.md` plus
>   vendor-specific notes.

## §6.4 Context groups: remove

**Remove** the section. **Replace** it with a one-line pointer:

> ### 6.4 (removed in v0.16)
> Context groups are replaced by facets (§3.1). Migration: each group becomes an entity with
> `attributes.facet`, and each member scope gets the slug in its `facets:`.

## §6.5 `_Index.md`: remove from the Drive

**Replace** with:

> ### 6.5 Workspace map (tooling view)
> Tooling serves a map of the workspace — every scope with its "What it is", every entity and facet —
> on demand: in the app, through its API, and in exported bundles (§12). It is not stored in the
> Drive. Agents with file access orient from `AGENTS.md`, then list the areas and read scope
> overviews. Search-only assistants use exported bundles (whose `index.md` serves the `llms.txt`
> role).

## §6.6 Entities: `organization` kind and facets

**Replace** the kind list (`person | system | concept`) everywhere with
`person | organization | system | concept`, and EN-001 accordingly.

> - **organization**: a company, client, partner, vendor, agency or team-of-teams (Vivanti, Lendi
>   Group, Neo4j). Before v0.16, organisations had to be filed as `concept`, so agents couldn't tell a
>   company from an idea.
> - **concept**: an idea, programme, theme or pillar.

**Add**:

> - An entity used as a facet carries `attributes.facet: pillar | platform | discipline | brand`. A
>   pillar is usually a `concept`, a platform a `system`, and a brand an `organization`.

## §6.7 Relationships: two predicates plus a description

**Replace** the section body with:

> Relationships are stored as outgoing edges in the subject entity's frontmatter. **There are two
> predicates.** What the relationship *is* goes in a short description, `as`:
>
> ```yaml
> relations:
>   - predicate: member-of            # member-of | related-to
>     target: Internal/Presales/Presales _ Lendi Brain PoV
>     as: Principal Consultant; signs the cover letter
>     since: 2026-10-20               # optional, ISO date
>   - predicate: member-of
>     target: incubeta
>     as: Analytics consultant
>     until: 2026-09-30               # optional; present = a past relationship
>   - predicate: related-to
>     target: amperity
>     as: uses as CDP (segmentation, profiles, identity)
>     note: Live ~12 months.          # optional longer note
> ```
>
> - **`member-of`**: the subject is *part of* the target. A person in an organisation, team or
>   project scope; an organisation in a parent organisation (GroupM → WPP); an entity in a facet
>   (Databricks → cloud-data-platform).
> - **`related-to`**: any other connection. `as` is **required**: a few words from the subject's point
>   of view ("uses as CDP", "client", "partner on the Lendi PoV", "owner", "deployed for").
> - **`as`** is the description shown on graph edges and read by agents. It is free text, so there is
>   no vocabulary to maintain and no wrong verb to pick. `note` stays for anything longer.
> - **Time**: `since` and `until` are optional ISO dates. An edge with `until` in the past is a
>   *former* relationship. This replaces separate "previously-…" predicates, and works for both
>   predicates (a former employer, a former vendor).
> - **Record each edge once**, on the entity the sentence is naturally about ("Intrepid uses
>   Amperity" on `intrepid-travel`). Tooling shows the inverse ("used by Intrepid") on the target. Don't
>   add mirror edges.
> - `predicate` MUST be `member-of` or `related-to`. `[RL-001]`
> - Targets (entity slug, or scope path) SHOULD resolve; `related-to` edges SHOULD carry `as`; dates
>   SHOULD be ISO. `[RL-002]`
>
> Why so few: in the reference workspace, 37 of 89 edges were `related-to` even though seven more
> specific verbs were available. Writers didn't pick verbs reliably, and several facts were recorded
> twice in opposite directions (`uses` + `deployed-for`). Two structural predicates (membership, which
> drives team and facet queries, versus everything else) plus a description captures the same meaning
> with nothing to choose wrongly. Typed queries that matter ("who is on this project?", "what is in
> this pillar?", "who used to work here?") are all membership queries.

## §6.8 `_Model.json`: remove from the Drive

**Replace** with:

> ### 6.8 World-model view (tooling)
> The queryable graph (entities, scopes, relations, facet memberships) is computed by tooling and
> served through the app and its API. It is not stored in the Drive. The entity files remain the
> only source.

## §6.9 Freshness and the maintenance loop

**Replace** step 2 ("Re-derive…") with:

> 2. **Re-derive.** Tooling recomputes its views (map, model, digest) from the files. Nothing is
>    written to the Drive.

**Replace** step 3 ("Reflect…") with:

> 3. **Reflect (agent, out of band).** Interpreting drift — staleness, contradictions, graph
>    quality, overdue decisions, lessons — is done by a reflection agent ("dreaming") that writes
>    **proposals** (§6.10). Tooling never invents semantic facts. The owner decides in the proposals
>    inbox.

## §6.10 Proposals (new)

**Add**:

> ### 6.10 Proposals (optional capability)
> The one channel through which agents ask the owner questions and propose changes, and through
> which the owner's decisions flow back.
>
> - Layout: `<proposals mount>/<agent>/` holding `YYYY-MM-DD.proposals.json` (canonical),
>   `YYYY-MM-DD.md` (readable rendering), `YYYY-MM-DD.decisions.json` and `suppressions.json`.
> - **Single writer per file.** The proposing agent writes the proposals, rendering and suppressions
>   files. The owner's tooling writes the decisions file. Nobody else writes either.
> - Schemas: `dcp-proposals/1` and `dcp-decisions/1`. Every item carries a stable id, `lens`
>   (`triage` | `hygiene`), `tier` (`auto` | `approve` | `you`), evidence (path + exact quote), and
>   either a `question` with options or small `ops` (`replace`, `append_line`, `frontmatter`, `move`,
>   `create`; never `delete`), each with the target file's `base_md5`.
> - **Accepted edits apply immediately** through tooling, and only if the file still matches
>   `base_md5`. Answers and rejections go back to the agent on its next run. A rejection is
>   suppressed so it isn't proposed again; a lesson drawn from it is only ever *proposed*.
> - Structural changes (moves, renames, new scopes) are always `tier: you` (§8 rule 5).
> - Full contract: the Dreaming Inbox Spec (workspace doc; to be folded into `OKF-COMPAT.md`'s
>   sibling `PROPOSALS.md` when stable).

## §7 Memory: surfaces

**Replace** item 2 with:

> 2. **Journal** — the chronological agent activity log. "What changed, by whom, around date X?"

**Add** item 4:

> 4. **Proposals** — open questions and pending changes for the owner, with the decisions taken.

## §8 Operating rules

**Add** rule 8:

> 8. **Ask through proposals.** Questions for the owner and changes that need approval go to the
>    proposals capability (§6.10), not into journal sections or chat. Never write another agent's
>    or the owner's file in `_Proposals/`.

## §9 Lint rules: table changes

- **ST-001** → "Root contains `AGENTS.md` with a valid config header (`protocol`, `owner`, `mounts`)".
- **ST-002** → "Every mount declared in the `AGENTS.md` header exists".
- **ST-004** → add "v0.15 leftovers get a migration hint".
- **EN-001** → "Entity files have valid `name` and `kind` (person/organization/system/concept)".
- **RL-001** → "Relationship `predicate` is `member-of` or `related-to`".
- **RL-002** → "Relationship targets and scope `facets` resolve; `related-to` edges carry `as`; `since`/`until` are ISO dates".
- **Remove** ST-005, CX-001, CX-002, JR-002, and add the removal note: *Removed in v0.16: ST-005
  (single config file), CX-001/CX-002 (context groups → facets), JR-002 (journal is a log).*

## §9.1 / §9.2: location

**Replace** "in `_Workspace.yaml`" with "in the `AGENTS.md` header" (two places).
**Remove** the `relationship_predicates` convention from §9.1: the two predicates are fixed by the
spec, not tuned per workspace.

## §10 Profiles

**Add**: profile starter topologies use `_Journal/`, `_Templates/`, `_Entities/`, `_Proposals/`,
`Archive/`. A profile's `templates/` overrides at most the four workspace templates.

## §12 OKF interoperability

**Replace** "context groups → `Group` concepts" with "facets → concepts of their entity kind, with
member scopes linked". A bundle's `index.md` is the search-tier map formerly served by `_Index.md`
(§6.5).

## New §13: migrating v0.15 → v0.16

**Add**:

> Tooling migrates a workspace through one reviewable proposal with undo. Nothing is deleted.
> 1. Merge `_Workspace.yaml` into the `AGENTS.md` header. Move the root `_Overview.md`'s owner and
>    purpose into `owner` / `about`. Re-render the body.
> 2. Turn each context group into a facet entity (`attributes.facet` from the group's `kind`, default
>    `pillar`), and add its slug to each member scope's `facets:`.
> 3. Rename the journal and templates mounts to `_Journal/` and `_Templates/`. Keep the 4 templates and
>    archive the rest. Move content that lived in templates (e.g. an onboarding guide) to a scope.
> 4. Move `_Workspace.yaml`, the root `_Overview.md`, `_Index.md`, `_Model.json`, `_Digest.md` and
>    `_Context/` to `<archive>/_protocol-v0.15/`.
> 5. Move "Needs review" / "Needs filing" items still open in the journal into proposals.
> 5a. **Relationships**: map each edge, with `as` drafted from the old predicate and note, and offer
>     the result as a proposal for the owner to check:
>
>     | v0.15 | v0.16 |
>     |---|---|
>     | `member-of` | `member-of` (`as` = role from the note, if any) |
>     | `previously-member-of` | `member-of` + `until` (date from the note, or a question) |
>     | `leads` | `member-of`, `as: lead …` |
>     | `works-on` | `member-of`, `as` = role |
>     | `owns` | person → scope: `member-of`, `as: owner`; otherwise `related-to`, `as: owner` |
>     | `uses`, `provides`, `depends-on`, `reports-to` | `related-to`, `as` = the verb + note gist |
>     | `deployed-for` | dropped if the inverse `uses` edge exists; otherwise `related-to`, `as: deployed for …` |
>     | `related-to` | `related-to`, `as` drafted from the note |
> 5b. **Kinds**: propose `kind: organization` for `concept` entities that are organisations.
> 6. Rewrite inbound links to moved paths. Journal files keep their depth, so their outbound links are
>    unchanged.
> 7. Journal the migration, and list the agents whose prompts hard-code old paths.
>
> During migration, tooling accepts both layouts.

## Decisions (James, 2026-11-05)

James asked for Claude's recommendation on the three open questions, and proposed simplifying
relationships to membership plus a description.

1. **`facets:`**, not `pillars:`. One mechanism covers pillars, platforms, disciplines and brands. A
   pillar is a facet with `attributes.facet: pillar`.
2. **Add the `organization` kind** (closes consolidation item C3).
3. **Relationships: two predicates, `member-of` and `related-to`, plus `as` (description), `since`
   and `until`.** This is James's proposal, with two adjustments:
   - `related-to` instead of forcing everything into membership. "Intrepid member-of Amperity" would
     mislead agents.
   - `until:` instead of a `previously-member-of` predicate. It records *when* the relationship ended,
     and works for past non-membership links too.
   This also closes consolidation item C2: no vocabulary extensions are needed.
