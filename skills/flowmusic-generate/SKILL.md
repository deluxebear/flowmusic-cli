---
name: flowmusic-generate
description: >-
  Use when the user wants to create new music with the flowmusic CLI: a song from a style description, with custom or
  generated lyrics, instrumental tracks, a target length, a specific model, many songs in a batch, cover art images or
  short video clips. Explains how to write good prompts and lyrics and how to run `flowmusic gen`, `batch`, `lyrics`,
  `image` and `video`.
---

# Generating music

Prerequisite: the `flowmusic-cli` skill (readiness, safety, output conventions).

## Create one song

```bash
flowmusic gen "<style/sound prompt>" [--lyrics TEXT|@file] [--instrumental] [--title T] \
              [--length SEC] [--bpm N] [--model "Lyria 3 Pro"] [--seed N] [--json] [-o DIR]
```

- **Sound prompt** = genre, mood, instruments, vocals, tempo, era. Example:
  `"dreamy 80s synthwave, warm analog pads, female vocals, 100 bpm"`. Be concrete; the prompt describes the *sound*,
  not the story - put the story in the lyrics.
- **Lyrics**: pass text or `@path/to/lyrics.txt`. `\n` typed on a command line becomes a newline. Use section tags the
  model understands: `[Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Outro]`. The server may lightly rewrite lyrics.
  Without `--lyrics` and without `--instrumental` the model writes its own lyrics.
- **Instrumental**: `--instrumental`. Combine with `--length` for a fixed duration.
- **Length**: `--length SEC` adds an `[End - m:ss]` marker. Works well for 60+ seconds (`120` -> ~118 s). The server has a
  ~60 s minimum, so asking for 30 s still yields ~62 s. Tell the user about this limit instead of retrying.
- **Model**: `flowmusic models` lists them (`Lyria 3.5` default, `Lyria 3 Pro`). Unknown names are rejected with the list.
- **Title** defaults to the first words of the prompt; set `--title` when it matters.
- Result: song(s) downloaded to `./out`, `--json` gives ids. With lyrics you may receive two versions (A/B).

Do not call `gen` repeatedly "to see what happens" - each call spends credits. Generate, play/inspect, then ask.

## Need lyrics first?

```bash
flowmusic lyrics "a nostalgic song about the last train home"        # writes lyrics, prints them
flowmusic lyrics-edit @lyrics.txt --prompt "make the chorus rhyme"   # rewrite existing lyrics
```
Show the lyrics to the user, then pass the approved text to `gen --lyrics`.

## Many songs

```bash
flowmusic batch prompts.txt --jobs 3 [--length 90] [--model "Lyria 3 Pro"]
```
`prompts.txt`: one entry per line - a plain prompt, or a JSON object with `prompt`, `lyrics`, `title`, `instrumental`,
`length`, `bpm`, `seed`. Lines starting with `#` are comments. `--jobs` is capped at 5 (the site's own limit).
See [examples/batch.txt](./examples/batch.txt). Failures are reported per line; the exit code is 1 if any failed.
Confirm the count with the user first (cost).

## Talk to the Producer agent (optional)

```bash
flowmusic chat "make me a sad piano ballad about autumn" [-c last]
```
An LLM decides what to make and may ask questions; use `-c last` (or an id) to continue. Prefer `gen` for predictable,
scripted results; use `chat` when the user explicitly wants conversational help.

## Images and video

```bash
flowmusic image "neon city album cover" --aspect 1:1      # cover art -> ./out/image-*.jpg
flowmusic video "slow pan over a rainy neon street" --aspect 16:9 --duration 4   # -> ./out/video-*.mp4
```
`gen --image-id <id>` exists, but how to obtain a valid id is unverified; don't guess. Video is a separate, pricier
operation - confirm with the user first.

## Verify

After generation, check the returned `duration` and `file`. `flowmusic show <clip_id>` prints the title, duration and
the final lyrics; `flowmusic wait <clip_id>` blocks until a still-rendering clip is ready.
