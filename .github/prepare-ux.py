from pathlib import Path
import base64, json, os, urllib.request

# Apply the reviewed markup blob to the same repository's validation checkout.
req = urllib.request.Request(
    f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}/git/blobs/f12821c6dd8c5aa578e545d7a9547632affb2836",
    headers={'Authorization': f"Bearer {os.environ['GH_TOKEN']}", 'Accept': 'application/vnd.github+json'})
with urllib.request.urlopen(req, timeout=30) as response:
    Path('public/app/index.html').write_bytes(base64.b64decode(json.load(response)['content']))

p = Path('tests/browser/webmail.mjs')
s = p.read_text()
s = s.replace('await page.locator("#delete-mailbox").click();', 'await clickDeleteMailbox(page);')
s = s.replace('try {\n  for (const [name, engine]', '''async function clickDeleteMailbox(page) {
  if (!await page.locator("#mailbox-options").evaluate(e => e.open)) await page.getByLabel("Mailbox options", { exact: true }).click();
  await page.locator("#delete-mailbox").click();
}

try {
  for (const [name, engine]''')
s = s.replace('"Load remote images"', '"Show images"')
p.write_text(s)

p = Path('tests/browser/remembered.mjs')
s = p.read_text()
a = s.index('async function login(')
b = s.index('async function recall(', a)
s = s[:a] + '''async function login(page, email, key, claim = false) {
  await page.locator("#home-link").click();
  if (await page.locator("#remembered").isVisible()) {
    await page.locator(claim ? "#new-mailbox" : "#open-other").click();
  } else {
    await page.locator(claim ? "#mode-create" : "#mode-open").click();
  }
  if (claim) {
    await page.locator("#name").fill(email.split("@")[0]);
    await page.locator("#create-mailbox").click();
  } else {
    await page.locator("#address").fill(email); await page.locator("#key").fill(key);
    await page.locator("#open-mailbox").click();
  }
}
''' + s[b:]
s = s.replace('"Saved mailbox could not be opened"', '"Mailbox no longer exists"')
s = s.replace('assert.equal(creations, 1);\n      page.once', 'assert.equal(creations, 1);\n      await page.locator("#close").click();\n      page.once')
s = s.replace('page.once("dialog", d => d.accept(gamma)); await page.locator("#delete-mailbox").click();', 'await recall(page, gamma); await opened(page, gamma);\n      await page.getByLabel("Mailbox options", { exact: true }).click();\n      page.once("dialog", d => d.accept(gamma)); await page.locator("#delete-mailbox").click();')
s = s.replace('await page.locator("#login").waitFor({ state: "visible" }); await count(page, 1);', 'await page.locator("#remembered").waitFor({ state: "visible" }); await count(page, 1);')
s = s.replace('const other = await context.newPage(); await other.goto(origin); await count(other, 1);\n      page.once', 'const other = await context.newPage(); await other.goto(origin); await count(other, 1);\n      await page.locator("#close").click();\n      page.once')
p.write_text(s)

p = Path('README.md')
s = p.read_text().replace('Use **Login** beside a remembered address to reopen', 'Select a remembered address to reopen').replace('until you choose Login', 'until you select a mailbox').replace('**New / other mailbox**\nkeeps manual login and **Claim & open** available.', '**New mailbox** generates an access key automatically; **Open existing** accepts an address and key.').replace('**Close inbox** keeps the remembered entry.', '**Mailboxes** returns to the saved list without deleting anything.')
p.write_text(s)
p = Path('documentation/06_frontend.md')
s = p.read_text().replace('Claiming requires an explicit **Claim & open** action. Generate a key and save it first.', 'The **Create mailbox** action generates an access key automatically. A blank address creates a random mailbox; a supplied name creates that address.').replace('New / other mailbox always keeps manual login and claiming\navailable.', '**New mailbox** and **Open existing** keep creation and manual login available.')
s += '''
## Concise navigation

An empty device goes straight to the Create/Open form; no empty saved-mailbox section is
shown. Returning devices show only saved mailbox rows and New mailbox / Open existing
actions. Selecting a row logs in without checking other saved mailboxes. The active inbox
hides the home form and saved list. Mailboxes returns to the list; More contains access-link
copying, new mailbox creation, and mailbox deletion. Only destructive actions ask for
confirmation. Storage details and persistence controls live in Settings; real storage
failures remain visible beside actionable retry/backup controls.

No persistent success/instruction banners, routine storage notices, duplicate empty reader,
or unnecessary pagination are shown. On narrow screens, reading a message replaces the
list, and Inbox returns focus to that message. Keyboard focus, missing domains, storage
failures, post-claim read failure, remembered-key durability, HTML isolation, and deletion
remain covered by browser tests.
'''
p.write_text(s)
Path(__file__).unlink()
print('Prepared concise UX changes; no deployment configuration or credentials changed')
