// render/lib/git.ts
// Frontend git primitives via a thin Rust shim (git_run).
// Diff parsing and status logic stays in TypeScript.
// Only git_run crosses the IPC boundary — one generic command instead of many.

import { invoke } from "@tauri-apps/api/core";
import type { LiveDiffFile } from "../features/git/types";

// ── Shim ─────────────────────────────────────────────────────────────────────

async function git(cwd: string, args: string[]): Promise<string> {
  return invoke<string>("git_run", { cwd, args });
}

// ── Repo detection ────────────────────────────────────────────────────────────

export async function gitIsRepo(cwd: string): Promise<boolean> {
  try {
    const out = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

export async function gitCurrentBranch(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    return "";
  }
}

// ── Status + diff ─────────────────────────────────────────────────────────────

// FIX: Use "added" to match LiveDiffFile.change_type ("added" | "modified" | "deleted")
type ChangeType = "modified" | "added" | "deleted";

interface StatusEntry {
  path: string;
  change_type: ChangeType;
}

function parseStatus(raw: string): StatusEntry[] {
  return raw
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((l) => {
      const xy = l.slice(0, 2);
      const rest = l.slice(3);
      const path = rest.includes(" -> ") ? rest.split(" -> ")[1] : rest;
      const x = xy[0];
      const y = xy[1];
      let change_type: ChangeType = "modified";
      // Untracked ("??") or intent-added (" ?") → treat as added
      if (x === "?" || y === "?") change_type = "added";
      else if (x === "A" || y === "A") change_type = "added";
      else if (x === "D" || y === "D") change_type = "deleted";
      return { path: path.trim(), change_type };
    });
}

function countDiffLines(diff: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) insertions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { insertions, deletions };
}

async function fileDiff(cwd: string, path: string, change_type: ChangeType): Promise<string> {
  try {
    if (change_type === "deleted") {
      // Try HEAD diff first (staged delete), fall back to cached
      const d = await git(cwd, ["diff", "HEAD", "--", path]).catch(() => "");
      if (d.trim()) return d;
      return await git(cwd, ["diff", "--cached", "--", path]).catch(() => "");
    }

    // For modified/added: try unstaged first, then staged
    const [unstaged, staged] = await Promise.all([
      git(cwd, ["diff", "--", path]).catch(() => ""),
      git(cwd, ["diff", "--cached", "--", path]).catch(() => ""),
    ]);
    if (unstaged.trim()) return unstaged;
    if (staged.trim()) return staged;

    // FIX: For new/untracked files both diffs are empty because the file is
    // not tracked yet.  Use --intent-to-add to temporarily register the path
    // in the index (zero bytes), run `git diff`, then immediately remove it.
    if (change_type === "added") {
      try {
        await git(cwd, ["add", "--intent-to-add", "--", path]);
        const diff = await git(cwd, ["diff", "--", path]).catch(() => "");
        // Always clean up — even if diff failed
        await git(cwd, ["rm", "--cached", "--quiet", "--force", "--", path]).catch(() => {});
        return diff;
      } catch {
        // intent-to-add can fail if the file is already tracked somehow;
        // safe to swallow and return empty
        return "";
      }
    }

    return "";
  } catch {
    return "";
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Replaces invoke("git_diff_live").
 * Returns the same LiveDiffFile[] shape — ChangesTab needs no changes.
 */
export async function gitDiffLive(cwd: string): Promise<LiveDiffFile[]> {
  const statusRaw = await git(cwd, ["status", "--porcelain", "-u"]);
  const entries = parseStatus(statusRaw);

  return Promise.all(
    entries.map(async ({ path, change_type }) => {
      const diff = await fileDiff(cwd, path, change_type);
      const { insertions, deletions } = countDiffLines(diff);
      return {
        path,
        change_type,
        diff,
        insertions,
        deletions,
        modified_at: Date.now(),
      } satisfies LiveDiffFile;
    })
  );
}
