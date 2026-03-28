// src/panels/FileTreePanel.tsx
// Backward-compat re-export shim — import from the split files for new code:
//   FileStructurePanel  →  file tree + search
//   WorkspacePanel      →  editor with highlight.js

export { default } from "./Filestructurepanel";
export { fileColor, FileIcon } from "./Filestructurepanel";
export { EditorPane, detectLang } from "./Workspacepanel";