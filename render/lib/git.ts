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

type ChangeType = "modified" | "added" | "deleted";

interface StatusEntry {
  path: string;
  change_type: ChangeType;
  /** raw XY porcelain status codes */
  x: string;
  y: string;
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
      if (x === "?" || y === "?") change_type = "added";
      else if (x === "A" || y === "A") change_type = "added";
      else if (x === "D" || y === "D") change_type = "deleted";
      return { path: path.trim(), change_type, x, y };
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

/**
 * Build a synthetic "+line" diff from raw file content.
 * Used when git diff returns nothing (fresh repo / empty-tree scenario).
 */
function syntheticAddedDiff(path: string, content: string): string {
  const lines = content.split("\n");
  // git adds a trailing newline — remove the phantom empty last line
  if (lines[lines.length - 1] === "") lines.pop();
  const count = lines.length;
  let d =
    `diff --git a/${path} b/${path}\n` +
    `new file mode 100644\n` +
    `--- /dev/null\n` +
    `+++ b/${path}\n` +
    `@@ -0,0 +1,${count} @@\n`;
  for (const l of lines) d += `+${l}\n`;
  return d;
}

/**
 * Check whether HEAD exists (i.e. the repo has at least one commit).
 * Returns false on a freshly-initialised repo.
 */
async function repoHasHead(cwd: string): Promise<boolean> {
  try {
    const out = await git(cwd, ["rev-parse", "--verify", "HEAD"]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Git's empty-tree SHA — stable across versions.
 * Comparing against it with --cached gives us all staged content
 * even when HEAD doesn't exist yet.
 */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

async function fileDiff(cwd: string, path: string, change_type: ChangeType, x: string, y: string): Promise<string> {
  try {
    if (change_type === "deleted") {
      const [head, cached] = await Promise.all([
        git(cwd, ["diff", "HEAD", "--", path]).catch(() => ""),
        git(cwd, ["diff", "--cached", "--", path]).catch(() => ""),
      ]);
      return head.trim() ? head : cached;
    }

    // Try unstaged first (y == 'M' means working-tree has changes)
    const unstaged = y === "M" || y === "?" ? await git(cwd, ["diff", "--", path]).catch(() => "") : "";
    if (unstaged.trim()) return unstaged;

    // Try staged (x != ' ' means index has changes relative to HEAD)
    const staged = await git(cwd, ["diff", "--cached", "--", path]).catch(() => "");
    if (staged.trim()) return staged;

    // ── Fresh-repo fallback ────────────────────────────────────────────────
    // git diff --cached returns empty when there's no HEAD yet.
    // Compare the staged file against the empty tree instead.
    const hasHead = await repoHasHead(cwd);
    if (!hasHead) {
      const emptyTreeDiff = await git(cwd, ["diff", EMPTY_TREE, "--cached", "--", path]).catch(() => "");
      if (emptyTreeDiff.trim()) return emptyTreeDiff;

      // Last resort: read staged blob content and build a synthetic diff.
      // `git show :path` reads the staged version (the colon is intentional).
      const blobContent = await git(cwd, ["show", `:${path}`]).catch(() => "");
      if (blobContent.trim()) return syntheticAddedDiff(path, blobContent);
    }

    // ── Untracked-file fallback (intent-to-add trick) ──────────────────────
    // Only safe when the file is NOT already staged (x != 'A').
    // If it IS staged, --intent-to-add will fail with "already exists in index".
    if (change_type === "added" && x !== "A") {
      try {
        await git(cwd, ["add", "--intent-to-add", "--", path]);
        const diff = await git(cwd, ["diff", "--", path]).catch(() => "");
        await git(cwd, ["rm", "--cached", "--quiet", "--force", "--", path]).catch(() => {});
        if (diff.trim()) return diff;
      } catch {
        // intent-to-add unavailable or file already indexed — fall through
      }
    }

    // ── Absolute last resort: build from disk content ──────────────────────
    // Covers genuinely untracked files on repos that already have commits.
    // We can't read disk files directly from the renderer process, but
    // git show :path covers the staged case and git diff covers the rest.
    // Return empty — the UI will show "computing diff…" rather than crashing.
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
    entries.map(async ({ path, change_type, x, y }) => {
      const diff = await fileDiff(cwd, path, change_type, x, y);
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