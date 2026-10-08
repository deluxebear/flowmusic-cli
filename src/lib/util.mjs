// Pure helpers (unit-tested).
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VALUE_FLAGS = new Set(["-o", "--out", "-c", "--conversation", "-n", "--lyrics", "--title", "--bpm", "--length", "--seed", "--image-id",
  "--prompt", "--seconds", "--from", "--region", "--strength", "--start", "--end", "--aspect", "--duration", "--model", "--jobs", "--to",
  "--prefix", "--format", "--description", "--factor", "--semitones", "--zip"]);
const ALIAS = { o: "out", c: "conversation" };

/** Tiny argv parser: positional args in `_`, value flags, boolean flags, repeatable --region. */
export function parseArgs(argv) {
  const o = { _: [], region: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      const v = argv[++i];
      const k = a.replace(/^-+/, "");
      if (k === "region") o.region.push(v); else o[ALIAS[k] || k] = v;
    } else if (a.startsWith("-") && a.length > 1 && !/^-\d/.test(a)) o[a.replace(/^-+/, "")] = true;
    else o._.push(a);
  }
  return o;
}

/** Collect clip ids from any tool result shape. */
export function clipIds(c) {
  if (!c || typeof c !== "object") return [];
  const ids = [c.clip_id, c.clip_id_b, c.result_clip_id, ...(c.clip_outputs || []).map((x) => x.clip_id), ...(c.stems || []).map((x) => x.clip_id)];
  return [...new Set(ids.filter(Boolean))];
}

/** "[End - m:ss]" marker used by the web UI to request a song length. */
export function endMarker(seconds) {
  const L = Math.round(Number(seconds));
  return `[End - ${Math.floor(L / 60)}:${String(L % 60).padStart(2, "0")}]`;
}

/** Build the (sound_prompt, lyrics) pair exactly as the web compose form does. */
export function composeSong({ prompt, lyrics, instrumental, length, bpm }, instrumentalText = "[Instrumental]") {
  let text = instrumental ? instrumentalText : lyrics || "";
  if (length) text = text ? `${text}\n${endMarker(length)}` : endMarker(length);
  const sound = bpm ? (prompt ? `${prompt}, ${bpm} bpm` : `${bpm} bpm`) : prompt;
  return { sound_prompt: sound, lyricsText: text };
}

/** Turn literal "\n" typed on a shell command line into real newlines. */
export const unescapeNewlines = (s) => (typeof s === "string" ? s.replace(/\\n/g, "\n") : s);

/** One batch line: JSON object or plain prompt. Blank lines and # comments are skipped. */
export function parseBatchLines(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("{")) out.push(JSON.parse(line));
    else out.push({ prompt: line });
  }
  return out;
}

/** Run async tasks with limited concurrency, preserving order of results. */
export async function pool(items, limit, fn) {
  const res = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; try { res[i] = { ok: true, value: await fn(items[i], i) }; } catch (e) { res[i] = { ok: false, error: e }; } }
  }));
  return res;
}

export function fmtDuration(v) { return Number(v ?? 0).toFixed(1); }

/** Tolerant Server-Sent-Events parser over an async iterable of Uint8Array chunks. */
export async function* parseSSE(body) {
  let buf = "";
  const dec = new TextDecoder();
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true }).replace(/\r\n?/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message", data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) yield { event, data: JSON.parse(data) };
    }
  }
}

export function friendlyError(err) {
  const t = err?.type, m = err?.message || "";
  const raw = err?.raw_error ? ` | ${String(err.raw_error).slice(0, 300)}` : "";
  if (t === "moderation") return `Content flagged by moderation: ${m}`;
  if (t === "permission") return "Permission denied for this action";
  if (t === "rate_limit" || t === "rateLimit") return "Rate limited by the server, try again in a bit";
  if (t === "inference") return `Generation failed on the server (try again later)${raw}`;
  return `${m}${raw}${t ? ` [${t}]` : ""}`.trim();
}
