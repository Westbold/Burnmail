// Real-browser integration checks using fixture inboxes, never production mailboxes.
// Run after installing Playwright's Chromium/Firefox browsers:
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/webmail.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";

const { chromium, firefox } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../../public/", import.meta.url));
const headers = {};
for (const line of (await readFile(resolve(root, "_headers"), "utf8")).split("\n")) {
  const match = line.match(/^\s+([^:]+):\s*(.*)$/);
  if (match) headers[match[1]] = match[2];
}
const address = "reader+fixture@example.test";
const key = "fixture+&=#key";
let origin;
let state;
function resetState() {
  state = { exists: true, deleteCount: 0, putCount: 0, failDelete: false, deleteDelay: 0, readDelay: 0, removedMessages: 0 };
}
const remote = "https://remote.example.test";
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6X0AAAAASUVORK5CYII=";
function message(id) {
  const base = { id, from_address: "sender@example.test", to_address: address, received_at: 1753317948 };
  if (id === "plain") return { ...base, subject: "Plain fixture", html_content: null, text_content: "Literal <b>plain</b> & safe" };
  if (id === "html-only") return { ...base, subject: "HTML-only fixture", html_content: "<h2>HTML-only rendering works</h2><table><tr><td>Real table</td></tr></table>", text_content: null };
  return {
    ...base, subject: "Formatted fixture", text_content: "Plain alternative",
    html_content: `<!doctype html><html><head>
      <meta http-equiv="refresh" content="0;url=${remote}/refresh">
      <base href="${remote}/"><link rel="stylesheet" href="${remote}/linked.css">
      <style>@import url('${remote}/imported.css'); .headline{color:rgb(20,80,160);font-size:24px}.banner{background-image:url('${remote}/background.png')}</style>
      </head><body>
      <h1 class="headline" id="greeting">Formatted email</h1>
      <table style="background-color:rgb(240,245,250)"><tr><td>Invoice</td><td><b>$42.00</b></td></tr></table>
      <p class="banner">Styled banner</p><p><a id="safe-link" href="${origin}/safe-link" target="_top" ping="${remote}/ping">Open website</a></p>
      <a id="bad-link" href="javascript:parent.__emailScriptRan=true">Bad link</a>
      <img id="remote-image" src="${remote}/image.png" onerror="parent.__emailScriptRan=true" alt="Remote logo">
      <img id="data-image" src="data:image/png;base64,${pixel}" alt="Embedded pixel">
      <img src="/claims/secret" onerror="alert(1)">
      <script>parent.__emailScriptRan=true;fetch('${remote}/script')</script>
      <form action="${remote}/form"><input autofocus onfocus="alert(1)"><button>Submit</button></form>
      <iframe src="${remote}/frame"></iframe><object data="${remote}/object"></object>
      <svg><a xlink:href="javascript:alert(1)">svg</a></svg>
      </body></html>`,
  };
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin || "http://localhost");
  const json = (status, result, error) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(error ? { success: false, error: { message: error } } : { success: true, result }));
  };
  if (url.pathname === "/domains") return json(200, ["example.test"]);
  if (/^\/(emails|inbox|claims)\//.test(url.pathname)) {
    if (req.headers.authorization !== `Bearer ${key}`) return json(403, null, "Wrong key");
    if (!state.exists) return json(404, null, "Address not claimed");
    if (req.method === "PUT") { state.putCount += 1; return json(200, {}); }
    if (url.pathname.startsWith("/claims/") && req.method === "DELETE") {
      assert.equal(decodeURIComponent(url.pathname.slice(8)), address);
      state.deleteCount += 1;
      if (state.deleteDelay) await new Promise(r => setTimeout(r, state.deleteDelay));
      if (state.failDelete) return json(403, null, "Deletion denied by test API");
      state.exists = false;
      state.removedMessages = 3;
      return json(200, { message: "Claim released successfully", deleted_count: 3 });
    }
    if (url.pathname.startsWith("/inbox/")) {
      if (state.readDelay) await new Promise(r => setTimeout(r, state.readDelay));
      return json(200, message(decodeURIComponent(url.pathname.slice(7))));
    }
    return json(200, ["formatted", "html-only", "plain"].map(id => { const {html_content, text_content, ...summary} = message(id); return summary; }));
  }
  if (url.pathname === "/safe-link") { res.end("<!doctype html><title>External link fixture</title><h1>Safe link opened</h1>"); return; }
  const name = url.pathname === "/" ? "app/index.html" : url.pathname.slice(1);
  const file = resolve(root, name);
  if (!file.startsWith(root)) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(file);
    const type = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".mjs": "application/javascript" }[extname(file)] || "text/plain";
    res.writeHead(200, { ...headers, "Content-Type": type });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
origin = `http://127.0.0.1:${server.address().port}`;

try {
  for (const [name, engine] of [["chromium", chromium], ["firefox", firefox]]) {
    resetState();
    const browser = await engine.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const remoteRequests = [];
      const pageErrors = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      await context.route(`${remote}/**`, async route => {
        remoteRequests.push(route.request().url());
        await route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(pixel, "base64") });
      });
      const link = new URL(origin);
      link.search = new URLSearchParams({ email: address, key }).toString();
      await page.goto(link.href);
      await page.locator("#mailbox").waitFor({ state: "visible" });
      assert.equal(new URL(page.url()).search, "");
      assert.equal(state.putCount, 0, "URL login must never create a claim");
      await page.locator(".mail-item").filter({ hasText: "Formatted fixture" }).click();
      const frame = page.frameLocator("#html-body");
      await frame.locator("#greeting").waitFor();
      assert.equal(await frame.locator("#greeting").textContent(), "Formatted email");
      assert.equal(await frame.locator("#greeting").evaluate(e => getComputedStyle(e).color), "rgb(20, 80, 160)");
      assert.equal(await frame.locator("#greeting").evaluate(e => getComputedStyle(e).fontSize), "24px");
      assert.equal(await frame.locator("table").evaluate(e => getComputedStyle(e).backgroundColor), "rgb(240, 245, 250)");
      assert.equal(await frame.locator("td").count(), 2);
      assert.equal(await frame.locator("script, iframe, object, form, input, svg, meta[http-equiv=refresh], link, base").count(), 0);
      assert.equal(await frame.locator("[onerror], [onfocus], [ping], [srcset]").count(), 0);
      assert.equal(await frame.locator("#bad-link").getAttribute("href"), null);
      assert.equal(await frame.locator("body").evaluate(() => { try { void parent.document.body; return true; } catch { return false; } }), false, "email must have an opaque origin");
      assert.equal(await page.evaluate(() => Boolean(window.__emailScriptRan)), false);
      assert.equal(await frame.locator("body").evaluate(() => Boolean(window.__emailScriptRan)), false);
      await page.waitForTimeout(250);
      assert.equal(remoteRequests.length, 0, "no network request while remote images are disabled, including during sanitization");
      assert.equal(await frame.locator("#data-image").evaluate(e => e.complete && e.naturalWidth > 0), true);
      const popupPromise = page.waitForEvent("popup");
      await frame.locator("#safe-link").click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(await popup.evaluate(() => window.opener === null), true);
      await popup.close();
      await page.locator("#load-images").click();
      await page.waitForFunction(() => document.querySelector("#html-body").srcdoc.includes("img-src data: https: http:"));
      await frame.locator("#remote-image").evaluate(e => e.decode());
      assert(remoteRequests.some(url => url.endsWith("image.png")));
      assert(!remoteRequests.some(url => /\.css|\/script|\/refresh|\/frame|\/object/.test(url)));
      await page.locator("#view-text").click();
      assert.equal(await page.locator("#body").textContent(), "Plain alternative");
      assert.equal(await page.locator("#html-body").isVisible(), false);
      await page.locator(".mail-item").filter({ hasText: "HTML-only fixture" }).click();
      await frame.locator("h2").waitFor();
      assert.equal(await frame.locator("h2").textContent(), "HTML-only rendering works");
      assert.equal(await page.locator("#load-images").textContent(), "Load remote images");
      await page.locator(".mail-item").filter({ hasText: "Plain fixture" }).click();
      await page.locator("#body").waitFor({ state: "visible" });
      assert.equal(await page.locator("#body").textContent(), "Literal <b>plain</b> & safe");
      assert.equal(await page.locator("#body b").count(), 0);
      assert.equal(await page.locator("#html-body").getAttribute("srcdoc"), null);
      console.log(`PASS ${name}: HTML layouts/styles/tables, script/form/frame isolation, links, image consent, text fallback, URL login`);

      page.once("dialog", dialog => dialog.dismiss());
      await page.locator("#delete-mailbox").click();
      assert.equal(state.deleteCount, 0);
      page.once("dialog", dialog => dialog.accept("wrong@example.test"));
      await page.locator("#delete-mailbox").click();
      assert.equal(state.deleteCount, 0);
      assert.equal(await page.locator("#mailbox").isVisible(), true);
      state.failDelete = true;
      page.once("dialog", dialog => dialog.accept(address));
      await page.locator("#delete-mailbox").click();
      await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Deletion denied"));
      assert.equal(state.exists, true);
      assert.equal(await page.locator("#mailbox").isVisible(), true);
      assert.equal(await page.locator("#delete-mailbox").isEnabled(), true);
      state.failDelete = false;
      state.deleteDelay = 250;
      state.readDelay = 600;
      await page.locator(".mail-item").filter({ hasText: "Formatted fixture" }).click();
      const count = state.deleteCount;
      page.once("dialog", dialog => { assert(dialog.message().includes("ALL stored messages")); return dialog.accept(address); });
      await page.locator("#delete-mailbox").click();
      assert.equal(await page.locator("#close").isEnabled(), false);
      assert.equal(await page.locator("#delete-mailbox").isEnabled(), false);
      await page.locator("#delete-mailbox").evaluate(e => e.click());
      await page.locator("#login").waitFor({ state: "visible" });
      await page.waitForTimeout(650);
      assert.equal(state.deleteCount, count + 1, "no duplicate DELETE");
      assert.equal(state.exists, false);
      assert.equal(state.removedMessages, 3);
      assert.equal(await page.locator("#mailbox").isVisible(), false);
      assert.equal(await page.locator("#mailbox-address").textContent(), "");
      assert.equal(await page.locator("#key").inputValue(), "");
      assert.equal(await page.locator("#address").inputValue(), "");
      assert.equal(await page.locator("#messages").textContent(), "");
      assert.equal(await page.locator("#html-body").getAttribute("srcdoc"), null);
      assert.match(await page.locator("#status").textContent(), /permanently deleted/);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await page.goto(link.href);
      await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Address not claimed"));
      assert.equal(state.putCount, 0, "a deleted inbox link must not silently reclaim it");
      assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
      console.log(`PASS ${name}: cancel/mismatched confirmation, failed DELETE preserves inbox, pending controls, single DELETE, stale read cancellation, credentials cleared, deleted link denied`);
      await context.close();
    } finally { await browser.close(); }
  }
} finally { await new Promise(r => server.close(r)); }
