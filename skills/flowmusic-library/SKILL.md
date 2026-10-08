---
name: flowmusic-library
description: >-
  Use when the user wants to browse or manage their flowmusic library with the CLI: list recent songs, show a song's
  lyrics, download audio (m4a/mp3/wav or a zip), rename, change privacy, favorite, organise playlists and projects,
  search public songs/playlists/users, see trending/featured playlists, check credits or models, and safely clean up
  test clips and empty conversations.
---

# Library, playlists and discovery

Prerequisite: `flowmusic-cli` skill (safety rules apply: anything that deletes needs the user's explicit approval).

## Browse and inspect

```bash
flowmusic list [-n 20]            # id, date, duration, title (★ = favorite)
flowmusic show <clip>             # title, url, duration, privacy, lyrics
flowmusic wait <clip...>          # block until clips finish rendering
flowmusic credits | models | whoami
```
Add `--json` to parse. Song web page: `https://www.flowmusic.app/song/<clip_id>`.

## Download

```bash
flowmusic download <clip...> [-o DIR]                  # original m4a
flowmusic download <clip> --format mp3                 # mp3 | wav | m4a (server transcoding)
flowmusic download <clip...> --zip songs.zip           # one archive
```
Files are named `<title>-<id8>.<ext>`.

## Organise

```bash
flowmusic rename <clip> New title
flowmusic privacy <clip> public|unlisted|private       # new songs are "unlisted"
flowmusic favorite <clip...> | unfavorite <clip...> | favorites
flowmusic playlists                                    # list
flowmusic playlists create "Name"                      # prints the playlist id
flowmusic playlists add <playlist> <clip...>
flowmusic playlists show <playlist>
flowmusic playlists rename <playlist> "New name"
flowmusic playlists remove <playlist> <clip...>        # keeps the songs, drops them from the list
flowmusic projects [list|create "Title" --description "..."|delete <id>]
```
Making a song `public` publishes it on the site - confirm with the user before doing it.

## Discover (public data)

```bash
flowmusic search clips "lofi piano" -n 5
flowmusic search playlists "synthwave"
flowmusic search users "name"
flowmusic trending weekly         # daily | weekly | monthly
flowmusic featured
```

## Cleanup (destructive - ask first)

```bash
flowmusic cleanup --prefix "CLI Test,LEN-"        # DRY RUN: lists clips whose title starts with a prefix
flowmusic cleanup --prefix "CLI Test,LEN-" --yes  # deletes them
flowmusic delete <clip...>                        # deletes specific clips
flowmusic chats                                   # sessions; the shared one is marked (shared)
flowmusic chats clean                             # DRY RUN: empty conversations
flowmusic chats clean --yes                       # delete them (never touches the shared session)
```
Procedure: run the dry run, show the user the exact list, get a clear "yes", then rerun with `--yes`.
Deleted clips cannot be restored. Only match prefixes the user named; never guess broad prefixes.

## Notes
- `flowmusic chats` shows sessions created by the Producer chat and by direct tool calls; all CLI tool calls share one
  session (state in `~/.config/gfmusic/state.json`), `--new-session` starts a fresh one.
- Clip ids are UUIDs; unique 8-character prefixes are NOT accepted - use full ids.
