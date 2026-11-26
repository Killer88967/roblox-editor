/** Shared Tailwind class names for the app's buttons and panels. */
export const btn =
  "rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10";
export const primaryBtn =
  "rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600";
export const dangerBtn = "rounded bg-red-600/80 px-3 py-1.5 text-sm hover:bg-red-600";
export const input =
  "w-full rounded bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none ring-1 ring-white/10 focus:ring-blue-500";

/** "2.4 MB" */
export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "5 min ago", "yesterday", or a date. */
export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  return new Date(iso).toLocaleDateString();
}
