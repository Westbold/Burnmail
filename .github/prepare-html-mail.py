"""One-time preparation; removed from the published source tree after validation."""
from pathlib import Path
import hashlib
import io
import urllib.request
import zipfile


def replace(name, old, new):
    path = Path(name)
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f"Expected source changed: {name}")
    path.write_text(text.replace(old, new))


# Vendor a verified release, not a mutable CDN import. Preserve the upstream license.
url = "https://github.com/cure53/DOMPurify/releases/download/3.4.16/3.4.16.zip"
with urllib.request.urlopen(url, timeout=60) as response:
    archive = response.read()
assert hashlib.sha256(archive).hexdigest() == "35d4392fbd91509174b0583fc68500dd8d4b179ce2c1271a37651dd616cccc4c"
with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
    names = bundle.namelist()
    module = next(name for name in names if name.endswith("dist/purify.es.mjs"))
    license_name = next(name for name in names if name.endswith("/LICENSE") or name == "LICENSE")
    vendor = Path("public/app/vendor")
    vendor.mkdir(exist_ok=True)
    code = bundle.read(module)
    (vendor / "purify.es.mjs").write_bytes(code)
    (vendor / "LICENSE.DOMPurify").write_bytes(bundle.read(license_name))
    (vendor / "README.md").write_text(
        "# DOMPurify\n\nDOMPurify 3.4.16, vendored unchanged from the official release.\n"
        "Source: https://github.com/cure53/DOMPurify/releases/tag/3.4.16\n"
        "Archive SHA-256: `35d4392fbd91509174b0583fc68500dd8d4b179ce2c1271a37651dd616cccc4c`\n"
        f"Module SHA-256: `{hashlib.sha256(code).hexdigest()}`\n\n"
        "License: Apache-2.0 OR MPL-2.0; see LICENSE.DOMPurify.\n"
        "Keep this sanitizer updated. It runs only in the browser and is not a Worker dependency.\n"
    )

replace("public/app/index.html", '<button id="close" type="button" class="secondary">Close inbox</button>', '<button id="close" type="button" class="secondary">Close inbox</button>\n          <button id="delete-mailbox" type="button" class="danger">Delete mailbox</button>')
replace("public/app/index.html", 'Closing does not release the claim.', 'Closing does not release the claim. Delete mailbox permanently removes all messages and releases the address.')
replace("public/app/index.html", 'id="delete" type="button" class="danger">Delete</button>', 'id="delete" type="button" class="danger">Delete message</button>')
replace("public/app/index.html", '            <pre id="body"></pre>', '''            <div id="body-controls" class="actions body-controls" hidden>
              <button id="view-html" type="button" class="secondary" aria-pressed="true">HTML</button>
              <button id="view-text" type="button" class="secondary" aria-pressed="false">Text</button>
              <button id="load-images" type="button" class="secondary">Load remote images</button>
            </div>
            <p id="image-warning" class="hint" hidden>Remote images are blocked for privacy. Loading them may tell the sender that you opened this message.</p>
            <iframe id="html-body" title="HTML email content" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" src="about:blank" hidden></iframe>
            <pre id="body"></pre>''')
replace("public/_headers", "style-src 'self';", "style-src 'self' 'unsafe-inline';")
replace("public/_headers", "img-src 'self';", "img-src 'self' data: https: http:; frame-src 'self';")
# The opaque srcdoc inherits parent CSP. Styles/images are further restricted by its own CSP.
with Path("public/app/styles.css").open("a") as output:
    output.write('''
.body-controls { margin: 16px 0 10px; }
.body-controls [aria-pressed="true"] { color: #2456c7; border-color: #2456c7; background: #edf3ff; }
#html-body { display: block; width: 100%; height: 65vh; min-height: 380px; border: 1px solid #e2e7ef; border-radius: 8px; background: #fff; }
#image-warning { margin: 8px 0 12px; }
@media (max-width: 760px) { #html-body { height: 65vh; min-height: 320px; } .reader { padding: 16px; } }
''')

replace("public/app/app.js", '// Clear URL credentials', 'import { emailDocument } from "./html-email.js";\n\n// Clear URL credentials')
replace("public/app/app.js", 'let deleting = false;', 'let deleting = false;\nlet currentMessage = null;\nlet bodyMode = "html";\nlet remoteImages = false;')
replace("public/app/app.js", 'function clearReader() {', '''function clearReader() {
  currentMessage = null;
  bodyMode = "html";
  remoteImages = false;
  byId("html-body").hidden = true;
  byId("html-body").removeAttribute("srcdoc");
  byId("body-controls").hidden = true;
  byId("image-warning").hidden = true;
  byId("body").hidden = false;''')
replace("public/app/app.js", '  byId("delete").disabled = listBusy || deleting;', '''  byId("delete").disabled = listBusy || deleting;
  byId("delete-mailbox").disabled = listBusy || deleting;
  byId("close").disabled = deleting;
  byId("copy-address").disabled = deleting;
  byId("copy-link").disabled = deleting;''')
replace("public/app/app.js", '    const body = messageBody(email);\n    byId("body-kind").textContent = body.label;\n    byId("body").textContent = body.text;', '    currentMessage = email;\n    renderBody();')
replace("public/app/app.js", 'function date(seconds) {', '''function renderBody() {
  if (!currentMessage) return;
  const hasHtml = typeof currentMessage.html_content === "string" && currentMessage.html_content.trim().length > 0;
  const showHtml = hasHtml && bodyMode === "html";
  byId("body-controls").hidden = !hasHtml;
  byId("view-html").setAttribute("aria-pressed", String(showHtml));
  byId("view-text").setAttribute("aria-pressed", String(!showHtml));
  byId("load-images").hidden = !showHtml;
  byId("load-images").textContent = remoteImages ? "Block remote images" : "Load remote images";
  byId("image-warning").hidden = !showHtml;
  byId("image-warning").textContent = remoteImages
    ? "Remote images are enabled for this message only. They may reveal that you opened it."
    : "Remote images are blocked for privacy. Loading them may tell the sender that you opened this message.";
  byId("html-body").hidden = true;
  byId("body").hidden = showHtml;
  if (showHtml) {
    try {
      byId("html-body").srcdoc = emailDocument(currentMessage.html_content, remoteImages);
      byId("html-body").hidden = false;
      byId("body-kind").textContent = "HTML email";
    } catch {
      byId("body").hidden = false;
      byId("body").textContent = messageBody(currentMessage).text;
      byId("body-kind").textContent = "HTML could not be displayed safely. Showing the text alternative.";
    }
  } else {
    byId("html-body").removeAttribute("srcdoc");
    const body = messageBody(currentMessage);
    byId("body-kind").textContent = body.label;
    byId("body").textContent = body.text;
  }
}

byId("view-html").addEventListener("click", () => { bodyMode = "html"; renderBody(); });
byId("view-text").addEventListener("click", () => { bodyMode = "text"; renderBody(); });
byId("load-images").addEventListener("click", () => { remoteImages = !remoteImages; renderBody(); });

function date(seconds) {''')
replace("public/app/app.js", 'byId("close").addEventListener("click", () => {', 'function closeMailbox(message) {')
replace("public/app/app.js", '  status("Closed. The mailbox claim and its messages were not deleted.");\n});', '''  byId("key").value = "";
  byId("delete-mailbox").disabled = false;
  byId("close").disabled = false;
  byId("copy-address").disabled = false;
  byId("copy-link").disabled = false;
  status(message);
}

byId("close").addEventListener("click", () => {
  if (!deleting) closeMailbox("Closed. The mailbox claim and its messages were not deleted.");
});

byId("delete-mailbox").addEventListener("click", async () => {
  if (!session || deleting || listBusy) return;
  const active = session;
  const confirmation = prompt(
    `Permanently delete ${active.email} and ALL stored messages? This cannot be undone. ` +
    "The claim will be released and the address can be claimed again. " +
    "Type the full mailbox address to confirm:",
  );
  if (confirmation !== active.email) {
    if (confirmation !== null) status("Mailbox not deleted: the confirmation address did not match.", true);
    return;
  }
  deleting = true;
  selectionVersion += 1;
  renderList();
  status("Deleting mailbox and all stored messages...");
  try {
    await request(`/claims/${encodeURIComponent(active.email)}`, { ...active, method: "DELETE" });
    if (session !== active) return;
    closeMailbox("Mailbox permanently deleted. All stored messages were removed and the address was released.");
    byId("address").value = "";
  } catch (error) {
    if (session === active) report(error);
  } finally {
    if (session === active) {
      deleting = false;
      renderList();
    }
  }
});''')
replace("public/app/api.js", '// Deliberately return text, never trusted markup. The UI uses textContent only.', '// Plain-text alternative only. HTML is handled separately by the isolated email renderer.')
replace("tests/frontend.test.js", 'email content is text even for HTML-only messages', 'the explicit text alternative never returns trusted markup')

# Plain-text messages are also stored as HTML; escape them rather than interpreting tags.
replace("src/utils/mail.ts", 'return `<pre style="font-family: sans-serif; white-space: pre-wrap;">${text}</pre>`;', '''const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return `<pre style="font-family: sans-serif; white-space: pre-wrap;">${escaped}</pre>`;''')
Path("src/utils/mail.test.ts").write_text('''import { expect, test } from "bun:test";
import { processEmailContent } from "./mail";

test("plain-text mail is escaped in its generated HTML alternative", () => {
  const text = '<img src="https://example.test/pixel"> & <b>not markup</b>';
  const result = processEmailContent(null, text);
  expect(result.textContent).toBe(text);
  expect(result.htmlContent).toContain("&lt;img");
  expect(result.htmlContent).toContain("&amp;");
  expect(result.htmlContent).not.toContain("<img");
});

test("HTML layouts and text alternatives remain available", () => {
  const html = '<table><tr><td style="color: red">Hello</td></tr></table>';
  const result = processEmailContent(html, "Hello");
  expect(result.htmlContent).toBe(html);
  expect(result.textContent).toBe("Hello");
});
''')

# Expand the existing live webmail probe without publishing any deployment hostname.
replace("scripts/webmail-smoke.ts", 'check(html.includes(\'href="/api-docs"\'), "docs link");', '''check(html.includes('href="/api-docs"'), "docs link");
	check(html.includes('id="html-body"') && html.includes('id="delete-mailbox"'), "HTML reader and mailbox deletion controls");
	const policy = ui.headers.get("content-security-policy") ?? "";
	check(policy.includes("frame-src 'self'") && !policy.includes("script-src 'self' 'unsafe-inline'"), "HTML isolation policy");''')
replace("scripts/webmail-smoke.ts", '["/app/app.js", "/app/api.js", "/app/styles.css"]', '["/app/app.js", "/app/api.js", "/app/styles.css", "/app/html-email.js", "/app/vendor/purify.es.mjs"]')

# Replace outdated security guidance rather than leaving conflicting operator instructions.
path = Path("documentation/06_frontend.md")
text = path.read_text()
text = text.replace('Text and HTML-source bodies are\nrendered with `textContent`, not executable markup. Deletion asks for confirmation.', '''HTML is displayed by default when available, including inline styling, embedded styles,
tables, and links. A Text button keeps the plain-text alternative available. DOMPurify
sanitizes sender markup before it enters an opaque-origin sandboxed iframe. Scripts,
forms, nested frames, plugins, and automatic navigation are blocked. Sender CSS cannot
style the app or access the bearer key. HTTPS/HTTP links open separately with no opener
or referrer. Remote images (including CSS background images) are blocked until the reader
chooses Load remote images for the current message. Embedded raster data images work;
CID attachment images remain unavailable because attachments are not stored. The per-message
image preference resets when switching mail. CSP permits inline styles in the sandbox;
application scripts remain same-origin only and no inline JavaScript is allowed.

Delete message removes only the selected message. Delete mailbox requires typing the
full mailbox address, calls the authenticated claim-deletion endpoint, permanently removes
its stored messages, and releases the claim. Success clears the reader, aborts pending
requests, clears in-memory credentials, and returns to login. A cancellation or failed
authorized request does not silently close the inbox. Other controls/polling are paused
during deletion. The address can be claimed again; deletion is not a permanent address ban.''')
path.write_text(text)
path = Path("README.md")
text = path.read_text()
text = text.replace('Treat message HTML as untrusted content in clients; the server\'s basic content cleanup is\nnot a substitute for safe rendering.', 'The webmail renders sanitized HTML in an isolated, scriptless frame, with a Text alternative\nand per-message opt-in for remote images. The server\'s basic cleanup is not a substitute\nfor client-side isolation. Delete mailbox requires typing the address, permanently removes\nits stored messages, and releases the claim; the address may subsequently be claimed again.')
path.write_text(text)
Path(".github/prepare-html-mail.py").unlink()
print("Prepared sanitized HTML mail and confirmed mailbox deletion")
