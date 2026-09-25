import { accessLink, generateKey, messageBody, consumeAccessLink, request } from "./api.js";

import { emailDocument } from "./html-email.js";
import { listMailboxes, getMailbox, rememberMailbox, forgetMailbox, storageProtection } from "./mailbox-store.js";

// Clear URL credentials before starting any API requests.
let linked = consumeAccessLink(location, history);

const byId = (id) => document.getElementById(id);
const pageSize = 20;
let session = null;
let listBusy = false;
let selectedId = null;
let selectionVersion = 0;
let offset = 0;
let rows = [];
let pollAllowed = true;
let deleting = false;
let currentMessage = null;
let bodyMode = "html";
let remoteImages = false;
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
    // Focusing a window must not replace buttons between pointerdown and click.
    const changed = records.length !== remembered.length || records.some((record, index) =>
      record.email !== remembered[index]?.email || record.lastUsedAt !== remembered[index]?.lastUsedAt);
    remembered = records;
    if (changed) renderRemembered();
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
void updateProtection();

function status(text, error = false) {
  byId("status").textContent = text;
  byId("status").dataset.error = String(error);
}

function report(error) {
  if (error.name === "AbortError") return;
  status(error.name === "TimeoutError" ? "The API timed out. Try Refresh." : error.message, true);
}

function clearReader() {
  currentMessage = null;
  bodyMode = "html";
  remoteImages = false;
  byId("html-body").hidden = true;
  byId("html-body").removeAttribute("srcdoc");
  byId("body-controls").hidden = true;
  byId("image-warning").hidden = true;
  byId("body").hidden = false;
  selectedId = null;
  selectionVersion += 1;
  byId("message").hidden = true;
  byId("reader-empty").hidden = false;
  for (const id of ["subject", "sender", "received", "body", "body-kind"]) byId(id).textContent = "";
}

function renderBody() {
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

function date(seconds) {
  return new Date(seconds * 1000).toLocaleString();
}

function renderList() {
  const list = byId("messages");
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = offset ? "No messages on this page." : "No messages yet. This inbox is ready to receive mail.";
    list.append(empty);
  }
  for (const email of rows) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "mail-item";
    item.setAttribute("aria-pressed", String(email.id === selectedId));
    item.disabled = deleting || connecting;
    const subject = document.createElement("strong");
    subject.textContent = email.subject || "(No subject)";
    const detail = document.createElement("span");
    detail.textContent = `${email.from_address} - ${date(email.received_at)}`;
    item.append(subject, detail);
    item.addEventListener("click", () => void openMessage(email.id));
    list.append(item);
  }
  byId("previous").disabled = listBusy || deleting || connecting || offset === 0;
  byId("next").disabled = listBusy || deleting || connecting || rows.length < pageSize;
  byId("refresh").disabled = listBusy || deleting || connecting;
  byId("delete").disabled = listBusy || deleting || connecting;
  byId("delete-mailbox").disabled = listBusy || deleting || connecting;
  byId("close").disabled = deleting || connecting;
  byId("copy-address").disabled = deleting || connecting;
  byId("copy-link").disabled = deleting || connecting;
  byId("page").textContent = `Page ${offset / pageSize + 1}`;
  renderRemembered();
}

async function refresh(newOffset = offset, silent = false) {
  if (!session || listBusy || deleting || connecting) return;
  const active = session;
  listBusy = true;
  renderList();
  try {
    const data = await request(`/emails/${encodeURIComponent(active.email)}?limit=${pageSize}&offset=${newOffset}`, active);
    if (session !== active) return;
    if (!Array.isArray(data)) throw new Error("The API returned an invalid message list.");
    offset = newOffset;
    rows = data;
    pollAllowed = true;
    if (selectedId && !rows.some((email) => email.id === selectedId)) clearReader();
    if (!silent) status("Inbox updated.");
  } catch (error) {
    if (session === active) {
      if ([401, 403, 404].includes(error.status)) pollAllowed = false;
      report(error);
    }
  } finally {
    if (session === active) {
      listBusy = false;
      renderList();
    }
  }
}

async function openMessage(id) {
  if (!session || deleting || connecting) return;
  const active = session;
  clearReader();
  selectedId = id;
  const version = selectionVersion;
  renderList();
  status("Loading message...");
  try {
    const email = await request(`/inbox/${encodeURIComponent(id)}`, active);
    if (session !== active || version !== selectionVersion) return;
    byId("subject").textContent = email.subject || "(No subject)";
    byId("sender").textContent = `From: ${email.from_address}`;
    byId("received").textContent = `Received: ${date(email.received_at)}`;
    currentMessage = email;
    renderBody();
    byId("message").hidden = false;
    byId("reader-empty").hidden = true;
    status("");
  } catch (error) {
    if (session === active && version === selectionVersion) report(error);
  }
}

async function loginMailbox(email, key, claim = false, recalled = false) {
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

byId("generate").addEventListener("click", () => {
  byId("key").value = generateKey();
  byId("key").type = "text";
  status("New key generated. Save it, then use Claim & open for an unclaimed address.");
});

function closeMailbox(message) {
  session?.controller.abort();
  session = null;
  rows = [];
  offset = 0;
  listBusy = false;
  deleting = false;
  byId("delete").disabled = false;
  clearReader();
  byId("messages").replaceChildren();
  byId("mailbox-address").textContent = "";
  byId("mailbox").hidden = true;
  byId("login").hidden = false;
  byId("key").value = "";
  byId("delete-mailbox").disabled = false;
  byId("close").disabled = false;
  byId("copy-address").disabled = false;
  byId("copy-link").disabled = false;
  byId("retry-remember").hidden = true;
  renderRemembered();
  status(message);
}

byId("close").addEventListener("click", () => {
  if (!deleting && !connecting) closeMailbox("Closed. Any saved device entry was kept; the mailbox claim and messages were not deleted.");
});

byId("delete-mailbox").addEventListener("click", async () => {
  if (!session || deleting || listBusy || connecting) return;
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
    let forgotten = true;
    try {
      await forgetMailbox(active.email, active.key);
      deviceChannel?.postMessage("changed");
      await refreshRemembered();
    } catch { forgotten = false; }
    closeMailbox("Mailbox permanently deleted. All stored messages were removed and the address was released.");
    if (!forgotten) deviceWarning("The mailbox was deleted on the server, but its local entry could not be removed. Use Forget to retry local cleanup.");
    byId("address").value = "";
  } catch (error) {
    if (session === active) report(error);
  } finally {
    if (session === active) {
      deleting = false;
      renderList();
    }
  }
});

byId("refresh").addEventListener("click", () => void refresh());
byId("previous").addEventListener("click", () => void refresh(Math.max(0, offset - pageSize)));
byId("next").addEventListener("click", () => void refresh(offset + pageSize));

byId("delete").addEventListener("click", async () => {
  if (!session || !selectedId || deleting || listBusy || connecting) return;
  if (!confirm("Permanently delete this message?")) return;
  const active = session;
  const id = selectedId;
  let removed = false;
  deleting = true;
  byId("delete").disabled = true;
  renderList();
  try {
    await request(`/inbox/${encodeURIComponent(id)}`, { ...active, method: "DELETE" });
    if (session !== active) return;
    clearReader();
    rows = rows.filter((email) => email.id !== id);
    removed = true;
    status("Message deleted.");
  } catch (error) {
    if (session === active) report(error);
  } finally {
    if (session === active) {
      deleting = false;
      byId("delete").disabled = false;
      renderList();
      if (removed) await refresh(rows.length ? offset : Math.max(0, offset - pageSize), true);
    }
  }
});

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    status(message);
  } catch {
    status("Clipboard access was blocked by your browser. Open this page over HTTPS and try again.", true);
  }
}
byId("copy-address").addEventListener("click", () => {
  if (session) void copy(session.email, "Address copied.");
});
byId("copy-link").addEventListener("click", () => {
  if (session) void copy(accessLink(location.origin, session.email, session.key), "Access link copied. Keep it private: it grants full mailbox access.");
});

setInterval(() => {
  if (!document.hidden && offset === 0 && pollAllowed) void refresh(0, true);
}, 15000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && offset === 0 && pollAllowed) void refresh(0, true);
});

// Consume credentials once, then remove them from the current history entry.
// A link only opens an existing claim; following one never claims an address.
if (linked) {
  byId("address").value = linked.email;
  byId("key").value = linked.key;
  byId("connect").requestSubmit();
  linked = null;
}
request("/domains").then((domains) => {
  byId("domains").textContent = Array.isArray(domains) && domains.length
    ? `Receiving domains: ${domains.join(", ")}`
    : "No receiving domains are configured. Ask the service administrator.";
}).catch(() => {
  byId("domains").textContent = "Could not load domains. You can still try an existing mailbox address.";
});
