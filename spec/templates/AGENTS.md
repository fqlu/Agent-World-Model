# AGENTS.md — Workspace Protocol

> The header above is this workspace's config; the text below is rendered from it.
> Edit through the Agent World Model app (or edit the header carefully, then re-render).
> **Spec:** Drive Context Protocol v{{spec_version}} · **Profile:** {{profile}}
> **Owner:** {{owner_name}} <{{owner_email}}>

{{about}}

This Drive is a workspace shared by humans and AI agents. If you are an agent working
here, these are the rules. They are tool-agnostic.

## The map

```
{{map}}
```

**Folders are content by default.** A folder with an `_Overview.md` is a **scope** (a
maintained unit of work); every top-level folder inside an area is one. Read a scope's
`_Overview.md` before acting there, then its `_Tasks.md` (open commitments) and recent
notes in its `… | WIP Notes` folder (`YYYY-MM-DD.md` or `YYYY-MM-DD - Title.md`). A folder
without an overview is a **content folder**: it inherits context from the nearest scope
above it. Never add context files to content folders uninvited.

**Orientation:** there is no index file. List the areas, then read the scope overviews you
need. Retrieve by address: context for X's project Y is at `<Area>/X/X | Y/_Overview.md`.

**Entities** (`{{entities}}/`) are the cast: people, organizations, systems and concepts,
one file each (`kind: person | organization | system | concept`). When a name recurs,
the entity file is its canonical record. Each carries provenance (`source`, `confirmed`).

**Relationships** live in an entity's `relations:` with only two predicates:
`member-of` (the subject is part of the target: a person in an organization, team or
project scope; an organization in a parent organization; an entity in a facet) and
`related-to` (anything else). Say what the relationship is in `as` (required for
`related-to`, e.g. "uses as CDP", "client", "owner"); optional `since` / `until` ISO
dates (`until` in the past = a former relationship); `note` for detail. Record each edge
once, on the entity the sentence is about; never add the mirror edge.

**Facets** are cross-cutting views (pillar, platform, discipline, brand). A facet is an
entity with `attributes.facet`. A scope joins one by listing its slug in `facets:` in its
`_Overview.md` frontmatter; child scopes inherit their parents' facets.

## Where things go — filing decision

Folders use ONE axis; everything else is a facet:

1. **Time-bound, with a goal and an end?** → a **project** scope (`scope_type: project`),
   nested under the workstream it serves.
2. **An ongoing thing we're retained for** (product, function, brand, retainer)? → a
   **workstream** scope (`scope_type: workstream`).
3. **A platform, discipline, brand, or strategic pillar?** → a **facet** (an entity,
   listed in scopes' `facets:`). Never a folder.
4. **Just a document or deliverable?** → a **file** inside the relevant scope.

## Operating rules

1. **Read before write.** `_Overview.md` → `_Tasks.md` → recent WIP notes.
2. **Merge, don't overwrite.** Same-date notes are merged into. Edit overviews
   surgically; never regenerate them wholesale.
3. **Close the loop.** After changing files, add a line to the scope's
   `## Recent activity` (newest first, keep ≤10) and to today's journal
   (`{{journal}}/YYYY/YYYY-MM/YYYY-MM-DD.md`, create it if missing) under
   `## Agent activity`: `- HH:MM · <agent> · <scope> — what → [link]`. The journal is
   a log only.
4. **Never delete.** Move superseded material to `{{archive}}/`, mirroring its path, and
   journal the move.
5. **Tasks have a home.** Open commitments live in the scope's `_Tasks.md`
   (`- [ ] YYYY-MM-DD · @owner — task → [source](link)`); completed items move to
   `## Done`.
6. **Naming is load-bearing.** Scope folders carry their ancestry:
   `<Entity short> | <Unit> | <Sub-project>` (on Drive the pipe may appear as ` _ `).
   Short forms come from a trailing parenthetical (`Hanesbrands (Hanes)`) or `aliases:`
   in the scope's `_Overview.md`; never invent an abbreviation. Dates are ISO.
7. **Ask through proposals.** Questions for the owner and changes that need approval
   (new scopes, renames, moves, anything structural) go to `{{proposals}}/<agent>/` as
   proposals, not into the journal or chat. Never write another agent's files there, and
   never write a `*.decisions.json` (the owner's tooling does).
8. **Templates.** Copy layouts from `{{templates}}/`; never invent them.
9. **Ask when ambiguous.** A wrong-but-confident filing costs more than a question.

Everything you write may be reviewed: files the owner verifies gain a
`verified: human:<owner>` stamp. Write like someone will read the diff.

## House rules

{{house_rules}}

## Enforced rules (this workspace)

{{rules_summary}}

## Profile rules ({{profile}})

{{profile_rules}}
