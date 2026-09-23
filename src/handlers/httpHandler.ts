import app from "@/app";

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

/** Query links reach the server once; use a fragment for all subsequent navigation. */
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
	// Old webmail links retain their fragment when Location has no explicit fragment.
	if (url.pathname !== "/" && documentPaths.has(url.pathname)) {
		return redirectToApp(url, appHost);
	}
}

function docsRedirect(url: URL, env: CloudflareBindings): Response {
	const docs = new URL("/", url);
	if (env.API_HOSTNAME) {
		docs.protocol = "https:";
		docs.host = env.API_HOSTNAME.trim().toLowerCase();
		docs.port = "";
	}
	return privateRedirect(docs);
}

async function serveWebmail(request: Request, env: CloudflareBindings): Promise<Response> {
	if (!env.ASSETS) return new Response("Static assets unavailable", { status: 503 });
	const asset = new URL(request.url);
	const document = documentPaths.has(asset.pathname);
	if (document && cleanLoginQuery(asset)) return privateRedirect(asset);
	if (document) asset.pathname = "/app/";
	asset.search = "";
	asset.hash = "";
	const response = await env.ASSETS.fetch(new Request(asset.href, request));
	const result = new Response(response.body, response);
	result.headers.set("Referrer-Policy", "no-referrer");
	if (document) result.headers.set("Cache-Control", "no-store");
	return result;
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
	if (!navigation) return app.fetch(request, env, ctx);
	if (url.pathname === "/api-docs") return docsRedirect(url, env);
	const isApp = url.hostname === env.APP_HOSTNAME?.trim().toLowerCase();
	const appRoot = isApp && url.pathname === "/";
	if (appRoot || url.pathname.startsWith("/app/")) return serveWebmail(request, env);
	return app.fetch(request, env, ctx);
}
