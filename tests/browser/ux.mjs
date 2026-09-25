// Visible flows and responsive snapshots use local fixtures, never production mailboxes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
const { chromium, firefox } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../../public/", import.meta.url));
const output = process.env.UX_SCREENSHOTS || "/tmp/burnmail-ux-screenshots";
await mkdir(output, { recursive: true });
const headers = {};
for (const line of (await readFile(resolve(root, "_headers"), "utf8")).split("\n")) {
  const match = line.match(/^\s+([^:]+):\s*(.*)$/);
  if (match) headers[match[1]] = match[2];
}
let origin, state;
const fixtureMail = {
  id: "welcome", subject: "Your verification code", from_address: "hello@example.test", received_at: 1753317948,
  html_content: '<div style="font:16px/1.6 system-ui;padding:20px"><h2 style="font-size:22px">You\u2019re nearly there.</h2><p>Enter this code to finish signing in:</p><div style="font-size:32px;letter-spacing:8px;padding:20px;background:#f5f7fb;border-radius:10px">482091</div><p style="color:#777;font-size:13px">This code expires in 10 minutes.</p></div>',
  text_content: "Your verification code is 482091.",
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin || "http://localhost");
  function json(status, result, error) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(error ? { success: false, error: { message: error } } : { success: true, result }));
  }
  if (url.pathname === "/domains") return json(200, ["example.test"]);
  if (/^\/(emails|claims|inbox)\//.test(url.pathname)) {
    const email = decodeURIComponent(url.pathname.split("/")[2]);
    const key = (req.headers.authorization || "").slice(7);
    state.calls.push({ path: url.pathname, method: req.method });
    if (req.method === "PUT") {
      if (state.boxes.has(email)) return json(409, null, "Address already claimed");
      state.boxes.set(email, key); state.puts++;
      return json(200, {});
    }
    if (url.pathname.startsWith("/inbox/")) return json(200, fixtureMail);
    if (!state.boxes.has(email)) return json(404, null, "Address not claimed");
    if (state.boxes.get(email) !== key) return json(403, null, "Wrong key");
    if (req.method === "DELETE") { state.boxes.delete(email); return json(200, {}); }
    if (state.failNextRead) { state.failNextRead = false; return json(503, null, "Temporary read failure"); }
    return json(200, state.hasMail ? [fixtureMail] : []);
  }
  const file = resolve(root, url.pathname === "/" ? "app/index.html" : url.pathname.slice(1));
  if (!file.startsWith(root)) { res.writeHead(404); res.end(); return; }
  try {
    const content = await readFile(file);
    const type = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css" }[extname(file)] || "text/plain";
    res.writeHead(200, { ...headers, "Content-Type": type }); res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
origin = `http://127.0.0.1:${server.address().port}`;
async function ready(page) { await page.waitForFunction(() => document.querySelector("#loading").hidden && !document.querySelector("#create-mailbox").disabled); }
async function opened(page) { await page.waitForFunction(() => !document.querySelector("#mailbox").hidden && !document.querySelector("#close").disabled); }
async function noOverflow(page) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal page overflow"); }
try {
  for (const [name, engine] of [["chromium", chromium], ["firefox", firefox]]) {
    state = { boxes: new Map(), calls: [], puts: 0, hasMail: false, failNextRead: false };
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const errors = [], dialogs = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("dialog", dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
      await page.goto(origin); await ready(page);
      assert.equal(await page.locator("#remembered").isVisible(), false);
      assert.equal(await page.locator("#connect").isVisible(), false);
      assert.equal(await page.locator("#settings").isVisible(), false);
      assert.equal(await page.locator("#storage-alert").isVisible(), false);
      assert((await page.locator("main").innerText()).split(/\s+/).length < 45, "fresh home stays concise");
      await page.screenshot({ path: `${output}/${name}-fresh-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page);
      await page.screenshot({ path: `${output}/${name}-fresh-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator("#create-mailbox").click(); await opened(page);
      assert.equal(state.puts, 1); assert.deepEqual(dialogs, [], "creating a mailbox needs no redundant confirmation");
      const first = await page.locator("#mailbox-address").textContent();
      assert.match(first, /^mail-[a-f0-9]{12}@example\.test$/);
      assert.match(state.boxes.get(first), /^[a-f0-9]{64}$/);
      assert.equal(await page.locator("#home").isVisible(), false);
      assert.equal(await page.locator("#reader").isVisible(), false);
      assert.equal(await page.locator("#pagination").isVisible(), false);
      assert.equal(await page.locator("#messages").textContent(), "No mail yet");
      assert.equal(await page.locator("#delete-mailbox").isVisible(), false, "destruction is secondary, not a competing primary action");
      await page.screenshot({ path: `${output}/${name}-empty-inbox.png`, fullPage: true });
      await page.locator("#close").click();
      assert.equal(await page.locator("#remembered").isVisible(), true);
      assert.equal(await page.locator("#login").isVisible(), false);
      assert.equal(state.puts, 1);
      state.calls = []; await page.reload();
      await page.locator("#remembered").waitFor({ state: "visible" });
      assert.deepEqual(state.calls, [], "saved home performs no mailbox validation");
      const firstButton = page.getByRole("button", { name: `Login to ${first}`, exact: true });
      await firstButton.focus(); await page.keyboard.press("Enter"); await opened(page);
      assert.equal(state.calls.length, 1);
      await page.getByLabel("Mailbox options", { exact: true }).click();
      assert.equal(await page.locator("#delete-mailbox").isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#delete-mailbox").isVisible(), false);
      await page.locator("#settings-open").click();
      assert.equal(await page.locator("#settings").isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#settings").isVisible(), false);
      assert.equal(await page.locator("#settings-open").evaluate(e => e === document.activeElement), true);

      await page.getByLabel("Mailbox options", { exact: true }).click();
      await page.locator("#create-another").click();
      await page.locator("#name").fill("my-inbox");
      state.failNextRead = true;
      await page.locator("#create-mailbox").click();
      await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Mailbox created."));
      assert.equal(await page.locator("#connect").isVisible(), true);
      assert.equal(await page.locator("#create").isVisible(), false);
      assert.equal(await page.locator("#address").inputValue(), "my-inbox@example.test");
      const puts = state.puts;
      await page.locator("#open-mailbox").click(); await opened(page);
      assert.equal(state.puts, puts, "retrying a created mailbox never creates another claim");
      await page.locator("#close").click();
      await page.screenshot({ path: `${output}/${name}-saved-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page);
      await page.screenshot({ path: `${output}/${name}-saved-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole("button", { name: "Login to my-inbox@example.test", exact: true }).click(); await opened(page);
      state.hasMail = true;
      await page.locator("#refresh").click(); await page.locator(".mail-item").waitFor();
      await page.locator(".mail-item").click();
      await page.frameLocator("#html-body").locator("h2").waitFor();
      assert.equal(await page.locator("#body-kind").isVisible(), false);
      await page.screenshot({ path: `${output}/${name}-reading-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page);
      assert.equal(await page.locator(".inbox").isVisible(), false);
      assert.equal(await page.locator("#reader").isVisible(), true);
      await page.screenshot({ path: `${output}/${name}-reading-mobile.png`, fullPage: true });
      await page.locator("#reader-back").click();
      assert.equal(await page.locator(".inbox").isVisible(), true);
      assert.equal(await page.locator("#reader").isVisible(), false);
      assert.equal(await page.locator(".mail-item").evaluate(e => e === document.activeElement), true);
      await page.setViewportSize({ width: 320, height: 700 }); await noOverflow(page);
      assert.equal(errors.length, 0, errors.join("\n"));
      console.log(`PASS ${name}: concise empty/saved homes, one-click creation, keyboard re-entry, settings/menu focus, claim-read recovery, desktop/mobile reading and no overflow`);
      await context.close();
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
