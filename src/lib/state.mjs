// Small persistent CLI state (shared conversation, user defaults) next to the session file.
import fs from "node:fs";
import path from "node:path";
import { DIR } from "./config.mjs";

const FILE = path.join(DIR, "state.json");
export function loadState() { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; } }
export function saveState(s) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}
export function patchState(p) { const s = { ...loadState(), ...p }; saveState(s); return s; }
