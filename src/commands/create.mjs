// Creation commands: gen, batch, chat, wizard, lyrics, image, video, upload.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { loadState, patchState } from "../lib/state.mjs";
import { clipIds, parseBatchLines, pool, sleep } from "../lib/util.mjs";

export default (c) => {
  const { opts, f, log, need, num, readText, clipUrl, dur, emit, dbg, T, applyModel, waitClips, download, FORMATS, materialize, songLine, finish, createSong, renderEdit, baseTitle, seed, userId, listAllOwn, saveUrl } = c;
  return {
    async gen() {
      await applyModel();
      const songs = await createSong({ ...opts, prompt: opts._.slice(1).join(" ") });
      emit(songs.map(songLine).join("\n"), { songs });
    },

    async batch() {
      await applyModel();
      const specs = parseBatchLines(fs.readFileSync(need(opts._[1], "batch file"), "utf8"));
      if (!specs.length) throw new Error("no prompts in batch file");
      const jobs = Math.min(5, Math.max(1, num(opts.jobs, 2))); // web client allows max 5 concurrent
      log(`batch: ${specs.length} songs, ${jobs} at a time`);
      const res = await pool(specs, jobs, async (s, i) => {
        const songs = await createSong({ model: opts.model, length: opts.length, ...s }, { quiet: true });
        log(`[${i + 1}/${specs.length}] done: ${songs.map((x) => x.title).join(", ")}`);
        return songs;
      });
      const flat = [], failed = [];
      res.forEach((r, i) => (r.ok ? flat.push(...r.value) : (failed.push({ index: i + 1, prompt: specs[i].prompt, error: r.error.message }), log(`[${i + 1}] FAILED: ${r.error.message}`))));
      emit(flat.map(songLine).join("\n") + (failed.length ? `\n${failed.length} failed` : ""), { songs: flat, failed });
      if (failed.length) process.exitCode = 1;
    },

    async chat() {
      const msg = need(opts._.slice(1).join(" "), "message");
      let conv = opts.conversation === "last" ? loadState().lastChat : opts.conversation;
      const r = await f.runJob("chat", { conversation: conv || (await f.newConversation()), body: msg, onEvent: dbg });
      if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
      patchState({ lastChat: r.conversation });
      for (const t of r.toolCalls) if (t.tool_name?.includes("__") && !/^(synthetic|player)/.test(t.tool_name)) log(`> ${t.tool_name} ${JSON.stringify(t.args).slice(0, 200)}`);
      if (r.text) log(`\nproducer: ${r.text}\n`);
      log(`conversation: ${r.conversation}  (continue with: -c last)`);
      const ids = [...new Set(r.returns.flatMap((x) => clipIds(typeof x.content === "object" ? x.content : {})))];
      if (ids.length) await finish({ clip_outputs: ids.map((clip_id) => ({ clip_id })) }, "chat", { conversation: r.conversation, reply: r.text });
      else emit(r.text, { conversation: r.conversation, reply: r.text });
    },

    async wizard() {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      try {
        const ask = async (q, d = "") => ((await rl.question(`${q}${d ? ` [${d}]` : ""}: `)).trim() || d);
        const prompt = need(await ask("Style / description (e.g. dreamy synthwave, female vocals)"), "description");
        const instrumental = /^y/i.test(await ask("Instrumental? (y/n)", "n"));
        const lyrics = instrumental ? "" : await ask("Lyrics (text, @file, or empty for auto)");
        const title = await ask("Title", prompt.split(/\s+/).slice(0, 4).join(" "));
        const length = await ask("Target length in seconds (min ~60, empty = auto)");
        const { models } = await f.get("/models");
        const model = await ask(`Model (${models.map((m) => m.public_name).join(" / ")})`, models.find((m) => m.is_default)?.public_name);
        Object.assign(opts, { model });
        await applyModel();
        const songs = await createSong({ prompt, instrumental, lyrics, title, length: length || undefined });
        emit(songs.map(songLine).join("\n"), { songs });
      } finally { rl.close(); }
    },

    async lyrics() {
      const c = await T("lyrics__create", { prompt: need(opts._.slice(1).join(" "), "prompt") });
      emit(`# ${c.title}\n\n${c.lyrics}`, c);
    },
    async "lyrics-edit"() {
      const text = readText(need(opts._[1], "lyrics text or @file"));
      const { lyrics_id } = await T("lyrics__register", { lyrics: text });
      const c = await T("lyrics__edit", { prompt: need(opts.prompt, "--prompt"), lyrics_id });
      emit(c.lyrics, c);
    },

    async image() {
      const c = await T("image__create_image", { prompt: need(opts._.slice(1).join(" "), "prompt"), aspect_ratio: opts.aspect || "1:1", image_urls: null });
      if (!opts["no-download"] && c.image_url) c.file = await saveUrl(c.image_url, `image-${Date.now()}.jpg`);
      emit(c.file || c.image_url, c);
    },
    async video() {
      const c = await T("video__create_video_clip", { inputs: { prompt: need(opts._.slice(1).join(" "), "prompt"), aspect_ratio: opts.aspect || "16:9", duration: String(num(opts.duration, 4)), model_name: "veo3-1-fast" } });
      if (!opts["no-download"] && c.url) c.file = await saveUrl(c.url, `video-${Date.now()}.mp4`);
      emit(c.file || c.url, c);
    },

    async upload() {
      const file = need(opts._[1], "file");
      const mime = { m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg" }[file.split(".").pop().toLowerCase()] || "audio/mpeg";
      const fd = new FormData();
      fd.append("file", new Blob([fs.readFileSync(file)], { type: mime }), path.basename(file));
      fd.append("file_type", mime);
      fd.append("filename", path.basename(file));
      const r = await f.json("POST", "/producer/upload-audio", { body: fd });
      let clip_id = r.clip_id || r.id, status = null;
      if (r.operation_id) {
        for (let i = 0; i < 80; i++) {
          status = await f.get(`/producer/upload-audio/${clip_id}/upload-check-status`, { operation_id: r.operation_id });
          if (status.status === "complete" || /fail|error/i.test(status.status || "")) break;
          await sleep(3000);
        }
        if (status?.status === "complete" && status.has_cid_match) throw new Error("upload rejected: audio matches protected content");
        if (status?.status === "complete" && status.has_vocals) {
          if (opts["remove-vocals"]) {
            log("vocals detected: removing vocals...");
            const n = await f.json("POST", `/producer/upload-audio/${clip_id}/remove-vocals`, { body: { operation_id: r.operation_id } });
            clip_id = n.clip_id || clip_id;
          } else {
            await f.json("POST", `/producer/upload-audio/${clip_id}/confirm`, { body: { operation_id: r.operation_id, has_vocals: true, has_cid_match: status.has_cid_match ?? null, has_minor_vocals: status.has_minor_vocals ?? null } });
          }
        }
      }
      emit(clip_id, { clip_id, status });
    },
  };
};
