// Edit and analysis commands: extend, replace, cover, stems, trim, speed, convert, modify, caption, transcribe.
import { clipIds } from "../lib/util.mjs";

export default (c) => {
  const { opts, f, log, need, num, readText, clipUrl, dur, emit, dbg, T, applyModel, waitClips, download, FORMATS, materialize, songLine, finish, createSong, renderEdit, baseTitle, seed, userId, listAllOwn, saveUrl } = c;
  return {
    async extend() {
      const clip = need(opts._[1], "clip id");
      await finish(await renderEdit(clip, { node_type: "ExtendSection", instruction: opts.prompt || "", extend_s: num(opts.seconds, 20), extend_from_s: opts.from != null ? Number(opts.from) : null, seed: seed() }, opts.title || (await baseTitle(clip, "extended"))), "extend");
    },
    async replace() {
      const clip = need(opts._[1], "clip id");
      if (!opts.region.length) throw new Error("need at least one --region START-END (seconds)");
      const masks = opts.region.map((r) => { const [a, b] = r.split("-").map(Number); return { start_s: a, end_s: b }; });
      await finish(await renderEdit(clip, { node_type: "ReplaceSection", instruction: opts.prompt || "", masks, seed: seed() }, opts.title || (await baseTitle(clip, "replaced"))), "replace");
    },
    async cover() {
      const clip = need(opts._[1], "clip id");
      await finish(await renderEdit(clip, { node_type: "CoverSong", instruction: need(opts.prompt, "--prompt"), strength: num(opts.strength, 0.5), seed: seed() }, opts.title || (await baseTitle(clip, "cover"))), "cover");
    },
    async stems() { await finish(await T("audio__split_stems", { clip_id: need(opts._[1], "clip id") }), "stems"); },
    async trim() {
      const clip = need(opts._[1], "clip id");
      await finish(await T("audio__apply_effect", {
        graph: [{ node_type: "Input", node_id: "input", track_id: clip }, { node_type: "Trim", node_id: "trim", input_ids: ["input"], start_s: num(need(opts.start, "--start")), end_s: num(need(opts.end, "--end")) }, { node_type: "Output", input_ids: ["trim"] }],
        output_title: opts.title || (await baseTitle(clip, "trim")),
      }), "trim");
    },
    async speed() {
      const clip = need(opts._[1], "clip id");
      const speed = num(opts.factor, 1), semitones = num(opts.semitones, 0);
      if (speed === 1 && semitones === 0) throw new Error("give --factor (e.g. 0.85) and/or --semitones");
      await finish(await T("audio__apply_effect", {
        graph: [{ node_type: "Input", node_id: "input", track_id: clip }, { node_type: "TempoShift", node_id: "fx", input_ids: ["input"], speed, semitones }, { node_type: "Output", input_ids: ["fx"] }],
        output_title: opts.title || (await baseTitle(clip, `x${speed}${semitones ? ` ${semitones > 0 ? "+" : ""}${semitones}st` : ""}`)),
      }), "speed");
    },
    async convert() { // formats are produced by the download endpoint: no new clip, no credits
      const fmt = need(opts.format, `--format (${FORMATS.join("|")})`);
      const ids = opts._.slice(1);
      for (const id of need(ids.length ? ids : null, "clip id")) console.log(await download(id, null, opts.out || "out", fmt));
    },
    async modify() {
      const clip = need(opts._[1], "clip id");
      const instr = need(opts._.slice(2).join(" "), "instruction");
      f.extraContext = { current_song_id: clip, song_queue: [{ id: clip }] };
      const r = await f.runJob("chat", { conversation: await f.newConversation(), body: `Call audio__modify_song on the current song with the prompt ${JSON.stringify(instr)}. Do it now without asking questions.`, onEvent: dbg });
      if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
      const ids = [...new Set(r.returns.flatMap((x) => clipIds(typeof x.content === "object" ? x.content : {})))].filter((i) => i !== clip);
      if (!ids.length) { log(`producer: ${r.text}`); throw new Error("the agent did not produce a new clip"); }
      await finish({ clip_outputs: ids.map((clip_id) => ({ clip_id })) }, "modify", { reply: r.text });
    },

    async caption() {
      const clip = need(opts._[1], "clip id");
      const c = (await f.clips([clip]))[clip];
      const r = await T("audio__caption", { prompt: opts.prompt || "Describe the musical style, instruments, vocals, and overall mood of this track.", audio_url: c.audio_url });
      emit(r.caption, r);
    },
    async transcribe() {
      const clip = need(opts._[1], "clip id");
      const c = (await f.clips([clip]))[clip];
      const r = await T("audio__transcribe", { audio_url: c.audio_url });
      emit(r.lyrics, r);
    },
  };
};
