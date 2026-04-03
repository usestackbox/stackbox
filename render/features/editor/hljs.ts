// features/editor/hljs.ts
// Lazy-loaded highlight.js singleton — imported once, shared across all editors.

type HljsCore = typeof import("highlight.js").default;
let _promise: Promise<HljsCore> | null = null;

export function getHljs(): Promise<HljsCore> {
  if (_promise) return _promise;
  _promise = (async () => {
    const { default: hljs } = await import("highlight.js/lib/core");
    const [
      { default: javascript }, { default: typescript }, { default: python },
      { default: css },        { default: xml },         { default: json },
      { default: bash },       { default: markdown },    { default: rust },
      { default: go },         { default: java },        { default: cpp },
      { default: csharp },     { default: ruby },        { default: swift },
      { default: kotlin },     { default: sql },         { default: yaml },
      { default: dockerfile }, { default: graphql },
    ] = await Promise.all([
      import("highlight.js/lib/languages/javascript"),
      import("highlight.js/lib/languages/typescript"),
      import("highlight.js/lib/languages/python"),
      import("highlight.js/lib/languages/css"),
      import("highlight.js/lib/languages/xml"),
      import("highlight.js/lib/languages/json"),
      import("highlight.js/lib/languages/bash"),
      import("highlight.js/lib/languages/markdown"),
      import("highlight.js/lib/languages/rust"),
      import("highlight.js/lib/languages/go"),
      import("highlight.js/lib/languages/java"),
      import("highlight.js/lib/languages/cpp"),
      import("highlight.js/lib/languages/csharp"),
      import("highlight.js/lib/languages/ruby"),
      import("highlight.js/lib/languages/swift"),
      import("highlight.js/lib/languages/kotlin"),
      import("highlight.js/lib/languages/sql"),
      import("highlight.js/lib/languages/yaml"),
      import("highlight.js/lib/languages/dockerfile"),
      import("highlight.js/lib/languages/graphql"),
    ]);
    const reg = (aliases: string[], lang: unknown) =>
      aliases.forEach(a => hljs.registerLanguage(a, lang as never));
    reg(["javascript","js","jsx","mjs"], javascript);
    reg(["typescript","ts","tsx"],       typescript);
    reg(["python","py"],                 python);
    reg(["css","scss","less"],           css);
    reg(["html","xml","svg"],            xml);
    reg(["json","jsonc"],                json);
    reg(["bash","sh","zsh"],             bash);
    reg(["markdown","md","mdx"],         markdown);
    reg(["rust","rs"],                   rust);
    reg(["go"],                          go);
    reg(["java","groovy"],               java);
    reg(["cpp","c","cc","cxx","h","hpp"],cpp);
    reg(["csharp","cs"],                 csharp);
    reg(["ruby","rb"],                   ruby);
    reg(["swift"],                       swift);
    reg(["kotlin","kt"],                 kotlin);
    reg(["sql"],                         sql);
    reg(["yaml","yml"],                  yaml);
    reg(["dockerfile"],                  dockerfile);
    reg(["graphql","gql"],               graphql);
    return hljs;
  })();
  return _promise;
}

export type { HljsCore };

export function extToLang(filename: string): string {
  const ext  = filename.split(".").pop()?.toLowerCase() ?? "";
  const name = filename.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile")   return "makefile";
  const map: Record<string, string> = {
    ts:"typescript", tsx:"typescript", js:"javascript", jsx:"javascript",
    mjs:"javascript", cjs:"javascript", py:"python", pyw:"python",
    css:"css", scss:"css", less:"css", html:"html", htm:"html",
    xml:"xml", svg:"xml", json:"json", jsonc:"json", yaml:"yaml", yml:"yaml",
    sh:"bash", bash:"bash", zsh:"bash", md:"markdown", mdx:"markdown",
    rs:"rust", go:"go", c:"c", h:"c", cpp:"cpp", cc:"cpp", cxx:"cpp", hpp:"cpp",
    cs:"csharp", java:"java", kt:"kotlin", rb:"ruby", swift:"swift",
    sql:"sql", graphql:"graphql", gql:"graphql",
  };
  return map[ext] ?? "plaintext";
}