import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
// features/changes/useFileChanges.ts
import { useCallback, useEffect, useRef, useState } from "react";

export interface LiveDiffFile {
  path: string;
  change_type: "created" | "modified" | "deleted";
  diff: string;
  insertions: number;
  deletions: number;
  modified_at: number;
}

export interface AgentSpan {
  agent: string;
  startedAt: number;
}

const BLOCKED_NAMES = new Set([
  ".calus-context.md",
  "claude.md",
  "agents.md",
  "gemini.md",
  "opencode.md",
  "copilot-instructions.md",
  "mcp.json",
  "skill.md",
  "payload.json",
  "rewrite_app.py",
  "update_app.py",
]);
const BLOCKED_PREFIXES = [
  ".claude/",
  ".gemini/",
  ".codex/",
  ".cursor/",
  ".agents/",
  ".opencode/",
  ".github/skills/",
  ".github/copilot",
];

function isTempFile(n: string) {
  return /^(rewrite_|update_|patch_|fix_|temp_|tmp_).*\.(py|js|sh|ps1)$/.test(n);
}
function shouldBlock(path: string) {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  const name = norm.split("/").pop() ?? "";
  return (
    BLOCKED_NAMES.has(name) || isTempFile(name) || BLOCKED_PREFIXES.some((p) => norm.startsWith(p))
  );
}

export function useFileChanges(runboxId: string, runboxCwd: string) {
  const [files, setFiles] = useState<LiveDiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [agentSpans, setAgentSpans] = useState<AgentSpan[]>([]);
  const worktreeCwdRef = useRef(runboxCwd);

  const PORT = (window as any).__CALUS_PORT__ ?? 7700;

  useEffect(() => {
    worktreeCwdRef.current = runboxCwd;
    invoke<string>("git_current_branch", { cwd: runboxCwd })
      .then((b) => {
        if (b) setBranch(b);
      })
      .catch(() => {});
  }, [runboxId, runboxCwd]);

  useEffect(() => {
    fetch(`http://localhost:${PORT}/events?runbox_id=${runboxId}&event_type=AgentSpawned&limit=50`)
      .then((r) => r.json())
      .then((rows: any[]) =>
        setAgentSpans(
          rows
            .map((r) => {
              try {
                const p = JSON.parse(r.payload_json);
                return { agent: p.agent ?? "", startedAt: r.timestamp };
              } catch {
                return null;
              }
            })
            .filter((s): s is AgentSpan => !!s && s.agent !== "Shell")
            .sort((a, b) => a.startedAt - b.startedAt)
        )
      )
      .catch(() => {});
  }, [runboxId]);

  const applyAndSet = (raw: LiveDiffFile[]) =>
    setFiles(
      raw
        .filter((f) => !shouldBlock(f.path))
        .sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0))
    );

  const load = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      invoke<LiveDiffFile[]>("git_diff_live", { cwd: worktreeCwdRef.current, runboxId })
        .then(applyAndSet)
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    },
    [runboxId]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    if (!runboxCwd) return;
    invoke("git_watch_start", { cwd: runboxCwd, runboxId }).catch(() => {});
    return () => {
      invoke("git_watch_stop", { cwd: runboxCwd }).catch(() => {});
    };
  }, [runboxId, runboxCwd]);

  useEffect(() => {
    const u = listen<LiveDiffFile[]>("git:live-diff", ({ payload }) => {
      applyAndSet(payload);
      setLoading(false);
      setError(null);
    });
    return () => {
      u.then((f) => f());
    };
  }, []);

  const deduped = (() => {
    const m = new Map<string, LiveDiffFile>();
    for (const f of files) m.set(f.path, f);
    return Array.from(m.values());
  })();

  return { files: deduped, loading, error, branch, agentSpans, reload: load };
}
