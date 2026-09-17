import { describe, expect, test } from "bun:test";
import { handleEmail } from "./emailHandler";

class UnclaimedAddressD1 {
	prepare() {
		return {
			bind: () => ({
				first: async () => null,
			}),
		};
	}
}

describe("email handler access control", () => {
	test("discards unclaimed inbound email before parsing or webhook delivery", async () => {
		let waitUntilCalls = 0;
		const message = {
			from: "sender@example.com",
			to: "recipient@example.test",
			get raw() {
				throw new Error("unclaimed email should not be parsed");
			},
		} as unknown as ForwardableEmailMessage;
		const env = {
			D1: new UnclaimedAddressD1() as unknown as D1Database,
			EMAIL_DOMAINS: "example.test",
		} as CloudflareBindings;
		const ctx = {
			waitUntil: () => {
				waitUntilCalls++;
			},
		} as unknown as ExecutionContext;

		await handleEmail(message, env, ctx);

		expect(waitUntilCalls).toBe(0);
	});
});
