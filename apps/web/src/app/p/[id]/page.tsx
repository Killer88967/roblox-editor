import { Suspense } from "react";
import { ProjectEditor } from "./project-editor";

export default function ProjectPage() {
  return (
    <Suspense>
      <ProjectEditor />
    </Suspense>
  );
}
