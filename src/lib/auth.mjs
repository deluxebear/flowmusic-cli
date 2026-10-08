// Session persistence, silent token refresh and interactive login.
//
// Strategy: the CLI owns its OWN Supabase session (own refresh-token chain) obtained through a dedicated
// Chrome profile, so refreshing never invalidates the session of your everyday browser.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SITE, DIR } from "./config.mjs";
import { getSessionFromChrome } from "./chrome_auth.mjs";

const SESSION_FILE = path.join(DIR, "session.json");
const PROFILE_DIR = path.join(DIR, "chrome-profile");
const log = (...a) => console.error(...a);

const jwt = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());

export function loadSession() {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); } catch { return null; }
}
export function saveSession(s) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = SESSION_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SESSION_FILE);
}
export function clearSession() { fs.rmSync(SESSION_FILE, { force: true }); fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); }

const normalize = (r) => ({
  access_token: r.access_token,
  refresh_token: r.refresh_token,
  expires_at: r.expires_at ?? Math.floor(Date.now() / 1000) + (r.expires_in || 3600),
  user_id: r.user?.id ?? jwt(r.access_token).sub,
  email: r.user?.email ?? jwt(r.access_token).email,
});

/** Exchange the refresh token for a fresh access token (refresh tokens rotate: always persist the new one). */
export async function refresh(sess) {
  if (!sess?.refresh_token) throw new Error("no refresh token stored");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: sess.refresh_token }),
  });
  if (!r.ok) throw new Error(`refresh failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const n = normalize(await r.json());
  saveSession(n);
  return n;
}

function chromeBinary() {
  for (const b of [process.env.CHROME_BIN, "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"])
    if (b && fs.existsSync(b)) return b;
  throw new Error("Chrome/Chromium not found (set CHROME_BIN)");
}

/**
 * Two-phase login (Google refuses sign-in in browsers started with a remote-debugging port):
 *  1. open a plain Chrome window on a dedicated profile; the user signs in and closes the window;
 *  2. reopen that profile headless with a debug port, read the session cookie, then quit.
 */
export async function login({ timeoutS = 600 } = {}) {
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); // fresh profile => fresh, independent session
  fs.mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
  const bin = chromeBinary();
  const base = [`--user-data-dir=${PROFILE_DIR}`, "--no-first-run", "--no-default-browser-check"];

  const win = spawn(bin, [...base, "--ozone-platform-hint=auto", `${SITE}/`], { stdio: "ignore" });
  log(`A Chrome window opened. Sign in to ${SITE}, wait until you see your library/home page, then CLOSE that window.`);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => { win.kill("SIGTERM"); reject(new Error("login timed out")); }, timeoutS * 1000);
    win.on("exit", () => { clearTimeout(t); resolve(); });
  });
  await new Promise((r) => setTimeout(r, 1500)); // let Chrome flush cookies to disk

  const portFile = path.join(PROFILE_DIR, "DevToolsActivePort");
  fs.rmSync(portFile, { force: true });
  const hl = spawn(bin, [...base, "--headless=new", "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  let result = null, lastErr;
  try {
    for (let i = 0; i < 20 && !result; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!fs.existsSync(portFile)) continue;
      try { result = await getSessionFromChrome(portFile); } catch (e) { lastErr = e; if (e.notLoggedIn) break; }
    }
  } finally {
    hl.kill("SIGTERM"); // only the CLI uses this refresh-token chain from now on
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!result) throw new Error(lastErr?.notLoggedIn ? "No login found in that window - did you finish signing in before closing it? Run `flowmusic login` again." : `could not read session: ${lastErr?.message || "headless Chrome did not start"}`);
  const sess = normalize(result);
  saveSession(sess);
  log(`Logged in as ${sess.email || sess.user_id}. Session saved to ${SESSION_FILE}`);
  return sess;
}

/**
 * Pure-CLI login (no Chrome automation): Supabase OAuth with PKCE in your normal default browser and a
 * temporary loopback server. Works only if the site's Supabase project allow-lists loopback redirect URLs;
 * otherwise Supabase redirects to the website and this times out (use plain `login` instead).
 */
export async function loginWithBrowser({ timeoutS = 240, port = 0 } = {}) {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  let resolveCode;
  const codeP = new Promise((r) => (resolveCode = r));
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
    const code = u.searchParams.get("code"), err = u.searchParams.get("error_description") || u.searchParams.get("error");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<h3>${code ? "Login complete - you can close this tab." : "Login failed: " + (err || "no code")}</h3>`);
    resolveCode({ code, err });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=s256`;
  log(`Opening your browser to sign in... If nothing opens, visit:\n${url}\n`);
  for (const opener of ["xdg-open", "open", "wslview"]) { if (spawnSync("which", [opener]).status === 0) { spawn(opener, [url], { stdio: "ignore", detached: true }).unref(); break; } }
  try {
    const got = await Promise.race([codeP, new Promise((_, rej) => setTimeout(() => rej(new Error("browser login timed out (loopback redirect may not be allowed by this site; use `flowmusic login`)")), timeoutS * 1000))]);
    if (!got.code) throw new Error(got.err || "no authorization code returned");
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
      method: "POST", headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ auth_code: got.code, code_verifier: verifier }),
    });
    if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const sess = normalize(await r.json());
    saveSession(sess);
    log(`Logged in as ${sess.email || sess.user_id}. Session saved to ${SESSION_FILE}`);
    return sess;
  } finally { server.close(); }
}

/** Import only the short-lived access token from your already-running main Chrome (no refresh token is stored). */
export async function importFromChrome() {
  const s = normalize(await getSessionFromChrome());
  s.refresh_token = undefined; // never rotate the main browser's refresh token
  saveSession(s);
  log(`Imported 1-hour token for ${s.email || s.user_id} from running Chrome (no auto-refresh).`);
  return s;
}

/** Returns a valid access token: env -> stored (refreshed when near expiry) -> interactive login. */
export async function getSession({ force = false, interactive = true } = {}) {
  if (process.env.FLOWMUSIC_TOKEN) return { access_token: process.env.FLOWMUSIC_TOKEN, user_id: jwt(process.env.FLOWMUSIC_TOKEN).sub, env: true };
  let s = loadSession();
  if (s) {
    const fresh = s.expires_at - 90 > Date.now() / 1000;
    if (fresh && !force) return s;
    try { return await refresh(s); } catch (e) { log(`(${e.message})`); s = null; }
  }
  if (!interactive) throw new Error("not logged in: run `flowmusic login`");
  return await loginWithBrowser();
}
