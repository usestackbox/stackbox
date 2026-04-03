// lib/lang.ts
// Single source of truth for file → language mapping.
// Merged from DiffViewer.tsx and Workspacepanel.tsx — was duplicated.

const EXT_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  css: "css", scss: "css", less: "css",
  html: "html", htm: "html", xml: "xml", svg: "xml",
  json: "json", jsonc: "json",
  yaml: "yaml", yml: "yaml",
  toml: "toml", ini: "toml", env: "bash",
  rs: "rust", go: "go",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp",
  cs: "csharp",
  java: "java", kt: "kotlin", scala: "scala",
  py: "python", pyw: "python",
  rb: "ruby", php: "php", lua: "lua", pl: "perl",
  r: "r", swift: "swift", dart: "dart",
  sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell",
  md: "markdown", mdx: "markdown",
  sql: "sql", proto: "protobuf", graphql: "graphql", gql: "graphql",
  hs: "haskell", ex: "elixir", exs: "elixir",
  diff: "diff", patch: "diff",
  groovy: "java", kt2: "kotlin",
};

/** Map a filename or path to an hljs language identifier. */
export function getLanguage(path: string): string {
  const ext  = path.split(".").pop()?.toLowerCase() ?? "";
  const name = path.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile")   return "makefile";
  return EXT_MAP[ext] ?? "plaintext";
}

/** Alias used by the editor module. */
export const extToLang = getLanguage;

/** Extension → colour for file type indicators in tabs and diffs. */
export function extColor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx"].includes(ext)) return "#4a7ab5";
  if (["js", "jsx"].includes(ext)) return "#a09040";
  if (ext === "rs")                return "#b04040";
  if (["css", "scss"].includes(ext)) return "#4060a0";
  if (ext === "json")              return "#808040";
  if (ext === "md")                return "#5080a0";
  if (ext === "go")                return "#3a8080";
  return "rgba(255,255,255,.40)";
}
