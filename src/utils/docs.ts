import { swaggerUI } from "@hono/swagger-ui";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";

export function setupDocumentation(app: OpenAPIHono<{ Bindings: CloudflareBindings }>) {
	app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
		type: "http",
		scheme: "bearer",
		description: "The secret key used to claim this recipient address",
	});

	app.doc("/openapi.json", {
		openapi: "3.0.0",
		info: {
			version: "1.0.0",
			title: "Passworthy Temp Email API",
			description: `
Claim-based temporary inboxes for Passworthy, backed by Cloudflare Email Routing and D1.

Claim an address with PUT /claims/{emailAddress} before sending mail to it.
Use the same Authorization: Bearer <key> for every subsequent request to that inbox.
Claims do not expire. Releasing a claim also deletes the address's stored messages.

Unclaimed or unsupported recipients are discarded. Attachments are not stored.
Stored messages expire according to the deployment's retention and cleanup schedule.
Optional webhook delivery uses a centralized HMAC-SHA512 signature, not the claim key.

GET /domains returns the runtime receiving-domain allowlist. Examples use reserved
placeholder addresses; they are not production configuration.
`,
			contact: {
				name: "Westbold",
				url: "https://github.com/Westbold/Passworthy-Temp-Email",
			},
			license: { name: "MIT" },
		},
		servers: [{ url: "/", description: "This deployment" }],
		tags: [
			{ name: "Claims", description: "Claim and release recipient addresses" },
			{ name: "Emails", description: "List, count, and delete a recipient's messages" },
			{ name: "Inbox", description: "Read and delete individual messages" },
			{ name: "Domains", description: "Read the runtime receiving-domain allowlist" },
		],
	});

	app.get("/swagger", swaggerUI({ url: "/openapi.json" }));
	app.get("/", Scalar({ url: "/openapi.json", theme: "purple" }));
}
