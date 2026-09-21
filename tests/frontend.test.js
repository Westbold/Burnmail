import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import { accessLink, ApiError, generateKey, messageBody, parseAccessLink, request } from "../public/app/api.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

// These dependency-free tests run with both `bun test` and `node --test tests/frontend.test.js`.
test("API calls use the same origin, a bearer header, and no browser cache", async () => {
  globalThis.fetch = async (path, options) => {
    assert.equal(path, "/emails/recipient%40example.test?limit=20&offset=0");
    assert.equal(options.headers.Authorization, "Bearer fixture-key");
    assert.equal(options.mode, "same-origin");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    return Response.json({ success: true, result: [{ id: "fixture" }] });
  };
  assert.deepEqual(await request("/emails/recipient%40example.test?limit=20&offset=0", { key: "fixture-key" }), [{ id: "fixture" }]);
});

test("domains are fetched publicly without an Authorization header", async () => {
  globalThis.fetch = async (path, options) => {
    assert.equal(path, "/domains");
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ success: true, result: ["example.test"] });
  };
  assert.deepEqual(await request("/domains"), ["example.test"]);
});

test("API wrapper rejects cross-origin URLs before making a request", async () => {
  globalThis.fetch = async () => { throw new Error("fetch must not be called"); };
  for (const path of ["https://example.test/domains", "//example.test/domains", "/\\example.test/domains"]) {
    await assert.rejects(request(path), /same-origin/);
  }
});

test("API status and structured error messages are preserved", async () => {
  globalThis.fetch = async () => Response.json({ success: false, error: { message: "Authorization key does not match claim" } }, { status: 403 });
  await assert.rejects(request("/emails/recipient%40example.test", { key: "wrong" }), (error) => error instanceof ApiError && error.status === 403 && /does not match/.test(error.message));
});

test("an HTML error page does not get treated as a successful API response", async () => {
  globalThis.fetch = async () => new Response("<html>bad gateway</html>", { status: 502 });
  await assert.rejects(request("/domains"), (error) => error.status === 502);
});

test("PUT and DELETE are explicit and forwarded unchanged", async () => {
  const methods = [];
  globalThis.fetch = async (_path, options) => {
    methods.push(options.method);
    return Response.json({ success: true, result: {} });
  };
  await request("/claims/recipient%40example.test", { method: "PUT", key: "fixture" });
  await request("/inbox/fixture", { method: "DELETE", key: "fixture" });
  assert.deepEqual(methods, ["PUT", "DELETE"]);
});

test("new keys are 256-bit hexadecimal values", () => {
  const a = generateKey();
  const b = generateKey();
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.match(b, /^[a-f0-9]{64}$/);
  assert.notEqual(a, b);
});

test("access links keep credentials in the fragment and round-trip reserved characters", () => {
  const email = "recipient+tag@example.test";
  const key = "a&b=+/#? fixture";
  const url = new URL(accessLink("https://mail.example.test", email, key));
  assert.equal(url.pathname, "/app/");
  assert.equal(url.search, "");
  assert.deepEqual(parseAccessLink(url.hash), { email, key });
  assert.equal(parseAccessLink("#email=recipient%40example.test"), null);
  assert.equal(parseAccessLink(""), null);
});

test("email content is text even for HTML-only messages", () => {
  const html = '<img src="https://example.test/pixel" onerror="alert(1)"><script>alert(1)</script>';
  assert.deepEqual(messageBody({ text_content: "plain", html_content: html }), { label: "Plain text", text: "plain" });
  assert.deepEqual(messageBody({ html_content: html }), { label: "HTML source (not rendered)", text: html });
  assert.match(messageBody({}).text, /no stored body/);
});

test("static assets are scoped to /app without taking over API routes or root docs", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.main, "src/index.ts");
  assert.equal(config.assets.directory, "./public");
  assert.equal(config.assets.not_found_handling, "none");
  for (const route of ["/", "/claims/*", "/emails/*", "/inbox/*", "/domains", "/health", "/openapi.json", "/swagger"]) {
    assert.ok(config.assets.run_worker_first.includes(route));
  }
  assert.ok(!config.assets.run_worker_first.includes("/app/*"));
  await assert.rejects(readFile(new URL("../public/index.html", import.meta.url)));
  const html = await readFile(new URL("../public/app/index.html", import.meta.url), "utf8");
  assert.ok(html.includes('src="/app/app.js"'));
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(headers, /^\/app\/\*/);
  assert.match(headers, /connect-src 'self'/);
});
