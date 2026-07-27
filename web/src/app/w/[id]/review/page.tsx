import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import ReviewQueue from "./queue";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/w/${ws.id}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {ws.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">Review</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500">
          Everything that changed since you last reviewed — written by any agent, in any tool, at
          any time. Open <em>View changes</em> to see the before/after diff; each file is also
          linted against the protocol <em>now</em>. <strong>Verify</strong> marks it reviewed and
          stamps a <code className="font-mono">verified: human:you</code> event on entities and
          overviews (the durable form of your approval). <strong>Flag</strong> records a problem
          to hand to your next agent session.
        </p>
      </div>
      <ReviewQueue wsId={ws.id} />
    </div>
  );
}
