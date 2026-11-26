"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "@/lib/auth-client";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { btn } from "./ui";

/** "Sign in", or the signed-in user's menu (Projects, Sign out). Hidden while accounts are off. */
export function AccountMenu() {
  return ACCOUNTS_ENABLED ? <Account /> : null;
}

function Account() {
  const { data, isPending } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (isPending) return <span className="w-16" />;
  if (!data) {
    return (
      <Link href={`/login?next=${encodeURIComponent(pathname)}`} className={btn}>
        Sign in
      </Link>
    );
  }
  const { user } = data;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-blue-700 text-sm font-medium"
        title={user.email}
        onClick={() => setOpen(!open)}
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-full w-full object-cover" />
        ) : (
          (user.name || user.email).slice(0, 1).toUpperCase()
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 min-w-48 rounded-md border border-white/10 bg-zinc-900 p-1 text-sm shadow-xl">
          <div className="truncate px-2 py-1.5 text-zinc-400">{user.name || user.email}</div>
          <Link href="/dashboard" className="block rounded px-2 py-1.5 hover:bg-white/10">
            Your projects
          </Link>
          <Link href="/" className="block rounded px-2 py-1.5 hover:bg-white/10">
            Local editor
          </Link>
          <button
            type="button"
            className="block w-full rounded px-2 py-1.5 text-left hover:bg-white/10"
            onClick={async () => {
              await signOut();
              router.push("/login");
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
