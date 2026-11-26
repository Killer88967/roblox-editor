import { connection } from "next/server";
import { Suspense } from "react";
import { enabledProviders } from "@/lib/server/providers";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Roblox Editor" };

/** Reads which sign-in methods are configured at request time, not build time. */
async function Form() {
  await connection();
  return <LoginForm providers={enabledProviders()} />;
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-950 p-4 text-zinc-100">
      <Suspense>
        <Form />
      </Suspense>
    </main>
  );
}
