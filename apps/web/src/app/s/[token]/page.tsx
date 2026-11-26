import { Suspense } from "react";
import { SharedViewer } from "./shared-viewer";

export const metadata = { title: "Shared place · Roblox Editor" };

export default function SharedPage() {
  return (
    <Suspense>
      <SharedViewer />
    </Suspense>
  );
}
