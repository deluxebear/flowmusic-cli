// Pull the Supabase session (access/refresh token) of the logged-in flowmusic.app tab from local Chrome via CDP.
import fs from "node:fs";

export async function getSessionFromChrome(portFile) {
  const home = process.env.HOME;
  const cands = portFile ? [portFile] : [`${home}/.config/google-chrome/DevToolsActivePort`, `${home}/.config/chromium/DevToolsActivePort`];
  const pf = cands.find((p) => fs.existsSync(p));
  if (!pf) throw new Error("DevToolsActivePort not found: start Chrome with remote debugging enabled");
  const [port, path] = fs.readFileSync(pf, "utf8").split("\n");
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => (ws.onopen = r));
  const { cookies } = await send("Storage.getCookies");
  ws.close();
  const mine = cookies.filter((c) => c.domain.includes("flowmusic.app") && c.name.startsWith("sb-sb-auth-token"));
  if (!mine.length) { const e = new Error("Not logged in to flowmusic.app in Chrome"); e.notLoggedIn = true; throw e; }
  mine.sort((a, b) => a.name.localeCompare(b.name));
  let raw = mine.map((c) => c.value).join("");
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64").toString("utf8");
  const s = JSON.parse(raw);
  if (!s.access_token || s.user?.is_anonymous) { const e = new Error("Not logged in (no user session yet)"); e.notLoggedIn = true; throw e; }
  return { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, user_id: s.user?.id };
}
