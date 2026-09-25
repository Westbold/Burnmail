from pathlib import Path
root=Path('.')
def replace(name, old, new):
 p=root/name;s=p.read_text();assert old in s,(name,old[:80]);p.write_text(s.replace(old,new))
replace('public/app/app.js','import { emailDocument } from "./html-email.js";','''import { emailDocument } from "./html-email.js";
import { listMailboxes, getMailbox, rememberMailbox, forgetMailbox, storageProtection } from "./mailbox-store.js";''')
replace('public/app/app.js','let remoteImages = false;', '''let remoteImages = false;
let connecting = false;
let remembered = [];
let rememberedVersion = 0;
let persistenceRequested = false;
let deviceChannel;
try { deviceChannel = new BroadcastChannel("burnmail-device-mailbox-changes"); } catch { /* Focus refresh still works. */ }

function deviceWarning(message = "") {
  byId("storage-warning").textContent = message;
  byId("storage-warning").hidden = !message;
  byId("retry-remember").hidden = !message || !session;
}

function renderRemembered() {
  const list = byId("remembered-list");
  list.replaceChildren();
  byId("new-mailbox").disabled = connecting || deleting;
  byId("retry-remember").disabled = connecting || deleting;
  byId("remembered-empty").hidden = remembered.length > 0;
  for (const record of remembered) {
    const row = document.createElement("div");
    row.className = "remembered-row";
    row.dataset.email = record.email;
    const label = document.createElement("span");
    label.className = "remembered-address";
    label.textContent = record.email;
    const login = document.createElement("button");
    login.type = "button";
    login.className = "secondary";
    login.textContent = session?.email === record.email ? "Open" : "Login";
    login.setAttribute("aria-label", `Login to ${record.email}`);
    login.disabled = connecting || deleting || session?.email === record.email;
    login.addEventListener("click", () => void loginMailbox(record.email, null, false, true));
    const forget = document.createElement("button");
    forget.type = "button";
    forget.className = "secondary";
    forget.textContent = "Forget";
    forget.setAttribute("aria-label", `Forget ${record.email} on this device`);
    forget.disabled = connecting || deleting;
    forget.addEventListener("click", () => void forgetRemembered(record.email));
    row.append(label, login, forget);
    list.append(row);
  }
}

async function refreshRemembered() {
  const version = ++rememberedVersion;
  try {
    const records = await listMailboxes();
    if (version !== rememberedVersion) return;
    remembered = records;
    renderRemembered();
  } catch {
    deviceWarning("Remembered mailboxes could not be read from this browser. You can still open or create a mailbox below.");
  }
}

async function updateProtection(request = false) {
  const protection = await storageProtection(request);
  const labels = {
    persistent: "Persistent storage granted. Saved mailboxes have no app expiration and are protected from automatic storage-pressure cleanup.",
    "best-effort": "Saved on this device with no app expiration. The browser has not granted protection from automatic cleanup.",
    unsupported: "Saved on this device with no app expiration. This browser does not expose persistent-storage protection.",
    unavailable: "Storage protection could not be checked. Keep a private copy of your access links.",
  };
  byId("storage-protection").textContent = labels[protection];
  byId("protect-storage").hidden = protection === "persistent" || protection === "unsupported";
}

async function saveRemembered(email, key) {
  try {
    await rememberMailbox(email, key);
    deviceWarning();
    deviceChannel?.postMessage("changed");
    await refreshRemembered();
    if (!persistenceRequested) {
      persistenceRequested = true;
      void updateProtection(true);
    }
    return true;
  } catch {
    deviceWarning("This mailbox was NOT saved on this device. Copy its access link before leaving, or retry saving. Server login still works.");
    return false;
  }
}

async function forgetRemembered(email) {
  if (connecting || deleting || !confirm(`Forget ${email} on this device? This does NOT delete its mailbox or messages. Keep the access key if you need it again.`)) return;
  connecting = true;
  renderRemembered();
  try {
    await forgetMailbox(email);
    if (session?.email === email) closeMailbox("Forgotten on this device. The mailbox and messages were NOT deleted.");
    else status("Forgotten on this device. The mailbox and messages were NOT deleted.");
    deviceWarning();
    deviceChannel?.postMessage("changed");
    await refreshRemembered();
  } catch { deviceWarning("Could not forget this mailbox. Browser storage may be blocked; the saved entry was not confirmed removed."); }
  finally { connecting = false; renderRemembered(); renderList(); }
}

byId("new-mailbox").addEventListener("click", () => {
  if (connecting || deleting) return;
  closeMailbox("Open another mailbox or use Generate key and Claim & open to create one. Your saved mailboxes stay on this device.");
  byId("connect").reset();
  byId("address").focus();
});
byId("protect-storage").addEventListener("click", () => void updateProtection(true));
byId("retry-remember").addEventListener("click", async () => {
  if (!session || connecting || deleting) return;
  connecting = true;
  renderRemembered();
  try { await saveRemembered(session.email, session.key); }
  finally { connecting = false; renderRemembered(); }
});
if (deviceChannel) deviceChannel.onmessage = () => void refreshRemembered();
window.addEventListener("focus", () => void refreshRemembered());
void refreshRemembered();
void updateProtection();''')
replace('public/app/app.js','if (!session || listBusy || deleting) return;', 'if (!session || listBusy || deleting || connecting) return;')
replace('public/app/app.js','if (!session || deleting) return;', 'if (!session || deleting || connecting) return;')
replace('public/app/app.js','if (!session || deleting || listBusy) return;', 'if (!session || deleting || listBusy || connecting) return;')
replace('public/app/app.js','if (!session || !selectedId || deleting || listBusy) return;', 'if (!session || !selectedId || deleting || listBusy || connecting) return;')
replace('public/app/app.js','item.disabled = deleting;', 'item.disabled = deleting || connecting;')
replace('public/app/app.js','listBusy || deleting;', 'listBusy || deleting || connecting;')
replace('public/app/app.js','listBusy || deleting || offset', 'listBusy || deleting || connecting || offset')
replace('public/app/app.js','listBusy || deleting || rows', 'listBusy || deleting || connecting || rows')
replace('public/app/app.js','.disabled = deleting;', '.disabled = deleting || connecting;')
replace('public/app/app.js','byId("page").textContent = `Page ${offset / pageSize + 1}`;', 'byId("page").textContent = `Page ${offset / pageSize + 1}`;\n  renderRemembered();')
p=root/'public/app/app.js';s=p.read_text();a=s.index('byId("connect").addEventListener');b=s.index('byId("generate").addEventListener',a)
s=s[:a]+'''async function loginMailbox(email, key, claim = false, recalled = false) {
  if (connecting || deleting) return;
  if (claim && !confirm(`Claim ${email} with this key? It will be remembered on this device after the claim succeeds.`)) return;
  connecting = true;
  byId("credentials").disabled = true;
  renderList();
  status(claim ? "Claiming address..." : "Opening inbox...");
  const controller = new AbortController();
  let active;
  let saved = false;
  try {
    if (recalled) {
      const record = await getMailbox(email);
      if (!record) throw new Error("This mailbox is no longer remembered on this device. Enter its address and key to open it.");
      key = record.key;
    }
    active = { email, key, signal: controller.signal, controller };
    if (claim) {
      await request(`/claims/${encodeURIComponent(email)}`, { ...active, method: "PUT" });
      // A successful new claim must be saved even if the first inbox read later fails.
      saved = await saveRemembered(email, key);
    }
    const data = await request(`/emails/${encodeURIComponent(email)}?limit=${pageSize}&offset=0`, active);
    if (!Array.isArray(data)) throw new Error("The API returned an invalid message list.");
    if (!claim) saved = await saveRemembered(email, key);
    session?.controller.abort();
    session = active;
    offset = 0;
    rows = data;
    listBusy = false;
    pollAllowed = true;
    byId("mailbox-address").textContent = email;
    byId("key").value = "";
    byId("key").type = "password";
    byId("login").hidden = true;
    byId("mailbox").hidden = false;
    clearReader();
    renderList();
    byId("retry-remember").hidden = saved;
    status(saved ? "Inbox open. Remembered on this device for next time." : "Inbox open, but NOT remembered. Copy your access link before leaving.");
  } catch (error) {
    controller.abort();
    report(error);
    if (recalled && [401, 403, 404].includes(error.status)) {
      status("Saved mailbox could not be opened: " + error.message + ". You can Forget it locally or enter another key. Nothing was automatically deleted or reclaimed.", true);
    }
  } finally {
    connecting = false;
    byId("credentials").disabled = false;
    renderList();
  }
}

byId("connect").addEventListener("submit", event => {
  event.preventDefault();
  void loginMailbox(byId("address").value.trim(), byId("key").value, event.submitter?.value === "claim");
});

''' + s[b:];p.write_text(s)
replace('public/app/app.js','  status(message);\n}', '  byId("retry-remember").hidden = true;\n  renderRemembered();\n  status(message);\n}')
replace('public/app/app.js','if (!deleting) closeMailbox("Closed. The mailbox claim and its messages were not deleted.");', 'if (!deleting && !connecting) closeMailbox("Closed. The mailbox is still remembered on this device; its claim and messages were not deleted.");')
replace('public/app/app.js','''    closeMailbox("Mailbox permanently deleted. All stored messages were removed and the address was released.");''','''    let forgotten = true;
    try {
      await forgetMailbox(active.email, active.key);
      deviceChannel?.postMessage("changed");
      await refreshRemembered();
    } catch { forgotten = false; }
    closeMailbox("Mailbox permanently deleted. All stored messages were removed and the address was released.");
    if (!forgotten) deviceWarning("The mailbox was deleted on the server, but its local entry could not be removed. Use Forget to retry local cleanup.");''')
replace('public/app/index.html','  <main>','''  <main>
    <section id="remembered" class="card remembered" aria-labelledby="remembered-title">
      <div class="toolbar">
        <h2 id="remembered-title">Mailboxes on this device</h2>
        <button id="new-mailbox" type="button" class="secondary">New / other mailbox</button>
      </div>
      <p class="hint">Addresses and access keys are remembered only in this browser profile on this device, with no server sync. Anyone using this profile can open them.</p>
      <div id="remembered-list" aria-live="polite"></div>
      <p id="remembered-empty" class="hint">No mailboxes remembered yet. Open or create one below to save it here.</p>
      <p id="storage-protection" class="hint" role="status">Checking local storage protection...</p>
      <div class="actions">
        <button id="protect-storage" type="button" class="secondary">Protect browser storage</button>
        <button id="retry-remember" type="button" class="secondary" hidden>Retry remembering this mailbox</button>
      </div>
      <p id="storage-warning" class="storage-warning" role="status" hidden></p>
      <p class="hint">No automatic checks of remembered mailboxes. Login checks only the mailbox you choose. Clearing site data or using private browsing can lose saved keys; keep private access-link backups.</p>
    </section>''')
replace('public/app/index.html','<p class="hint">Save your key. There is no password reset or key recovery.</p>', '<p class="hint">Successful logins and new claims are remembered on this device. Keep a private backup of your key; there is no password reset.</p>')
replace('public/app/index.html','Save your access link before leaving. Anyone with it can read, delete, and release this inbox. Closing does not release the claim.', 'This mailbox is remembered here when browser storage is available. Keep your access link private: it grants full access. Closing keeps the local entry. Forget removes only the local entry.')
p=root/'public/app/styles.css';p.write_text(p.read_text()+'''
.remembered { margin-bottom: 28px; }
.remembered .toolbar { flex-wrap: wrap; }
#remembered-list { max-height: 260px; overflow-y: auto; }
.remembered-row { display: flex; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e7ef; }
.remembered-address { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 14px; }
.storage-warning { color: #b42318; margin: 16px 0 0; }
.remembered + .login { margin-top: 0; }
@media (max-width: 480px) {
  .remembered { padding: 16px; }
  .remembered-row { flex-wrap: wrap; }
  .remembered-address { flex-basis: 100%; }
}
''')
replace('documentation/06_frontend.md','keeps them\nonly in memory, and uses the original bearer-header API.', 'uses the original bearer-header API, and remembers successful logins in device-local IndexedDB.')
replace('documentation/06_frontend.md','''Credentials are never saved in cookies or local/session storage. Closing/reloading requires
supplying the original key or link. Closing the UI does not release the address claim.''','''Successful logins and newly created claims are remembered in IndexedDB in this browser
profile. Closing the UI retains the remembered entry; refreshing lists saved mailboxes
without opening or checking any of them. Login performs the existing authenticated read
only for the selected mailbox. New / other mailbox always keeps manual login and claiming
available. Cookies, localStorage, sessionStorage, and server-side sync are not used.''')
replace('documentation/06_frontend.md','''requests, clears in-memory credentials, and returns to login.''','''requests, removes the matching local remembered entry, clears in-memory credentials, and returns to login.''')
p=root/'documentation/06_frontend.md';p.write_text(p.read_text()+'''
## Device-local remembered mailboxes

The database `burnmail-device-mailboxes`, version 1, has a `mailboxes` object store keyed
by the exact trimmed address (matching the existing case-sensitive API), containing the
address, opaque bearer key, and last successful use timestamp. One record per address;
a failed login never overwrites a valid stored key. Keys never appear in switcher markup,
change notifications, or logs. Email content remains in the existing server mailbox and
is not copied into this client credential store. There is no account, cloud backup, sync
endpoint, or bulk upload. Only an explicitly selected mailbox's key goes to the existing
API Authorization header. Remembering itself performs no network requests.

Records have no TTL, pruning schedule, or artificial limit. Writes request IndexedDB
`durability: strict` and wait for transaction completion, falling back to the default
transaction only on engines that reject the durability option. The app requests
`navigator.storage.persist()` after saving and offers an explicit retry button. It shows
whether persistence was granted instead of claiming guaranteed permanence. Browser denial,
unsupported persistence, blocked/quota-exhausted storage, private-mode cleanup, manual site
data deletion, profile removal, and changing origins cannot be overridden. Failed saves
leave a working login and visible warning with a retry and access-link backup guidance.
Storage errors never cause a cloud fallback or deletion/recreation of the local database.

Forget requires confirmation and only removes the entry on this device; it does not delete
the remote mailbox. Forgetting the active entry also closes the local session. Delete mailbox
removes local credentials only after the existing authorized server deletion succeeds;
cancellation and server failure preserve the record. A stale saved login stays listed with
an error until the user chooses Forget or supplies a working key. Same-device tabs exchange
only a key-free invalidation notice with BroadcastChannel and refresh local metadata on focus;
there is no background validation, automatic login, or polling of inactive saved mailboxes.

Keys must be recoverable for one-click access, so IndexedDB is not a password vault. Anyone
with this browser profile, privileged extensions, or same-origin script execution can access
them. Existing script CSP and opaque-origin HTML-email sandboxing remain in place. Keep
private access links as backups; storage permission cannot prevent explicit deletion.
''')
p=root/'README.md';s=p.read_text();s=s.replace('## API quick start','''## Remembered mailboxes on this device

Every successful webmail login (including access links) and newly created claim is saved
in this browser profile using IndexedDB. Use **Login** beside a remembered address to reopen
it without re-entering a key. The list makes no mailbox API requests until you choose Login;
it does not auto-login, check for deletion, or prune inactive records. **New / other mailbox**
keeps manual login and **Claim & open** available. Failed logins never replace a saved key.

**Close inbox** keeps the remembered entry. **Forget** only removes it from this device;
**Delete mailbox** still deletes the server mailbox and removes the matching local entry
on success. All remembered addresses and recoverable keys remain on this device, not in a
Cloudflare database or sync service. Only the selected inbox's key is sent for authentication.

There is no app expiration. Writes request strict IndexedDB durability, and the app requests
persistent-storage permission and displays the browser's actual decision. Denial does not
stop local saving; a failed write displays a warning and retry. Clearing site data, private
browsing, profile/device loss, or changing browser/origin can still lose remembered keys.
Anyone with this browser profile can open saved mailboxes. Keep private access-link backups.
See [webmail](documentation/06_frontend.md#device-local-remembered-mailboxes) for details.

## API quick start''');p.write_text(s)
replace('tests/browser/webmail.mjs','assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);','''assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      assert.equal(await page.evaluate(async () => (await (await import("/app/mailbox-store.js")).listMailboxes()).length), 0, "successful mailbox deletion also forgets its device key");''')
Path(__file__).unlink()
print('Prepared remembered mailboxes without modifying the backend contract')
