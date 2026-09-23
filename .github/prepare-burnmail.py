"""One-time maintenance preparation; not included in the published source tree."""
from pathlib import Path
import json
import re


def write(name, content):
    path = Path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def replace(name, old, new):
    path = Path(name)
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f"Expected source changed: {name}")
    path.write_text(text.replace(old, new))


# Rename product-facing text, not the existing repository, Worker, or database IDs.
for name in ["README.md", "CLAUDE.md", "src/utils/docs.ts", *map(str, Path("documentation").glob("*.md"))]:
    path = Path(name)
    text = path.read_text()
    text = text.replace("Passworthy Temp Email", "Burnmail").replace("Passworthy Inbox", "Burnmail")
    text = text.replace("for Passworthy", "for Burnmail").replace("# Passworthy", "# Burnmail")
    path.write_text(text)
replace("public/app/index.html", "<title>Passworthy Inbox</title>", "<title>Burnmail</title>")
replace("public/app/index.html", 'PASSWORTHY <span>INBOX</span>', 'BURNMAIL <span>INBOX</span>')
replace("public/app/index.html", 'href="/app/"', 'href="/"')
replace("public/app/index.html", '<a href="/" target="_blank"', '<a href="/api-docs" target="_blank"')

# Process links before other page code, retain fragment compatibility, and never auto-claim.
replace("public/app/api.js", 'new URL("/app/", origin)', 'new URL("/", origin)')
replace("public/app/api.js", 'export function parseAccessLink(hash) {\n  const values = new URLSearchParams(hash.replace(/^#/, ""));', 'export function parseAccessLink(parameters) {\n  const values = new URLSearchParams(parameters.replace(/^[#?]/, ""));')
replace("public/app/api.js", '  return email && key ? { email, key } : null;', '  return values.getAll("email").length === 1 && values.getAll("key").length === 1 && email && key ? { email, key } : null;')
with Path("public/app/api.js").open("a") as out:
    out.write('''
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
''')
replace("public/app/app.js", 'messageBody, parseAccessLink, request', 'messageBody, consumeAccessLink, request')
replace("public/app/app.js", 'const byId = (id)', '// Clear URL credentials before starting any API requests.\nlet linked = consumeAccessLink(location, history);\n\nconst byId = (id)')
replace("public/app/app.js", 'let linked = parseAccessLink(location.hash);\nif (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);\n', '')
# Keys are opaque. Do not silently change a URL-supplied key by trimming it.
replace("public/app/app.js", 'const key = byId("key").value.trim();', 'const key = byId("key").value;')

write("src/handlers/httpHandler.ts", '''import app from "@/app";

const documentPaths = new Set(["/", "/app", "/app/", "/app/index.html"]);

function privateRedirect(url: URL): Response {
	return new Response(null, {
		status: 302,
		headers: {
			Location: url.href,
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
			"X-Robots-Tag": "noindex, nofollow",
		},
	});
}

/** Move query credentials into a browser-only fragment before serving the UI. */
function cleanLoginQuery(url: URL): boolean {
	if (!url.searchParams.has("email") && !url.searchParams.has("key")) return false;
	const credentials = new URLSearchParams();
	for (const name of ["email", "key"]) {
		for (const value of url.searchParams.getAll(name)) credentials.append(name, value);
		url.searchParams.delete(name);
	}
	url.hash = credentials.toString();
	return true;
}

function redirectToApp(source: URL, hostname: string): Response {
	const target = new URL(source.href);
	target.protocol = "https:";
	target.host = hostname;
	target.port = "";
	target.pathname = "/";
	cleanLoginQuery(target);
	return privateRedirect(target);
}

function hostRedirect(url: URL, env: CloudflareBindings): Response | undefined {
	const root = env.ROOT_HOSTNAME?.trim().toLowerCase();
	const appHost = env.APP_HOSTNAME?.trim().toLowerCase();
	const apiHost = env.API_HOSTNAME?.trim().toLowerCase();
	if (!appHost) return;
	const inZone = root && (url.hostname === root || url.hostname.endsWith(`.${root}`));
	if (inZone && url.hostname !== appHost && url.hostname !== apiHost) {
		return redirectToApp(url, appHost);
	}
	// Preserve old webmail links, including their fragments, without moving API docs.
	if (url.pathname !== "/" && documentPaths.has(url.pathname)) {
		return redirectToApp(url, appHost);
	}
}

export async function handleHttp(
	request: Request,
	env: CloudflareBindings,
	ctx: ExecutionContext,
): Promise<Response> {
	const url = new URL(request.url);
	const navigation = request.method === "GET" || request.method === "HEAD";
	const redirected = hostRedirect(url, env);
	if (redirected) {
		return navigation ? redirected : new Response("Method not allowed", { status: 405 });
	}
	const appHost = env.APP_HOSTNAME?.trim().toLowerCase();
	const isApp = Boolean(appHost && url.hostname === appHost);

	if (url.pathname === "/api-docs" && navigation) {
		const docs = new URL("/", url);
		if (env.API_HOSTNAME) {
			docs.protocol = "https:";
			docs.host = env.API_HOSTNAME.trim().toLowerCase();
			docs.port = "";
		}
		return privateRedirect(docs);
	}

	const webmailDocument = (isApp && url.pathname === "/") || url.pathname === "/app/";
	if (navigation && webmailDocument && cleanLoginQuery(url)) return privateRedirect(url);
	if (navigation && (webmailDocument || url.pathname.startsWith("/app/"))) {
		if (!env.ASSETS) return new Response("Static assets unavailable", { status: 503 });
		const asset = new URL(request.url);
		if (webmailDocument) asset.pathname = "/app/";
		asset.search = "";
		asset.hash = "";
		const response = await env.ASSETS.fetch(new Request(asset.href, request));
		const result = new Response(response.body, response);
		result.headers.set("Referrer-Policy", "no-referrer");
		if (webmailDocument) result.headers.set("Cache-Control", "no-store");
		return result;
	}
	return app.fetch(request, env, ctx);
}
''')
replace("src/index.ts", 'import app from "@/app";', 'import { handleHttp } from "@/handlers/httpHandler";')
replace("src/index.ts", 'fetch: app.fetch,', 'fetch: handleHttp,')
replace("src/env.d.ts", 'interface CloudflareBindings {', 'interface CloudflareBindings {\n\tAPI_HOSTNAME?: string;\n\tAPP_HOSTNAME?: string;\n\tROOT_HOSTNAME?: string;\n\tASSETS?: Fetcher;')
config = json.loads(Path("wrangler.jsonc").read_text())
config["assets"]["binding"] = "ASSETS"
config["assets"]["run_worker_first"] = True
write("wrangler.jsonc", json.dumps(config, indent="\t") + "\n")

# Inject real hostnames only into an ignored, short-lived deployment file.
replace("scripts/deploy.ts", '\t\tconfig.routes = [{ pattern: hostname, custom_domain: true }];', '''		const appHost = process.env.APP_HOSTNAME?.trim().toLowerCase();
		const rootHost = process.env.ROOT_HOSTNAME?.trim().toLowerCase();
		if (!appHost || !rootHost || appHost !== `app.${rootHost}` || hostname !== `api.${rootHost}`) {
			throw new Error("Set matching APP_HOSTNAME, ROOT_HOSTNAME, and API_HOSTNAME privately");
		}
		config.routes = [
			{ pattern: hostname, custom_domain: true },
			{ pattern: appHost, custom_domain: true },
			{ pattern: rootHost, custom_domain: true },
			{ pattern: `*.${rootHost}/*`, zone_name: rootHost },
		];''')
replace("scripts/deploy.ts", '\t\tconst smoke = Bun.spawn', '\t\tawait redactQueryLogs(config.account_id, config.name);\n\t\tconst smoke = Bun.spawn')
# The pinned Wrangler predates this setting. Enforce it through the current API after each upload.
insert = '''
async function redactQueryLogs(account: string, worker: string): Promise<void> {
	const token = process.env.CLOUDFLARE_API_TOKEN;
	if (!token) throw new Error("Set CLOUDFLARE_API_TOKEN to enforce query-log redaction after deployment");
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${account}/workers/workers/${worker}`,
		{
			method: "PUT",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ name: worker, observability: { enabled: true, redact_query_string: true } }),
		},
	);
	if (!response.ok) throw new Error("Could not enforce query-log redaction; check Worker configuration");
	console.log("PASS Worker query-string log redaction enabled");
}

'''
replace("scripts/deploy.ts", 'async function main(): Promise<void> {', insert + 'async function main(): Promise<void> {')
replace("scripts/private-config.ts", '[process.env.API_HOSTNAME,', '[process.env.API_HOSTNAME, process.env.APP_HOSTNAME, process.env.ROOT_HOSTNAME,')
replace("scripts/deploy.ts", '\t\tif ((await smoke.exited) !== 0) {', '\t\tif ((await smoke.exited) !== 0) {')
replace("scripts/smoke.ts", '\tconsole.log("PASS temporary claim removed; no test recipient or key logged");', '\tconsole.log("PASS temporary claim removed; no test recipient or key logged");\n\tawait checkWebmail();')
replace("scripts/smoke.ts", 'import { resolveMx } from "node:dns/promises";', 'import { resolveMx } from "node:dns/promises";\nimport { checkWebmail } from "./webmail-smoke";')

write("scripts/webmail-smoke.ts", '''/** Read-only checks. Never print hostnames, login URLs, or credentials. */
export async function checkWebmail(): Promise<void> {
	const appHost = process.env.APP_HOSTNAME;
	const rootHost = process.env.ROOT_HOSTNAME;
	const apiHost = process.env.API_HOSTNAME;
	if (!appHost || !rootHost || !apiHost) throw new Error("Webmail host configuration missing");
	const appOrigin = `https://${appHost}`;
	async function get(url: string): Promise<Response> {
		return fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
	}
	function check(ok: unknown, label: string): asserts ok {
		if (!ok) throw new Error(`Webmail smoke test failed: ${label}`);
	}
	const ui = await get(appOrigin);
	const html = await ui.text();
	check(ui.status === 200 && html.includes("<title>Burnmail</title>"), "app root");
	check(html.includes('href="/api-docs"'), "docs link");
	const docs = await get(`${appOrigin}/api-docs`);
	check(docs.status === 302 && docs.headers.get("location") === `https://${apiHost}/`, "docs target");
	const api = await get(`https://${apiHost}/`);
	check(api.status === 200 && (await api.text()).includes("api-reference"), "API root docs");
	for (const host of [rootHost, `unconfigured-smoke.${rootHost}`]) {
		const response = await get(`https://${host}/`);
		check(response.status === 302 && response.headers.get("location") === `${appOrigin}/`, "hostname redirect");
	}
	for (const path of ["/app/app.js", "/app/api.js", "/app/styles.css"]) {
		check((await get(appOrigin + path)).status === 200, "static asset");
	}
	const query = new URLSearchParams({ email: "inbox@example.test", key: "test+&=#value" });
	const login = await get(`${appOrigin}/?${query}`);
	check(login.status === 302, "query credential cleanup");
	const target = new URL(login.headers.get("location") ?? "", appOrigin);
	check(!target.search && target.origin === appOrigin, "login redirect origin");
	check(new URLSearchParams(target.hash.slice(1)).get("key") === "test+&=#value", "encoded key");
	check((await get(`${appOrigin}/emails/not-a-real-endpoint/invalid`)).status !== 200, "no API HTML fallback");
	console.log("PASS Burnmail app, docs link, apex and wildcard redirects, assets, and query login cleanup");
}
''')

# Update config expectations without discarding the existing API/client tests.
replace("tests/frontend.test.js", 'messageBody, parseAccessLink, request', 'messageBody, parseAccessLink, consumeAccessLink, request')
replace("tests/frontend.test.js", 'assert.equal(url.pathname, "/app/");', 'assert.equal(url.pathname, "/");')
path = Path("tests/frontend.test.js")
text = path.read_text()
start = text.index('  for (const route of ["/", "/claims/*"')
end = text.index('  await assert.rejects', start)
text = text[:start] + '  assert.equal(config.assets.run_worker_first, true);\n  assert.equal(config.assets.binding, "ASSETS");\n' + text[end:]
path.write_text(text)
with path.open("a") as out:
    out.write('''

test("query login round-trips email and opaque keys and removes credentials from history", () => {
  const email = "name+tag@example.test";
  const key = "a+b&c=#/?";
  const url = new URL("https://app.example.test/?view=inbox");
  url.searchParams.set("email", email);
  url.searchParams.set("key", key);
  let clean;
  assert.deepEqual(consumeAccessLink(url, { replaceState: (_state, _title, path) => { clean = path; } }), { email, key });
  assert.equal(clean, "/?view=inbox");
});

test("fragment login remains supported and the key never goes in a copied query", () => {
  const url = new URL(accessLink("https://app.example.test", "inbox@example.test", "key+value"));
  let clean;
  assert.deepEqual(consumeAccessLink(url, { replaceState: (_s, _t, path) => { clean = path; } }), { email: "inbox@example.test", key: "key+value" });
  assert.equal(clean, "/");
  assert.equal(url.search, "");
});

test("incomplete and duplicate login parameters do not open or combine credentials", () => {
  for (const suffix of ["?email=x%40example.test#key=secret", "?key=one&key=two&email=x%40example.test", "?email=x%40example.test&key="]) {
    let clean;
    assert.equal(consumeAccessLink(new URL("https://app.example.test/" + suffix), { replaceState: (_s, _t, path) => { clean = path; } }), null);
    assert.equal(clean, "/");
  }
});

test("Burnmail branding and the API documentation link are present", async () => {
  const html = await readFile(new URL("../public/app/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("<title>Burnmail</title>"));
  assert.ok(html.includes('href="/api-docs"'));
  assert.ok(!html.includes("PASSWORTHY"));
});
''')

write("src/handlers/httpHandler.test.ts", '''import { expect, test } from "bun:test";
import { handleHttp } from "./httpHandler";

const env = {
	APP_HOSTNAME: "app.example.test",
	API_HOSTNAME: "api.example.test",
	ROOT_HOSTNAME: "example.test",
	EMAIL_DOMAINS: "example.test",
	ASSETS: { fetch: async (request: Request) => new Response(new URL(request.url).pathname) },
} as unknown as CloudflareBindings;
const ctx = { waitUntil() {}, passThroughOnException() {} } as ExecutionContext;
const get = (url: string) => handleHttp(new Request(url), env, ctx);

test("app root serves static webmail, while API and workers.dev roots keep docs", async () => {
	expect(await (await get("https://app.example.test/")).text()).toBe("/app/");
	for (const origin of ["https://api.example.test", "https://fixture.workers.dev"]) {
		const response = await get(`${origin}/`);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("api-reference");
	}
});

test("apex and unknown hostnames redirect to the fixed app root", async () => {
	for (const host of ["example.test", "unknown.example.test", "other.example.test"]) {
		for (const path of ["/", "/whatever", "/app/styles.css"]) {
			const response = await get(`https://${host}${path}`);
			expect(response.status).toBe(302);
			expect(response.headers.get("Location")).toBe("https://app.example.test/");
		}
	}
});

test("legacy webmail links redirect without taking over the API root", async () => {
	for (const path of ["/app", "/app/", "/app/index.html"]) {
		const response = await get(`https://api.example.test${path}`);
		expect(response.headers.get("Location")).toBe("https://app.example.test/");
	}
	expect((await get("https://api.example.test/")).status).toBe(200);
});

test("query credentials survive redirects without remaining in the query string", async () => {
	const query = new URLSearchParams({ email: "inbox+tag@example.test", key: "a+b&=#/?" });
	for (const host of ["app.example.test", "example.test", "random.example.test"]) {
		const response = await get(`https://${host}/?${query}`);
		const target = new URL(response.headers.get("Location") ?? "");
		expect(target.origin).toBe("https://app.example.test");
		expect(target.search).toBe("");
		expect(new URLSearchParams(target.hash.slice(1)).get("email")).toBe("inbox+tag@example.test");
		expect(new URLSearchParams(target.hash.slice(1)).get("key")).toBe("a+b&=#/?");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
	}
});

test("app docs link redirects to API docs without carrying credentials", async () => {
	const response = await get("https://app.example.test/api-docs?email=foo&key=secret");
	expect(response.headers.get("Location")).toBe("https://api.example.test/");
});

test("API requests on the app origin remain API requests", async () => {
	const response = await get("https://app.example.test/domains");
	expect(response.status).toBe(200);
	expect((await response.json()) as unknown).toEqual({ success: true, result: ["example.test"] });
	const missing = await get("https://app.example.test/emails/invalid/endpoint");
	expect(missing.status).toBe(404);
	expect(await missing.text()).not.toBe("/app/");
});

test("non-navigation requests to unknown hosts are not replayed to another origin", async () => {
	const response = await handleHttp(new Request("https://unknown.example.test/", { method: "POST", body: "private" }), env, ctx);
	expect(response.status).toBe(405);
	expect(response.headers.has("Location")).toBe(false);
});
''')

# Keep operator documentation accurate without writing any deployed hostname into Git.
readme = Path("README.md").read_text()
readme = readme.replace("## API quick start", '''## Webmail

Burnmail lives at the root of the privately configured app hostname. The API hostname's
root remains the API documentation. The receiving zone's apex and unconfigured subdomains
redirect to the app. Old `/app/` webmail links redirect to its new root.

The app header links to `/api-docs`, which redirects to the configured API documentation.
An existing mailbox can be opened with `/?email=<URL-encoded-address>&key=<URL-encoded-key>`.
Use `URLSearchParams` to encode both values, especially `+`, `&`, `#`, and `=`. Opening a
link never claims a new address. Missing, invalid, or wrong credentials do not bypass auth.

The Worker converts login query parameters to a fragment; the browser consumes the
credentials, clears them from its current history entry, and opens the inbox with its
bearer header. Copied access links still use `#email=...&key=...` by default. Both forms
are full-access credentials, not read-only links. Query links reach the server on their
first request and can be retained outside this application; prefer fragments when possible.
The deployment enables Worker query-string log redaction. Do not share real links publicly.

## API quick start''')
readme = readme.replace('| `API_HOSTNAME` | Cloudflare Builds secret | Custom API hostname inserted only into a temporary deploy config |', '| `API_HOSTNAME`, `APP_HOSTNAME`, `ROOT_HOSTNAME` | Worker and Cloudflare Builds secrets | Host routing and temporary deployment routes; no hostname literals in Git |')
readme = readme.replace("The deployment serves interactive documentation at `/`,", "The API hostname serves interactive documentation at `/`,")
readme = readme.replace("injects the custom hostname", "injects the private hostnames")
readme = readme.replace("API/DNS smoke tests", "API/DNS/webmail smoke tests")
readme += '\nThe Cloudflare Worker and D1 identifiers retain their existing deployment names to avoid\nrecreating resources or disrupting inboxes. Product UI and API titles use Burnmail.\n'
Path("README.md").write_text(readme)
write("documentation/06_frontend.md", '''# Burnmail webmail

## Host routing

The private `APP_HOSTNAME` serves the static inbox at `/`. The private `API_HOSTNAME`
continues to serve API docs at `/`, Swagger at `/swagger`, and OpenAPI at `/openapi.json`.
The private `ROOT_HOSTNAME` apex and its other subdomains redirect to the app root.
Unknown paths on the app/API do not get a global SPA fallback.

The header's **API docs** link uses `/api-docs`. The Worker sends it to the configured
API origin without propagating query parameters or login credentials. Existing `/app/`
links redirect to the app root. All browser API calls remain same-origin.

The Worker runs before asset handling for host routing and URL credential cleanup.
Its `ASSETS` binding serves the files in `public/`; the UI remains static HTML/CSS/JS.
The app root internally serves `public/app/index.html`. Script/style paths remain `/app/*`.
The existing API, D1 database, mail routing, and claim permissions are unchanged.

## URL login

An existing inbox opens with either `/?email=recipient%40example.test&key=YOUR_KEY`
or `/#email=recipient%40example.test&key=YOUR_KEY`. Use `URLSearchParams` to encode the
values rather than concatenating them. Query credentials take precedence when present;
incomplete query values are not combined with a fragment's values. Duplicates are rejected.

Query credentials are redirected to a fragment before the HTML is served. Responses
use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The browser removes
credentials from the current URL/history entry before starting API calls, keeps them
only in memory, and uses the original bearer-header API. It never creates a claim from
a link. Opening fails for unclaimed inboxes or incorrect keys.

A query link still sends credentials in the initial HTTPS request and can be retained
in upstream logs or external history. Worker query-string log redaction is enforced by
the deployment script. The **Copy access link** button produces fragment links by default.
Both link forms grant full existing mailbox authority; neither is read-only or expiring.

## Client behavior and safety

Claiming requires an explicit **Claim & open** action. Generate a key and save it first.
Credentials are never saved in cookies or local/session storage. Closing/reloading requires
supplying the original key or link. Closing the UI does not release the address claim.

Messages are listed 20 per page. Auto-refresh runs every 15 seconds on the first page
while visible. Authorization errors pause polling. Text and HTML-source bodies are
rendered with `textContent`, not executable markup. Deletion asks for confirmation.

## Deployment

No frontend build dependency or separate Pages project is needed. `scripts/deploy.ts`
generates routes from private settings: app/API/apex custom domains plus a wildcard
Worker route. A proxied wildcard DNS record is required for unknown subdomains. Existing
specific DNS entries take precedence; this does not route incoming email for extra domains.
Standard zone TLS covers the apex and one-level subdomains, not arbitrary nested names.

The registered Worker name and D1 identifiers stay unchanged; the product is Burnmail.
Production deployment runs API/DNS checks plus webmail assets, branding, docs target,
apex/wildcard redirects, and query-credential cleanup checks. Unit tests cover routing,
query/fragment parsing, malformed links, and preserved API behavior.

Use `bun test`, `bun run tsc`, `bun run check`, and `bun run deploy --dry-run --outdir dist`.
Set runtime secrets and private build settings before a real deploy. Live domains and
hostname values must never be added to source, examples, tests, or documentation.
''')
# Do not publish the temporary preparation helper itself.
Path(".github/prepare-burnmail.py").unlink()
print("Prepared Burnmail changes without deployed hostname literals")
