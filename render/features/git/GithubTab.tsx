// features/git/GithubTab.tsx
//
// GitHub tab inside the Git panel. Shows PR status, reviews, CI checks,
// and lets the user create or merge a PR via the gh CLI backend commands:
//   git_push_pr  — push branch + open PR
//   git_pr_view  — fetch live PR details (title, state, checks, reviews)
//   git_pr_merge — squash-merge + delete remote branch

import { useState } from "react";
import { C, MONO, SANS } from "../../design";
import type { WorktreeRecord } from "./types";

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

export function GithubTab({
  record,
  branch,
  workspaceCwd,
  busy,
  onCreatePr,
  onRefreshRecord,
}: GithubTabProps) {
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

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

      <div
        style={{
          padding: "14px 16px",
          background: C.bg2,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS, fontWeight: 600 }}>
          Branch
        </span>
        <span style={{ fontSize: 13, color: C.t0, fontFamily: MONO }}>{branch}</span>
      </div>
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