import { Suspense } from "react";
import { SharedViewer } from "./shared-viewer";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { AccountsOff } from "@/components/accounts-off";

export const metadata = { title: "Shared place · Roblox Editor" };

export default function SharedPage() {
  if (!ACCOUNTS_ENABLED) return <AccountsOff />;
  return (
    <Suspense>
      <SharedViewer />
    </Suspense>
  );
}
