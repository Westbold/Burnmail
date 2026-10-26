import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	CLIENT_CAPABILITIES_META_KEY,
	PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import app from "@/app";
import { handleEmail } from "@/handlers/emailHandler";
import { handleHttp } from "@/handlers/httpHandler";
import type { Email } from "@/schemas/emails";

const databases: Database[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});
const ctx = { props: {}, waitUntil() {}, passThroughOnException() {} } as ExecutionContext;
const endpoint = "https://api.example.test/mcp";
const schema = readFileSync(
	fileURLToPath(new URL("../../sql/schema.sql", import.meta.url).href),
	"utf8",
);
const allow = { limit: async () => ({ success: true }) } as RateLimit;

function fixture() {
	const sql = new Database(":memory:");
	databases.push(sql);
	sql.exec(schema);
	// Execute real SQL in SQLite instead of mocking mailbox/auth behavior.
	const D1 = {
		prepare(query: string) {
			let values: (string | number | null)[] = [];
			return {
				bind(...args: (string | number | null)[]) {
					values = args;
					return this;
				},
				async all() {
					return { success: true, results: sql.query(query).all(...values) };
				},
				async first() {
					return sql.query(query).get(...values);
				},
				async run() {
					return { success: true, meta: { changes: sql.query(query).run(...values).changes } };
				},
			};
		},
	};
	const env = {
		D1,
		EMAIL_DOMAINS: "example.test",
		API_HOSTNAME: "api.example.test",
		APP_HOSTNAME: "app.example.test",
		ROOT_HOSTNAME: "example.test",
		MCP_REQUEST_LIMIT: allow,
		MCP_CREATE_LIMIT: allow,
	} as unknown as CloudflareBindings;
	return { sql, env };
}

type Inbox = { email_address: string; claim_key: string };
type Output = { success: boolean; result: unknown; status?: number; error?: unknown };
type ToolReply = {
	content: { type: string; text: string }[];
	structuredContent: Output;
	isError: boolean;
};
type RpcReply = { result: unknown; error?: { code: number; message: string } };

function request(
	env: CloudflareBindings,
	body: string,
	headers: HeadersInit = {},
	url = endpoint,
	method = "POST",
) {
	return handleHttp(
		new Request(url, {
			method,
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				...headers,
			},
			body: method === "POST" ? body : undefined,
		}),
		env,
		ctx,
	);
}

async function rpc(
	env: CloudflareBindings,
	method: string,
	params: Record<string, unknown> = {},
	headers: HeadersInit = {},
) {
	const response = await request(
		env,
		JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
		headers,
	);
	const raw = await response.text();
	const text = response.headers.get("Content-Type")?.includes("text/event-stream")
		? (raw
				.split("\n")
				.find((line) => line.startsWith("data: "))
				?.slice(6) ?? "null")
		: raw;
	expect(response.headers.get("Mcp-Session-Id")).toBeNull();
	expect(response.headers.get("Set-Cookie")).toBeNull();
	expect(response.headers.get("Cache-Control")).toBe("no-store");
	return { response, payload: JSON.parse(text) as RpcReply };
}

async function call(env: CloudflareBindings, name: string, args: Record<string, unknown> = {}) {
	const { response, payload } = await rpc(env, "tools/call", { name, arguments: args });
	expect(response.status).toBe(200);
	expect(payload.error).toBeUndefined();
	return payload.result as ToolReply;
}

function value<T>(reply: ToolReply): T {
	expect(reply.isError).toBe(false);
	expect(reply.structuredContent.success).toBe(true);
	expect(JSON.parse(reply.content[0].text)).toEqual(reply.structuredContent);
	return reply.structuredContent.result as T;
}
const create = async (env: CloudflareBindings) => value<Inbox>(await call(env, "create_inbox"));
const seed = (sql: Database, inbox: Inbox, id = "abcdefghijklmnopqrstuvwx", timestamp = 1000) => {
	sql
		.query("INSERT INTO emails VALUES (?, ?, ?, ?, ?, ?, ?)")
		.run(
			id,
			"sender@example.com",
			inbox.email_address,
			"Login code",
			timestamp,
			"<p>123456</p>",
			"123456",
		);
	return id;
};

async function claim(env: CloudflareBindings, inbox: Inbox) {
	const response = await app.request(
		`/claims/${encodeURIComponent(inbox.email_address)}`,
		{
			method: "PUT",
			headers: { Authorization: `Bearer ${inbox.claim_key}` },
		},
		env,
	);
	expect(response.status).toBe(200);
}

describe("MCP protocol and isolation", () => {
	test("discovers all nine annotated tools without auth, a handshake, or a session", async () => {
		const { env } = fixture();
		const { payload } = await rpc(env, "tools/list");
		const { tools } = payload.result as {
			tools: {
				name: string;
				annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
			}[];
		};
		expect(tools.map((t) => t.name).sort()).toEqual(
			[
				"list_domains",
				"create_inbox",
				"list_messages",
				"read_message",
				"count_messages",
				"delete_message",
				"clear_inbox",
				"release_inbox",
				"reconcile_inbox",
			].sort(),
		);
		expect(tools.find((t) => t.name === "release_inbox")?.annotations.destructiveHint).toBe(true);
		expect(tools.find((t) => t.name === "list_messages")?.annotations.readOnlyHint).toBe(true);
		expect(tools.find((t) => t.name === "create_inbox")?.annotations.idempotentHint).toBe(false);
	});

	for (const protocolVersion of ["2025-03-26", "2025-06-18", "2025-11-25"]) {
		test(`supports stateless legacy initialize ${protocolVersion}`, async () => {
			const { env } = fixture();
			const { payload } = await rpc(env, "initialize", {
				protocolVersion,
				capabilities: {},
				clientInfo: { name: "test", version: "1" },
			});
			expect((payload.result as { protocolVersion: string }).protocolVersion).toBe(protocolVersion);
			expect(value<string[]>(await call(env, "list_domains"))).toEqual(["example.test"]);
		});
	}

	test("serves modern stateless discovery and tool calls", async () => {
		const { env } = fixture();
		const _meta = { [PROTOCOL_VERSION_META_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_META_KEY]: {} };
		const headers = { "MCP-Protocol-Version": "2026-07-28" };
		const discovery = await rpc(
			env,
			"server/discover",
			{ _meta },
			{ ...headers, "MCP-Method": "server/discover" },
		);
		expect(discovery.payload.error).toBeUndefined();
		const result = await rpc(
			env,
			"tools/call",
			{ _meta, name: "list_domains", arguments: {} },
			{ ...headers, "MCP-Method": "tools/call", "MCP-Name": "list_domains" },
		);
		expect(result.payload.error).toBeUndefined();
		expect(value<string[]>(result.payload.result as ToolReply)).toEqual(["example.test"]);
	});

	test("keeps environment/domain configuration request-local under concurrency", async () => {
		const a = fixture().env;
		const b = { ...fixture().env, EMAIL_DOMAINS: "other.test" };
		const outputs = await Promise.all(
			Array.from({ length: 12 }, (_, i) => call(i % 2 ? a : b, "list_domains")),
		);
		outputs.forEach((out, i) =>
			expect(value<string[]>(out)).toEqual([i % 2 ? "example.test" : "other.test"]),
		);
	});

	test("does not inherit credentials from another request or the HTTP Authorization header", async () => {
		const { env } = fixture();
		const inbox = await create(env);
		expect(value<{ count: number }>(await call(env, "count_messages", inbox)).count).toBe(0);
		const result = await rpc(
			env,
			"tools/call",
			{ name: "count_messages", arguments: { email_address: inbox.email_address } },
			{ Authorization: `Bearer ${inbox.claim_key}` },
		);
		expect((result.payload.result as ToolReply).isError).toBe(true);
	});
});

describe("MCP mailbox behavior through real REST handlers and SQLite", () => {
	test("create -> receive MIME -> list -> read -> count -> delete -> release", async () => {
		const { env, sql } = fixture();
		const inbox = await create(env);
		expect(inbox.claim_key).toMatch(/^[a-f0-9]{64}$/);
		expect(inbox.email_address).toMatch(/^[a-f0-9]{32}@example\.test$/);
		const stored = sql.query("SELECT auth_key_hash FROM claims").get() as { auth_key_hash: string };
		expect(stored.auth_key_hash).not.toBe(inbox.claim_key);
		await handleEmail(
			{
				from: "sender@example.com",
				to: inbox.email_address,
				raw: new Blob([
					`From: sender@example.com\r\nTo: ${inbox.email_address}\r\nSubject: Verification\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCode: 654321`,
				]).stream(),
			} as unknown as ForwardableEmailMessage,
			env,
			ctx,
		);
		const list = value<Email[]>(await call(env, "list_messages", inbox));
		expect(list).toHaveLength(1);
		expect(list[0].subject).toBe("Verification");
		expect(list[0].text_content).toBeUndefined();
		const args = { ...inbox, message_id: list[0].id };
		expect(value<Email>(await call(env, "read_message", args)).text_content).toContain("654321");
		expect(value<Email>(await call(env, "read_message", args)).id).toBe(list[0].id);
		expect(value<{ count: number }>(await call(env, "count_messages", inbox)).count).toBe(1);
		value(await call(env, "delete_message", args));
		expect(value<{ count: number }>(await call(env, "count_messages", inbox)).count).toBe(0);
		value(await call(env, "release_inbox", inbox));
		expect((await call(env, "list_messages", inbox)).structuredContent.status).toBe(404);
		expect(sql.query("SELECT * FROM claims").all()).toHaveLength(0);
	});

	test("supports configured domains/prefixes and unique cryptographic inboxes", async () => {
		const { env } = fixture();
		env.EMAIL_DOMAINS = "example.test, second.test";
		const a = value<Inbox>(
			await call(env, "create_inbox", { domain: " SECOND.TEST ", prefix: "signup" }),
		);
		const b = await create(env);
		expect(a.email_address).toMatch(/^signup-[a-f0-9]{32}@second\.test$/);
		expect(a.claim_key).not.toBe(b.claim_key);
		expect(a.email_address).not.toBe(b.email_address);
	});

	test("supports existing REST claims, encoded plus-addresses, and special key characters", async () => {
		const { env, sql } = fixture();
		const inbox = { email_address: "existing+test@example.test", claim_key: "a+b&c#d=e" };
		await claim(env, inbox);
		seed(sql, inbox);
		expect(value<Email[]>(await call(env, "list_messages", inbox))).toHaveLength(1);
		const conflict = await app.request(
			`/claims/${encodeURIComponent(inbox.email_address)}`,
			{ method: "PUT", headers: { Authorization: "Bearer other" } },
			env,
		);
		expect(conflict.status).toBe(409);
	});

	test("blocks wrong keys on every protected tool without leaking bodies or changing data", async () => {
		const { env, sql } = fixture();
		const inbox = await create(env);
		const message_id = seed(sql, inbox);
		for (const name of [
			"list_messages",
			"read_message",
			"count_messages",
			"delete_message",
			"clear_inbox",
			"release_inbox",
			"reconcile_inbox",
		]) {
			const reply = await call(env, name, { ...inbox, claim_key: "wrong", message_id, since: 0 });
			expect(reply.isError).toBe(true);
			expect(reply.structuredContent.status).toBe(403);
			expect(JSON.stringify(reply)).not.toContain("123456");
		}
		expect(sql.query("SELECT * FROM emails").all()).toHaveLength(1);
		expect(sql.query("SELECT * FROM claims").all()).toHaveLength(1);
	});

	test("enforces the supplied recipient even when two inboxes use the same key", async () => {
		const { env, sql } = fixture();
		const a = await create(env);
		const b = { email_address: "second@example.test", claim_key: a.claim_key };
		await claim(env, b);
		const id = seed(sql, a);
		for (const name of ["read_message", "delete_message"]) {
			const reply = await call(env, name, { ...b, message_id: id });
			expect(reply.structuredContent.status).toBe(404);
			expect(JSON.stringify(reply)).not.toContain("123456");
		}
		expect(sql.query("SELECT * FROM emails").all()).toHaveLength(1);
	});

	test("clear keeps the claim; release removes only the addressed claim and messages", async () => {
		const { env, sql } = fixture();
		const a = await create(env);
		const b = await create(env);
		seed(sql, a);
		seed(sql, b, "bcdefghijklmnopqrstuvwxy");
		expect(value<{ deleted_count: number }>(await call(env, "clear_inbox", a)).deleted_count).toBe(
			1,
		);
		expect(sql.query("SELECT * FROM claims").all()).toHaveLength(2);
		expect(value<{ count: number }>(await call(env, "count_messages", b)).count).toBe(1);
		seed(sql, a);
		expect(
			value<{ deleted_count: number }>(await call(env, "release_inbox", a)).deleted_count,
		).toBe(1);
		expect(sql.query("SELECT * FROM claims").all()).toHaveLength(1);
		expect(value<{ count: number }>(await call(env, "count_messages", b)).count).toBe(1);
		await claim(env, { ...a, claim_key: "new-owner" });
		expect((await call(env, "count_messages", a)).structuredContent.status).toBe(403);
	});

	test("paginates lists and full reconciliation without a stored cursor or key in links", async () => {
		const { env, sql } = fixture();
		const inbox = await create(env);
		seed(sql, inbox, "abcdefghijklmnopqrstuvwx", 1000);
		seed(sql, inbox, "bcdefghijklmnopqrstuvwxy", 1001);
		const page = value<{ data: Email[]; hasNext: boolean; links: { next: { href: string } } }>(
			await call(env, "reconcile_inbox", { ...inbox, since: 1000, limit: 1 }),
		);
		expect(page.data[0].text_content).toBe("123456");
		expect(page.hasNext).toBe(true);
		expect(page.links.next.href).toContain("offset=1");
		expect(page.links.next.href).not.toContain(inbox.claim_key);
		const next = value<{ data: Email[]; hasNext: boolean }>(
			await call(env, "reconcile_inbox", { ...inbox, since: 1000, limit: 1, offset: 1 }),
		);
		expect(next.data[0].received_at).toBe(1001);
		expect(next.hasNext).toBe(false);
		expect(
			value<Email[]>(await call(env, "list_messages", { ...inbox, limit: 1, offset: 1 }))[0]
				.received_at,
		).toBe(1000);
	});

	test("does not create claims for missing or unsupported domains", async () => {
		const { env, sql } = fixture();
		expect((await call(env, "create_inbox", { domain: "bad.test" })).structuredContent.status).toBe(
			404,
		);
		env.EMAIL_DOMAINS = "";
		expect((await call(env, "create_inbox")).structuredContent.status).toBe(404);
		expect(sql.query("SELECT * FROM claims").all()).toHaveLength(0);
	});

	test("redacts database failures in MCP responses", async () => {
		const { env } = fixture();
		env.D1 = {
			prepare: () => {
				throw new Error("private internal detail");
			},
		} as unknown as D1Database;
		const result = await call(env, "count_messages", {
			email_address: "recipient@example.test",
			claim_key: "secret",
		});
		expect(result.structuredContent).toMatchObject({
			status: 500,
			error: { code: "INTERNAL_ERROR", retryable: true },
		});
		expect(JSON.stringify(result)).not.toContain("private internal detail");
		expect(JSON.stringify(result)).not.toContain("secret");
	});
});

describe("MCP HTTP boundary", () => {
	for (const origin of [
		"https://evil.test",
		"null",
		"https://api.example.test.evil.test",
		"http://api.example.test",
		"https://api.example.test:444",
	]) {
		test(`rejects origin ${origin}`, async () => {
			const { env } = fixture();
			expect((await request(env, "{}", { Origin: origin })).status).toBe(403);
		});
	}
	test("allows absent or same-origin Origin, and handles preflight without auth", async () => {
		const { env } = fixture();
		const result = await rpc(env, "tools/list", {}, { Origin: "https://api.example.test" });
		expect(result.response.status).toBe(200);
		expect(result.response.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://api.example.test",
		);
		expect(
			(await request(env, "", { Origin: "https://api.example.test" }, endpoint, "OPTIONS")).status,
		).toBe(204);
	});
	test("rejects wrong URL/Host and never redirects MCP credentials to webmail", async () => {
		const { env } = fixture();
		for (const url of [
			"https://example.test/mcp",
			"https://app.example.test/mcp",
			"https://fixture.workers.dev/mcp",
		]) {
			const response = await request(env, "{}", {}, url);
			expect(response.status).toBe(404);
			expect(response.headers.get("Location")).toBeNull();
		}
		expect((await request(env, "{}", { Host: "evil.test" })).status).toBe(404);
	});
	test("fails closed on unconfigured public hosts, while allowing explicit local development", async () => {
		const { env } = fixture();
		delete env.API_HOSTNAME;
		expect((await request(env, "{}")).status).toBe(404);
		const local = await request(
			env,
			JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
			{},
			"http://127.0.0.1:8787/mcp",
		);
		expect(local.status).toBe(200);
	});
	test("rejects GET/DELETE session transport operations", async () => {
		const { env } = fixture();
		for (const method of ["GET", "DELETE", "PUT"]) {
			const response = await request(env, "", {}, endpoint, method);
			expect(response.status).toBe(405);
			expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
		}
	});
	test("caps the actual body even without Content-Length", async () => {
		const { env } = fixture();
		const response = await request(
			env,
			JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", padding: "x".repeat(17000) }),
		);
		expect(response.status).toBe(413);
	});
	test("rejects bad content types and malformed JSON without crashing", async () => {
		const { env } = fixture();
		expect((await request(env, "{}", { "Content-Type": "text/plain" })).status).toBe(415);
		expect((await request(env, "{")).status).toBe(400);
	});
	test("enforces the edge request limit and returns Retry-After without touching D1", async () => {
		const { env, sql } = fixture();
		const keys: string[] = [];
		env.MCP_REQUEST_LIMIT = {
			limit: async ({ key }) => {
				keys.push(key);
				return { success: false };
			},
		};
		const response = await request(env, "{}", {
			"CF-Connecting-IP": "192.0.2.1",
			"X-Forwarded-For": "attacker",
		});
		expect(response.status).toBe(429);
		expect(response.headers.get("Retry-After")).toBe("60");
		expect(keys).toEqual(["burnmail:mcp:request:192.0.2.1"]);
		expect(sql.query("SELECT * FROM claims").all()).toHaveLength(0);
	});
	test("fails closed if the edge request limiter is missing", async () => {
		const { env } = fixture();
		delete env.MCP_REQUEST_LIMIT;
		expect((await request(env, "{}")).status).toBe(503);
	});
	test("enforces a separate creation limit without blocking reads", async () => {
		const { env, sql } = fixture();
		env.MCP_CREATE_LIMIT = { limit: async () => ({ success: false }) };
		expect((await call(env, "create_inbox")).structuredContent.status).toBe(429);
		expect(value<string[]>(await call(env, "list_domains"))).toEqual(["example.test"]);
		delete env.MCP_CREATE_LIMIT;
		expect((await call(env, "create_inbox")).structuredContent.status).toBe(503);
		expect(sql.query("SELECT * FROM claims").all()).toHaveLength(0);
	});
	test("rejects invalid pagination, message IDs, and header injection", async () => {
		const { env } = fixture();
		const inbox = await create(env);
		for (const [name, args] of [
			["list_messages", { ...inbox, limit: 101 }],
			["list_messages", { ...inbox, offset: -1 }],
			["list_messages", { ...inbox, limit: 1.5 }],
			["reconcile_inbox", { ...inbox, since: 0, limit: 26 }],
			["read_message", { ...inbox, message_id: "../../domains" }],
			["count_messages", { ...inbox, claim_key: "key\r\nX-Evil: true" }],
		] as const)
			expect((await call(env, name, args)).isError).toBe(true);
	});
});

describe("MCP deep-test regressions", () => {
	test("empty, repeated, and concurrent clears succeed without releasing the claim", async () => {
		const { env, sql } = fixture();
		const inbox = await create(env);
		for (let i = 0; i < 2; i++) {
			expect(
				value<{ deleted_count: number }>(await call(env, "clear_inbox", inbox)).deleted_count,
			).toBe(0);
		}
		seed(sql, inbox);
		seed(sql, inbox, "bcdefghijklmnopqrstuvwxy");
		const results = await Promise.all([
			call(env, "clear_inbox", inbox),
			call(env, "clear_inbox", inbox),
		]);
		expect(results.map((r) => value<{ deleted_count: number }>(r).deleted_count).sort()).toEqual([
			0, 2,
		]);
		expect(value<{ count: number }>(await call(env, "count_messages", inbox)).count).toBe(0);
		expect(sql.query("SELECT * FROM claims").all()).toHaveLength(1);
		expect(
			(await call(env, "clear_inbox", { ...inbox, claim_key: "wrong" })).structuredContent.status,
		).toBe(403);
		expect(
			(await call(env, "clear_inbox", { ...inbox, email_address: "missing@example.test" }))
				.structuredContent.status,
		).toBe(404);
	});

	test("REST empty clearing has the same idempotent behavior and retains authorization", async () => {
		const { env } = fixture();
		const inbox = await create(env);
		const path = `/emails/${encodeURIComponent(inbox.email_address)}`;
		for (let i = 0; i < 2; i++) {
			const response = await app.request(
				path,
				{ method: "DELETE", headers: { Authorization: `Bearer ${inbox.claim_key}` } },
				env,
			);
			expect(response.status).toBe(200);
			expect((await response.json()) as Record<string, unknown>).toEqual({
				success: true,
				result: { message: "Emails deleted successfully", deleted_count: 0 },
			});
		}
		expect((await app.request(path, { method: "DELETE" }, env)).status).toBe(401);
		expect(
			(
				await app.request(
					path,
					{ method: "DELETE", headers: { Authorization: "Bearer wrong" } },
					env,
				)
			).status,
		).toBe(403);
	});

	test("business failures preserve distinct structured codes instead of JSON-RPC errors", async () => {
		const { env } = fixture();
		const inbox = await create(env);
		const denied = await call(env, "count_messages", { ...inbox, claim_key: "wrong" });
		const missing = await call(env, "read_message", {
			...inbox,
			message_id: "abcdefghijklmnopqrstuvwx",
		});
		const unsupported = await call(env, "create_inbox", { domain: "unsupported.test" });
		env.MCP_CREATE_LIMIT = { limit: async () => ({ success: false }) };
		const limited = await call(env, "create_inbox");
		delete env.MCP_CREATE_LIMIT;
		const unavailable = await call(env, "create_inbox");
		for (const [reply, status, code, retryable] of [
			[denied, 403, "FORBIDDEN", false],
			[missing, 404, "NOT_FOUND", false],
			[unsupported, 404, "NOT_FOUND", false],
			[limited, 429, "RATE_LIMITED", true],
			[unavailable, 503, "SERVICE_UNAVAILABLE", true],
		] as const) {
			expect(reply.isError).toBe(true);
			expect(reply.structuredContent).toMatchObject({
				success: false,
				status,
				error: { code, retryable },
			});
			expect(JSON.parse(reply.content[0].text)).toEqual(reply.structuredContent);
			expect(JSON.stringify(reply)).not.toContain(inbox.claim_key);
		}
		const unknown = await rpc(env, "tools/call", { name: "no_such_tool", arguments: {} });
		expect(unknown.payload.error?.code).toBe(-32602);
	});

	test("discovery declares the error schema and preserves truthful destructive annotations", async () => {
		const { env } = fixture();
		const { payload } = await rpc(env, "tools/list");
		const { tools } = payload.result as {
			tools: {
				name: string;
				outputSchema: { properties: Record<string, unknown> };
				annotations: { readOnlyHint: boolean; destructiveHint: boolean };
			}[];
		};
		for (const tool of tools) {
			expect(tool.outputSchema.properties.error).toBeDefined();
			expect(tool.outputSchema.properties.status).toBeDefined();
			if (["delete_message", "clear_inbox", "release_inbox"].includes(tool.name)) {
				expect(tool.annotations.destructiveHint).toBe(true);
				expect(tool.annotations.readOnlyHint).toBe(false);
			}
		}
	});

	test("stable timestamp ties paginate in opposite list/reconciliation orders without omissions", async () => {
		const { env, sql } = fixture();
		const inbox = await create(env);
		const ids = [
			"abcdefghijklmnopqrstuvwx",
			"bcdefghijklmnopqrstuvwxy",
			"cdefghijklmnopqrstuvwxyz",
			"defghijklmnopqrstuvwxyza",
		];
		// Insertion order deliberately disagrees with both sort orders.
		for (const i of [2, 0, 3, 1]) seed(sql, inbox, ids[i], i === 3 ? 1001 : 1000);
		const listed: string[] = [];
		const reconciled: string[] = [];
		for (const offset of [0, 2]) {
			listed.push(
				...value<Email[]>(await call(env, "list_messages", { ...inbox, limit: 2, offset })).map(
					(m) => m.id,
				),
			);
			const page = value<{ data: Email[]; hasNext: boolean; links: { next?: { href: string } } }>(
				await call(env, "reconcile_inbox", { ...inbox, since: 1000, limit: 2, offset }),
			);
			reconciled.push(...page.data.map((m) => m.id));
			expect(page.hasNext).toBe(offset === 0);
			if (offset === 0) {
				const link = new URL(page.links.next?.href ?? "");
				expect(link.searchParams.get("since")).toBe("1000");
				expect(link.searchParams.get("offset")).toBe("2");
				expect(link.href).not.toContain(inbox.claim_key);
			} else expect(page.links).toEqual({});
		}
		expect(listed).toEqual([...ids].reverse());
		expect(reconciled).toEqual(ids);
		expect(value<Email[]>(await call(env, "list_messages", { ...inbox, offset: 4 }))).toEqual([]);
		expect(
			value<{ data: Email[]; hasNext: boolean }>(
				await call(env, "reconcile_inbox", { ...inbox, since: 1002 }),
			),
		).toMatchObject({ data: [], hasNext: false });
		expect(value<{ count: number }>(await call(env, "count_messages", inbox)).count).toBe(4);
	});

	test("successful deletion affects only its message; retries and reads report NOT_FOUND", async () => {
		const { env, sql } = fixture();
		const a = await create(env);
		const b = await create(env);
		const message_id = seed(sql, a);
		seed(sql, a, "bcdefghijklmnopqrstuvwxy");
		seed(sql, b, "cdefghijklmnopqrstuvwxyz");
		value(await call(env, "delete_message", { ...a, message_id }));
		for (const name of ["read_message", "delete_message"]) {
			expect((await call(env, name, { ...a, message_id })).structuredContent).toMatchObject({
				success: false,
				status: 404,
				error: { code: "NOT_FOUND" },
			});
		}
		for (const inbox of [a, b])
			expect(value<{ count: number }>(await call(env, "count_messages", inbox)).count).toBe(1);
	});

	test("release retries cannot delete an address reclaimed under a different key", async () => {
		const { env, sql } = fixture();
		const inbox = await create(env);
		seed(sql, inbox);
		expect(
			value<{ deleted_count: number }>(await call(env, "release_inbox", inbox)).deleted_count,
		).toBe(1);
		expect((await call(env, "release_inbox", inbox)).structuredContent.status).toBe(404);
		const next = { ...inbox, claim_key: "new-owner-secret" };
		await claim(env, next);
		seed(sql, next);
		for (const name of ["release_inbox", "clear_inbox", "count_messages"]) {
			expect((await call(env, name, inbox)).structuredContent.status).toBe(403);
		}
		expect(value<{ count: number }>(await call(env, "count_messages", next)).count).toBe(1);
	});

	test("concurrent message deletes remain isolated across independently claimed inboxes", async () => {
		const { env, sql } = fixture();
		const a = await create(env);
		const b = await create(env);
		const first = seed(sql, a);
		const second = seed(sql, a, "bcdefghijklmnopqrstuvwxy");
		const third = seed(sql, b, "cdefghijklmnopqrstuvwxyz");
		const replies = await Promise.all([
			call(env, "delete_message", { ...a, message_id: first }),
			call(env, "delete_message", { ...a, message_id: second }),
			call(env, "read_message", { ...b, message_id: third }),
		]);
		for (const reply of replies) value(reply);
		expect(value<{ count: number }>(await call(env, "count_messages", a)).count).toBe(0);
		expect(value<{ count: number }>(await call(env, "count_messages", b)).count).toBe(1);
	});

	test("multipart Unicode MIME preserves text/HTML while attachments remain unsupported", async () => {
		const { env } = fixture();
		const inbox = await create(env);
		const body = "Grüße 世界 — code 987654";
		const html = `<p>${body}</p>`;
		const raw = [
			"From: sender@example.com",
			`To: ${inbox.email_address}`,
			`Subject: =?UTF-8?B?${Buffer.from("Unicode ✓ 世界").toString("base64")}?=`,
			"MIME-Version: 1.0",
			'Content-Type: multipart/mixed; boundary="outer"',
			"",
			"--outer",
			'Content-Type: multipart/alternative; boundary="inner"',
			"",
			"--inner",
			"Content-Type: text/plain; charset=utf-8",
			"Content-Transfer-Encoding: base64",
			"",
			Buffer.from(body).toString("base64"),
			"--inner",
			"Content-Type: text/html; charset=utf-8",
			"Content-Transfer-Encoding: base64",
			"",
			Buffer.from(html).toString("base64"),
			"--inner--",
			"--outer",
			'Content-Type: application/octet-stream; name="fixture.bin"',
			'Content-Disposition: attachment; filename="fixture.bin"',
			"Content-Transfer-Encoding: base64",
			"",
			Buffer.from("ATTACHMENT_ONLY_MARKER").toString("base64"),
			"--outer--",
			"",
		].join("\r\n");
		await handleEmail(
			{
				from: "sender@example.com",
				to: inbox.email_address,
				raw: new Blob([raw]).stream(),
			} as unknown as ForwardableEmailMessage,
			env,
			ctx,
		);
		const list = value<Email[]>(await call(env, "list_messages", inbox));
		expect(list).toHaveLength(1);
		const message = value<Email>(
			await call(env, "read_message", { ...inbox, message_id: list[0].id }),
		);
		expect(message.subject).toBe("Unicode ✓ 世界");
		expect(message.text_content).toContain(body);
		expect(message.html_content).toContain(html);
		expect(JSON.stringify(message)).not.toContain("ATTACHMENT_ONLY_MARKER");
		expect(message).not.toHaveProperty("attachments");
	});

	test("oversized MIME bodies are rejected without entering inbox or recovery storage", async () => {
		const { env } = fixture();
		const inbox = await create(env);
		const body = "0123456789abcdef\n".repeat(16384);
		let rejected = false;
		await handleEmail(
			{
				from: "sender@example.com",
				to: inbox.email_address,
				raw: new Blob([body]).stream(),
				setReject() {
					rejected = true;
				},
			} as unknown as ForwardableEmailMessage,
			env,
			ctx,
		);
		expect(rejected).toBe(true);
		expect(value<Email[]>(await call(env, "list_messages", inbox))).toHaveLength(0);
		expect(
			value<{ data: Email[] }>(await call(env, "reconcile_inbox", { ...inbox, since: 0 })).data,
		).toHaveLength(0);
	});

	test("retention also removes legacy oversized rows without releasing claims", async () => {
		const { deleteOldEmails } = await import("@/database/d1");
		const { env, sql } = fixture();
		const inbox = await create(env);
		const id = seed(sql, inbox, "abcdefghijklmnopqrstuvwx", 2000);
		sql.query("UPDATE emails SET text_content = ? WHERE id = ?").run("x".repeat(64 * 1024 + 1), id);
		expect((await deleteOldEmails(env.D1, 0)).success).toBe(true);
		expect(value<{ count: number }>(await call(env, "count_messages", inbox)).count).toBe(0);
		expect(sql.query("SELECT * FROM claims").all()).toHaveLength(1);
	});
	test("retention removes expired mail but preserves the inclusive cutoff and claimed address", async () => {
		const { deleteOldEmails } = await import("@/database/d1");
		const { env, sql } = fixture();
		const inbox = await create(env);
		const expired = seed(sql, inbox, "abcdefghijklmnopqrstuvwx", 1000);
		const retained = seed(sql, inbox, "bcdefghijklmnopqrstuvwxy", 1001);
		expect((await deleteOldEmails(env.D1, 1001)).success).toBe(true);
		expect(
			(await call(env, "read_message", { ...inbox, message_id: expired })).structuredContent.status,
		).toBe(404);
		const page = value<{ data: Email[] }>(
			await call(env, "reconcile_inbox", { ...inbox, since: 0 }),
		);
		expect(page.data.map((m) => m.id)).toEqual([retained]);
		expect((await deleteOldEmails(env.D1, 1002)).success).toBe(true);
		expect(value<{ count: number }>(await call(env, "count_messages", inbox)).count).toBe(0);
		expect(
			value<{ deleted_count: number }>(await call(env, "clear_inbox", inbox)).deleted_count,
		).toBe(0);
		expect(sql.query("SELECT * FROM claims").all()).toHaveLength(1);
	});
});
