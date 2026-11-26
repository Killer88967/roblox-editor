"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { signIn, signUp } from "@/lib/auth-client";
import { btn, input, primaryBtn } from "@/components/ui";

const PROVIDER_LABELS = { github: "GitHub", discord: "Discord" } as const;

/** Only same-site paths are allowed as the place to go after signing in. */
const safeNext = (next: string | null) => (next && /^\/(?!\/)/.test(next) ? next : "/dashboard");

export function LoginForm({ providers }: { providers: ("github" | "discord")[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res =
      mode === "in"
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: name.trim() || email.split("@")[0] });
    setBusy(false);
    if (res.error) setError(res.error.message ?? "That didn't work. Try again.");
    else router.push(next);
  };

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-1 text-xl font-semibold">Roblox Editor</h1>
      <p className="mb-6 text-sm text-zinc-400">
        {mode === "in"
          ? "Sign in to save places to the cloud."
          : "Create an account to save places to the cloud."}
      </p>

      {providers.length > 0 && (
        <div className="mb-4 grid gap-2">
          {providers.map((p) => (
            <button
              key={p}
              type="button"
              className={`${btn} py-2`}
              onClick={() =>
                signIn.social({
                  provider: p,
                  callbackURL: next,
                  errorCallbackURL: `/login?next=${encodeURIComponent(next)}`,
                })
              }
            >
              Continue with {PROVIDER_LABELS[p]}
            </button>
          ))}
          <div className="my-2 flex items-center gap-3 text-xs text-zinc-500">
            <span className="h-px flex-1 bg-white/10" /> or{" "}
            <span className="h-px flex-1 bg-white/10" />
          </div>
        </div>
      )}

      <form onSubmit={submit} className="grid gap-3">
        {mode === "up" && (
          <input
            className={input}
            placeholder="Name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <input
          className={input}
          type="email"
          placeholder="Email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className={input}
          type="password"
          placeholder={mode === "up" ? "Password (8+ characters)" : "Password"}
          autoComplete={mode === "up" ? "new-password" : "current-password"}
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" className={`${primaryBtn} py-2`} disabled={busy}>
          {busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-sm text-zinc-400">
        {mode === "in" ? "No account yet? " : "Already have an account? "}
        <button
          type="button"
          className="text-blue-400 hover:underline"
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
            setError(null);
          }}
        >
          {mode === "in" ? "Create one" : "Sign in"}
        </button>
      </p>
      <p className="mt-6 text-sm">
        <Link href="/" className="text-zinc-400 hover:text-zinc-200">
          ← Use the editor without an account
        </Link>
      </p>
    </div>
  );
}
