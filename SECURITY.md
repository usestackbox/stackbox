# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest stable | ✅ |
| Previous minor | ✅ (critical fixes only) |
| Older | ❌ |

We only provide security patches for the two most recent minor releases.
Please update to the latest version before reporting.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

### Preferred: GitHub Private Vulnerability Reporting

Use GitHub's built-in private reporting:
👉 https://github.com/usestackbox/stackbox/security/advisories/new

This keeps the report private until a fix is released.

### Alternative: Email

Send a PGP-encrypted or plain-text email to:

```
security@stackbox.dev
```

Include as much of the following as possible:

- Type of issue (e.g. RCE, path traversal, privilege escalation, XSS, etc.)
- Full paths of source file(s) related to the issue
- Steps to reproduce (PoC or exploit code if available)
- Impact assessment — what an attacker could achieve
- Your recommended fix if you have one

## Response Timeline

| Stage | Target |
|-------|--------|
| Acknowledgement | within 48 hours |
| Initial assessment | within 5 business days |
| Status update | within 10 business days |
| Patch / advisory | as soon as a fix is ready |

We follow a 90-day coordinated disclosure window. If we have not patched the issue
within 90 days we will coordinate with you on public disclosure.

## Scope

### In scope

- The Stackbox desktop application (Tauri kernel + React frontend)
- The auto-updater and update signature verification
- MCP server connections and credential handling
- Local data storage (SQLite, LanceDB, config files)
- The health API endpoint (`/health`)
- Any bundled installer artifacts

### Out of scope

- Vulnerabilities in upstream dependencies (report those to the upstream project)
- Denial-of-service attacks requiring physical access to the machine
- Issues in third-party MCP servers not bundled with Stackbox
- Social engineering of contributors

## Release Signing

All Stackbox release artifacts are signed with a [minisign](https://jedisct1.github.io/minisign/) key.
The public key is embedded in `kernel/tauri.conf.json` and used by Tauri's built-in updater
to verify every update before installation.

To manually verify a release artifact:

```bash
./scripts/verify-signature.sh <artifact> <artifact.sig>
```

## Credits

We publicly credit researchers who responsibly disclose vulnerabilities in our release notes,
unless they prefer to remain anonymous.
