import { Dashboard } from "./dashboard";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { AccountsOff } from "@/components/accounts-off";

export const metadata = { title: "Your projects · Roblox Editor" };

export default function DashboardPage() {
  if (!ACCOUNTS_ENABLED) return <AccountsOff />;
  return <Dashboard />;
}
