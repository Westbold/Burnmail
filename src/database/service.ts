import type { Email, EmailSummary } from "@/schemas/emails";

interface Claim {
	email_address: string;
	auth_key_hash: string;
	created_at: number;
}

export class DatabaseService {
	constructor(private db: D1Database) {}

	async getClaimByEmailAddress(emailAddress: string) {
		try {
			const { results, error } = await this.db
				.prepare(
					"SELECT email_address, auth_key_hash, created_at FROM claims WHERE email_address = ?",
				)
				.bind(emailAddress)
				.all();
			return { result: results[0] as unknown as Claim | undefined, error };
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			return { result: undefined, error };
		}
	}

	async insertClaim(emailAddress: string, authKeyHash: string, createdAt: number) {
		try {
			const { success, error, meta } = await this.db
				.prepare("INSERT INTO claims (email_address, auth_key_hash, created_at) VALUES (?, ?, ?)")
				.bind(emailAddress, authKeyHash, createdAt)
				.run();
			return { success, error, meta };
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			return { success: false, error, meta: undefined };
		}
	}

	async deleteClaimByEmailAddress(emailAddress: string) {
		try {
			const { meta, error } = await this.db
				.prepare("DELETE FROM claims WHERE email_address = ?")
				.bind(emailAddress)
				.run();
			return { meta, error };
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			return { meta: undefined, error };
		}
	}

	// Email operations
	async insertEmail(emailData: Email) {
		try {
			const { success, error, meta } = await this.db
				.prepare(
					`INSERT INTO emails (id, from_address, to_address, subject, received_at, html_content, text_content)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					emailData.id,
					emailData.from_address,
					emailData.to_address,
					emailData.subject,
					emailData.received_at,
					emailData.html_content,
					emailData.text_content,
				)
				.run();
			return { success, error, meta };
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			return { success: false, error: error, meta: undefined };
		}
	}

	async getEmailsByRecipient(emailAddress: string, limit: number, offset: number) {
		try {
			const { results, error } = await this.db
				.prepare(
					`SELECT id, from_address, to_address, subject, received_at
         FROM emails
         WHERE to_address = ?
         ORDER BY received_at DESC
         LIMIT ? OFFSET ?`,
				)
				.bind(emailAddress, limit, offset)
				.all();

			return { results: results as EmailSummary[], error };
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			return { results: [], error };
		}
	}

	async getEmailsForReconciliation(
		emailAddress: string,
		since: number,
		afterTimestamp: number,
		afterId: string,
		limit: number,
	) {
		try {
			const { results, error } = await this.db
				.prepare(
					"SELECT id, from_address, to_address, subject, received_at, html_content, text_content FROM emails WHERE to_address = ? AND received_at >= ? AND (received_at > ? OR (received_at = ? AND id > ?)) ORDER BY received_at ASC, id ASC LIMIT ?",
				)
				.bind(emailAddress, since, afterTimestamp, afterTimestamp, afterId, limit)
				.all();
			return { results: results as Email[], error };
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			return { results: [] as Email[], error };
		}
	}

	async getEmailById(emailId: string) {
		try {
			const { results, error } = await this.db
				.prepare(
					`SELECT id, from_address, to_address, subject, received_at, html_content, text_content
         FROM emails
         WHERE id = ?`,
				)
				.bind(emailId)
				.all();

			if (results[0]) {
				return { result: results[0] as Email, error };
			}

			return { result: undefined, error };
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			return { result: undefined, error };
		}
	}

	async countEmailsByRecipient(emailAddress: string) {
		try {
			const { results, error } = await this.db
				.prepare(`SELECT COUNT(*) as count FROM emails WHERE to_address = ?`)
				.bind(emailAddress)
				.all();
			return { count: results[0]?.count || 0, error };
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			return { count: 0, error };
		}
	}

	async deleteEmailsByRecipient(emailAddress: string) {
		try {
			const { meta, error } = await this.db
				.prepare(`DELETE FROM emails WHERE to_address = ?`)
				.bind(emailAddress)
				.run();
			return { meta, error };
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			return { meta: undefined, error };
		}
	}

	async deleteEmailById(emailId: string) {
		try {
			const { meta, error } = await this.db
				.prepare(`DELETE FROM emails WHERE id = ?`)
				.bind(emailId)
				.run();
			return { meta, error };
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			return { meta: undefined, error };
		}
	}
}
