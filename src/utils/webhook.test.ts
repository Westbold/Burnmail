import { describe, expect, test } from "bun:test";
import { createWebhookBody, createWebhookSignature } from "./webhook";

describe("webhook signatures", () => {
	test("signs the exact UTF-8 JSON body with HMAC-SHA512 base64", async () => {
		const body = createWebhookBody({
			id: "email_1",
			from_address: "sender@example.com",
			to_address: "inbox@example.test",
			subject: "Hello",
			received_at: 1753317948,
			html_content: "<p>Hello</p>",
			text_content: "Hello",
		});

		const signature = await createWebhookSignature(body, "top-secret");

		expect(body).toBe(
			'{"id":"email_1","from_address":"sender@example.com","to_address":"inbox@example.test","subject":"Hello","received_at":1753317948,"html_content":"<p>Hello</p>","text_content":"Hello"}',
		);
		expect(signature).toBe(
			"HMAC-SHA512=If9sMfZpRBBpaD68gk8B3NnQnax/bhimBrtCGmGtvWTwwttYwTz4Z/UTKId+nlG/vAZMKQm0y27fwpK1iTpjAA==",
		);
	});
});
