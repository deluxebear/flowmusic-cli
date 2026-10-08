// Account and diagnostic commands: credits, models, tool, login, logout, whoami, doctor.
import { login, importFromChrome, loginWithBrowser, clearSession, loadSession } from "../lib/auth.mjs";

export default (c) => {
  const { opts, f, log, need, num, readText, clipUrl, dur, emit, dbg, T, applyModel, waitClips, download, FORMATS, materialize, songLine, finish, createSong, renderEdit, baseTitle, seed, userId, listAllOwn, saveUrl } = c;
  return {
    async credits() { const c = (await f.get("/billing/credits")).data; emit(`credits: ${c.credits_remaining}  tokens: ${c.tokens_remaining}`, c); },
    async models() { const r = await f.get("/models"); emit(r.models.map((m) => `${m.public_name}${m.is_default ? " (default)" : ""} - ${m.description}`).join("\n"), r.models); },
    async tool() { emit(JSON.stringify(await T(need(opts._[1], "tool name"), JSON.parse(opts._[2] || "{}")), null, 2), {}); },

    async login() {
      const s = opts["from-chrome"] ? await importFromChrome() : opts.profile ? await login() : await loginWithBrowser();
      emit(`logged in: ${s.email || s.user_id}`, { user_id: s.user_id, email: s.email });
    },
    async logout() { clearSession(); emit("logged out (session and dedicated browser profile removed)", {}); },
    async whoami() {
      const s = loadSession();
      if (!s) throw new Error("not logged in: run `flowmusic login`");
      const left = Math.round(s.expires_at - Date.now() / 1000);
      emit(`${s.email || s.user_id}\naccess token ${left > 0 ? `valid ${Math.round(left / 60)} min` : "expired"}, auto-refresh ${s.refresh_token ? "on" : "off"}`, { user_id: s.user_id, email: s.email, expires_in: left, auto_refresh: !!s.refresh_token });
    },

    async doctor() {
      const rows = [];
      const check = async (name, fn) => { try { rows.push([true, name, await fn()]); } catch (e) { rows.push([false, name, e.message.slice(0, 160)]); } };
      await check("session", async () => { await f.auth(); return `${f.userId}${loadSession()?.refresh_token ? " (auto-refresh on)" : ""}`; });
      await check("GET /billing/credits", async () => { const c = (await f.get("/billing/credits")).data; if (c.credits_remaining == null) throw new Error("unexpected shape"); return `${c.credits_remaining} credits`; });
      await check("GET /models", async () => (await f.get("/models")).models.map((m) => m.public_name).join(", "));
      let sample;
      await check("GET /clips/user/{id}", async () => { sample = (await listAllOwn(1))[0]; return sample ? sample.id.slice(0, 8) : "no clips yet"; });
      await check("POST /clips (response shape)", async () => {
        if (!sample) return "skipped";
        const c = (await f.clips([sample.id]))[sample.id];
        const miss = ["audio_url", "duration", "title", "lyrics"].filter((k) => !(k in c));
        if (miss.length) throw new Error("missing fields: " + miss.join(","));
        return "ok";
      });
      await check("shared conversation", async () => { const id = await f.useSharedConversation(); await f.get(`/conversations/${id}/clip_count`); return id.slice(0, 8); });
      await check("direct tool call", async () => { if (!sample) return "skipped"; const r = await f.tool("songs__get_metadata", { clip_id: sample.id }); return r.content.model_display_name ? `model ${r.content.model_display_name}` : "ok"; });
      await check("SSE stream", async () => "ok (via tool call)");
      for (const [ok, name, info] of rows) console.log(`${ok ? "✓" : "✗"} ${name}${info ? "  " + info : ""}`);
      if (rows.some((r) => !r[0])) process.exitCode = 1;
    },
  };
};
