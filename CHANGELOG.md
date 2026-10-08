# Changelog

## Unreleased

## 0.3.1
- Agent skills in `skills/` (cli router, generate, edit, library, troubleshoot) + `.agents/skills.json`.
- Source split into `src/commands/` and `src/lib/`; client tests; CI; npm publishing via GitHub Actions (Trusted Publishing).

## 0.3.0
- **Length control** `--length SEC` via the `[End - m:ss]` marker (server minimum is ~60 s); `--lyrics` accepts `\n` and `@file`.
- **Model selection** `--model "Lyria 3 Pro"` (validated against `GET /models`).
- **Shared conversation**: all direct tool calls reuse one persistent session (no more one conversation per call);
  `--new-session` starts a fresh one; `chats clean` removes empty conversations, `chats rm`.
- **New commands**: `batch` (concurrent), `wizard`, `video`, `speed`, `caption`, `transcribe`, `lyrics-edit`, `modify`,
  `search`, `trending`, `featured`, `favorite/unfavorite/favorites`, `cleanup`, `doctor`, `completion`,
  `playlists show|rename|remove|delete`, `projects create|delete`, `download --zip`, `upload --remove-vocals`.
- `convert`/`download --format mp3|wav|m4a` use the server-side transcoding of `/download/audio` (no credits, no new clip).
- Retries with back-off for 429 / 5xx / network errors (never re-sends non-idempotent requests after a server answer),
  clearer moderation / rate-limit errors, live progress line, A/B variants labelled `[A]`/`[B]`.
- `login` is now a pure-CLI PKCE login in your default browser (verified: the site allows loopback redirects); the old dedicated Chrome profile flow is `login --profile`.
- Unit tests (`npm test`), `research/` folder with the reverse-engineering scripts.

## 0.2.0
- Persistent session with silent token refresh; two-phase dedicated-profile login; installable package.

## 0.1.0
- First version: generate / edit / library commands.
