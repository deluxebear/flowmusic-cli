---
name: flowmusic-edit
description: >-
  Use when the user wants to modify an existing flowmusic song (identified by a clip id): extend it, replace a time
  range, make a cover/restyle, split into stems (vocals, drums, bass, other), trim, change speed or pitch, convert to
  mp3/wav, caption it, transcribe its lyrics, or make a free-form change. Covers `flowmusic extend`, `replace`,
  `cover`, `stems`, `trim`, `speed`, `convert`, `caption`, `transcribe`, `modify`.
---

# Editing existing songs

Prerequisite: `flowmusic-cli` skill. All edits take a **clip id** and produce **new clips** - the original is never
modified. Get ids from `flowmusic list` or from a previous command's output. Every edit that creates audio costs
credits and takes about as long as a generation; `convert`, `caption` and `transcribe` are cheap or free of new clips.

| Goal | Command |
|---|---|
| Continue the song | `flowmusic extend <clip> [--prompt "soft piano outro"] [--seconds 20] [--from SEC]` |
| Regenerate parts | `flowmusic replace <clip> --region 20-30 [--region 60-70] [--prompt "strings instead"]` |
| Restyle / cover | `flowmusic cover <clip> --prompt "acoustic folk" [--strength 0.5]` |
| Split stems | `flowmusic stems <clip>` -> 4 clips tagged `[vocals] [drums] [bass] [other]` |
| Cut a section | `flowmusic trim <clip> --start 0 --end 15` |
| Slow down / pitch | `flowmusic speed <clip> --factor 0.85 [--semitones -2]` |
| Other format | `flowmusic convert <clip...> --format mp3\|wav\|m4a` (also `download --format`) |
| Describe the sound | `flowmusic caption <clip> [--prompt "focus on the drums"]` |
| Lyrics from audio | `flowmusic transcribe <clip>` |
| Anything else | `flowmusic modify <clip> "make it slower and more mellow"` (experimental, uses the LLM agent) |

Common options: `--title T` (default `<original title> (extended|cover|...)`), `--seed N`, `--json`, `-o DIR`.

## Details that matter

- **extend**: `--seconds` is how much to add (default 20). `--from` is the point (in seconds) from which to continue;
  without it the model continues from the end. `--prompt` steers the new part.
- **replace**: `--region START-END` in seconds, repeatable. Check the song duration first (`flowmusic show <clip>`);
  regions must lie inside it. The surrounding audio is preserved.
- **cover**: `--prompt` is required. `--strength` 0..1: low keeps more of the original, high follows the prompt more.
- **stems**: needs a finished clip. Outputs are normal clips and can be downloaded, trimmed, etc.
- **speed**: `--factor` < 1 slows down, > 1 speeds up; `--semitones` shifts pitch. At least one must be non-neutral.
- **convert / download --format**: done by the server's transcoder: no credits, no new clip. Only `mp3`, `wav`, `m4a` are
  accepted (flac/ogg are rejected). `--wav` is the fast path for lossless.
- **modify**: the LLM may choose any combination of tools (it has used tempo shift + low-pass etc.) and sometimes
  produces several clips or none. If it prints "did not produce a new clip", report the agent's reply to the user instead of retrying blindly.
- Effect-derived clips (outputs of `trim`, `speed`, ...) cannot be used with the tool-based `audio__convert_format`, but
  `convert`/`download --format` works on every clip.

## Workflow pattern

1. `flowmusic show <clip>` - confirm title, duration, lyrics.
2. Run the edit once; read the printed file path(s) and durations.
3. If the user wants variations, change `--prompt`/`--seed` and run again (each run costs credits - ask first when doing several).
4. Report new clip ids so the user can reference them later.

Examples: [examples/edit_workflows.md](./examples/edit_workflows.md).
