import type { Metadata } from "next";
import { io } from "next/cache";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { aiConfigured } from "@/lib/ai/client";
import { getSessionUser } from "@/lib/auth/session";

import { AskForm } from "./ask-form";

export const metadata: Metadata = { title: "Ask about your spending · PayTra" };

export default function InsightsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Ask about your spending</h1>
        <p className="mt-1 text-sm text-muted">
          Ask in plain English. The AI picks one read-only query; PayTra runs it on your transactions and writes the
          answer, so every number comes from your data, not from the AI.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Inner />
      </Suspense>
    </main>
  );
}

async function Inner() {
  await io();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!aiConfigured()) return <p className="text-muted">Questions aren&apos;t set up on this server yet.</p>;
  return <AskForm />;
}
