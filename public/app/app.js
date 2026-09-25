import { accessLink, generateKey, messageBody, consumeAccessLink, request } from "./api.js";
import { emailDocument } from "./html-email.js";
import { listMailboxes, getMailbox, rememberMailbox, forgetMailbox, storageProtection } from "./mailbox-store.js";

// Consume URL credentials before any requests; remembered mailboxes are not auto-opened.
let linked = consumeAccessLink(location, history);
const byId = id => document.getElementById(id);
const pageSize = 20;
let session = null, sessionSaved = false, recovery = null;
let rows = [], offset = 0, listBusy = false, connecting = false, deleting = false;
let selectedId = null, selectionVersion = 0, currentMessage = null;
let bodyMode = "html", remoteImages = false, pollAllowed = true;
let remembered = [], rememberedVersion = 0, storageReady = false, homeView = "auto";
let domainsReady = false, persistenceRequested = false, statusTimer;
let deviceChannel;
try { deviceChannel = new BroadcastChannel("burnmail-device-mailbox-changes"); } catch { /* Focus refresh is enough. */ }
const busy = () => connecting || deleting;

function status(text = "", error = false, transient = false) {
  clearTimeout(statusTimer);
  const node = byId("status");
  node.textContent = text;
  node.hidden = !text;
  node.dataset.error = String(error);
  if (transient && !error) statusTimer = setTimeout(() => { node.hidden = true; }, 3000);
}
function report(error) {
  if (error.name === "AbortError") return;
  const text = error.name === "TimeoutError" ? "Request timed out. Try again." : error.message;
  status(text || "Something went wrong. Try again.", true);
}
function deviceWarning(message = "") {
  byId("storage-warning").textContent = message;
  byId("storage-alert").hidden = !message;
  const canSave = Boolean(session || recovery);
  byId("retry-remember").hidden = !message || !canSave;
  byId("copy-backup").hidden = !message || !canSave;
}
function renderHome() {
  byId("loading").hidden = storageReady || Boolean(session);
  byId("home").hidden = !storageReady || Boolean(session);
  byId("mailbox").hidden = !session;
  const savedView = (homeView === "auto" || homeView === "saved") && remembered.length > 0;
  byId("remembered").hidden = !savedView || Boolean(session);
  byId("login").hidden = savedView || Boolean(session) || !storageReady;
  byId("back-saved").hidden = remembered.length === 0;
  const create = homeView !== "open";
  byId("create").hidden = !create;
  byId("connect").hidden = create;
  byId("form-title").textContent = create ? "New mailbox" : "Open mailbox";
  byId("mode-create").setAttribute("aria-pressed", String(create));
  byId("mode-open").setAttribute("aria-pressed", String(!create));
  for (const id of ["new-mailbox", "open-other", "back-saved", "mode-create", "mode-open", "retry-remember", "create-another"]) byId(id).disabled = busy();
  byId("credentials").disabled = busy();
  byId("create-fields").disabled = busy();
  byId("create-mailbox").disabled = busy() || !domainsReady;
  byId("create-mailbox").textContent = connecting && create ? "Creating..." : "Create mailbox";
  byId("open-mailbox").textContent = connecting && !create ? "Opening..." : "Open mailbox";
}
function renderRemembered() {
  const list = byId("remembered-list");
  list.replaceChildren();
  byId("remembered-count").textContent = String(remembered.length);
  for (const [index, record] of remembered.entries()) {
    const row = document.createElement("li");
    row.className = "remembered-row";
    const login = document.createElement("button");
    login.type = "button";
    login.className = "mailbox-open";
    login.setAttribute("aria-label", `Login to ${record.email}`);
    login.disabled = busy();
    const number = document.createElement("span");
    number.className = "mailbox-number";
    number.textContent = String(index + 1).padStart(2, "0");
    number.setAttribute("aria-hidden", "true");
    const address = document.createElement("span");
    address.className = "remembered-address";
    address.textContent = record.email;
    const arrow = document.createElement("span");
    arrow.className = "mailbox-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "\u2192";
    login.append(number, address, arrow);
    login.addEventListener("click", () => void loginMailbox(record.email, null, false, true));
    const forget = document.createElement("button");
    forget.type = "button";
    forget.className = "text-button forget-button";
    forget.textContent = "\u00d7";
    forget.title = "Forget on this device";
    forget.setAttribute("aria-label", `Forget ${record.email} on this device`);
    forget.disabled = busy();
    forget.addEventListener("click", () => void forgetRemembered(record.email));
    row.append(login, forget);
    list.append(row);
  }
  renderHome();
}
async function refreshRemembered() {
  const version = ++rememberedVersion;
  try {
    const records = await listMailboxes();
    if (version !== rememberedVersion) return;
    const changed = records.length !== remembered.length || records.some((record, i) =>
      record.email !== remembered[i]?.email || record.lastUsedAt !== remembered[i]?.lastUsedAt);
    remembered = records;
    // Do not replace focus/click targets on a no-change browser focus event.
    if (changed) renderRemembered();
  } catch { deviceWarning("Can't read saved mailboxes in this browser."); }
  finally {
    storageReady = true;
    renderHome();
  }
}
async function updateProtection(ask = false) {
  const value = await storageProtection(ask);
  const labels = {
    persistent: "Protected from automatic storage cleanup.",
    "best-effort": "Saved locally. Browser cleanup protection isn't enabled.",
    unsupported: "Saved locally. This browser doesn't offer cleanup protection.",
    unavailable: "Couldn't check storage protection.",
  };
  byId("storage-protection").textContent = labels[value];
  byId("protect-storage").hidden = value === "persistent" || value === "unsupported";
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
    deviceWarning("Not saved on this device. Keep your access link.");
    return false;
  }
}
async function forgetRemembered(email) {
  if (busy() || !confirm(`Forget ${email} on this device?\n\nThe mailbox and its messages will not be deleted.`)) return;
  connecting = true;
  renderRemembered();
  try {
    await forgetMailbox(email);
    if (session?.email === email) clearSession();
    deviceChannel?.postMessage("changed");
    deviceWarning();
    await refreshRemembered();
    status("Forgotten on this device.", false, true);
  } catch { deviceWarning("Couldn't remove the saved entry. Try Forget again."); }
  finally { connecting = false; renderRemembered(); }
}

function clearSession() {
  session?.controller.abort();
  session = null;
  sessionSaved = false;
  recovery = null;
  rows = [];
  offset = 0;
  listBusy = false;
  clearReader();
  byId("messages").replaceChildren();
  byId("mailbox-address").textContent = "";
  byId("connect").reset();
  byId("key").type = "password";
  byId("show-key").textContent = "Show";
  byId("show-key").setAttribute("aria-pressed", "false");
  byId("mailbox-options").open = false;
  byId("retry-remember").hidden = true;
  byId("copy-backup").hidden = true;
  renderHome();
}
function navigateHome(view = "auto", focus = true) {
  if (busy()) return;
  if ((session && !sessionSaved) || recovery) {
    if (!confirm("This mailbox isn't saved. Leave without keeping its access link?")) return;
  }
  clearSession();
  homeView = view;
  byId("create").reset();
  status();
  renderHome();
  if (focus) {
    const savedView = !byId("remembered").hidden;
    byId(savedView ? "remembered-title" : view === "open" ? "address" : "name").focus();
  }
}
async function loadDomains() {
  domainsReady = false;
  byId("domain-error").hidden = true;
  renderHome();
  try {
    const domains = await request("/domains");
    if (!Array.isArray(domains) || !domains.length) throw new Error("No receiving domains available.");
    byId("domain").replaceChildren(...domains.map(domain => new Option(domain, domain)));
    domainsReady = true;
  } catch {
    byId("domain").replaceChildren(new Option("Unavailable", ""));
    byId("domains").textContent = "Couldn't load receiving domains.";
    byId("domain-error").hidden = false;
  }
  renderHome();
}
async function loginMailbox(email, key, claim = false, recalled = false) {
  if (busy()) return;
  connecting = true;
  renderRemembered();
  status(claim ? "Creating mailbox..." : "Opening...");
  const controller = new AbortController();
  let active, saved = false, claimed = false;
  try {
    if (recalled) {
      const record = await getMailbox(email);
      if (!record) throw new Error("Saved key unavailable. Open this mailbox with its access key.");
      key = record.key;
    }
    active = { email, key, signal: controller.signal, controller };
    if (claim) {
      await request(`/claims/${encodeURIComponent(email)}`, { ...active, method: "PUT" });
      claimed = true;
      recovery = { email, key };
      saved = await saveRemembered(email, key);
      if (saved) recovery = null;
    }
    const data = await request(`/emails/${encodeURIComponent(email)}?limit=${pageSize}&offset=0`, active);
    if (!Array.isArray(data)) throw new Error("Couldn't load this inbox. Try again.");
    if (!claim) saved = await saveRemembered(email, key);
    session?.controller.abort();
    session = active;
    sessionSaved = saved;
    recovery = null;
    rows = data;
    offset = 0;
    listBusy = false;
    pollAllowed = true;
    byId("mailbox-address").textContent = email;
    byId("key").value = "";
    byId("key").type = "password";
    clearReader();
    renderList();
    deviceWarning(saved ? "" : "Not saved on this device. Keep your access link.");
    status();
    byId("mailbox-address").focus();
  } catch (error) {
    controller.abort();
    if (claim && claimed) {
      homeView = "open";
      byId("address").value = email;
      byId("key").value = key;
      status("Mailbox created. Couldn't load it; try Open mailbox.", true);
    } else if (claim && error.status === 409) {
      status("That address is taken. Choose another.", true);
      byId("name").focus();
    } else if (recalled && [401, 403, 404].includes(error.status)) {
      status(error.status === 404 ? "Mailbox no longer exists. Forget it or create another." : "Saved key no longer works. Open it with another key.", true);
    } else report(error);
  } finally {
    connecting = false;
    renderRemembered();
    renderList();
  }
}

function clearReader() {
  selectedId = null;
  selectionVersion += 1;
  currentMessage = null;
  bodyMode = "html";
  remoteImages = false;
  byId("html-body").hidden = true;
  byId("html-body").removeAttribute("srcdoc");
  byId("message").hidden = true;
  byId("reader-empty").hidden = false;
  byId("reader-empty").textContent = "Select a message";
  byId("body-controls").hidden = true;
  byId("body-kind").hidden = true;
  byId("body").hidden = false;
  byId("workspace").dataset.reading = "false";
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
  byId("load-images").textContent = remoteImages ? "Hide images" : "Show images";
  byId("html-body").hidden = true;
  byId("body").hidden = showHtml;
  byId("body-kind").hidden = true;
  if (showHtml) {
    try {
      byId("html-body").srcdoc = emailDocument(currentMessage.html_content, remoteImages);
      byId("html-body").hidden = false;
    } catch {
      byId("body").hidden = false;
      byId("body").textContent = messageBody(currentMessage).text;
      byId("body-kind").hidden = false;
      byId("body-kind").textContent = "Couldn't render HTML. Showing text.";
    }
  } else {
    byId("html-body").removeAttribute("srcdoc");
    byId("body").textContent = messageBody(currentMessage).text;
  }
}
function date(seconds) { return new Date(seconds * 1000).toLocaleString(); }
function renderList() {
  const list = byId("messages");
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = offset ? "No more messages" : "No mail yet";
    list.append(empty);
  }
  for (const email of rows) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "mail-item";
    item.dataset.id = email.id;
    item.setAttribute("aria-pressed", String(email.id === selectedId));
    item.disabled = busy();
    const subject = document.createElement("strong");
    subject.textContent = email.subject || "(No subject)";
    const detail = document.createElement("span");
    detail.textContent = email.from_address;
    item.title = date(email.received_at);
    item.append(subject, detail);
    item.addEventListener("click", () => void openMessage(email.id));
    list.append(item);
  }
  byId("message-count").textContent = rows.length ? `${rows.length}${rows.length === pageSize ? "+" : ""}` : "";
  byId("workspace").dataset.empty = String(rows.length === 0);
  byId("reader").hidden = rows.length === 0;
  byId("pagination").hidden = offset === 0 && rows.length < pageSize;
  byId("previous").disabled = busy() || listBusy || offset === 0;
  byId("next").disabled = busy() || listBusy || rows.length < pageSize;
  for (const id of ["refresh", "delete", "delete-mailbox"]) byId(id).disabled = busy() || listBusy;
  for (const id of ["close", "copy-address", "copy-link", "create-another", "reader-back"]) byId(id).disabled = busy();
  byId("refresh").textContent = listBusy ? "Refreshing..." : "Refresh";
  byId("page").textContent = `${offset / pageSize + 1}`;
  renderHome();
}
async function refresh(newOffset = offset, silent = false) {
  if (!session || busy() || listBusy) return;
  const active = session;
  listBusy = true;
  renderList();
  try {
    const data = await request(`/emails/${encodeURIComponent(active.email)}?limit=${pageSize}&offset=${newOffset}`, active);
    if (session !== active) return;
    if (!Array.isArray(data)) throw new Error("Couldn't refresh inbox.");
    offset = newOffset;
    rows = data;
    pollAllowed = true;
    if (selectedId && !rows.some(email => email.id === selectedId)) clearReader();
    if (!silent) status();
  } catch (error) {
    if (session === active) {
      if ([401, 403, 404].includes(error.status)) pollAllowed = false;
      report(error);
    }
  } finally {
    if (session === active) { listBusy = false; renderList(); }
  }
}
async function openMessage(id) {
  if (!session || busy()) return;
  const active = session;
  clearReader();
  selectedId = id;
  const version = selectionVersion;
  byId("workspace").dataset.reading = "true";
  byId("reader-empty").textContent = "Loading...";
  renderList();
  try {
    const email = await request(`/inbox/${encodeURIComponent(id)}`, active);
    if (session !== active || version !== selectionVersion) return;
    byId("subject").textContent = email.subject || "(No subject)";
    byId("sender").textContent = email.from_address;
    byId("received").textContent = date(email.received_at);
    currentMessage = email;
    renderBody();
    byId("message").hidden = false;
    byId("reader-empty").hidden = true;
    status();
    if (matchMedia("(max-width: 760px)").matches) byId("subject").focus();
  } catch (error) {
    if (session === active && version === selectionVersion) {
      byId("reader-empty").textContent = "Couldn't load message. Select it to retry.";
      report(error);
    }
  }
}
async function deleteMailbox() {
  if (!session || busy() || listBusy) return;
  const active = session;
  const confirmation = prompt(`Delete ${active.email} and ALL stored messages? This cannot be undone.\n\nType the full address to confirm:`);
  if (confirmation !== active.email) {
    if (confirmation !== null) status("Address didn't match. Nothing deleted.", true);
    return;
  }
  deleting = true;
  selectionVersion += 1;
  renderList();
  status("Deleting mailbox...");
  try {
    await request(`/claims/${encodeURIComponent(active.email)}`, { ...active, method: "DELETE" });
    if (session !== active) return;
    let forgotten = true;
    try {
      await forgetMailbox(active.email, active.key);
      deviceChannel?.postMessage("changed");
      await refreshRemembered();
    } catch { forgotten = false; }
    clearSession();
    homeView = "auto";
    byId("create").reset();
    status("Mailbox permanently deleted.", false, true);
    deviceWarning(forgotten ? "" : "Mailbox deleted. Use Forget to remove its saved entry.");
  } catch (error) { if (session === active) report(error); }
  finally { deleting = false; renderList(); renderRemembered(); }
}
async function deleteMessage() {
  if (!session || !selectedId || busy() || listBusy || !confirm("Delete this message?")) return;
  const active = session, id = selectedId;
  deleting = true;
  renderList();
  let removed = false;
  try {
    await request(`/inbox/${encodeURIComponent(id)}`, { ...active, method: "DELETE" });
    if (session !== active) return;
    clearReader();
    rows = rows.filter(email => email.id !== id);
    removed = true;
    status("Message deleted.", false, true);
  } catch (error) { if (session === active) report(error); }
  finally {
    if (session === active) {
      deleting = false;
      renderList();
      if (removed) await refresh(rows.length ? offset : Math.max(0, offset - pageSize), true);
    }
  }
}
async function copy(text, message) {
  try { await navigator.clipboard.writeText(text); status(message, false, true); }
  catch { status("Clipboard blocked. Select and copy the address instead.", true); }
}
function copyAccess() {
  const active = session || recovery;
  if (active) void copy(accessLink(location.origin, active.email, active.key), "Access link copied. Keep it private.");
}

byId("create").addEventListener("submit", event => {
  event.preventDefault();
  if (busy() || !domainsReady) return;
  const local = byId("name").value.trim() || `mail-${generateKey().slice(0, 12)}`;
  void loginMailbox(`${local}@${byId("domain").value}`, generateKey(), true);
});
byId("connect").addEventListener("submit", event => {
  event.preventDefault();
  void loginMailbox(byId("address").value.trim(), byId("key").value);
});
byId("mode-create").addEventListener("click", () => { homeView = "create"; status(); renderHome(); byId("name").focus(); });
byId("mode-open").addEventListener("click", () => { homeView = "open"; status(); renderHome(); byId("address").focus(); });
byId("new-mailbox").addEventListener("click", () => navigateHome("create"));
byId("open-other").addEventListener("click", () => navigateHome("open"));
byId("create-another").addEventListener("click", () => navigateHome("create"));
byId("back-saved").addEventListener("click", () => navigateHome("auto"));
byId("close").addEventListener("click", () => navigateHome("auto"));
byId("home-link").addEventListener("click", event => { event.preventDefault(); navigateHome("auto"); });
byId("retry-domains").addEventListener("click", () => void loadDomains());
byId("show-key").addEventListener("click", () => {
  const visible = byId("key").type === "password";
  byId("key").type = visible ? "text" : "password";
  byId("show-key").textContent = visible ? "Hide" : "Show";
  byId("show-key").setAttribute("aria-label", visible ? "Hide access key" : "Show access key");
  byId("show-key").setAttribute("aria-pressed", String(visible));
});
byId("settings-open").addEventListener("click", () => { byId("settings").showModal(); void updateProtection(); });
byId("settings-close").addEventListener("click", () => byId("settings").close());
byId("protect-storage").addEventListener("click", () => void updateProtection(true));
byId("retry-remember").addEventListener("click", async () => {
  const active = session || recovery;
  if (!active || busy()) return;
  connecting = true;
  renderHome();
  try {
    const saved = await saveRemembered(active.email, active.key);
    if (session === active) sessionSaved = saved;
    if (saved && recovery === active) recovery = null;
  } finally { connecting = false; renderHome(); }
});
byId("copy-backup").addEventListener("click", copyAccess);
byId("copy-link").addEventListener("click", () => { copyAccess(); byId("mailbox-options").open = false; });
byId("copy-address").addEventListener("click", () => { if (session) void copy(session.email, "Address copied."); });
byId("refresh").addEventListener("click", () => void refresh());
byId("previous").addEventListener("click", () => void refresh(Math.max(0, offset - pageSize)));
byId("next").addEventListener("click", () => void refresh(offset + pageSize));
byId("delete-mailbox").addEventListener("click", () => void deleteMailbox());
byId("delete").addEventListener("click", () => void deleteMessage());
byId("reader-back").addEventListener("click", () => {
  const id = selectedId;
  clearReader();
  byId("reader-empty").textContent = "Select a message";
  renderList();
  [...byId("messages").querySelectorAll("button")].find(button => button.dataset.id === id)?.focus();
});
byId("view-html").addEventListener("click", () => { bodyMode = "html"; renderBody(); });
byId("view-text").addEventListener("click", () => { bodyMode = "text"; renderBody(); });
byId("load-images").addEventListener("click", () => { remoteImages = !remoteImages; renderBody(); });
document.addEventListener("click", event => { if (!byId("mailbox-options").contains(event.target)) byId("mailbox-options").open = false; });
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && byId("mailbox-options").open) {
    byId("mailbox-options").open = false;
    byId("mailbox-options").querySelector("summary").focus();
  }
});
if (deviceChannel) deviceChannel.onmessage = () => void refreshRemembered();
window.addEventListener("focus", () => void refreshRemembered());
window.addEventListener("beforeunload", event => {
  if ((session && !sessionSaved) || recovery) { event.preventDefault(); event.returnValue = ""; }
});
setInterval(() => { if (!document.hidden && offset === 0 && pollAllowed) void refresh(0, true); }, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && offset === 0 && pollAllowed) void refresh(0, true); });
void loadDomains();
void refreshRemembered().then(() => {
  if (linked) {
    const { email, key } = linked;
    linked = null;
    homeView = "open";
    byId("address").value = email;
    byId("key").value = key;
    void loginMailbox(email, key);
  }
});
