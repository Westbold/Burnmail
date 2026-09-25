// Device-only credentials. This module never performs a network request.
const databaseName = "burnmail-device-mailboxes";
const storeName = "mailboxes";
const unavailable = () => new Error("Browser storage is unavailable. Copy your access link before leaving.");

function openDatabase() {
  return new Promise((resolve, reject) => {
    let finished = false;
    let pending;
    const fail = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(unavailable());
    };
    const timer = setTimeout(fail, 5000);
    try {
      pending = indexedDB.open(databaseName, 1);
      pending.onupgradeneeded = () => {
        if (!pending.result.objectStoreNames.contains(storeName)) {
          pending.result.createObjectStore(storeName, { keyPath: "email" });
        }
      };
      pending.onerror = fail;
      pending.onblocked = fail;
      pending.onsuccess = () => {
        const db = pending.result;
        if (finished) { db.close(); return; }
        finished = true;
        clearTimeout(timer);
        db.onversionchange = () => db.close();
        resolve(db);
      };
    } catch { fail(); }
  });
}

async function transact(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx;
    let result;
    const fail = () => { clearTimeout(timer); db.close(); reject(unavailable()); };
    const timer = setTimeout(() => {
      try { tx?.abort(); } catch { /* It may already have completed. */ }
      fail();
    }, 5000);
    try {
      // Older engines can reject the durability option; do not downgrade other errors.
      try { tx = db.transaction(storeName, mode, { durability: "strict" }); }
      catch (error) {
        if (error.name !== "TypeError") throw error;
        tx = db.transaction(storeName, mode);
      }
      tx.oncomplete = () => { clearTimeout(timer); db.close(); resolve(result?.result); };
      tx.onabort = fail;
      tx.onerror = fail;
      result = operation(tx.objectStore(storeName));
    } catch {
      try { tx?.abort(); } catch { /* Preserve the storage failure. */ }
      fail();
    }
  });
}

function valid(record) {
  return record && typeof record.email === "string" && record.email.trim() &&
    typeof record.key === "string" && record.key.length > 0 && Number.isFinite(record.lastUsedAt);
}

// Only metadata goes to the switcher. Read a key separately when Login is clicked.
export async function listMailboxes() {
  const records = await transact("readonly", store => store.getAll());
  return records.filter(valid).sort((a, b) => b.lastUsedAt - a.lastUsedAt || a.email.localeCompare(b.email))
    .map(({ email, lastUsedAt }) => ({ email, lastUsedAt }));
}

export async function getMailbox(email) {
  const record = await transact("readonly", store => store.get(email.trim()));
  return valid(record) ? record : null;
}

export async function rememberMailbox(email, key) {
  const record = { email: email.trim(), key, lastUsedAt: Date.now() };
  if (!valid(record)) throw new Error("A mailbox address and access key are required.");
  // No expiration, record limit, pruning, server synchronization, or stored message bodies.
  await transact("readwrite", store => store.put(record));
}

export async function forgetMailbox(email, expectedKey) {
  await transact("readwrite", store => {
    if (expectedKey === undefined) return store.delete(email.trim());
    const lookup = store.get(email.trim());
    lookup.onsuccess = () => {
      // A different tab may have logged in again with a newly issued key.
      if (lookup.result?.key === expectedKey) store.delete(email.trim());
    };
    return lookup;
  });
}

export async function storageProtection(request = false) {
  try {
    if (!navigator.storage?.persisted) return "unsupported";
    if (await navigator.storage.persisted()) return "persistent";
    if (request && navigator.storage.persist && await navigator.storage.persist()) return "persistent";
    return "best-effort";
  } catch { return "unavailable"; }
}
