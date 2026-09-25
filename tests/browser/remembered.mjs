// Test fixtures only. No production domains, accounts, or access keys are used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
const { chromium, firefox } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../../public/", import.meta.url));
const alpha = "alpha@example.test", beta = "beta@example.test", gamma = "gamma@example.test";
const fixtureKey = "test+&=#key";
let origin, boxes, calls, deletions, creations;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin || "http://localhost");
  const reply = (status, result, error) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(error ? { success: false, error: { message: error } } : { success: true, result }));
  };
  if (url.pathname === "/domains") return reply(200, ["example.test"]);
  if (/^\/(emails|claims)\//.test(url.pathname)) {
    const email = decodeURIComponent(url.pathname.split("/")[2]);
    calls.push({ email, method: req.method });
    const key = (req.headers.authorization || "").slice(7);
    if (req.method === "PUT") {
      if (boxes.has(email) && boxes.get(email) !== key) return reply(409, null, "Claim conflict");
      creations++; boxes.set(email, key); return reply(200, {});
    }
    if (!boxes.has(email)) return reply(404, null, "Address not claimed");
    if (boxes.get(email) !== key) return reply(403, null, "Wrong key");
    if (req.method === "DELETE") { deletions++; boxes.delete(email); return reply(200, { deleted_count: 0 }); }
    return reply(200, []);
  }
  const file = resolve(root, url.pathname === "/" ? "app/index.html" : url.pathname.slice(1));
  if (!file.startsWith(root)) { res.writeHead(404); res.end(); return; }
  try {
    const type = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css" }[extname(file)] || "text/plain";
    res.writeHead(200, { "Content-Type": type }); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
origin = `http://127.0.0.1:${server.address().port}`;
async function count(page, n) { await page.waitForFunction(n => document.querySelectorAll(".remembered-row").length === n, n); }
async function opened(page, email) {
  await page.waitForFunction(email => !document.querySelector("#mailbox").hidden && document.querySelector("#mailbox-address").textContent === email && !document.querySelector("#new-mailbox").disabled, email);
}
async function login(page, email, key, claim = false) {
  await page.locator("#new-mailbox").click();
  await page.locator("#address").fill(email); await page.locator("#key").fill(key);
  if (claim) page.once("dialog", d => d.accept());
  await page.locator(`#connect button[value=${claim ? "claim" : "open"}]`).click();
}
async function recall(page, email) { await page.getByRole("button", { name: `Login to ${email}`, exact: true }).click(); }
try {
  for (const [name, engine] of [["chromium", chromium], ["firefox", firefox]]) {
    boxes = new Map([[alpha, fixtureKey], [beta, fixtureKey]]); calls = []; deletions = 0; creations = 0;
    const profile = await mkdtemp(resolve(tmpdir(), "burnmail-fixture-"));
    let context;
    try {
      context = await engine.launchPersistentContext(profile, { headless: true });
      let page = context.pages()[0];
      await page.goto(origin); await count(page, 0);
      const url = new URL(origin); url.search = new URLSearchParams({ email: alpha, key: fixtureKey });
      await page.goto(url.href); await opened(page, alpha); await count(page, 1);
      assert.equal(creations, 0, "URL login never creates a claim");
      assert.equal(new URL(page.url()).search, "");
      await login(page, beta, fixtureKey); await opened(page, beta); await count(page, 2);
      await page.locator("#close").click();
      await page.reload(); await count(page, 2);
      calls = [];
      await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
      await page.waitForTimeout(250);
      assert.deepEqual(calls, [], "saved mailbox listing performs no login or validation requests");
      await context.close();
      context = await engine.launchPersistentContext(profile, { headless: true });
      page = context.pages()[0]; calls = [];
      await page.goto(origin); await count(page, 2);
      assert.deepEqual(calls, [], "a browser restart does not automatically open remembered mailboxes");
      await recall(page, beta); await opened(page, beta);
      assert.deepEqual(calls, [{ email: beta, method: "GET" }]);
      console.log(`PASS ${name}: two remembered mailboxes survive real browser shutdown/restart; Login checks only the selected mailbox`);
      boxes.delete(alpha);
      calls = []; await page.reload(); await count(page, 2);
      assert.deepEqual(calls, [], "deleted server mailboxes remain listed without background checks");
      await recall(page, alpha);
      await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Saved mailbox could not be opened"));
      await count(page, 2); assert.equal(creations, 0);
      await login(page, beta, "wrong-fixture-key");
      await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Wrong key"));
      await recall(page, beta); await opened(page, beta);
      await login(page, gamma, fixtureKey, true); await opened(page, gamma); await count(page, 3);
      assert.equal(creations, 1);
      page.once("dialog", d => d.dismiss());
      await page.getByRole("button", { name: `Forget ${alpha} on this device`, exact: true }).click();
      await count(page, 3);
      page.once("dialog", d => d.accept());
      await page.getByRole("button", { name: `Forget ${alpha} on this device`, exact: true }).click();
      await count(page, 2); assert.equal(deletions, 0, "Forget never deletes server mailboxes");
      page.once("dialog", d => d.accept(gamma)); await page.locator("#delete-mailbox").click();
      await page.locator("#login").waitFor({ state: "visible" }); await count(page, 1);
      assert.equal(deletions, 1); assert.equal(boxes.has(beta), true); assert.equal(boxes.has(gamma), false);
      await recall(page, beta); await opened(page, beta);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      assert.equal((await context.cookies()).length, 0);
      assert.equal((await page.content()).includes(fixtureKey), false, "remembered keys are not in page markup");
      const other = await context.newPage(); await other.goto(origin); await count(other, 1);
      page.once("dialog", d => d.accept());
      await page.getByRole("button", { name: `Forget ${beta} on this device`, exact: true }).click();
      await count(page, 0); await count(other, 0);
      assert.equal(boxes.has(beta), true); assert.equal(await page.locator("#login").isVisible(), true);
      console.log(`PASS ${name}: stale and wrong-key logins preserve saved entries, new mailbox creation, local Forget, successful deletion cleanup, and cross-tab metadata updates`);
    } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
  }
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
