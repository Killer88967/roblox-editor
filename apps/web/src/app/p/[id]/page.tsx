import { Suspense } from "react";
import { ProjectEditor } from "./project-editor";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { AccountsOff } from "@/components/accounts-off";

export default function ProjectPage() {
  if (!ACCOUNTS_ENABLED) return <AccountsOff />;
  return (
    <Suspense>
      <ProjectEditor />
    </Suspense>
  );
}
