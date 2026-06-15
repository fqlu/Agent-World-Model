import Link from "next/link";

export const metadata = {
  title: "About — Agent World Model",
};

const STEPS = [
  {
    n: "1",
    title: "Audit",
    body: "Point the app at a folder (local or Google Drive) and run a read-only health check. It reports exactly what's missing or inconsistent against the protocol — nothing is touched.",
  },
  {
    n: "2",
    title: "Repair",
    body: "Findings become a reviewable plan: every operation is listed, explained, and individually tick-able. You approve before anything runs. Anything the app can't safely fix is flagged for a human instead of guessed at.",
  },
  {
    n: "3",
    title: "Context groups",
    body: "Draw connections between folders on a visual canvas — \"Companies I've worked at\", \"Active client projects\" — and save. The groups become plain markdown files that any AI agent can read to answer questions like \"which companies have we worked with?\" without searching.",
  },
];

const ARTIFACTS = [
  {
    file: "_Workspace.yaml",
    role: "Declares the workspace's layout — which folders hold work, where the journal, templates, and archive live. Layouts vary; the rules don't.",
  },
  {
    file: "AGENTS.md",
    role: "The agent rulebook, generated at the root. Any AI tool pointed at the folder reads one file and knows the map, the rituals, and the rules. Uses the cross-vendor naming standard many agentic tools auto-discover.",
  },
  {
    file: "_Overview.md",
    role: "One per important folder: what it is, who's involved, what's active, what happened recently. Agents read this before acting — context by address, not by search.",
  },
  {
    file: "_Index.md",
    role: "A generated map of every scope and context group, kept fresh automatically. Built for AI assistants that reach your Drive through search connectors and can't walk the folder tree themselves.",
  },
  {
    file: "Journal/",
    role: "A daily log where every change — human or AI — leaves an attributed one-line record. You can always reconstruct what agents did to your files, and when.",
  },
  {
    file: "_Context/",
    role: "Context group files: named, cross-cutting associations between folders, with notes. The authoritative answer to \"what belongs together?\".",
  },
];

const PRINCIPLES = [
  {
    title: "Read-only audits",
    body: "Health checks never modify anything.",
  },
  {
    title: "Propose, then apply",
    body: "Structural changes are plans you review and approve operation by operation.",
  },
  {
    title: "Nothing is ever deleted",
    body: "The app has no delete operation — superseded files move to Archive/, preserving their paths.",
  },
  {
    title: "Everything is journaled",
    body: "Every applied change writes an attributed line to the workspace journal.",
  },
  {
    title: "Files stay canonical",
    body: "Plain folders and markdown remain the source of truth. No lock-in: delete the app and your workspace still works, for humans and agents alike.",
  },
  {
    title: "Ceremony never exceeds value",
    body: "Context files are required only at the top level of each area. Deeper folders are plain content unless you choose to promote them.",
  },
];

export default function AboutPage() {
  return (
    <div className="space-y-12">
      {/* What it is */}
      <section className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
          A governance layer that makes your Drive agent-ready
        </h1>
        <p className="mt-4 text-zinc-700">
          This tool installs and maintains the <strong>Drive Context Protocol</strong> — a
          small set of conventions that turn an ordinary folder structure into something both
          humans and AI agents can navigate, act in, and remember things in, without guesswork.
        </p>
        <p className="mt-3 text-zinc-700">
          The problem it solves: every Drive is organised differently, context lives in
          people's heads, and AI assistants retrieve by luck. An agent asked "what's the
          status of project X?" searches and hopes. Under the protocol, the same agent knows{" "}
          <em>exactly which file answers that</em> — and where to record what it did.
        </p>
      </section>

      {/* What it does */}
      <section>
        <h2 className="text-xl font-semibold text-zinc-900">What it does</h2>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          Three workflows, run as a loop: audit → repair → enrich.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="card p-5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                  {s.n}
                </span>
                <h3 className="font-semibold text-zinc-900">{s.title}</h3>
              </div>
              <p className="mt-2 text-sm text-zinc-600">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="text-xl font-semibold text-zinc-900">How it works</h2>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          The protocol is just files — plain markdown and folders, owned by you, readable by
          anything. The app generates and maintains them:
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <tbody>
              {ARTIFACTS.map((a, i) => (
                <tr key={a.file} className={i % 2 ? "bg-zinc-50" : ""}>
                  <td className="whitespace-nowrap px-4 py-3 align-top font-mono text-xs font-medium text-indigo-700">
                    {a.file}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{a.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-3xl text-sm text-zinc-600">
          The structure is <strong>not one-size-fits-all</strong>: each workspace declares its
          own layout, and organisation-specific rituals (like Incubeta's draft → production
          lifecycle) live in a <em>profile</em> layered on a neutral core — so a client-services
          folder, a research archive, and a personal Drive can all speak the same protocol.
        </p>
      </section>

      {/* Safety */}
      <section>
        <h2 className="text-xl font-semibold text-zinc-900">The safety contract</h2>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          A tool that touches someone's files lives or dies on trust, so these are hard
          guarantees, not settings:
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="card p-4">
              <h3 className="text-sm font-semibold text-zinc-900">{p.title}</h3>
              <p className="mt-1 text-sm text-zinc-600">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="max-w-3xl">
        <h2 className="text-xl font-semibold text-zinc-900">Why it's worth it</h2>
        <div className="mt-4 space-y-4 text-sm text-zinc-700">
          <p>
            <strong className="text-zinc-900">For you:</strong> your Drive stays findable and
            consistent without discipline — the audit catches drift, the repair plan fixes it,
            and the rituals (overviews, daily journal, dated notes) maintain themselves as a
            by-product of working.
          </p>
          <p>
            <strong className="text-zinc-900">For your AI agents:</strong> context arrives by
            address instead of search. An agent entering the workspace reads the rulebook,
            finds the right overview, consults the context groups, does its work, and leaves
            an attributed trail — across vendors, with at most one line of configuration.
            Assistants that only have search connectors still benefit: self-describing names,
            rich overviews, and the generated index make their retrieval dramatically better.
          </p>
          <p>
            <strong className="text-zinc-900">For your team:</strong> when two people run the
            protocol, their structures speak the same language even if their layouts differ —
            work, and the agents working on it, can be handed across without re-explaining how
            anything is organised.
          </p>
        </div>
      </section>

      {/* Get started */}
      <section className="card flex flex-wrap items-center gap-4 p-6">
        <div className="flex-1">
          <h2 className="font-semibold text-zinc-900">Try it in two minutes</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Add a workspace (browse to any folder), run the read-only audit, and look at what
            it finds. Nothing changes until you approve a plan.
          </p>
        </div>
        <Link href="/" className="btn-primary">
          Go to workspaces →
        </Link>
      </section>
    </div>
  );
}
