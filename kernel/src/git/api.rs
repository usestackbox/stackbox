// src/github/api.rs
//
// Minimal GitHub REST API client.
// Fetches only what the webhook handler needs:
//   - Inline review comments on a PR
//   - Check run / workflow job logs (for CI failure feedback)
//
// FIX (Bug #api-A): `get_check_run_logs` was parsing run_id from the URL's
//   last path segment without stripping query parameters. URLs like
//   `.../job/87654321?check_suite_focus=true` produced an invalid API URL.
//   Fixed by splitting on `?` before using the segment.
//
// FIX (Bug #api-B): `handle_workflow_run` called `get_check_run_logs` with
//   the workflow_run html_url (`.../actions/runs/{run_id}`). That gives a
//   run ID, not a job ID, so `/actions/jobs/{id}/logs` always fails.
//   Added `get_workflow_run_logs` which first resolves job IDs from the run
//   then fetches each job's log, concatenating up to 3000 chars.

use serde::Deserialize;

pub struct GithubApi {
    token:  String,
    client: reqwest::Client,
}

impl GithubApi {
    pub fn new(token: &str) -> Self {
        Self {
            token:  token.to_string(),
            client: reqwest::Client::new(),
        }
    }

    fn auth_header(&self) -> String {
        format!("Bearer {}", self.token)
    }

    // ── Review comments ───────────────────────────────────────────────────────

    /// Fetch all inline code review comments on a PR.
    pub async fn get_review_comments(
        &self,
        repo:   &str,   // "owner/repo"
        pr_num: u64,
    ) -> Result<Vec<ReviewComment>, String> {
        let url = format!(
            "https://api.github.com/repos/{repo}/pulls/{pr_num}/comments"
        );

        let resp = self.client
            .get(&url)
            .header("Authorization", self.auth_header())
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "stackbox")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("GitHub API {}: {url}", resp.status()));
        }

        resp.json::<Vec<ReviewComment>>()
            .await
            .map_err(|e| e.to_string())
    }

    // ── Check run logs ────────────────────────────────────────────────────────

    /// Fetch the log output of a failed check run (individual job).
    ///
    /// check_html_url format: https://github.com/{owner}/{repo}/actions/runs/{run_id}/job/{job_id}
    /// Last path segment = job_id → calls /actions/jobs/{job_id}/logs.
    pub async fn get_check_run_logs(&self, check_html_url: &str) -> Result<String, String> {
        // FIX (Bug #api-A): strip query string from the last path segment.
        let last_segment = check_html_url
            .split('/')
            .last()
            .ok_or("cannot parse id from check run url")?
            .split('?')      // strip ?check_suite_focus=true etc.
            .next()
            .unwrap_or("");

        if last_segment.is_empty() {
            return Err("empty id segment in check run url".to_string());
        }

        // Extract repo from url: github.com/{owner}/{repo}/...
        let parts: Vec<&str> = check_html_url
            .trim_start_matches("https://github.com/")
            .split('/')
            .collect();

        if parts.len() < 2 {
            return Err("cannot parse repo from check url".to_string());
        }
        let repo = format!("{}/{}", parts[0], parts[1]);

        let url = format!(
            "https://api.github.com/repos/{repo}/actions/jobs/{last_segment}/logs"
        );

        let resp = self.client
            .get(&url)
            .header("Authorization", self.auth_header())
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "stackbox")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if resp.status().is_success() {
            return resp.text().await.map_err(|e| e.to_string());
        }

        Err(format!("GitHub logs API {}: {url}", resp.status()))
    }

    // ── Workflow run logs ─────────────────────────────────────────────────────

    /// Fetch logs for a failed workflow run.
    ///
    /// FIX (Bug #api-B): workflow_run html_url format is:
    ///   https://github.com/{owner}/{repo}/actions/runs/{run_id}
    /// The last segment is the run_id, NOT a job_id. We must first resolve
    /// the jobs for this run, then fetch each job's logs.
    pub async fn get_workflow_run_logs(&self, workflow_html_url: &str) -> Result<String, String> {
        let run_id = workflow_html_url
            .split('/')
            .last()
            .ok_or("cannot parse run_id from workflow url")?
            .split('?')
            .next()
            .unwrap_or("");

        if run_id.is_empty() {
            return Err("empty run_id in workflow url".to_string());
        }

        let parts: Vec<&str> = workflow_html_url
            .trim_start_matches("https://github.com/")
            .split('/')
            .collect();

        if parts.len() < 2 {
            return Err("cannot parse repo from workflow url".to_string());
        }
        let repo = format!("{}/{}", parts[0], parts[1]);

        // Step 1: get jobs for this workflow run
        let jobs_url = format!(
            "https://api.github.com/repos/{repo}/actions/runs/{run_id}/jobs"
        );
        let jobs_resp = self.client
            .get(&jobs_url)
            .header("Authorization", self.auth_header())
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "stackbox")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !jobs_resp.status().is_success() {
            return Err(format!("GitHub jobs API {}: {jobs_url}", jobs_resp.status()));
        }

        let jobs: WorkflowJobsResponse = jobs_resp
            .json()
            .await
            .map_err(|e| format!("jobs parse: {e}"))?;

        // Step 2: fetch logs for each failed/incomplete job (up to 3 jobs)
        let mut combined = String::new();
        for job in jobs.jobs.iter().take(3) {
            let log_url = format!(
                "https://api.github.com/repos/{repo}/actions/jobs/{}/logs",
                job.id
            );
            if let Ok(resp) = self.client
                .get(&log_url)
                .header("Authorization", self.auth_header())
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "stackbox")
                .send()
                .await
            {
                if let Ok(text) = resp.text().await {
                    combined.push_str(&format!("\n--- Job: {} ---\n", job.name));
                    combined.push_str(&text);
                }
            }
        }

        if combined.is_empty() {
            return Err("no job logs available".to_string());
        }
        Ok(combined)
    }
}

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ReviewComment {
    pub path:      String,
    pub line:      Option<u64>,
    pub body:      String,
    pub diff_hunk: Option<String>,
    pub html_url:  String,
}

#[derive(Debug, Deserialize)]
struct WorkflowJobsResponse {
    jobs: Vec<WorkflowJob>,
}

#[derive(Debug, Deserialize)]
struct WorkflowJob {
    id:   u64,
    name: String,
}