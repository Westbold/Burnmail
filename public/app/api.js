// No configured hostname: API requests always go to this deployment's origin.
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function request(path, { key, method = "GET", signal } = {}) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Only same-origin API paths are allowed.");
  }
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(path, {
    method,
    headers: key ? { Accept: "application/json", Authorization: `Bearer ${key}` } : { Accept: "application/json" },
    credentials: "omit",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success !== true) {
    throw new ApiError(data?.error?.message || `API request failed (${response.status}).`, response.status);
  }
  return data.result;
}

export function generateKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function accessLink(origin, email, key) {
  const url = new URL("/", origin);
  url.hash = new URLSearchParams({ email, key }).toString();
  return url.href;
}

export function parseAccessLink(parameters) {
  const values = new URLSearchParams(parameters.replace(/^[#?]/, ""));
  const email = values.get("email");
  const key = values.get("key");
  return values.getAll("email").length === 1 && values.getAll("key").length === 1 && email && key ? { email, key } : null;
}

// Plain-text alternative only. HTML is handled separately by the isolated email renderer.
export function messageBody(message) {
  if (message.text_content) return { label: "Plain text", text: message.text_content };
  if (message.html_content) return { label: "HTML source (not rendered)", text: message.html_content };
  return { label: "Plain text", text: "This message has no stored body." };
}

// Never combine half a query credential with half a fragment credential.
export function consumeAccessLink(location, history) {
  const url = new URL(location.href);
  const query = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const queryHasCredentials = query.has("email") || query.has("key");
  const fragmentHasCredentials = fragment.has("email") || fragment.has("key");
  const linked = queryHasCredentials ? parseAccessLink(url.search) : parseAccessLink(url.hash);
  if (queryHasCredentials || fragmentHasCredentials) {
    query.delete("email");
    query.delete("key");
    fragment.delete("email");
    fragment.delete("key");
    url.search = query.toString();
    url.hash = fragment.toString();
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return linked;
}
