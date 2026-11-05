import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import DreamingInbox from "./inbox";

export const dynamic = "force-dynamic";

export default async function InboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/w/${ws.id}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {ws.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">Dreaming</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500">
          Proposals and questions from the dreaming agent. <strong>Accept</strong> applies an edit
          straight away (refused if the file changed since it was proposed);{" "}
          <strong>Reject</strong> needs a reason so it isn&apos;t proposed again; answers and
          rejections go back to the next dreaming run. An accept is not a verification — changed
          files still show up in Review.
        </p>
      </div>
      <DreamingInbox wsId={ws.id} />
    </div>
  );
}
