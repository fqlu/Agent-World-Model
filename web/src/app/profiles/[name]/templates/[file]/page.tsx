import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AGENTS_PLACEHOLDERS,
  PROFILE_TEMPLATES,
  profileExists,
  readProfileTemplate,
} from "@/lib/profiles";
import { saveTemplateAction, resetTemplateAction } from "../../../actions";
import TemplateEditor from "./template-editor";

export const dynamic = "force-dynamic";

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ name: string; file: string }>;
}) {
  const { name, file: rawFile } = await params;
  const file = decode(rawFile);
  const meta = PROFILE_TEMPLATES.find((t) => t.file === file);
  if (!meta || !profileExists(name)) notFound();
  const { content, base, overridden } = readProfileTemplate(name, file);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/profiles/${name}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {name}
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-900">
          <span className="font-mono">{file}</span>
          {overridden ? (
            <span className="badge bg-indigo-100 text-indigo-700">customised for {name}</span>
          ) : (
            <span className="badge bg-zinc-100 text-zinc-500">base template</span>
          )}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">{meta.usedFor}</p>
      </div>

      {file === "AGENTS.md" && (
        <div className="card max-w-3xl p-4 text-xs text-zinc-600">
          <p className="font-medium text-zinc-800">Placeholders filled in when AGENTS.md is generated</p>
          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {AGENTS_PLACEHOLDERS.map((p) => (
              <li key={p.token}>
                <code className="font-mono text-zinc-900">{p.token}</code> — {p.meaning}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Keep <code className="font-mono">{"{{spec_version}}"}</code> and{" "}
            <code className="font-mono">{"{{profile}}"}</code> in the file, or every workspace on
            this profile fails audit rule ST-005.
          </p>
        </div>
      )}

      <TemplateEditor
        initial={content}
        base={base}
        overridden={overridden}
        saveAction={saveTemplateAction.bind(null, name, file)}
        resetAction={resetTemplateAction.bind(null, name, file)}
      />
    </div>
  );
}
