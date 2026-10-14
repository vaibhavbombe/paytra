import type { Metadata } from "next";
import { Suspense } from "react";

import { ReturnStatus } from "./return-status";

export const metadata: Metadata = { title: "Account Aggregator · PayTra" };

// Setu sends the browser here after approve/reject. We never trust the query
// string for the result: the status comes from Setu's API (server-side).
export default function AaReturnPage({ searchParams }: PageProps<"/aa/return">) {
  return (
    <main className="mx-auto w-full max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Linking your bank</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Inner searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Inner({ searchParams }: { searchParams: PageProps<"/aa/return">["searchParams"] }) {
  const p = await searchParams;
  const consent = typeof p.consent === "string" ? p.consent : null;
  return <ReturnStatus consentId={consent} />;
}
