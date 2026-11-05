import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { getDreamingSvc } from "@/lib/service";
import DreamingSetup from "./setup";

export const dynamic = "force-dynamic";

export default async function DreamingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) notFound();
  const data = await getDreamingSvc(ws.id);
  return (
    <div className="space-y-4">
      <div>
        <Link href={`/w/${ws.id}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {ws.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">Dreaming setup</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          Dreaming is the protocol&apos;s overnight review: an agent reads the whole workspace on a schedule
          and sends you questions and small fixes in the{" "}
          <Link href={`/w/${ws.id}/inbox`} className="text-indigo-600 hover:underline">Dreaming inbox</Link>.
          The app writes the agent&apos;s instructions to{" "}
          <code className="font-mono text-xs">{data.briefPath}</code> from these settings (saved in the{" "}
          <code className="font-mono text-xs">AGENTS.md</code> header). You never edit that file by hand.
        </p>
      </div>
      {data.layout !== "v0.16" ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Migrate this workspace to protocol v0.16 first (workspace page → Migrate to v0.16).
        </p>
      ) : (
        <DreamingSetup wsId={ws.id} initial={data} />
      )}
    </div>
  );
}
