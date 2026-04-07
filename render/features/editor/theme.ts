// features/editor/theme.ts
// One Dark Pro theme + scrollbar + transparent-textarea trick.
// Injected once into document.head.

export const THEME_CSS = `
.sb-hljs .hljs            { background:transparent; color:#abb2bf; }
.sb-hljs .hljs-keyword    { color:#c678dd; }
.sb-hljs .hljs-built_in   { color:#e06c75; }
.sb-hljs .hljs-type       { color:#e5c07b; }
.sb-hljs .hljs-class      { color:#e5c07b; }
.sb-hljs .hljs-string     { color:#98c379; }
.sb-hljs .hljs-number     { color:#d19a66; }
.sb-hljs .hljs-literal    { color:#56b6c2; }
.sb-hljs .hljs-operator   { color:#56b6c2; }
.sb-hljs .hljs-comment    { color:#5c6370; font-style:italic; }
.sb-hljs .hljs-variable   { color:#e06c75; }
.sb-hljs .hljs-attr       { color:#e06c75; }
.sb-hljs .hljs-attribute  { color:#98c379; }
.sb-hljs .hljs-title      { color:#61afef; }
.sb-hljs .hljs-function   { color:#61afef; }
.sb-hljs .hljs-title.function_ { color:#61afef; }
.sb-hljs .hljs-title.class_    { color:#e5c07b; }
.sb-hljs .hljs-params     { color:#abb2bf; }
.sb-hljs .hljs-tag        { color:#e06c75; }
.sb-hljs .hljs-name       { color:#e06c75; }
.sb-hljs .hljs-property   { color:#9cdcfe; }
.sb-hljs .hljs-meta       { color:#61afef; }
.sb-hljs .hljs-symbol     { color:#56b6c2; }
.sb-hljs .hljs-punctuation{ color:#abb2bf; }
.sb-hljs .hljs-regexp     { color:#98c379; }
.sb-hljs .hljs-section    { color:#61afef; font-weight:bold; }
.sb-hljs .hljs-selector-tag   { color:#e06c75; }
.sb-hljs .hljs-selector-class { color:#e5c07b; }
.sb-hljs .hljs-selector-id    { color:#61afef; }
.sb-hljs .hljs-emphasis   { font-style:italic; }
.sb-hljs .hljs-strong     { font-weight:bold; }
.sb-hljs .hljs-link       { color:#98c379; text-decoration:underline; }
.sb-hljs .hljs-code       { color:#98c379; }
.sb-hljs .hljs-bullet     { color:#61afef; }
.sb-hljs .hljs-quote      { color:#5c6370; font-style:italic; }
.sb-hljs .hljs-formula    { color:#9cdcfe; }
.sb-hljs .hljs-variable.language_ { color:#c678dd; }

.sb-scroll::-webkit-scrollbar { width:8px; height:8px; }
.sb-scroll::-webkit-scrollbar-track { background:transparent; }
.sb-scroll::-webkit-scrollbar-thumb { background:rgba(255,255,255,.12); border-radius:4px; }
.sb-scroll::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,.22); }
.sb-scroll::-webkit-scrollbar-corner { background:transparent; }

.sb-textarea {
  color:transparent !important;
  -webkit-text-fill-color:transparent !important;
  caret-color:#00e5ff !important;
  background:transparent !important;
  resize:none !important;
  outline:none !important;
  border:none !important;
  overflow:hidden !important;
  white-space:pre !important;
  word-wrap:normal !important;
  overflow-wrap:normal !important;
}
.sb-textarea::selection {
  background:rgba(97,175,239,.28) !important;
  -webkit-text-fill-color:transparent !important;
  color:transparent !important;
}
@keyframes sb-spin { to { transform:rotate(360deg); } }
`;

let _injected = false;
export function injectTheme() {
  if (_injected) return;
  _injected = true;
  const s = document.createElement("style");
  s.id = "sb-theme";
  s.textContent = THEME_CSS;
  document.head.appendChild(s);
}
