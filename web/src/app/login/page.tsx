export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "/", error } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Sign in</h1>
      <p className="text-sm text-zinc-600">
        Agent World Model is limited to approved Google accounts.
      </p>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}
      <a href={`/api/auth/login?next=${encodeURIComponent(next)}`} className="btn-primary inline-flex justify-center">
        Sign in with Google
      </a>
    </div>
  );
}
