import Link from "next/link";

/** Shown on account pages while accounts are turned off. */
export function AccountsOff() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-950 p-4 text-center text-zinc-100">
      <h1 className="text-lg font-semibold">Accounts are turned off for now</h1>
      <p className="max-w-sm text-sm text-zinc-400">
        You can still open, edit and save places on your device with the editor.
      </p>
      <Link
        href="/"
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
      >
        Open the editor
      </Link>
    </main>
  );
}
