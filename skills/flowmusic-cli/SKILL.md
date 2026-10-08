---
name: flowmusic-cli
description: >-
  Entry point for operating the `flowmusic` command-line tool (an unofficial client for flowmusic.app, Google's AI
  music generator). Use this skill first whenever the user wants to generate, edit, download or manage AI music from
  the terminal, or mentions flowmusic, Lyria, or the gfmusic project. Covers installation, login, safety rules,
  output conventions and which specialised skill to load next.
---

# flowmusic CLI - overview for agents

`flowmusic` generates songs and manages a flowmusic.app library from the shell. Everything is non-interactive
except the one-time `login`.

## 1. Make sure it is ready

Run [scripts/ensure_ready.sh](./scripts/ensure_ready.sh). It checks, in order: the binary exists, a session exists
and is valid, the API answers, and prints the credit balance. Exit code 0 means ready.

- Not installed: `cd <repo-root> && npm install -g .` (Node >= 22 required; repo root is the folder with `package.json`
  named `flowmusic-cli`). Without installing you can use `node <repo-root>/bin/flowmusic.mjs`.
- Not logged in: tell the user to run `flowmusic login` (opens their browser for Google sign-in, cannot be automated;
  do not try to type credentials). After that the session refreshes itself silently.

## 2. Golden rules

1. **Generating costs credits** (observed: roughly 5 credits per song, more for video). Check `flowmusic credits` before
   anything bigger than a couple of songs, and ask the user before running `batch` with more than ~5 songs.
2. **Never run destructive commands without explicit user approval**: `delete`, `cleanup --yes`, `chats clean --yes`,
   `chats rm`, `playlists delete`, `projects delete`, `logout`. Always show a dry run first (`cleanup`, `chats clean` are
   dry runs unless `--yes`).
3. **Never print or paste secrets.** `~/.config/gfmusic/session.json` holds access and refresh tokens - do not `cat` it.
   Use `flowmusic whoami` to inspect the login state.
4. **Long-running**: a song takes ~30-120 s, video longer. Use a generous timeout (>= 5 minutes) or run in the
   background; the CLI waits for completion by itself and prints the downloaded file path.
5. Prefer **`--json`** when you need to parse results. Data goes to stdout, progress/log lines go to stderr.

## 3. Output conventions

- Default output: one line per result, usually the downloaded file path (`./out/<title>-<id8>.m4a`) plus duration.
- With `--json`, song-producing commands print `{"songs":[{"clip_id","title","duration","url","audio_url","wav_url","file"}]}`.
  A generation with lyrics may return two versions, marked `variant: "A"|"B"`; mention both to the user.
- A `clip_id` (UUID) identifies a song everywhere: edits, download, playlists, `show`. Keep the ids you create.
- Files go to `./out` unless `-o DIR`. `--no-download` skips fetching audio.

## 4. Pick the next skill

| User wants | Load |
|---|---|
| Create a song / lyrics / batch of songs / cover art / video | `flowmusic-generate` |
| Extend, replace a section, cover, split stems, trim, change speed/pitch, convert format | `flowmusic-edit` |
| List, search, download, rename, favorite, playlists, projects, cleanup | `flowmusic-library` |
| Something fails, login/session problems, API changed | `flowmusic-troubleshoot` |

Full command syntax: [references/commands.md](./references/commands.md).
