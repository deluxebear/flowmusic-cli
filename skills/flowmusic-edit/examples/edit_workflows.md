# Edit workflow examples

Each step spends credits and yields a NEW clip id (parse it with `--json`).

## Generate -> extend -> download
```bash
flowmusic gen "cinematic strings, slow build" --instrumental --json   # -> CLIP
flowmusic extend CLIP --seconds 30 --json                             # -> CLIP2
flowmusic download CLIP2 --format wav -o ./out
```

## Stems
```bash
flowmusic stems CLIP --json
```

## Slow down + pitch shift
```bash
flowmusic speed CLIP --factor 0.85 --semitones -2
```

## Replace a section / cover
```bash
flowmusic replace CLIP --region 30-45 --prompt "add a guitar solo"
flowmusic cover CLIP --prompt "jazz version" --strength 0.5
```
