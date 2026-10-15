import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import app from "@/app";
import type { Email } from "@/schemas/emails";
import { hashAuthorizationKey } from "@/utils/auth";

class SqliteD1 {
	private readonly db = new Database(":memory:");
	failReconciliation = false;

	constructor() {
		this.db.exec(
			"CREATE TABLE claims (email_address TEXT PRIMARY KEY, auth_key_hash TEXT NOT NULL, created_at INTEGER NOT NULL)",
		);
		this.db.exec(
			"CREATE TABLE emails (id TEXT PRIMARY KEY, from_address TEXT NOT NULL, to_address TEXT NOT NULL, subject TEXT, received_at INTEGER NOT NULL, html_content TEXT, text_content TEXT)",
		);
	}

	prepare(sql: string) {
		return {
			bind: (...args: (string | number)[]) => ({
				all: async () => {
					if (this.failReconciliation && sql.includes("ORDER BY received_at ASC"))
						throw new Error("Simulated D1 outage");
					return { results: this.db.prepare(sql).all(...args) };
				},
			}),
		};
	}

	async claim(address: string, key: string) {
		this.db
			.prepare("INSERT INTO claims VALUES (?, ?, ?)")
			.run(address, await hashAuthorizationKey(key), 100);
	}

	insert(email: Email) {
		this.db
			.prepare("INSERT INTO emails VALUES (?, ?, ?, ?, ?, ?, ?)")
			.run(
				email.id,
				email.from_address,
				email.to_address,
				email.subject,
				email.received_at,
				email.html_content,
				email.text_content,
			);
	}

	close() {
		this.db.close();
	}
}

const ADDRESS = "alias@example.test";
const OTHER = "other@example.test";
const SECRET = "claim-secret";
const email = (id: string, to: string, received_at: number): Email => ({
	id,
	from_address: "sender@example.com",
	to_address: to,
	subject: "One-time login",
	received_at,
	html_content: "<p>123456</p>",
	text_content: "123456",
});

function request(db: SqliteD1, path: string, secret?: string) {
	return app.request(path, secret ? { headers: { Authorization: `Bearer ${secret}` } } : {}, {
		D1: db as unknown as D1Database,
		EMAIL_DOMAINS: "example.test",
	} as CloudflareBindings);
}

describe("claim-scoped email reconciliation", () => {
	test("returns full messages in stable chronological pages, including tied timestamps", async () => {
		const db = new SqliteD1();
		try {
			await db.claim(ADDRESS, SECRET);
			await db.claim(OTHER, "other-key");
			db.insert(email("older", ADDRESS, 99));
			db.insert(email("c3", ADDRESS, 100));
			db.insert(email("a1", ADDRESS, 100));
			db.insert(email("d4", ADDRESS, 101));
			db.insert(email("b2", ADDRESS, 100));
			db.insert(email("excluded", OTHER, 100));

			const first = await request(db, `/reconciliation/${ADDRESS}?since=100&limit=2`, SECRET);
			expect(first.status).toBe(200);
			expect(first.headers.get("Cache-Control")).toBe("no-store");
			const page1 = (await first.json()) as {
				result: { messages: Email[]; next_cursor: string | null };
			};
			expect(page1.result.messages).toEqual([email("a1", ADDRESS, 100), email("b2", ADDRESS, 100)]);
			expect(page1.result.next_cursor).toBe("100:b2");

			const second = await request(
				db,
				`/reconciliation/${ADDRESS}?since=100&limit=2&cursor=100:b2`,
				SECRET,
			);
			expect(second.status).toBe(200);
			const page2 = (await second.json()) as {
				result: { messages: Email[]; next_cursor: string | null };
			};
			expect(page2.result.messages).toEqual([email("c3", ADDRESS, 100), email("d4", ADDRESS, 101)]);
			expect(page2.result.next_cursor).toBeNull();

			// Repeating a page is safe: the caller can deduplicate by immutable email ID.
			const replay = await request(db, `/reconciliation/${ADDRESS}?since=100&limit=2`, SECRET);
			expect(((await replay.json()) as { result: { messages: Email[] } }).result.messages).toEqual(
				page1.result.messages,
			);
		} finally {
			db.close();
		}
	});

	// Late messages in the same second can sort before a cursor, so consumers must overlap scans.
	test("an overlapping pass recovers a late insertion before a previous cursor", async () => {
		const db = new SqliteD1();
		try {
			await db.claim(ADDRESS, SECRET);
			db.insert(email("a1", ADDRESS, 100));
			db.insert(email("c3", ADDRESS, 100));
			db.insert(email("d4", ADDRESS, 101));
			const first = await request(db, `/reconciliation/${ADDRESS}?since=100&limit=2`, SECRET);
			const initial = (await first.json()) as { result: { next_cursor: string | null } };
			expect(initial.result.next_cursor).toBe("100:c3");
			db.insert(email("b2", ADDRESS, 100));
			const tail = await request(
				db,
				`/reconciliation/${ADDRESS}?since=100&limit=2&cursor=100:c3`,
				SECRET,
			);
			const tailJson = (await tail.json()) as { result: { messages: Email[] } };
			expect(tailJson.result.messages.map((x) => x.id)).toEqual(["d4"]);
			const overlap = await request(db, `/reconciliation/${ADDRESS}?since=100&limit=10`, SECRET);
			const overlapJson = (await overlap.json()) as { result: { messages: Email[] } };
			expect(overlapJson.result.messages.map((x) => x.id)).toEqual(["a1", "b2", "c3", "d4"]);
		} finally {
			db.close();
		}
	});

	test("requires the recipient's original claim key, never another mailbox's key", async () => {
		const db = new SqliteD1();
		try {
			await db.claim(ADDRESS, SECRET);
			await db.claim(OTHER, "different-secret");
			db.insert(email("a1", ADDRESS, 100));

			expect((await request(db, `/reconciliation/${ADDRESS}?since=0`)).status).toBe(401);
			expect((await request(db, `/reconciliation/${ADDRESS}?since=0`, "wrong")).status).toBe(403);
			expect((await request(db, `/reconciliation/${OTHER}?since=0`, SECRET)).status).toBe(403);
			expect(
				(await request(db, "/reconciliation/unclaimed@example.test?since=0", SECRET)).status,
			).toBe(404);
			expect(
				(await request(db, "/reconciliation/unclaimed@invalid.test?since=0", SECRET)).status,
			).toBe(404);
		} finally {
			db.close();
		}
	});

	test("validates bounds and cursors instead of scanning all mail by default", async () => {
		const db = new SqliteD1();
		try {
			await db.claim(ADDRESS, SECRET);
			for (const query of [
				"",
				"?since=-1",
				"?since=abc",
				"?since=0&limit=0",
				"?since=0&limit=26",
				"?since=0&cursor=bad",
				"?since=100&cursor=99:a1",
				"?since=0&cursor=999999999999999999999999:a1",
			]) {
				const response = await request(db, `/reconciliation/${ADDRESS}${query}`, SECRET);
				expect(response.status).toBe(400);
			}
		} finally {
			db.close();
		}
	});

	test("reports D1 failure instead of acknowledging a partial reconciliation", async () => {
		const db = new SqliteD1();
		try {
			await db.claim(ADDRESS, SECRET);
			db.failReconciliation = true;
			const response = await request(db, `/reconciliation/${ADDRESS}?since=0`, SECRET);
			expect(response.status).toBe(500);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(false);
		} finally {
			db.close();
		}
	});

	test("describes the authenticated reconciliation route in OpenAPI", async () => {
		const response = await app.request("/openapi.json");
		expect(response.status).toBe(200);
		const doc = (await response.json()) as {
			paths: Record<string, { get?: { security?: unknown[] } }>;
		};
		expect(doc.paths["/reconciliation/{emailAddress}"]?.get?.security).toEqual([
			{ bearerAuth: [] },
		]);
	});
});
