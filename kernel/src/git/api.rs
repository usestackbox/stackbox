// src/github/api.rs
//
// Minimal GitHub REST API client.
// Fetches only what the webhook handler needs:
//   - Inline review comments on a PR
//   - Check run logs (for CI failure feedback)

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

    /// Fetch the log output of a failed check run.
    /// GitHub returns a 302 redirect to a signed S3 URL — reqwest follows it.
    pub async fn get_check_run_logs(&self, check_html_url: &str) -> Result<String, String> {
        // Extract check run id from url: .../runs/{id}
        let run_id = check_html_url
            .split('/')
            .last()
            .ok_or("cannot parse check run id from url")?;

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
            "https://api.github.com/repos/{repo}/actions/jobs/{run_id}/logs"
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