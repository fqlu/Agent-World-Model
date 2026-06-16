import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { getRulesSvc } from "@/lib/service";
import RulesEditor from "./editor";

export const dynamic = "force-dynamic";

export default async function RulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) notFound();
  const data = await getRulesSvc(ws.id);

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/w/${ws.id}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {ws.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">Rules</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          Every rule the audit enforces on this workspace, and the conventions behind them.
          Tune severity (or disable) per rule and edit the tunable conventions — changes save to{" "}
          <code className="font-mono text-xs">_Workspace.yaml</code>, feed straight into the
          audit, and regenerate <code className="font-mono text-xs">AGENTS.md</code> so agents
          read the same rules. Profile: <span className="font-mono">{data.profile}</span>.
        </p>
      </div>
      <RulesEditor
        wsId={ws.id}
        rules={data.rules}
        conventions={data.conventions}
        houseRules={data.houseRules}
      />
    </div>
  );
}
