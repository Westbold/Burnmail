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
  const url = new URL("/app/", origin);
  url.hash = new URLSearchParams({ email, key }).toString();
  return url.href;
}

export function parseAccessLink(hash) {
  const values = new URLSearchParams(hash.replace(/^#/, ""));
  const email = values.get("email");
  const key = values.get("key");
  return email && key ? { email, key } : null;
}

// Deliberately return text, never trusted markup. The UI uses textContent only.
export function messageBody(message) {
  if (message.text_content) return { label: "Plain text", text: message.text_content };
  if (message.html_content) return { label: "HTML source (not rendered)", text: message.html_content };
  return { label: "Plain text", text: "This message has no stored body." };
}
