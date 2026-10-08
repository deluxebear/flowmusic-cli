# gfmusic — `flowmusic` CLI

English | [简体中文](README.zh-CN.md)

Command-line client for [Google Flow Music](https://www.flowmusic.app), built by reverse-engineering its web client.
Node ≥ 22, zero dependencies.

```bash
flowmusic login                                   # one-time sign in (see Auth)
flowmusic gen "dreamy synthwave, female vocals" --lyrics @lyrics.txt --title "Night Drive" --model "Lyria 3 Pro"
flowmusic gen "lofi piano" --instrumental --length 120 --wav
flowmusic batch prompts.txt --jobs 3               # one prompt (or JSON object) per line
flowmusic extend|replace|cover|stems|trim|speed <clip> ...
flowmusic download <clip> --format mp3             # mp3 | wav | m4a (server-side transcoding)
flowmusic caption|transcribe <clip>                # describe / lyrics from audio
flowmusic search clips "piano"  |  trending  |  featured
flowmusic playlists create|add|remove|rename|delete|show ...
flowmusic doctor                                   # health check of session + API shapes
flowmusic help
```

Run `npm test` for the unit tests. Scripts used for the reverse engineering live in `research/`.

## Auth
```bash
flowmusic login                # one-time: OAuth in your default browser (PKCE + loopback), no Chrome automation
flowmusic whoami | logout
flowmusic login --profile      # fallback: sign in inside a dedicated Chrome profile (two-phase, see below)
flowmusic login --from-chrome  # borrow the 1 h token of your running Chrome (no auto-refresh)
```
- The session (access + refresh token) is stored in `~/.config/gfmusic/session.json` (mode 600).
- The access token (1 h) is refreshed silently before it expires (and once more on any HTTP 401); the rotated
  refresh token is saved every time. If there is no valid session, the browser login starts automatically.
- `login` opens `…supabase.co/auth/v1/authorize?provider=google&redirect_to=http://127.0.0.1:<port>/callback` with a PKCE
  challenge, receives the code on a temporary loopback server and exchanges it at `/auth/v1/token?grant_type=pkce`.
- `--profile` is two-phase because Google blocks sign-in in browsers started with a remote-debugging port: a plain
  Chrome window on `~/.config/gfmusic/chrome-profile` lets you sign in; after you close it the profile is reopened
  headless just to read the session cookie.
- The CLI always has its **own** refresh-token chain and never invalidates your everyday browser session.
- `FLOWMUSIC_TOKEN=<access_token>` overrides everything; `FLOWMUSIC_HOME` changes the storage dir; `CHROME_BIN` picks the browser.

## Reverse-engineered workflow
Base URL `https://www.flowmusic.app/__api`, header `Authorization: Bearer <supabase access_token>`.

### Two ways to generate
1. **Producer chat (LLM agent)**
   `POST /conversation/create` → `{conversation_id}`
   `POST /conversation {conversation_id, parts:[{content, part_kind:"user-prompt"}], client_context, model_name, mode:"standard"}` → `{job_id}`
   `GET /messages/{job_id}/stream?last_id=0` (SSE: `begin, conversation_id, part, complete, generated-title, suggestion, final, error`).
   The agent emits `tool-call` / `tool-return` parts, e.g. `audio__create_song` → `{clip_id, operation_id}`.
2. **Direct tool call (no LLM, what the compose form uses; used by this CLI)**
   `POST /producer/tool-call {conversation_id, part:{tool_name,args,part_kind:"tool-call",tool_call_id}, client_context}` → `{job_id}`
   then the same SSE stream (events are `message` with `parts[]`); result is in the `tool-return` part.

### Tools (`tool_name` → args → result)
| Tool | Args | Result |
|---|---|---|
| `audio__create_song` | `sound_prompt, lyrics_id, title, seed, image_id` | `clip_id, operation_id, estimated_time` |
| `lyrics__create` | `prompt` | `title, lyrics` |
| `audio__render_edit` | `recipe_id, title, image_id` | `clip_outputs[{clip_id}]` |
| `audio__split_stems` | `clip_id` | `stems[{stem_type, clip_id}]` |
| `audio__apply_effect` | `graph:[Input, Trim{start_s,end_s} \| TempoShift{speed,semitones}, Output], output_title` | `result_clip_id` |
| `image__create_image` | `prompt, aspect_ratio, image_urls` | `image_url` |
| `video__create_video_clip` | `inputs:{prompt, aspect_ratio, duration, model_name:"veo3-1-fast"}` | `url` (mp4) |
| `audio__convert_format` | `track_id, output_title, output_format:{extension}` | `result_clip_id` (fails for effect-derived clips; prefer `GET /download/audio/{id}?format=mp3\|wav\|m4a`) |
| `audio__caption` | `prompt, audio_url` | `caption` |
| `audio__transcribe` | `audio_url` | `lyrics` |
| `lyrics__register` / `lyrics__edit` | `{lyrics}` -> `lyrics_id`; `{prompt, lyrics_id}` | `lyrics` |
| `songs__get_metadata` | `clip_id` | metadata incl. `model_display_name` |
| `audio__plan_edit` | `clip_ids, instruction` | `recipe_id` (used by the agent for free-form edits) |
| others seen in client | `audio__modify_song, audio__convert_format, audio__caption, audio__transcribe, video__create_music_video, lyrics__edit, playlists__*, songs__*` | use `flowmusic tool` |

**Lyrics:** `lyrics_id = uuidv5(lyrics_text, "b8f9e3a1-7c2d-4f5e-9a8b-1c3d5e7f9a2b")`; the text itself travels in
`client_context.lyrics_id_map[lyrics_id]`. Empty id = no lyrics; `"[Instrumental]"` = instrumental.
Song length is expressed by appending `[End - m:ss]` to the lyrics (works: 2:00 -> ~119 s; the server has a ~60 s minimum),
bpm by appending `, N bpm` to the sound prompt. The model is chosen with `client_context.selected_model` (`GET /models`).
With lyrics the server sometimes returns two versions (`clip_id` + `clip_id_b`, shown as `[A]`/`[B]`).

**Edits (extend / replace / cover):** `POST /recipes/create {recipe:{nodes:[Input{clip_id}, <node>, Output{title,generate_image}], instruction}}`
→ `{recipe_id}`, then `audio__render_edit`. Node types: `ExtendSection{extend_s, extend_from_s}`,
`ReplaceSection{masks:[{start_s,end_s}]}`, `CoverSong{strength}`; all take `instruction, seed`.

### REST endpoints used
`GET /billing/credits`, `GET /models`, `GET /clips/user/{uid}`, `POST /clips {clip_ids}` (→ `audio_url`, `wav_url`, `image_url`, lyrics, duration status),
`PATCH /clips/{id} {title|privacy}`, `POST /clips/delete {clip_ids}`, `GET /download/audio/{id}`,
`GET /audio-create-song-status/{operation_id}`, `GET/POST /playlists`, `POST /playlists/add {playlist_id, clip_ids}`,
`GET /projects`, `GET /conversations`, `POST /producer/upload-audio` (multipart `file, file_type, filename`) +
`GET /producer/upload-audio/{id}/upload-check-status?operation_id=`.

Full extracted endpoint list: `captures/endpoints.tsv` (generated; ignored by git).

### More endpoints
`POST /search/{clips|playlists|users} {query, limit}`, `GET /playlists/trending/{daily|weekly|monthly}`, `GET /featured/playlists`,
`POST /v2/generations/favorite {clip_id, is_favorite}`, `GET /clips/favorites`, `POST /batch-download-clip {clip_ids}` (zip),
`PATCH|DELETE /playlists/{id}`, `DELETE /playlists/{id}/songs {clip_ids}`, `POST /projects {title, description}`,
`DELETE /conversations/{id}`, `GET /conversations/{id}/clip_count`.

## Not covered / untested
Music-video generation, upload with vocals (`--remove-vocals`/confirm flow is implemented from the web client but untested), DAW plugin,
Spaces, billing. Reach tools with `flowmusic tool <name> '<json>'`.
This is an unofficial, undocumented API and may change without notice.

## Skills for AI agents

`skills/` contains agent skills: `flowmusic-cli` (entry/router, readiness check), `flowmusic-generate`,
`flowmusic-edit`, `flowmusic-library`, `flowmusic-troubleshoot`. `.agents/skills.json` registers them for
Antigravity; for other agents copy or symlink `skills/*` into their skills directory.
