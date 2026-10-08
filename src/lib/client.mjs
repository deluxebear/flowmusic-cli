// Low-level flowmusic.app client: auth, REST, SSE, direct tool calls, recipes.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSession } from "./auth.mjs";
import { loadState, patchState } from "./state.mjs";
import { parseSSE, friendlyError, sleep } from "./util.mjs";

export const BASE = process.env.FLOWMUSIC_BASE || "https://www.flowmusic.app/__api";
const LYRICS_NS = "b8f9e3a1-7c2d-4f5e-9a8b-1c3d5e7f9a2b"; // from the web client
export const INSTRUMENTAL = "[Instrumental]";

/** RFC 4122 uuid v5 (same as the `uuid` npm package used by the web client). */
export function uuid5(name, namespace = LYRICS_NS) {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = crypto.createHash("sha1").update(ns).update(Buffer.from(name, "utf8")).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
export const lyricsId = (text) => (!text || !text.trim() || text === INSTRUMENTAL ? "" : uuid5(text));

export class Flow {
  constructor({ token, verbose = false } = {}) {
    this.token = token || process.env.FLOWMUSIC_TOKEN;
    this.envToken = !!this.token;
    this.expiresAt = Infinity;
    this.verbose = verbose;
    this.lyricsMap = {};
    this.extraContext = {};
  }
  log(...a) { console.error(...a); }

  async auth() {
    if (!this.token || this.expiresAt - 90 < Date.now() / 1000) {
      const s = await getSession({ force: !!this.token && !this.envToken });
      this.token = s.access_token;
      this.userId = s.user_id;
      this.expiresAt = s.expires_at ?? Infinity;
    }
    if (!this.userId) this.userId = JSON.parse(Buffer.from(this.token.split(".")[1], "base64url")).sub;
    return this.token;
  }

  async raw(method, p, o = {}, _retry = false) {
    const { body, search, headers } = o;
    await this.auth();
    const url = new URL(BASE + p);
    for (const [k, v] of Object.entries(search || {})) if (v != null) url.searchParams.set(k, Array.isArray(v) ? v.join(",") : v);
    const isForm = body instanceof FormData;
    const idempotent = method === "GET" || method === "DELETE";
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      let r;
      try {
        r = await fetch(url, {
          method,
          headers: { authorization: `Bearer ${this.token}`, ...(isForm || body === undefined ? {} : { "content-type": "application/json" }), ...headers },
          body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
        });
      } catch (e) { // network error: only safe to retry when nothing could have been processed
        lastErr = e;
        if (!idempotent && attempt >= 1) break;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (r.status === 401 && !_retry && !this.envToken) { this.expiresAt = 0; return this.raw(method, p, o, true); }
      const retryable = r.status === 429 || (idempotent && r.status >= 500);
      if (!r.ok && retryable && attempt < 3) {
        const wait = Number(r.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
        await sleep(wait);
        continue;
      }
      if (!r.ok) { const e = new Error(`${method} ${p} -> ${r.status} ${(await r.text()).slice(0, 600)}`); e.status = r.status; throw e; }
      return r;
    }
    throw lastErr || new Error(`${method} ${p} failed`);
  }
  async json(method, p, opts) {
    const t = await (await this.raw(method, p, opts)).text();
    try { return JSON.parse(t); } catch { return t; }
  }
  get(p, search) { return this.json("GET", p, { search }); }
  post(p, body) { return this.json("POST", p, { body }); }

  sse(res) { return parseSSE(res.body); }

  clientContext(extra = {}) {
    return {
      current_song_id: null, song_queue: [], project_id: null, selected_model: null,
      lyrics_id_map: this.lyricsMap, ghostwriter_version: "standard", enable_lyria_agent: false, onboarding_variant: null,
      ...this.extraContext, ...extra,
    };
  }

  async newConversation(opts = {}) {
    return (await this.post("/conversation/create", { project_id: null, ...opts })).conversation_id;
  }

  /** Reuse one persistent conversation for all direct tool calls (keeps the library tidy). */
  async useSharedConversation({ fresh = false } = {}) {
    let id = fresh ? null : loadState().conversation;
    if (!id) { id = await this.newConversation(); patchState({ conversation: id }); }
    this.conversation = id;
    return id;
  }

  /**
   * Run a job stream and collect tool calls / returns.
   * kind: "chat" -> POST /conversation ; "tool" -> POST /producer/tool-call
   */
  async runJob(kind, { conversation, body, onEvent }) {
    let conv = conversation || this.conversation || (await this.newConversation());
    const send = (c) => this.post(kind === "chat" ? "/conversation" : "/producer/tool-call",
      kind === "chat"
        ? { conversation_id: c, parts: [{ content: body, part_kind: "user-prompt" }], client_context: this.clientContext(), model_name: null, mode: "standard" }
        : { conversation_id: c, part: body, client_context: this.clientContext() });
    let job;
    try { job = await send(conv); } catch (e) {
      if (conv === this.conversation && (e.status === 404 || e.status === 403 || /conversation/i.test(e.message))) { // stale shared conversation
        conv = this.conversation = await this.newConversation(); patchState({ conversation: conv }); job = await send(conv);
      } else throw e;
    }
    const res = await this.raw("GET", `/messages/${job.job_id}/stream`, { search: { last_id: "0" } });
    const result = { conversation: conv, job_id: job.job_id, returns: [], toolCalls: [], text: "", error: null, events: [] };
    for await (const ev of this.sse(res)) {
      if (this.verbose) result.events.push(ev);
      onEvent?.(ev);
      if (ev.event === "error") { result.error = ev.data; break; }
      if (ev.event === "final") break;
      const parts = ev.event === "part" ? (ev.data.status === "final" ? [ev.data.part] : []) : ev.event === "message" ? ev.data.parts || [] : [];
      for (const p of parts) {
        if (p.part_kind === "tool-call") result.toolCalls.push(p);
        else if (p.part_kind === "tool-return") result.returns.push(p);
        else if (p.part_kind === "text") result.text = p.content;
      }
    }
    return result;
  }

  /** Direct (LLM-free) producer tool call. */
  async tool(tool_name, args, { conversation, onEvent } = {}) {
    const r = await this.runJob("tool", { conversation, body: { tool_name, args, part_kind: "tool-call", tool_call_id: crypto.randomUUID() }, onEvent });
    if (r.error) throw new Error(`${tool_name}: ${friendlyError(r.error)}`);
    const ret = r.returns.find((x) => x.tool_name === tool_name) || r.returns[0];
    let content = ret?.content;
    if (typeof content === "string") { try { content = JSON.parse(content); } catch {} }
    return { ...r, content };
  }

  // ---------- operations ----------
  async waitOperation(opId, { timeoutS = 900, onProgress } = {}) {
    const t0 = Date.now();
    for (;;) {
      const s = await this.get(`/audio-create-song-status/${opId}`);
      if (s.status === "complete") return s;
      if (s.error_type || s.error_message || /fail|error/i.test(String(s.status))) throw new Error(`operation ${opId} failed: ${s.error_message || s.error_type || s.status}`);
      onProgress?.(s);
      if ((Date.now() - t0) / 1000 > timeoutS) throw new Error(`timeout waiting for operation ${opId}`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  async clips(ids) { return (await this.post("/clips", { clip_ids: ids })).clips; }

  async zipClips(ids, file) {
    const r = await this.raw("POST", "/batch-download-clip", { body: { clip_ids: ids } });
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return file;
  }
  deleteConversation(id) { return this.json("DELETE", `/conversations/${id}`, { body: {} }); }

  async downloadAudio(clipId, dir = ".", title, params) {
    const r = await this.raw("GET", `/download/audio/${clipId}`, { search: params });
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(dir, { recursive: true });
    const ext = (r.headers.get("content-type") || "").includes("mpeg") ? "mp3" : (r.headers.get("content-type") || "").includes("wav") ? "wav" : "m4a";
    const name = (title || clipId).replace(/[^\w\u4e00-\u9fa5\- ]+/g, "_").trim();
    const file = path.join(dir, `${name}-${clipId.slice(0, 8)}.${ext}`);
    fs.writeFileSync(file, buf);
    return file;
  }
}
