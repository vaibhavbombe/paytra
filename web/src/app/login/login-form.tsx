"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getClientAuth } from "@/lib/firebase/client";

type Mode = "signin" | "signup";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Hand the fresh ID token to our server, which sets the httpOnly cookie.
  // Then drop the Firebase client session: from here on the cookie is the
  // only credential the browser holds.
  async function startSession(user: User) {
    const idToken = await user.getIdToken();
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    await signOut(getClientAuth());
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Sign-in failed");
    }
    router.replace("/dashboard");
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const google = () =>
    run(async () => {
      const cred = await signInWithPopup(getClientAuth(), new GoogleAuthProvider());
      await startSession(cred.user);
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const auth = getClientAuth();
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(cred.user);
        await signOut(auth);
        setMode("signin");
        setMessage("Verification email sent. Click the link in it, then sign in.");
        return;
      }
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await startSession(cred.user);
    });
  };

  return (
    <div className="w-full max-w-sm space-y-6">
      <button
        type="button"
        onClick={google}
        disabled={busy}
        className="w-full rounded-md border border-input px-4 py-2 font-medium hover:bg-surface-hover disabled:opacity-50"
      >
        Continue with Google
      </button>

      <div className="text-center text-sm text-muted">or</div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-input px-3 py-2"
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-input px-3 py-2"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      {message && (
        <p role="status" className="text-sm text-foreground">
          {message}
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setMessage(null);
        }}
        className="w-full text-sm text-muted underline"
      >
        {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </div>
  );
}

// Don't echo raw Firebase errors: they reveal whether an email is registered.
function friendlyError(e: unknown): string {
  const code = (e as { code?: string }).code ?? "";
  if (code === "auth/popup-closed-by-user") return "Sign-in window was closed.";
  if (code === "auth/email-already-in-use") return "Could not create account. Try signing in.";
  if (code === "auth/weak-password") return "Password is too weak.";
  if (code === "auth/too-many-requests") return "Too many attempts. Try again later.";
  if (code.startsWith("auth/")) return "Email or password is incorrect.";
  return e instanceof Error ? e.message : "Something went wrong.";
}
