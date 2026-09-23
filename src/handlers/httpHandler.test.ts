import { expect, test } from "bun:test";
import { handleHttp } from "./httpHandler";

const env = {
	APP_HOSTNAME: "app.example.test",
	API_HOSTNAME: "api.example.test",
	ROOT_HOSTNAME: "example.test",
	EMAIL_DOMAINS: "example.test",
	ASSETS: { fetch: async (request: Request) => new Response(new URL(request.url).pathname) },
} as unknown as CloudflareBindings;
const ctx = { props: {}, waitUntil() {}, passThroughOnException() {} } as ExecutionContext;
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
	const response = await handleHttp(
		new Request("https://unknown.example.test/", { method: "POST", body: "private" }),
		env,
		ctx,
	);
	expect(response.status).toBe(405);
	expect(response.headers.has("Location")).toBe(false);
});
