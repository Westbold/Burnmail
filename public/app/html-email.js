import DOMPurify from "./vendor/purify.es.mjs";

// Defense in depth: sanitize first, then render in an opaque-origin, scriptless frame.
// Never insert sender markup into the application's own DOM.
const forbiddenTags = [
  "script", "iframe", "frame", "frameset", "object", "embed", "applet",
  "base", "link", "meta", "form", "input", "button", "textarea", "select",
  "option", "video", "audio", "source", "track", "template", "noscript",
];

function safeLink(value) {
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function safeImage(value, loadRemoteImages) {
  // No SVG or arbitrary data documents; embedded raster images are passive content.
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  if (!loadRemoteImages) return null;
  const url = safeLink(value);
  return url && /^https?:/i.test(url) ? url : null;
}

export function emailDocument(html, loadRemoteImages = false) {
  if (!DOMPurify.isSupported) throw new Error("This browser cannot safely display HTML email. Use the text view.");
  const clean = DOMPurify.sanitize(String(html), {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    USE_PROFILES: { html: true },
    FORBID_TAGS: forbiddenTags,
    FORBID_ATTR: ["srcset", "ping", "srcdoc", "action", "formaction", "autofocus", "contenteditable", "is"],
    ALLOW_DATA_ATTR: false,
  });
  for (const anchor of clean.querySelectorAll("a")) {
    const href = safeLink(anchor.getAttribute("href") || "");
    if (href) {
      anchor.setAttribute("href", href);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
      anchor.setAttribute("referrerpolicy", "no-referrer");
    } else {
      anchor.removeAttribute("href");
      anchor.removeAttribute("target");
    }
  }
  for (const image of clean.querySelectorAll("img")) {
    const src = safeImage(image.getAttribute("src") || "", loadRemoteImages);
    if (src) image.setAttribute("src", src);
    else image.removeAttribute("src");
    image.setAttribute("referrerpolicy", "no-referrer");
  }

  const head = clean.querySelector("head");
  const owner = clean.ownerDocument;
  const csp = owner.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", [
    "default-src 'none'", "script-src 'none'", "style-src 'unsafe-inline'",
    `img-src data:${loadRemoteImages ? " https: http:" : ""}`,
    "font-src 'none'", "connect-src 'none'", "media-src 'none'",
    "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
  ].join("; "));
  const referrer = owner.createElement("meta");
  referrer.setAttribute("name", "referrer");
  referrer.setAttribute("content", "no-referrer");
  const viewport = owner.createElement("meta");
  viewport.setAttribute("name", "viewport");
  viewport.setAttribute("content", "width=device-width, initial-scale=1");
  const defaults = owner.createElement("style");
  defaults.textContent = "html{color-scheme:light}body{margin:12px;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%}";
  // CSP comes before sender-controlled styles or body content. Email CSS remains isolated.
  head.prepend(csp, referrer, viewport, defaults);
  return `<!doctype html>\n${clean.outerHTML}`;
}
