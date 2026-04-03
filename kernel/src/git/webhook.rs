// src/github/webhook.rs
//
// Receives GitHub webhook events, matches them to a runbox via pr_url,
// and writes feedback directly into that agent's PTY.
//
// Events handled:
//   pull_request_review         → review submitted (approved / changes_requested)
//   pull_request_review_comment → inline code comment
//   issue_comment               → general PR comment
//   check_run                   → CI check passed or failed
//   workflow_run                → workflow passed or failed
//   pull_request (closed)       → PR merged → notify agent to clean up

use serde::Deserialize;
use crate::{db::{self, runboxes::WorktreeRecord}, state::AppState};
use super::api::GithubApi;

// ── Payload types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct WebhookPayload {
    pub action:        Option<String>,
    pub pull_request:  Option<PrInfo>,
    pub review:        Option<ReviewInfo>,
    pub comment:       Option<CommentInfo>,
    pub check_run:     Option<CheckRunInfo>,
    pub workflow_run:  Option<WorkflowRunInfo>,
}

#[derive(Debug, Deserialize)]
pub struct PrInfo {
    pub html_url: String,
    pub number:   u64,
    pub merged:   Option<bool>,
    pub head:     PrHead,
}

#[derive(Debug, Deserialize)]
pub struct PrHead {
    pub repo: RepoInfo,
}

#[derive(Debug, Deserialize)]
pub struct RepoInfo {
    pub full_name: String,   // "owner/repo"
}

#[derive(Debug, Deserialize)]
pub struct ReviewInfo {
    pub state:    String,       // APPROVED | CHANGES_REQUESTED | COMMENTED
    pub body:     Option<String>,
    pub html_url: String,
}

#[derive(Debug, Deserialize)]
pub struct CommentInfo {
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub struct CheckRunInfo {
    pub conclusion:    Option<String>,   // success | failure | cancelled
    pub name:          String,
    pub html_url:      String,
    pub pull_requests: Vec<CheckPr>,
}

#[derive(Debug, Deserialize)]
pub struct WorkflowRunInfo {
    pub conclusion:    Option<String>,
    pub name:          String,
    pub html_url:      String,
    pub pull_requests: Vec<CheckPr>,
}

#[derive(Debug, Deserialize)]
pub struct CheckPr {
    pub number: u64,
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

/// Called from the axum route for every incoming webhook.
/// `event_type` is the value of the `X-GitHub-Event` header.
pub async fn handle_webhook(
    event_type: &str,
    payload:    WebhookPayload,
    state:      &AppState,
) {
    match event_type {
        "pull_request_review"         => handle_review(payload, state).await,
        "pull_request_review_comment" => handle_inline_comment(payload, state).await,
        "issue_comment"               => handle_issue_comment(payload, state).await,
        "check_run"                   => handle_check_run(payload, state).await,
        "workflow_run"                => handle_workflow_run(payload, state).await,
        "pull_request"                => handle_pr_event(payload, state).await,
        other => eprintln!("[webhook] unhandled event: {other}"),
    }
}

// ── Review submitted ──────────────────────────────────────────────────────────

async fn handle_review(payload: WebhookPayload, state: &AppState) {
    let Some(pr)     = payload.pull_request else { return };
    let Some(review) = payload.review        else { return };
    if payload.action.as_deref() != Some("submitted") { return; }

    let Some(record) = db::runboxes::runbox_find_by_pr(&state.db, &pr.html_url) else {
        eprintln!("[webhook] no runbox for PR: {}", pr.html_url);
        return;
    };

    let api      = GithubApi::new(&state.github_token);
    let repo     = &pr.head.repo.full_name;
    let comments = api.get_review_comments(repo, pr.number).await.unwrap_or_default();

    let state_str = review.state.to_uppercase();
    let message   = match state_str.as_str() {
        "APPROVED" => {
            db::runboxes::runbox_set_status(&state.db, &record.runbox_id, "approved").ok();
            format!(
                "\n\n✅ PR APPROVED\n\
                 Your PR has been approved: {}\n\
                 Review comment: {}\n\
                 You can now merge or wait for CI to pass.\n",
                pr.html_url,
                review.body.as_deref().unwrap_or("(no comment)"),
            )
        }
        "CHANGES_REQUESTED" => {
            db::runboxes::runbox_set_status(&state.db, &record.runbox_id, "changes_requested").ok();

            let inline_section = if comments.is_empty() {
                String::new()
            } else {
                let lines: Vec<String> = comments.iter()
                    .map(|c| format!("  • {} (line {}): {}", c.path, c.line.unwrap_or(0), c.body))
                    .collect();
                format!("\nInline comments:\n{}\n", lines.join("\n"))
            };

            format!(
                "\n\n🔴 CHANGES REQUESTED\n\
                 PR: {}\n\
                 Review:\n{}\n\
                 {}\n\
                 Please fix all issues, commit, and push to the same branch.\n\
                 The PR will update automatically.\n",
                pr.html_url,
                review.body.as_deref().unwrap_or("(no general comment)"),
                inline_section,
            )
        }
        _ => {
            // COMMENTED — only forward if there's a body
            let body = review.body.as_deref().unwrap_or("").trim();
            if body.is_empty() { return; }
            format!(
                "\n\n💬 PR COMMENT\n\
                 PR: {}\n\
                 Comment: {}\n",
                pr.html_url, body,
            )
        }
    };

    write_to_pty(&record.runbox_id, &message, state);
}

// ── Inline code comment ───────────────────────────────────────────────────────

async fn handle_inline_comment(payload: WebhookPayload, state: &AppState) {
    let Some(pr)      = payload.pull_request else { return };
    let Some(comment) = payload.comment       else { return };
    if payload.action.as_deref() != Some("created") { return; }

    let Some(record) = db::runboxes::runbox_find_by_pr(&state.db, &pr.html_url) else {
        return;
    };

    let message = format!(
        "\n\n💬 INLINE CODE COMMENT on PR {}\n\
         {}\n\
         Please address this comment and push to the same branch.\n",
        pr.html_url, comment.body,
    );

    write_to_pty(&record.runbox_id, &message, state);
}

// ── General issue comment ─────────────────────────────────────────────────────

async fn handle_issue_comment(payload: WebhookPayload, state: &AppState) {
    let Some(pr)      = payload.pull_request else { return };
    let Some(comment) = payload.comment       else { return };
    if payload.action.as_deref() != Some("created") { return; }

    let Some(record) = db::runboxes::runbox_find_by_pr(&state.db, &pr.html_url) else {
        return;
    };

    let message = format!(
        "\n\n💬 PR COMMENT on {}\n\
         {}\n",
        pr.html_url, comment.body,
    );

    write_to_pty(&record.runbox_id, &message, state);
}

// ── CI check run ──────────────────────────────────────────────────────────────

async fn handle_check_run(payload: WebhookPayload, state: &AppState) {
    let Some(check)  = payload.check_run else { return };
    let Some(concl)  = check.conclusion.as_deref() else { return };
    if payload.action.as_deref() != Some("completed") { return; }
    if concl != "failure" && concl != "action_required" { return; }

    let pr_num = match check.pull_requests.first() {
        Some(p) => p.number,
        None    => return,
    };

    let Some(record) = find_runbox_by_pr_number(pr_num, state) else { return };

    let api  = GithubApi::new(&state.github_token);
    let logs = api.get_check_run_logs(&check.html_url).await
        .unwrap_or_else(|_| "(could not fetch logs)".to_string());

    let message = format!(
        "\n\n❌ CI FAILED: {}\n\
         Check: {}\n\
         Logs:\n{}\n\
         Please fix the failing CI, commit, and push to the same branch.\n",
        check.name, check.html_url,
        truncate(&logs, 3000),
    );

    write_to_pty(&record.runbox_id, &message, state);
}

// ── Workflow run ──────────────────────────────────────────────────────────────

async fn handle_workflow_run(payload: WebhookPayload, state: &AppState) {
    let Some(wf)    = payload.workflow_run else { return };
    let Some(concl) = wf.conclusion.as_deref() else { return };
    if payload.action.as_deref() != Some("completed") { return; }
    if concl != "failure" { return; }

    let pr_num = match wf.pull_requests.first() {
        Some(p) => p.number,
        None    => return,
    };

    let Some(record) = find_runbox_by_pr_number(pr_num, state) else { return };

    let message = format!(
        "\n\n❌ WORKFLOW FAILED: {}\n\
         Details: {}\n\
         Please fix the failing workflow, commit, and push to the same branch.\n",
        wf.name, wf.html_url,
    );

    write_to_pty(&record.runbox_id, &message, state);
}

// ── PR merged / closed ────────────────────────────────────────────────────────

async fn handle_pr_event(payload: WebhookPayload, state: &AppState) {
    let Some(pr) = payload.pull_request else { return };
    if payload.action.as_deref() != Some("closed") { return; }
    let merged = pr.merged.unwrap_or(false);

    let Some(record) = db::runboxes::runbox_find_by_pr(&state.db, &pr.html_url) else {
        return;
    };

    if merged {
        db::runboxes::runbox_set_status(&state.db, &record.runbox_id, "merged").ok();

        let message = format!(
            "\n\n🎉 PR MERGED\n\
             PR: {}\n\
             Your branch has been merged into main.\n\
             Please run: mcp__stackbox__git_worktree_delete to clean up your worktree.\n",
            pr.html_url,
        );
        write_to_pty(&record.runbox_id, &message, state);
    } else {
        db::runboxes::runbox_set_status(&state.db, &record.runbox_id, "cancelled").ok();

        let message = format!(
            "\n\n🚫 PR CLOSED WITHOUT MERGE\n\
             PR: {}\n\
             Please run: mcp__stackbox__git_worktree_delete with force=true to clean up.\n",
            pr.html_url,
        );
        write_to_pty(&record.runbox_id, &message, state);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Write text into the agent's PTY stdin.
fn write_to_pty(runbox_id: &str, message: &str, state: &AppState) {
    eprintln!("[webhook] writing to PTY for runbox: {runbox_id}");
    if let Err(e) = state.pty_writer.write(runbox_id, message) {
        eprintln!("[webhook] PTY write failed for {runbox_id}: {e}");
    }
}

/// Find a runbox by PR number — used by check_run events that carry only the
/// PR number, not the full html_url.
fn find_runbox_by_pr_number(
    pr_num: u64,
    state:  &AppState,
) -> Option<db::runboxes::WorktreeRecord> {
    let conn = state.db.read();
    let mut stmt = conn
        .prepare(
            "SELECT runbox_id, agent_kind, worktree_path, branch, pr_url, status,
                    created_at, updated_at
             FROM agent_worktrees
             WHERE pr_url IS NOT NULL",
        )
        .ok()?;


    let records: Vec<WorktreeRecord> = stmt.query_map([], |row| {
        Ok(db::runboxes::WorktreeRecord {
            runbox_id:     row.get(0)?,
            agent_kind:    row.get(1)?,
            worktree_path: row.get(2)?,
            branch:        row.get(3)?,
            pr_url:        row.get(4)?,
            status:        row.get(5)?,
            created_at:    row.get(6)?,
            updated_at:    row.get(7)?,
        })
    })
    .ok()?
    .flatten()
    .collect::<Vec<_>>();

    records.into_iter().find(|r| {
        r.pr_url.as_deref()
            .map(|u| u.ends_with(&format!("/{pr_num}")))
            .unwrap_or(false)
    })
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max { s } else { &s[..max] }
}