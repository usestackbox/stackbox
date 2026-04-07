// features/git/GithubTab.tsx
//
// GitHub tab inside the Git panel. Shows PR status, reviews, CI checks,
// and lets the user create or merge a PR via the gh CLI backend commands:
//   git_push_pr  — push branch + open PR
//   git_pr_view  — fetch live PR details (title, state, checks, reviews)
//   git_pr_merge — squash-merge + delete remote branch

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { C, MONO, SANS } from "../../design";
import type { PrCheck, PrDetails, PrReview, WorktreeRecord } from "./types";

// ── Props ─────────────────────────────────────────────────────────────────────

interface GithubTabProps {
  record: WorktreeRecord | null;
  branch: string;
  workspaceCwd: string;
  busy: boolean;
  onCreatePr: (title: string, body: string) => Promise<string>;
  onRefreshRecord: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(s: string): string {
  const u = s.toUpperCase();
  if (u === "SUCCESS" || u === "COMPLETED") return C.green;
  if (u === "FAILURE" || u === "ERROR") return C.red;
  if (u === "PENDING" || u === "QUEUED") return C.amber;
  if (u === "IN_PROGRESS") return C.blue;
  return C.t3;
}

function reviewColor(s: string): string {
  if (s === "APPROVED") return C.green;
  if (s === "CHANGES_REQUESTED") return C.red;
  return C.t3;
}

function stateLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
      <span style={{ fontSize: 11, color: C.t3, fontFamily: SANS, width: 80, flexShrink: 0 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 11,
          color: color ?? C.t1,
          fontFamily: MONO,
          flex: 1,
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: MONO,
        color,
        background: `${color}1a`,
        border: `1px solid ${color}33`,
        borderRadius: 6,
        padding: "2px 7px",
      }}
    >
      {label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GithubTab({
  record,
  branch,
  workspaceCwd,
  busy,
  onCreatePr,
  onRefreshRecord,
}: GithubTabProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [prDetails, setPrDetails] = useState<PrDetails | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const showNotice = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 4000);
  };

  const loadPrDetails = useCallback(() => {
    if (!record?.pr_url) return;
    setPrLoading(true);
    invoke<PrDetails>("git_pr_view", { cwd: workspaceCwd })
      .then((d) => setPrDetails(d))
      .catch(() => setPrDetails(null))
      .finally(() => setPrLoading(false));
  }, [workspaceCwd, record?.pr_url]);

  useEffect(() => {
    loadPrDetails();
  }, [loadPrDetails]);

  const handleCreate = async () => {
    if (!title.trim()) {
      showNotice("Title is required.", false);
      return;
    }
    try {
      await onCreatePr(title.trim(), body.trim());
      setTitle("");
      setBody("");
      showNotice("PR created!", true);
      onRefreshRecord();
      setTimeout(loadPrDetails, 1500);
    } catch (e: any) {
      showNotice(String(e), false);
    }
  };

  const handleMerge = async () => {
    if (!confirm("Squash-merge this PR and delete the remote branch?")) return;
    setMerging(true);
    try {
      await invoke<string>("git_pr_merge", { cwd: workspaceCwd });
      showNotice("Merged! Branch deleted.", true);
      onRefreshRecord();
      setPrDetails(null);
    } catch (e: any) {
      showNotice(String(e), false);
    } finally {
      setMerging(false);
    }
  };

  const noPr = !record?.pr_url;

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {notice && (
        <div
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            background: C.bg2,
            border: `1px solid ${notice.ok ? C.border : `${C.red}33`}`,
            fontSize: 11,
            color: notice.ok ? C.t1 : C.red,
            fontFamily: SANS,
          }}
        >
          {notice.text}
        </div>
      )}

      {/* ── Create PR form ─────────────────────────────────────────────── */}
      {noPr && (
        <section>
          <p style={{ margin: "0 0 10px", fontSize: 11, color: C.t3, fontFamily: SANS }}>
            No pull request open for <span style={{ color: C.t1, fontFamily: MONO }}>{branch}</span>
            .
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="PR title"
              style={inputStyle}
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Description (optional)"
              rows={4}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
            <button
              onClick={handleCreate}
              disabled={busy || !title.trim()}
              style={primaryBtnStyle(busy || !title.trim())}
            >
              {busy ? "Creating…" : "Create Pull Request"}
            </button>
          </div>
        </section>
      )}

      {/* ── Existing PR details ─────────────────────────────────────────── */}
      {!noPr && (
        <>
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span
                style={{ fontSize: 12, fontWeight: 600, color: C.t0, fontFamily: SANS, flex: 1 }}
              >
                {prDetails?.title ?? record.pr_url}
              </span>
              {prDetails && (
                <Pill
                  label={stateLabel(prDetails.state)}
                  color={
                    prDetails.state === "OPEN"
                      ? C.green
                      : prDetails.state === "MERGED"
                        ? C.blue
                        : C.red
                  }
                />
              )}
            </div>

            {prDetails && (
              <>
                <Row label="Author" value={prDetails.author} />
                <Row
                  label="Mergeable"
                  value={prDetails.mergeable}
                  color={
                    prDetails.mergeable === "MERGEABLE"
                      ? C.green
                      : prDetails.mergeable === "CONFLICTING"
                        ? C.red
                        : C.t3
                  }
                />
                <div style={{ marginTop: 8 }}>
                  <a
                    href={prDetails.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 11,
                      color: C.blue,
                      fontFamily: MONO,
                      textDecoration: "none",
                    }}
                  >
                    {prDetails.url}
                  </a>
                </div>
                {prDetails.body?.trim() && (
                  <pre
                    style={{
                      marginTop: 10,
                      padding: "8px 10px",
                      background: C.bg0,
                      borderRadius: 8,
                      fontSize: 11,
                      fontFamily: MONO,
                      color: C.t2,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 120,
                      overflowY: "auto",
                    }}
                  >
                    {prDetails.body}
                  </pre>
                )}
              </>
            )}

            {prLoading && !prDetails && (
              <span style={{ fontSize: 11, color: C.t3, fontFamily: SANS }}>
                Loading PR details…
              </span>
            )}
          </section>

          {prDetails && prDetails.reviews.length > 0 && (
            <section style={cardStyle}>
              <h4 style={sectionHeading}>Reviews</h4>
              {prDetails.reviews.map((r: PrReview, i: number) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}
                >
                  <span style={{ fontSize: 11, color: C.t2, fontFamily: MONO, flex: 1 }}>
                    {r.author}
                  </span>
                  <Pill label={stateLabel(r.state)} color={reviewColor(r.state)} />
                </div>
              ))}
            </section>
          )}

          {prDetails && prDetails.checks.length > 0 && (
            <section style={cardStyle}>
              <h4 style={sectionHeading}>Checks</h4>
              {prDetails.checks.map((c: PrCheck, i: number) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: statusColor(c.conclusion || c.status),
                    }}
                  />
                  <span style={{ fontSize: 11, color: C.t2, fontFamily: MONO, flex: 1 }}>
                    {c.name}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: statusColor(c.conclusion || c.status),
                      fontFamily: MONO,
                    }}
                  >
                    {c.conclusion || c.status}
                  </span>
                </div>
              ))}
            </section>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={loadPrDetails} disabled={prLoading} style={ghostBtnStyle(prLoading)}>
              {prLoading ? "Refreshing…" : "↻ Refresh"}
            </button>
            {prDetails?.state === "OPEN" && prDetails.mergeable === "MERGEABLE" && (
              <button
                onClick={handleMerge}
                disabled={merging || busy}
                style={primaryBtnStyle(merging || busy)}
              >
                {merging ? "Merging…" : "Squash & Merge"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "7px 10px",
  background: C.bg0,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  color: C.t0,
  fontSize: 12,
  fontFamily: SANS,
  outline: "none",
};

const cardStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: C.bg2,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
};

const sectionHeading: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 11,
  fontWeight: 600,
  color: C.t2,
  fontFamily: SANS,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "7px 14px",
    background: disabled ? C.bg3 : C.blue,
    border: "none",
    borderRadius: 8,
    color: disabled ? C.t3 : "#fff",
    fontSize: 12,
    fontFamily: SANS,
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    transition: "all .1s",
    opacity: disabled ? 0.6 : 1,
  };
}

function ghostBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    background: "transparent",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    color: disabled ? C.t3 : C.t2,
    fontSize: 11,
    fontFamily: SANS,
    cursor: disabled ? "default" : "pointer",
    transition: "all .1s",
  };
}
