import { describe, expect, test } from "bun:test";
import app from "@/app";
import { handleEmail } from "@/handlers/emailHandler";
import { validateEmailDomain } from "@/utils/validation";
import { getDomains } from "./domains";

describe("runtime domain configuration", () => {
	test("normalizes and deduplicates a comma-separated allowlist", () => {
		expect(getDomains({ EMAIL_DOMAINS: " Example.TEST,mail.example.test,example.test, " })).toEqual(
			["example.test", "mail.example.test"],
		);
	});

	test("has no fallback when configuration is absent", () => {
		expect(getDomains()).toEqual([]);
		expect(getDomains({ EMAIL_DOMAINS: " , " })).toEqual([]);
		expect(validateEmailDomain("recipient@example.test", {}).valid).toBe(false);
	});

	test("rejects malformed configuration without revealing its value", () => {
		for (const value of ["https://example.test", "*.example.test", "user@example.test"]) {
			expect(() => getDomains({ EMAIL_DOMAINS: value })).toThrow(
				"EMAIL_DOMAINS must contain comma-separated DNS hostnames",
			);
		}
	});

	test("uses the current environment without leaking a previous allowlist", async () => {
		for (const domain of ["first.example.test", "second.example.test"]) {
			const env = { EMAIL_DOMAINS: domain } as CloudflareBindings;
			const response = await app.request("/domains", {}, env);
			expect((await response.json()) as { success: boolean; result: string[] }).toEqual({
				success: true,
				result: [domain],
			});
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(validateEmailDomain(`recipient@${domain.toUpperCase()}`, env).valid).toBe(true);
			expect(validateEmailDomain("recipient@other.example.test", env).valid).toBe(false);
		}
	});

	test("claims fail closed without a configured domain", async () => {
		const response = await app.request(
			"/claims/recipient@example.test",
			{ method: "PUT", headers: { Authorization: "Bearer test-only-key" } },
			{} as CloudflareBindings,
		);
		expect(response.status).toBe(404);
	});

	test("unsupported inbound mail never touches the database or message body", async () => {
		const message = {
			to: "recipient@removed.example.test",
			get raw() {
				throw new Error("Unsupported mail must not be parsed");
			},
		} as unknown as ForwardableEmailMessage;
		await handleEmail(
			message,
			{ EMAIL_DOMAINS: "example.test" } as CloudflareBindings,
			{} as ExecutionContext,
		);
	});

	test("OpenAPI examples do not expose a runtime domain", async () => {
		const response = await app.request("/openapi.json", {}, {
			EMAIL_DOMAINS: "private.example.test",
		} as CloudflareBindings);
		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain("private.example.test");
	});
});
