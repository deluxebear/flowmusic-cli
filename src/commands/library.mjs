// Library, playlists, projects, discovery and chat-session commands.
import { loadState } from "../lib/state.mjs";

export default (c) => {
  const { opts, f, log, need, num, readText, clipUrl, dur, emit, dbg, T, applyModel, waitClips, download, FORMATS, materialize, songLine, finish, createSong, renderEdit, baseTitle, seed, userId, listAllOwn, saveUrl } = c;
  return {
    async list() {
      const r = await f.get(`/clips/user/${await userId()}`, { limit: Math.min(num(opts.n, 20), 100), public_only: false });
      emit(r.clips.map((c) => `${c.id}  ${(c.created_at || "").slice(0, 16)}  ${dur(c).padStart(6)}s  ${c.is_favorite ? "★ " : ""}${c.title}`).join("\n"), r.clips);
    },
    async show() {
      const id = need(opts._[1], "clip id");
      const c = (await f.clips([id]))[id];
      if (!c) throw new Error("not found");
      emit(`${c.title}\n${clipUrl(id)}\nduration ${dur(c)}s  privacy ${c.privacy}  op ${c.op_type}${c.is_favorite ? "  ★" : ""}\n\n${c.lyrics?.value?.text ?? ""}`, c);
    },
    async rename() { const r = await f.json("PATCH", `/clips/${need(opts._[1], "clip id")}`, { body: { title: need(opts._.slice(2).join(" "), "title") } }); emit(r.clip.title, r.clip); },
    async privacy() { const r = await f.json("PATCH", `/clips/${need(opts._[1], "clip id")}`, { body: { privacy: need(opts._[2], "public|unlisted|private") } }); emit(r.clip.privacy, r.clip); },
    async favorite() { for (const id of opts._.slice(1)) await f.post("/v2/generations/favorite", { clip_id: id, is_favorite: true }); emit("favorited", {}); },
    async unfavorite() { for (const id of opts._.slice(1)) await f.post("/v2/generations/favorite", { clip_id: id, is_favorite: false }); emit("unfavorited", {}); },
    async favorites() { const r = await f.get("/clips/favorites", { limit: num(opts.n, 50) }); emit(r.clips.map((c) => `${c.id}  ${dur(c).padStart(6)}s  ${c.title}`).join("\n"), r.clips); },
    async delete() { const ids = opts._.slice(1); emit(JSON.stringify(await f.post("/clips/delete", { clip_ids: need(ids.length ? ids : null, "clip ids") })), { deleted: ids }); },
    async download() {
      const ids = opts._.slice(1);
      if (opts.zip) return console.log(await f.zipClips(need(ids.length ? ids : null, "clip ids"), opts.zip));
      for (const id of ids) console.log(await download(id));
    },
    async wait() { const ids = opts._.slice(1); const m = await waitClips(ids); emit(ids.map((i) => `${i}  ${m[i].title}`).join("\n"), m); },
    async cleanup() {
      const prefixes = need(opts.prefix, '--prefix "CLI Test,LEN-"').split(",").map((x) => x.trim()).filter(Boolean);
      const hit = (await listAllOwn()).filter((c) => prefixes.some((p) => (c.title || "").startsWith(p)));
      log(`${hit.length} clips match ${JSON.stringify(prefixes)}`);
      for (const c of hit) log(`  ${c.id}  ${c.title}`);
      if (!hit.length) return;
      if (!opts.yes) return log("dry run - add --yes to delete them");
      emit(JSON.stringify(await f.post("/clips/delete", { clip_ids: hit.map((c) => c.id) })), { deleted: hit.map((c) => c.id) });
    },

    async playlists() {
      const sub = opts._[1] || "list", uid = await userId();
      if (sub === "create") { const r = await f.post("/playlists", { name: need(opts._.slice(2).join(" "), "name") }); emit(r.playlist.id, r.playlist); }
      else if (sub === "add") { const [, , pl, ...ids] = opts._; await f.post("/playlists/add", { playlist_id: need(pl, "playlist id"), clip_ids: need(ids.length ? ids : null, "clip ids") }); emit("added", {}); }
      else if (sub === "remove") { const [, , pl, ...ids] = opts._; await f.json("DELETE", `/playlists/${need(pl, "playlist id")}/songs`, { body: { clip_ids: need(ids.length ? ids : null, "clip ids") } }); emit("removed", {}); }
      else if (sub === "rename") { const r = await f.json("PATCH", `/playlists/${need(opts._[2], "playlist id")}`, { body: { name: need(opts._.slice(3).join(" "), "name") } }); emit(r.playlist.name, r.playlist); }
      else if (sub === "delete") { await f.json("DELETE", `/playlists/${need(opts._[2], "playlist id")}`); emit("deleted", {}); }
      else if (sub === "show") {
        const r = await f.get(`/playlists/${need(opts._[2], "playlist id")}`, { limit: 100 });
        const ids = r.clips.map((x) => x.clip_id);
        const m = ids.length ? await f.clips(ids) : {};
        const clips = ids.map((id) => m[id]).filter(Boolean);
        emit(clips.map((c) => `${c.id}  ${dur(c).padStart(6)}s  ${c.title}`).join("\n"), clips);
      }
      else { const r = await f.get(`/users/${uid}/playlists`, { favorites: false, public: false, offset: 0, limit: 50 }); emit(r.playlists.map((p) => `${p.id}  ${String(p.num_songs ?? 0).padStart(3)}  ${p.name}`).join("\n"), r.playlists); }
    },
    async projects() {
      const sub = opts._[1] || "list";
      if (sub === "create") { const r = await f.post("/projects", { title: need(opts._.slice(2).join(" "), "title"), description: opts.description || "" }); emit(JSON.stringify(r.project ?? r), r); }
      else if (sub === "delete") { await f.json("DELETE", `/projects/${need(opts._[2], "project id")}`); emit("deleted", {}); }
      else { const r = await f.get("/projects", { offset: 0, limit: 50 }); emit(r.projects.map((p) => `${p.id}  ${p.title ?? p.name ?? ""}`).join("\n"), r.projects); }
    },

    async search() {
      const kind = need(opts._[1], "clips|playlists|users"), q = need(opts._.slice(2).join(" "), "query");
      const r = await f.post(`/search/${kind}`, { query: q, limit: num(opts.n, 10) });
      const line = { clips: (c) => `${c.id}  ${dur(c).padStart(6)}s  ${c.title}`, playlists: (p) => `${p.id}  ${p.name}`, users: (u) => `${u.user_id}  ${u.username}` }[kind];
      if (!line) throw new Error("search kind must be clips, playlists or users");
      const rows = r.slice(0, num(opts.n, 10));
      emit(rows.map(line).join("\n"), rows);
    },
    async trending() { const r = await f.get(`/playlists/trending/${opts._[1] || "weekly"}`, { limit: num(opts.n, 10), offset: 0 }); emit(r.playlists.map((p) => `${p.id}  ${String(p.num_songs ?? 0).padStart(3)}  ${p.name}`).join("\n"), r.playlists); },
    async featured() { const r = await f.get("/featured/playlists"); emit(r.playlists.map((p) => `${p.id}  ${String(p.num_songs ?? 0).padStart(3)}  ${p.name}`).join("\n"), r.playlists); },

    async chats() {
      const sub = opts._[1] || "list";
      if (sub === "rm") { for (const id of opts._.slice(2)) await f.deleteConversation(id); return emit("deleted", {}); }
      const all = await f.get("/conversations", { limit: 100, offset: 0 });
      if (sub === "clean") {
        const keep = loadState().conversation;
        const empty = [];
        for (const c of all) { if (c.id === keep) continue; const n = (await f.get(`/conversations/${c.id}/clip_count`)).clip_count; if (!n) empty.push(c); }
        log(`${empty.length} empty conversations of ${all.length}`);
        if (!empty.length) return;
        if (!opts.yes) return log("dry run - add --yes to delete them");
        for (const c of empty) await f.deleteConversation(c.id);
        return emit(`deleted ${empty.length}`, { deleted: empty.map((c) => c.id) });
      }
      emit(all.map((c) => `${c.id}  ${c.id === loadState().conversation ? "(shared) " : ""}${c.title ?? ""}`).join("\n"), all);
    },
  };
};
