"use client";

import { useEffect } from "react";
import { useEditor } from "@/stores/editor";
import { EditorShell } from "./editor-shell";

/** The editor for local files (no account needed). Leaves any cloud project behind. */
export function LocalEditor() {
  useEffect(() => {
    useEditor.getState().closeCloud();
  }, []);
  return <EditorShell />;
}
