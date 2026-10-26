import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const asset = (name) => readFile(new URL(`../public/app/${name}`, import.meta.url), "utf8");
const paths = (svg) => [...svg.matchAll(/<path\s+d="([^"]+)"\s*\/>/g)].map((match) => match[1]);

test("the shared app header uses the approved icon without a wordmark", async () => {
  const html = await asset("index.html");
  const brand = html.match(/<a\b[^>]*id="home-link"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(brand);
  assert.match(brand[0], /href="\/"/);
  assert.match(brand[0], /aria-label="Burnmail home"/);
  assert.match(brand[1], /<img\b[^>]*src="\/app\/burnmail\.svg"/);
  assert.match(brand[1], /width="80" height="44"/);
  assert.match(brand[1], /alt=""/);
  assert.equal(brand[1].replace(/<[^>]+>/g, "").trim(), "");
});

test("logo and favicon are transparent vectors with identical approved geometry", async () => {
  const [logo, favicon] = await Promise.all([asset("burnmail.svg"), asset("favicon.svg")]);
  assert.equal(paths(logo).length, 9);
  assert.deepEqual(paths(favicon), paths(logo));
  assert.match(logo, /viewBox="0 0 1000 540"/);
  assert.match(favicon, /viewBox="0 -230 1000 1000"/);
  for (const svg of [logo, favicon]) {
    assert.match(svg, /fill="#000"/);
    assert.doesNotMatch(svg, /<image\b|<rect\b|<script\b|<text\b|<foreignObject\b|data:image|(?:href|src)=/i);
    assert.ok(Buffer.byteLength(svg) < 6000);
  }
});

test("favicon adapts to dark tabs without turning the light app header white", async () => {
  const [html, logo, favicon, css] = await Promise.all([
    asset("index.html"), asset("burnmail.svg"), asset("favicon.svg"), asset("styles.css"),
  ]);
  assert.match(html, /rel="icon" href="\/app\/favicon\.svg" type="image\/svg\+xml"/);
  assert.match(favicon, /prefers-color-scheme:\s*dark/);
  assert.match(favicon, /fill:\s*#fff/);
  assert.doesNotMatch(logo, /prefers-color-scheme/);
  assert.match(css, /\.brand\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.brand-logo\s*\{[^}]*object-fit:\s*contain/);
});
