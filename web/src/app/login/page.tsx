import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · PayTra" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">PayTra</h1>
        <p className="text-sm text-muted">All your payments in one place</p>
      </div>
      <LoginForm />
      <p className="max-w-sm text-center text-xs text-muted">
        PayTra never asks for your bank password or UPI PIN.
      </p>
    </main>
  );
}
