import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { DOMAINS_SET } from "@/config/domains";
import type { Email } from "@/schemas/emails";

interface StoredClaim {
	email_address: string;
	auth_key_hash: string;
	created_at: number;
}

class FakeD1 {
	claims = new Map<string, StoredClaim>();
	emails = new Map<string, Email>();

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
	return { D1: db as unknown as D1Database } as CloudflareBindings;
}

describe("email route access control", () => {
	// Test addresses must not depend on the real domains enabled in production.
	beforeAll(() => {
		DOMAINS_SET.add("example.test");
	});

	afterAll(() => {
		DOMAINS_SET.delete("example.test");
	});

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
});

test("API documentation keeps authenticated requests on this deployment", async () => {
	const response = await app.request("/openapi.json");
	expect(response.status).toBe(200);
	const document = (await response.json()) as { servers: { url: string }[] };
	expect(document.servers.map((server) => server.url)).toEqual(["/"]);
});
