import test from "node:test";
import assert from "node:assert/strict";
import { uuid5, lyricsId } from "../src/lib/client.mjs";
import { parseArgs, clipIds, endMarker, composeSong, unescapeNewlines, parseBatchLines, pool, parseSSE, friendlyError } from "../src/lib/util.mjs";

test("uuid5 matches RFC 4122 reference vector", () => {
  // uuid.uuid5(uuid.NAMESPACE_DNS, "python.org")
  assert.equal(uuid5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"), "886313e1-3b8a-5372-9b90-0c9aee199e5d");
});
test("lyricsId: empty / instrumental => empty id, text => stable v5", () => {
  assert.equal(lyricsId(""), "");
  assert.equal(lyricsId("[Instrumental]"), "");
  assert.equal(lyricsId("hello"), lyricsId("hello"));
  assert.match(lyricsId("hello"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test("parseArgs", () => {
  const o = parseArgs(["gen", "a", "b", "--lyrics", "x", "--region", "1-2", "--region", "3-4", "-o", "dir", "--wav", "-n", "5"]);
  assert.deepEqual(o._, ["gen", "a", "b"]);
  assert.equal(o.lyrics, "x"); assert.deepEqual(o.region, ["1-2", "3-4"]); assert.equal(o.out, "dir"); assert.equal(o.wav, true); assert.equal(o.n, "5");
});
test("clipIds handles every tool result shape", () => {
  assert.deepEqual(clipIds({ clip_id: "a", clip_id_b: "b" }), ["a", "b"]);
  assert.deepEqual(clipIds({ clip_outputs: [{ clip_id: "x" }] }), ["x"]);
  assert.deepEqual(clipIds({ stems: [{ clip_id: "s1" }, { clip_id: "s2" }] }), ["s1", "s2"]);
  assert.deepEqual(clipIds({ result_clip_id: "r" }), ["r"]);
  assert.deepEqual(clipIds(null), []);
});
test("endMarker / composeSong mimic the web form", () => {
  assert.equal(endMarker(90), "[End - 1:30]");
  assert.equal(endMarker(125), "[End - 2:05]");
  assert.deepEqual(composeSong({ prompt: "pop", instrumental: true, length: 120, bpm: 100 }), { sound_prompt: "pop, 100 bpm", lyricsText: "[Instrumental]\n[End - 2:00]" });
  assert.deepEqual(composeSong({ prompt: "pop", lyrics: "la" }), { sound_prompt: "pop", lyricsText: "la" });
});
test("unescapeNewlines", () => assert.equal(unescapeNewlines("a\\nb"), "a\nb"));
test("parseBatchLines", () => {
  assert.deepEqual(parseBatchLines("# c\n\nlofi\n{\"prompt\":\"x\",\"title\":\"T\"}\n"), [{ prompt: "lofi" }, { prompt: "x", title: "T" }]);
});
test("pool preserves order and isolates failures", async () => {
  const r = await pool([1, 2, 3, 4], 2, async (x) => { if (x === 3) throw new Error("boom"); return x * 2; });
  assert.deepEqual(r.map((x) => x.ok), [true, true, false, true]);
  assert.deepEqual(r.filter((x) => x.ok).map((x) => x.value), [2, 4, 8]);
});
test("parseSSE handles CRLF, split chunks and multi-line data", async () => {
  const enc = new TextEncoder();
  async function* body() { yield enc.encode("id: 1\r\nevent: part\r\ndata: {\"a\":"); yield enc.encode("1}\r\n\r\n: ping\r\n\r\nevent: final\r\ndata: {}\r\n\r\n"); }
  const evs = []; for await (const e of parseSSE(body())) evs.push(e);
  assert.deepEqual(evs, [{ event: "part", data: { a: 1 } }, { event: "final", data: {} }]);
});
test("friendlyError", () => {
  assert.match(friendlyError({ type: "moderation", message: "bad" }), /moderation/);
  assert.match(friendlyError({ type: "rate_limit" }), /Rate limited/);
});
