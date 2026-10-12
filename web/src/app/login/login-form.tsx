"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getClientAuth } from "@/lib/firebase/client";
import { canSignUp, checkPassword, PASSWORD_MAX } from "@/lib/password";

type Mode = "signin" | "signup" | "reset";

const TITLES: Record<Mode, string> = {
  signin: "Sign in",
  signup: "Create account",
  reset: "Reset password",
};

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const strength = checkPassword(password);
  const confirmMismatch = mode === "signup" && confirm.length > 0 && confirm !== password;

  function switchMode(next: Mode) {
    setMode(next);
    setPassword("");
    setConfirm("");
    setShowPassword(false);
    setMessage(null);
  }

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
      setMessage({ kind: "error", text: friendlyError(e, mode) });
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
    const auth = getClientAuth();

    if (mode === "reset") {
      run(async () => {
        try {
          await sendPasswordResetEmail(auth, email.trim());
        } catch (err) {
          // Same answer whether or not the email exists (no account
          // enumeration); only surface rate limiting / bad format.
          const code = (err as { code?: string }).code ?? "";
          if (code === "auth/too-many-requests" || code === "auth/invalid-email") throw err;
        }
        switchMode("signin");
        setMessage({
          kind: "info",
          text: "If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.",
        });
      });
      return;
    }

    if (mode === "signup") {
      if (!canSignUp(email, password, confirm)) return; // button is disabled anyway
      run(async () => {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await sendEmailVerification(cred.user);
        await signOut(auth);
        switchMode("signin");
        setMessage({ kind: "info", text: "Verification email sent. Click the link in it, then sign in." });
      });
      return;
    }

    run(async () => {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await startSession(cred.user);
    });
  };

  const submitDisabled =
    busy ||
    !email.trim() ||
    (mode === "signin" && !password) ||
    (mode === "signup" && !canSignUp(email, password, confirm));

  const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2";

  return (
    <div className="w-full max-w-sm space-y-6">
      {mode !== "reset" && (
        <>
          <button
            type="button"
            onClick={google}
            disabled={busy}
            className="w-full rounded-md border border-input px-4 py-2 font-medium hover:bg-surface-hover disabled:opacity-50"
          >
            Continue with Google
          </button>
          <div className="text-center text-sm text-muted">or</div>
        </>
      )}

      <form onSubmit={submit} className="space-y-3" noValidate>
        <h2 className="text-lg font-medium">{TITLES[mode]}</h2>
        {mode === "reset" && (
          <p className="text-sm text-muted">Enter your account email and we&apos;ll send you a link to set a new password.</p>
        )}

        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />

        {mode !== "reset" && (
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              maxLength={PASSWORD_MAX}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder="Password"
              aria-label="Password"
              aria-describedby={mode === "signup" ? "password-rules" : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} pr-16`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs text-muted hover:bg-surface-hover"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        )}

        {mode === "signup" && (
          <>
            <ul id="password-rules" className="space-y-0.5 text-xs" aria-live="polite">
              {strength.results.map((r) => (
                <li key={r.id} className={r.ok ? "text-success" : "text-muted"}>
                  <span aria-hidden>{r.ok ? "✓" : "○"}</span> {r.label}
                  <span className="sr-only">{r.ok ? " (met)" : " (not met)"}</span>
                </li>
              ))}
            </ul>

            <div>
              <input
                type={showPassword ? "text" : "password"}
                required
                maxLength={PASSWORD_MAX}
                autoComplete="new-password"
                placeholder="Confirm password"
                aria-label="Confirm password"
                aria-invalid={confirmMismatch}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onPaste={(e) => e.preventDefault()} // make people actually re-type it
                className={`${inputClass} ${confirmMismatch ? "border-danger" : ""}`}
              />
              {confirmMismatch && <p className="mt-1 text-xs text-danger">Passwords don&apos;t match.</p>}
              {!confirmMismatch && confirm && confirm === password && (
                <p className="mt-1 text-xs text-success">✓ Passwords match</p>
              )}
            </div>
          </>
        )}

        {mode === "signin" && (
          <div className="text-right">
            <button type="button" onClick={() => switchMode("reset")} className="text-sm text-muted underline">
              Forgot password?
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={submitDisabled}
          className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {busy ? "Please wait…" : mode === "reset" ? "Send reset link" : TITLES[mode]}
        </button>
      </form>

      {message && (
        <p role="status" className={`text-sm ${message.kind === "error" ? "text-danger" : "text-foreground"}`}>
          {message.text}
        </p>
      )}

      <div className="space-y-1 text-center">
        {mode === "signin" && (
          <button type="button" onClick={() => switchMode("signup")} className="text-sm text-muted underline">
            New here? Create an account
          </button>
        )}
        {mode !== "signin" && (
          <button type="button" onClick={() => switchMode("signin")} className="text-sm text-muted underline">
            Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

// Don't echo raw Firebase errors: they reveal whether an email is registered.
function friendlyError(e: unknown, mode: Mode): string {
  const code = (e as { code?: string }).code ?? "";
  if (code === "auth/popup-closed-by-user") return "Sign-in window was closed.";
  if (code === "auth/too-many-requests") return "Too many attempts. Try again later.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/email-already-in-use") return "Could not create account. Try signing in or resetting your password.";
  if (code === "auth/weak-password" || code === "auth/password-does-not-meet-requirements")
    return "Password doesn't meet the requirements.";
  if (code.startsWith("auth/")) return mode === "signin" ? "Email or password is incorrect." : "Something went wrong. Try again.";
  return e instanceof Error ? e.message : "Something went wrong.";
}
