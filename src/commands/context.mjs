// Shared per-invocation context: API client plus helpers used by the command modules.
import fs from "node:fs";
import path from "node:path";
import { Flow, lyricsId, INSTRUMENTAL } from "../lib/client.mjs";
import { clipIds, composeSong, unescapeNewlines, fmtDuration, sleep } from "../lib/util.mjs";

export const log = (...a) => console.error(...a);
export const need = (v, what) => { if (v == null || v === "") throw new Error(`missing ${what} (see: flowmusic help)`); return v; };
export const num = (v, d) => (v == null ? d : Number(v));
export const readText = (v) => (v && v.startsWith("@") ? fs.readFileSync(v.slice(1), "utf8") : unescapeNewlines(v));
export const clipUrl = (id) => `https://www.flowmusic.app/song/${id}`;
export const dur = (c) => fmtDuration(c.duration?.value);

export function createContext(opts) {
  const f = new Flow({ verbose: !!opts.v });
  const emit = (human, data) => console.log(opts.json ? JSON.stringify(data, null, 2) : human);
  const dbg = (ev) => { if (opts.v) log(JSON.stringify(ev).slice(0, 400)); };

  /** Direct tool call on the shared conversation (kept tidy); validates --model. */
  async function T(name, args, extra = {}) {
    if (!f.conversation) await f.useSharedConversation({ fresh: !!opts["new-session"] });
    const r = await f.tool(name, args, { onEvent: dbg, ...extra });
    return r.content;
  }
  async function applyModel() {
    if (!opts.model) return;
    const { models } = await f.get("/models");
    const m = models.find((x) => x.public_name.toLowerCase() === String(opts.model).toLowerCase());
    if (!m) throw new Error(`unknown model "${opts.model}". Available: ${models.map((x) => x.public_name).join(", ")}`);
    f.extraContext.selected_model = m.public_name;
  }

  // ---------- progress / waiting ----------
  function progressBar(label, quiet) {
    const t0 = Date.now(), tty = process.stderr.isTTY && !quiet;
    let last = "";
    return {
      tick(msg) {
        const s = `${label}: ${msg} (${Math.round((Date.now() - t0) / 1000)}s)`;
        if (tty) process.stderr.write(`\r\x1b[K${s}`); else if (!quiet && msg !== last) { log(s); last = msg; }
      },
      done() { if (tty) process.stderr.write("\r\x1b[K"); },
    };
  }
  async function waitClips(ids, { label = "waiting", timeoutS = 900, quiet = false } = {}) {
    const pb = progressBar(label, quiet), t0 = Date.now();
    try {
      for (;;) {
        const m = await f.clips(ids);
        const st = ids.map((id) => m[id]);
        const failed = st.find((c) => c && (c.deleted_at || /fail|error/i.test(c.duration?.status || "")));
        if (failed) throw new Error(`clip ${failed.id} failed: ${JSON.stringify(failed.duration)}`);
        if (st.every((c) => c && c.audio_url && (c.duration?.status === "completed" || c.duration?.value))) return m;
        pb.tick(st.map((c, i) => `${ids[i].slice(0, 8)}:${c?.duration?.status ?? "pending"}`).join(" "));
        if ((Date.now() - t0) / 1000 > timeoutS) throw new Error("timeout waiting for clips");
        await sleep(3000);
      }
    } finally { pb.done(); }
  }

  const FORMATS = ["mp3", "wav", "m4a"]; // formats the server's /download/audio endpoint accepts
  async function download(id, clip, dir = opts.out || "out", format = opts.format || (opts.wav ? "wav" : null)) {
    clip = clip || (await f.clips([id]))[id];
    if (format && !FORMATS.includes(format)) throw new Error(`unsupported format "${format}" (server supports: ${FORMATS.join(", ")})`);
    const safe = `${(clip.title || id).replace(/[^\w\u4e00-\u9fa5\- ]+/g, "_").trim()}-${id.slice(0, 8)}`;
    fs.mkdirSync(dir, { recursive: true });
    const direct = format === "wav" ? clip.wav_url : !format || format === "m4a" ? clip.audio_url : null;
    if (direct) {
      const r = await fetch(direct);
      if (r.ok) {
        const file = path.join(dir, `${safe}.${new URL(direct).pathname.split(".").pop()}`);
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
        return file;
      }
    }
    const r = await f.raw("GET", `/download/audio/${id}`, { search: format ? { format } : undefined }); // server-side transcoding
    const file = path.join(dir, `${safe}.${format || "m4a"}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return file;
  }

  /** Wait for + download the clips named in a tool result. Returns plain result objects. */
  async function materialize(content, label, { quiet = false } = {}) {
    const ids = clipIds(content);
    if (!ids.length) return null;
    if (!quiet) log(`${label}: queued ${ids.map((i) => i.slice(0, 8)).join(", ")}${content.estimated_time ? ` (~${content.estimated_time}s)` : ""}`);
    const m = await waitClips(ids, { label, quiet });
    const stems = content.stems ? Object.fromEntries(content.stems.map((s) => [s.clip_id, s.stem_type])) : {};
    const out = [];
    for (const [i, id] of ids.entries()) {
      const c = m[id];
      const r = { clip_id: id, title: c.title, duration: Number(dur(c)), url: clipUrl(id), audio_url: c.audio_url, wav_url: c.wav_url };
      if (stems[id]) r.stem = stems[id];
      if (content.clip_id_b && id === content.clip_id_b) r.variant = "B";
      else if (content.clip_id_b && i === 0) r.variant = "A";
      if (!opts["no-download"]) r.file = await download(id, c);
      out.push(r);
    }
    return out;
  }
  const songLine = (r) => `${r.file || r.url}${r.stem ? `  [${r.stem}]` : ""}${r.variant ? `  [${r.variant}]` : ""}  (${r.duration}s)`;
  async function finish(content, label, extra = {}) {
    const songs = await materialize(content, label);
    if (!songs) return emit(JSON.stringify(content, null, 2), { result: content, ...extra });
    emit(songs.map(songLine).join("\n"), { ...extra, songs });
  }

  // ---------- song building blocks ----------
  async function createSong(spec, { quiet = false } = {}) {
    const prompt = need(spec.prompt, "sound prompt");
    const lyrics = spec.lyrics ? readText(spec.lyrics) : "";
    const { sound_prompt, lyricsText } = composeSong({ prompt, lyrics, instrumental: spec.instrumental, length: spec.length, bpm: spec.bpm }, INSTRUMENTAL);
    const id = lyricsId(lyricsText);
    if (id) f.lyricsMap[id] = lyricsText;
    const title = spec.title || prompt.split(/\s+/).slice(0, 5).join(" ");
    const content = await T("audio__create_song", { sound_prompt, lyrics_id: id, title, seed: spec.seed != null ? Number(spec.seed) : null, image_id: spec["image-id"] || spec.image_id || null });
    return materialize(content, "gen", { quiet });
  }

  async function renderEdit(clip, node, title) {
    const recipe = {
      nodes: [
        { node_type: "Input", clip_id: clip, input_ids: [], output_ids: ["input"] },
        { node_type: node.node_type, input_ids: ["input"], output_ids: ["processing"], ...node },
        { node_type: "Output", input_ids: ["processing"], output_ids: ["output"], title, generate_image: false },
      ],
      instruction: node.instruction || null,
    };
    const { recipe_id } = await f.post("/recipes/create", { recipe });
    return T("audio__render_edit", { recipe_id, title, image_id: null });
  }
  const baseTitle = async (clip, suffix) => `${(await f.clips([clip]))[clip]?.title || "Untitled"} (${suffix})`;
  const seed = () => (opts.seed ? Number(opts.seed) : null);
  const userId = async () => { await f.auth(); return f.userId; };

  async function listAllOwn(max = 1000) {
    const id = await userId(), out = [];
    while (out.length < max) {
      const r = await f.get(`/clips/user/${id}`, { limit: 100, offset: out.length, public_only: false });
      out.push(...r.clips);
      if (r.clips.length < 100) break;
    }
    return out;
  }

  async function saveUrl(url, name) {
    const r = await fetch(url);
    fs.mkdirSync(opts.out || "out", { recursive: true });
    const file = path.join(opts.out || "out", name);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return file;
  }

  return { opts, f, log, need, num, readText, clipUrl, dur, emit, dbg, T, applyModel, waitClips, download, FORMATS, materialize, songLine, finish, createSong, renderEdit, baseTitle, seed, userId, listAllOwn, saveUrl };
}
