---
name: flowmusic-troubleshoot
description: >-
  Use when a flowmusic CLI command fails or behaves unexpectedly: login or token errors, 401/403/422/429/500 responses,
  moderation or rate-limit messages, tool_call_failure, timeouts while waiting for a song, wrong durations, or when the
  site's API seems to have changed. Provides a diagnosis procedure with `flowmusic doctor` and a table of known errors.
---

# Troubleshooting flowmusic

Prerequisite: `flowmusic-cli` skill. Start with the health check - it is free and identifies most problems:

```bash
flowmusic doctor        # exit code 1 if any check fails
flowmusic whoami
```
`doctor` checks: session, `/billing/credits`, `/models`, clip listing, clip response fields, the shared conversation, a
direct tool call and the event stream. Re-run a failing command with `-v` to print raw stream events (they may contain
ids but no tokens).

## Known situations

| Symptom | Cause / fix |
|---|---|
| `not logged in: run flowmusic login` | No saved session. Ask the user to run `flowmusic login` (browser sign-in). Do not attempt to automate Google login. |
| `refresh failed: 400/401 ... refresh token` | The refresh token was revoked (user logged out elsewhere or reused it). `flowmusic login` again. |
| `login timed out` | The user did not finish signing in within ~4 min, or the browser did not open (the URL is printed - they can open it manually). |
| `POST ... -> 429` / "Rate limited" | The CLI already retries with back-off. Wait a minute; lower `--jobs` (site limit: 5 concurrent, ~20 requests/min). |
| `Content flagged by moderation` | The prompt or lyrics were rejected. Do not retry the same text; ask the user to reword. |
| `audio__... Error while streaming parts [tool_call_failure]` | Bad arguments or unsupported input for that tool (e.g. a clip type the tool cannot use). Check the clip with `flowmusic show`; try the equivalent cheaper command (`download --format`). |
| `Generation failed on the server` | Transient inference error. One retry is reasonable; then report to the user. |
| `timeout waiting for clips` | Rendering took > 15 min or failed silently. `flowmusic wait <clip>` later; `flowmusic show <clip>`. |
| Song is ~60 s although `--length 30` | Server minimum length ~60 s. Not a bug. |
| `unsupported format "flac"` | Only `mp3`, `wav`, `m4a` are supported by the server. |
| `422 ... Field required` | The site changed an endpoint's schema. See "API changed" below. |
| `unknown model` | Use a name printed by `flowmusic models`. |
| Stale shared conversation (404) | Handled automatically (a new one is created). Force with `--new-session`. |
| `Cannot find module` / syntax errors | Wrong Node version: needs Node >= 22 (`node --version`). Reinstall with `npm install -g .` in the repo. |

## Login details

- Default `flowmusic login` = OAuth in the default browser with a temporary `127.0.0.1` callback server.
  `flowmusic login --profile` signs in inside a dedicated Chrome profile (use when no default browser is available);
  `flowmusic login --from-chrome` borrows a 1-hour token from a running Chrome that has remote debugging (no auto-refresh).
- `FLOWMUSIC_TOKEN=<access_token>` overrides the saved session (1 h lifetime, no refresh).
- State lives in `~/.config/gfmusic/` (`session.json` mode 600, `state.json`, optional `chrome-profile/`).
  `flowmusic logout` deletes it. Never display `session.json`.

## API changed?

This is an unofficial client built by reverse engineering the web app, so endpoints can change.
1. `flowmusic doctor` shows which endpoint/shape broke.
2. Compare with the notes in the repo `README.md` ("Reverse-engineered workflow") and the scripts in `research/`
   (`research/capture.mjs` records live network traffic of an open flowmusic.app tab through Chrome DevTools).
3. Adjust `src/cli.mjs` / `src/client.mjs`, run `npm test`, reinstall (`npm install -g .`).
4. Do not paste tokens in reports; `capture.mjs` redacts authorization/cookie headers.

## Escalation

If the same command fails twice with the same server error, stop retrying (each retry may spend credits) and give the
user: the exact command, the error line, and the output of `flowmusic doctor`.
