import { test } from "node:test";
import assert from "node:assert/strict";
import { Flow, BASE } from "../src/lib/client.mjs";

const jwt = `x.${Buffer.from(JSON.stringify({ sub: "user-1" })).toString("base64url")}.y`;
const reply = (status, body = {}, headers = {}) => new Response(JSON.stringify(body), { status, headers });

function mockFetch(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: new URL(url), init }); return handler(calls.length, url, init); };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test("get sends bearer token and skips null query params", async () => {
  const m = mockFetch(() => reply(200, { ok: 1 }));
  try {
    const r = await new Flow({ token: jwt }).get("/models", { limit: 5, offset: null, ids: ["a", "b"] });
    assert.deepEqual(r, { ok: 1 });
    const { url, init } = m.calls[0];
    assert.equal(url.origin + url.pathname, BASE + "/models");
    assert.equal(url.searchParams.get("limit"), "5");
    assert.equal(url.searchParams.get("ids"), "a,b");
    assert.equal(url.searchParams.has("offset"), false);
    assert.equal(init.headers.authorization, `Bearer ${jwt}`);
  } finally { m.restore(); }
});

test("post sends a JSON body with content-type", async () => {
  const m = mockFetch(() => reply(200, {}));
  try {
    await new Flow({ token: jwt }).post("/clips/delete", { clip_ids: ["c1"] });
    const { init } = m.calls[0];
    assert.equal(init.method, "POST");
    assert.equal(init.headers["content-type"], "application/json");
    assert.equal(init.body, JSON.stringify({ clip_ids: ["c1"] }));
  } finally { m.restore(); }
});

test("non-retryable HTTP errors carry status and body", async () => {
  const m = mockFetch(() => reply(404, { error: "nope" }));
  try {
    await assert.rejects(new Flow({ token: jwt }).get("/clips/x"), (e) => e.status === 404 && /nope/.test(e.message));
    assert.equal(m.calls.length, 1);
  } finally { m.restore(); }
});

test("429 is retried honouring retry-after", async () => {
  const m = mockFetch((n) => (n === 1 ? reply(429, {}, { "retry-after": "1" }) : reply(200, { ok: 1 })));
  try {
    assert.deepEqual(await new Flow({ token: jwt }).get("/models"), { ok: 1 });
    assert.equal(m.calls.length, 2);
  } finally { m.restore(); }
});

test("POST is not retried after a 500", async () => {
  const m = mockFetch(() => reply(500, { error: "boom" }));
  try {
    await assert.rejects(new Flow({ token: jwt }).post("/clips/delete", {}), (e) => e.status === 500);
    assert.equal(m.calls.length, 1);
  } finally { m.restore(); }
});
