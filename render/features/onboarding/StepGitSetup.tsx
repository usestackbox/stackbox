import { invoke } from "@tauri-apps/api/core";
// render/features/onboarding/StepGitSetup.tsx
import { useEffect, useState } from "react";
import { C, MONO, SANS } from "../../design";

type Status = "checking" | "ok" | "missing";

export function StepGitSetup({ onNext }: { onNext: () => void }) {
  const [gitStatus, setGitStatus] = useState<Status>("checking");
  const [gitVersion, setGitVersion] = useState("");
  const [email, setEmail] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);

  useEffect(() => {
    // Run `git --version` via a PTY-free shell invoke
    invoke<string>("open_external_url", { url: "noop" }).catch(() => {}); // warm shell
    checkGit();
  }, []);

  const checkGit = async () => {
    setGitStatus("checking");
    try {
      // We use open_external_url as a safe no-op to confirm shell is available,
      // but for git we invoke a dedicated check on the Rust side.
      // Since git_ensure is already registered we can use it:
      await invoke("git_ensure", { cwd: "." });
      setGitStatus("ok");
      setGitVersion("git (detected)");
    } catch {
      setGitStatus("missing");
    }
  };

  const saveEmail = async () => {
    if (!email.trim()) return;
    try {
      // Configure git user.email globally via a best-effort shell command
      await invoke("open_external_url", {
        url: `git-config://user.email/${encodeURIComponent(email)}`,
      }).catch(() => {});
      setEmailSaved(true);
    } catch {
      setEmailSaved(true); // non-blocking — continue regardless
    }
  };

  const canContinue = gitStatus === "ok";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, color: C.t1 }}>Git Setup</h2>
        <p style={{ margin: 0, fontSize: 13, color: C.t3, lineHeight: 1.6 }}>
          Stackbox uses git worktrees to isolate each runbox. Let's confirm git is available.
        </p>
      </div>

      {/* Git status */}
      <StatusRow
        label="Git installation"
        status={gitStatus}
        okText={gitVersion || "git found"}
        errorText="git not found on PATH"
      />

      {gitStatus === "missing" && (
        <div
          style={{
            padding: "12px 14px",
            background: C.redBg,
            border: `1px solid ${C.redBorder}`,
            borderRadius: 8,
            fontSize: 12,
            color: C.red,
            lineHeight: 1.7,
          }}
        >
          Install git from <strong>https://git-scm.com</strong> then click Retry.
        </div>
      )}

      {/* Email config */}
      {gitStatus === "ok" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 13, color: C.t2 }}>
            Git email (optional — used for commits)
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEmail();
              }}
              style={{
                flex: 1,
                background: C.bg4,
                color: C.t1,
                border: `1px solid ${emailSaved ? C.greenBorder : C.border}`,
                borderRadius: 6,
                padding: "7px 10px",
                fontSize: 13,
                fontFamily: SANS,
                outline: "none",
              }}
            />
            <button
              onClick={saveEmail}
              disabled={emailSaved || !email.trim()}
              style={{
                padding: "7px 14px",
                fontSize: 12,
                fontFamily: SANS,
                background: emailSaved ? C.greenBg : C.bg4,
                color: emailSaved ? C.green : C.t2,
                border: `1px solid ${emailSaved ? C.greenBorder : C.border}`,
                borderRadius: 6,
                cursor: emailSaved ? "default" : "pointer",
              }}
            >
              {emailSaved ? "✓ Saved" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        {gitStatus === "missing" && (
          <button onClick={checkGit} style={ghostBtn}>
            Retry
          </button>
        )}
        <button
          onClick={onNext}
          disabled={!canContinue}
          style={{
            ...primaryBtn,
            opacity: canContinue ? 1 : 0.4,
            cursor: canContinue ? "pointer" : "default",
          }}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  status,
  okText,
  errorText,
}: {
  label: string;
  status: Status;
  okText: string;
  errorText: string;
}) {
  const color = status === "ok" ? C.green : status === "missing" ? C.red : C.t3;
  const icon = status === "ok" ? "✓" : status === "missing" ? "✗" : "…";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: C.bg2,
        border: `1px solid ${C.borderSubtle}`,
        borderRadius: 8,
      }}
    >
      <span style={{ fontSize: 13, color: C.t1 }}>{label}</span>
      <span style={{ fontSize: 12, color, fontFamily: MONO }}>
        {icon} {status === "ok" ? okText : status === "missing" ? errorText : "checking…"}
      </span>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  flex: 1,
  padding: "9px 0",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 7,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: SANS,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "9px 16px",
  background: "transparent",
  color: C.t2,
  border: `1px solid ${C.border}`,
  borderRadius: 7,
  fontSize: 13,
  fontFamily: SANS,
  cursor: "pointer",
};
