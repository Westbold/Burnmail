import { describe, expect, test } from "bun:test";
import { EMAIL_LIMITS } from "@/config/constants";
import { emailContentFits, readBoundedEmail } from "./emailLimits";
import { handleEmail } from "@/handlers/emailHandler";

describe("bounded email storage", () => {
	test("counts UTF-8 bytes across all stored fields", () => {
		expect(emailContentFits(["x".repeat(EMAIL_LIMITS.MAX_CONTENT_BYTES)])).toBe(true);
		expect(emailContentFits(["x".repeat(EMAIL_LIMITS.MAX_CONTENT_BYTES), "x"])).toBe(false);
		expect(emailContentFits(["\u754c".repeat(23000)])).toBe(false);
	});
	test("cancels oversized chunked input even when rawSize was understated", async () => {
		let cancelled = false;
		const raw = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(EMAIL_LIMITS.MAX_RAW_BYTES));
				controller.enqueue(new Uint8Array(1));
			},
			cancel() {
				cancelled = true;
			},
		});
		expect(await readBoundedEmail(raw)).toBeNull();
		expect(cancelled).toBe(true);
	});
	test("accepts the exact raw byte boundary", async () => {
		const raw = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new Uint8Array(EMAIL_LIMITS.MAX_RAW_BYTES));
				c.close();
			},
		});
		expect((await readBoundedEmail(raw))?.byteLength).toBe(EMAIL_LIMITS.MAX_RAW_BYTES);
	});
	test("rejects advertised oversized mail before querying D1 or reading MIME", async () => {
		let rejected = false;
		const message = {
			from: "sender@example.test",
			to: "recipient@example.test",
			rawSize: EMAIL_LIMITS.MAX_RAW_BYTES + 1,
			setReject() {
				rejected = true;
			},
			get raw() {
				throw new Error("must not read");
			},
		} as unknown as ForwardableEmailMessage;
		await handleEmail(
			message,
			{ EMAIL_DOMAINS: "example.test" } as CloudflareBindings,
			{} as ExecutionContext,
		);
		expect(rejected).toBe(true);
	});
});
