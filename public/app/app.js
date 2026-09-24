import { accessLink, generateKey, messageBody, consumeAccessLink, request } from "./api.js";

import { emailDocument } from "./html-email.js";

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
    item.disabled = deleting;
    const subject = document.createElement("strong");
    subject.textContent = email.subject || "(No subject)";
    const detail = document.createElement("span");
    detail.textContent = `${email.from_address} - ${date(email.received_at)}`;
    item.append(subject, detail);
    item.addEventListener("click", () => void openMessage(email.id));
    list.append(item);
  }
  byId("previous").disabled = listBusy || deleting || offset === 0;
  byId("next").disabled = listBusy || deleting || rows.length < pageSize;
  byId("refresh").disabled = listBusy || deleting;
  byId("delete").disabled = listBusy || deleting;
  byId("delete-mailbox").disabled = listBusy || deleting;
  byId("close").disabled = deleting;
  byId("copy-address").disabled = deleting;
  byId("copy-link").disabled = deleting;
  byId("page").textContent = `Page ${offset / pageSize + 1}`;
}

async function refresh(newOffset = offset, silent = false) {
  if (!session || listBusy || deleting) return;
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
  if (!session || deleting) return;
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

byId("connect").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = byId("address").value.trim();
  const key = byId("key").value;
  const claim = event.submitter?.value === "claim";
  if (claim && !confirm(`Claim ${email} with this key? Save your key first; it cannot be recovered.`)) return;
  byId("credentials").disabled = true;
  status(claim ? "Claiming address..." : "Opening inbox...");
  const controller = new AbortController();
  const active = { email, key, signal: controller.signal, controller };
  try {
    if (claim) await request(`/claims/${encodeURIComponent(email)}`, { ...active, method: "PUT" });
    const data = await request(`/emails/${encodeURIComponent(email)}?limit=${pageSize}&offset=0`, active);
    if (!Array.isArray(data)) throw new Error("The API returned an invalid message list.");
    session = active;
    offset = 0;
    rows = data;
    pollAllowed = true;
    byId("mailbox-address").textContent = email;
    byId("key").value = "";
    byId("key").type = "password";
    byId("login").hidden = true;
    byId("mailbox").hidden = false;
    clearReader();
    renderList();
    status("Inbox open. Save your access link before leaving this page.");
  } catch (error) {
    controller.abort();
    report(error);
  } finally {
    byId("credentials").disabled = false;
  }
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
});

byId("refresh").addEventListener("click", () => void refresh());
byId("previous").addEventListener("click", () => void refresh(Math.max(0, offset - pageSize)));
byId("next").addEventListener("click", () => void refresh(offset + pageSize));

byId("delete").addEventListener("click", async () => {
  if (!session || !selectedId || deleting || listBusy) return;
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
