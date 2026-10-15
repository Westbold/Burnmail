import { describe, expect, test } from "bun:test";
import app from "@/app";
import type { Email } from "@/schemas/emails";

interface StoredClaim {
	email_address: string;
	auth_key_hash: string;
	created_at: number;
}

class FakeD1 {
	claims = new Map<string, StoredClaim>();
	emails = new Map<string, Email>();
	failReconciliation = false;

	prepare(sql: string) {
		return new FakeD1Statement(this, sql);
	}
}

class FakeD1Statement {
	private values: unknown[] = [];

	constructor(
		private db: FakeD1,
		private sql: string,
	) {}

	bind(...values: unknown[]) {
		this.values = values;
		return this;
	}

	async all() {
		const emailAddress = String(this.values[0]);

		if (this.sql.includes("FROM claims WHERE email_address")) {
			const claim = this.db.claims.get(emailAddress);
			return { results: claim ? [claim] : [] };
		}

		if (this.sql.includes("ORDER BY received_at ASC")) {
			if (this.db.failReconciliation) throw new Error("Simulated D1 failure");
			const [recipient, since, limit, offset] = this.values;
			return {
				results: [...this.db.emails.values()]
					.filter((email) => email.to_address === recipient && email.received_at >= Number(since))
					.sort((a, b) => a.received_at - b.received_at || a.id.localeCompare(b.id))
					.slice(Number(offset), Number(offset) + Number(limit)),
			};
		}

		if (this.sql.includes("FROM emails") && this.sql.includes("WHERE to_address")) {
			const limit = Number(this.values[1]);
			const offset = Number(this.values[2]);
			const results = Array.from(this.db.emails.values())
				.filter((email) => email.to_address === emailAddress)
				.sort((a, b) => b.received_at - a.received_at)
				.slice(offset, offset + limit)
				.map(({ html_content: _html, text_content: _text, ...summary }) => summary);

			return { results };
		}

		throw new Error(`Unsupported all() query: ${this.sql}`);
	}

	async run() {
		const emailAddress = String(this.values[0]);

		if (this.sql.startsWith("INSERT INTO claims")) {
			this.db.claims.set(emailAddress, {
				email_address: emailAddress,
				auth_key_hash: String(this.values[1]),
				created_at: Number(this.values[2]),
			});
			return { success: true, meta: { changes: 1 } };
		}

		if (this.sql.startsWith("DELETE FROM emails WHERE to_address")) {
			let changes = 0;
			for (const [id, email] of this.db.emails) {
				if (email.to_address === emailAddress) {
					this.db.emails.delete(id);
					changes++;
				}
			}

			return { success: true, meta: { changes } };
		}

		if (this.sql.startsWith("DELETE FROM claims")) {
			const changes = this.db.claims.delete(emailAddress) ? 1 : 0;
			return { success: true, meta: { changes } };
		}

		throw new Error(`Unsupported run() query: ${this.sql}`);
	}
}

function makeEnv(db: FakeD1) {
	return { D1: db as unknown as D1Database, EMAIL_DOMAINS: "example.test" } as CloudflareBindings;
}

const RECIPIENT = "recipient@example.test";
const makeEmail = (id: string, received_at: number, to_address = RECIPIENT): Email => ({
	id,
	from_address: "sender@example.com",
	to_address,
	subject: "Login code",
	received_at,
	html_content: "<p>123456</p>",
	text_content: "123456",
});

function reconcile(db: FakeD1, query: string, key?: string, address = RECIPIENT) {
	return app.request(
		`https://api.example.test/reconciliation/${address}${query}`,
		{ headers: key ? { Authorization: `Bearer ${key}` } : {} },
		makeEnv(db),
	);
}

function claim(db: FakeD1, address = RECIPIENT, key = "claim-secret") {
	return app.request(
		`/claims/${address}`,
		{
			method: "PUT",
			headers: { Authorization: `Bearer ${key}` },
		},
		makeEnv(db),
	);
}

async function readPage(response: Response) {
	return (
		(await response.json()) as {
			result: {
				data: Email[];
				hasNext: boolean;
				links: { next?: { method: "GET"; href: string } };
			};
		}
	).result;
}

describe("email route access control", () => {
	test("claims addresses idempotently and rejects different bearer tokens", async () => {
		const db = new FakeD1();
		const env = makeEnv(db);

		const firstClaim = await app.request(
			"/claims/recipient@example.test",
			{
				method: "PUT",
				headers: { Authorization: "Bearer claim-secret" },
			},
			env,
		);
		expect(firstClaim.status).toBe(200);
		expect(db.claims.get("recipient@example.test")?.auth_key_hash).not.toBe("claim-secret");

		const sameClaim = await app.request(
			"/claims/recipient@example.test",
			{
				method: "PUT",
				headers: { Authorization: "Bearer claim-secret" },
			},
			env,
		);
		expect(sameClaim.status).toBe(200);

		const conflictingClaim = await app.request(
			"/claims/recipient@example.test",
			{
				method: "PUT",
				headers: { Authorization: "Bearer other-secret" },
			},
			env,
		);
		expect(conflictingClaim.status).toBe(409);
	});

	test("protects claimed inbox access with the original bearer token", async () => {
		const db = new FakeD1();
		const env = makeEnv(db);
		await app.request(
			"/claims/recipient@example.test",
			{
				method: "PUT",
				headers: { Authorization: "Bearer claim-secret" },
			},
			env,
		);
		db.emails.set("email_1", {
			id: "email_1",
			from_address: "sender@example.com",
			to_address: "recipient@example.test",
			subject: "Hello",
			received_at: 1753317948,
			html_content: "<p>Hello</p>",
			text_content: "Hello",
		});

		const missingAuth = await app.request("/emails/recipient@example.test", {}, env);
		expect(missingAuth.status).toBe(401);

		const wrongAuth = await app.request(
			"/emails/recipient@example.test",
			{
				headers: { Authorization: "Bearer other-secret" },
			},
			env,
		);
		expect(wrongAuth.status).toBe(403);

		const rightAuth = await app.request(
			"/emails/recipient@example.test",
			{
				headers: { Authorization: "Bearer claim-secret" },
			},
			env,
		);
		expect(rightAuth.status).toBe(200);
		await expect(rightAuth.json()).resolves.toEqual({
			success: true,
			result: [
				{
					id: "email_1",
					from_address: "sender@example.com",
					to_address: "recipient@example.test",
					subject: "Hello",
					received_at: 1753317948,
				},
			],
		});
	});

	test("releases a claim and deletes the address email data", async () => {
		const db = new FakeD1();
		const env = makeEnv(db);
		await app.request(
			"/claims/recipient@example.test",
			{
				method: "PUT",
				headers: { Authorization: "Bearer claim-secret" },
			},
			env,
		);
		db.emails.set("email_1", {
			id: "email_1",
			from_address: "sender@example.com",
			to_address: "recipient@example.test",
			subject: "Hello",
			received_at: 1753317948,
			html_content: "<p>Hello</p>",
			text_content: "Hello",
		});

		const release = await app.request(
			"/claims/recipient@example.test",
			{
				method: "DELETE",
				headers: { Authorization: "Bearer claim-secret" },
			},
			env,
		);

		expect(release.status).toBe(200);
		await expect(release.json()).resolves.toEqual({
			success: true,
			result: { message: "Claim released successfully", deleted_count: 1 },
		});
		expect(db.claims.has("recipient@example.test")).toBe(false);
		expect(db.emails.size).toBe(0);
	});

	test("follows absolute Phoneblur-style links to recover full messages", async () => {
		const db = new FakeD1();
		await claim(db);
		await claim(db, "other@example.test", "other-key");
		for (const message of [
			makeEmail("old", 99),
			makeEmail("a1", 100),
			makeEmail("c3", 100),
			makeEmail("d4", 100),
			makeEmail("e5", 101),
			makeEmail("hidden", 100, "other@example.test"),
		])
			db.emails.set(message.id, message);

		const first = await reconcile(db, "?since=100&limit=2", "claim-secret");
		expect(first.status).toBe(200);
		expect(first.headers.get("Cache-Control")).toBe("no-store");
		const page1 = await readPage(first);
		expect(page1.data).toEqual([makeEmail("a1", 100), makeEmail("c3", 100)]);
		expect(page1.hasNext).toBe(true);
		expect(page1.links.next).toEqual({
			method: "GET",
			href: `https://api.example.test/reconciliation/${RECIPIENT}?since=100&limit=2&offset=2`,
		});

		const next = page1.links.next;
		if (!next) throw new Error("Expected a next-page link");
		const second = await app.request(
			next.href,
			{ method: next.method, headers: { Authorization: "Bearer claim-secret" } },
			makeEnv(db),
		);
		const page2 = await readPage(second);
		expect(page2.data).toEqual([makeEmail("d4", 100), makeEmail("e5", 101)]);
		expect(page2.hasNext).toBe(false);
		expect(page2.links).toEqual({});
	});

	test("an overlapping scan recovers late inserts between offset pages", async () => {
		const db = new FakeD1();
		await claim(db);
		for (const email of [
			makeEmail("a1", 100),
			makeEmail("c3", 100),
			makeEmail("d4", 100),
			makeEmail("e5", 101),
		])
			db.emails.set(email.id, email);
		const first = await readPage(await reconcile(db, "?since=100&limit=2", "claim-secret"));
		db.emails.set("b2", makeEmail("b2", 100));

		const received = first.data.map((email) => email.id);
		let link = first.links.next;
		while (link) {
			const response = await app.request(
				link.href,
				{ method: link.method, headers: { Authorization: "Bearer claim-secret" } },
				makeEnv(db),
			);
			const page = await readPage(response);
			received.push(...page.data.map((email) => email.id));
			link = page.links.next;
		}
		expect(received).toEqual(["a1", "c3", "c3", "d4", "e5"]);
		const rescan = await readPage(await reconcile(db, "?since=100", "claim-secret"));
		expect(rescan.data.map((email) => email.id)).toEqual(["a1", "b2", "c3", "d4", "e5"]);
	});

	test("reconciliation enforces claim keys, limits, and database errors", async () => {
		const db = new FakeD1();
		await claim(db);
		await claim(db, "other@example.test", "other-key");
		expect((await reconcile(db, "?since=0")).status).toBe(401);
		expect((await reconcile(db, "?since=0", "wrong-key")).status).toBe(403);
		expect((await reconcile(db, "?since=0", "claim-secret", "other@example.test")).status).toBe(
			403,
		);
		expect((await reconcile(db, "?since=0", "claim-secret", "unclaimed@example.test")).status).toBe(
			404,
		);
		expect((await reconcile(db, "?since=0", "claim-secret", "recipient@invalid.test")).status).toBe(
			404,
		);

		for (const query of [
			"",
			"?since=-1",
			"?since=no",
			"?since=0&limit=0",
			"?since=0&limit=26",
			"?since=0&offset=-1",
			"?since=0&offset=1.5",
			"?since=0&offset=abc",
		])
			expect((await reconcile(db, query, "claim-secret")).status).toBe(400);
		db.failReconciliation = true;
		expect((await reconcile(db, "?since=0", "claim-secret")).status).toBe(500);
	});
});

test("API documentation keeps authenticated requests on this deployment", async () => {
	const response = await app.request("/openapi.json");
	expect(response.status).toBe(200);
	const document = (await response.json()) as {
		servers: { url: string }[];
		paths: Record<string, { get?: { security?: unknown[] } }>;
	};
	expect(document.servers.map((server) => server.url)).toEqual(["/"]);
	expect(document.paths["/reconciliation/{emailAddress}"]?.get?.security).toEqual([
		{ bearerAuth: [] },
	]);
});
