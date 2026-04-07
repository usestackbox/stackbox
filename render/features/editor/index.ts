// features/editor/index.ts
export { FileEditorPane } from "./FileEditorPane";
export { LiveEditor } from "./LiveEditor";
export { GutterInner } from "./GutterInner";
export { FindBar, buildMatches } from "./FindBar";
export type { FindMatch } from "./FindBar";
export { StatusBar } from "./StatusBar";
export { getHljs, extToLang } from "./hljs";
export type { HljsCore } from "./hljs";
export { injectTheme } from "./theme";
