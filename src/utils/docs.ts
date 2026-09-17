import { swaggerUI } from "@hono/swagger-ui";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { DOMAINS_SET } from "@/config/domains";

export function setupDocumentation(app: OpenAPIHono<{ Bindings: CloudflareBindings }>) {
	app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
		type: "http",
		scheme: "bearer",
		description: "Address claim authorization key",
	});

	// OpenAPI Documentation
	app.doc("/openapi.json", {
		openapi: "3.0.0",
		info: {
			version: "1.0.0",
			title: "Temp Mail API",
			description: `
# Temporary Email Service API

A simple and fast temporary email service for permanently claimed disposable addresses.

## Features
- Permanently claim supported email addresses
- Discard inbound email for unclaimed addresses
- Multiple supported domains
- Authorized email retrieval and deletion
- Signed centralized webhook forwarding
- Automatic cleanup

## Authorization
Claim and email endpoints require \`Authorization: Bearer <key>\`. Claim an address with
\`PUT /claims/{emailAddress}\`; every later email request for that address must use the same
bearer key. Use \`DELETE /claims/{emailAddress}\` with the same key to release the claim and
delete all stored email for that address.

## Response Format
- **Success responses** include \`success: true\` and a \`result\` field
- **Error responses** include \`success: false\` and an \`error\` object
- **Validation errors** include \`success: false\` and detailed error information

## Supported Domains
This API currently supports the following email domains:
${`\n${Array.from(DOMAINS_SET)
	.map((domain) => `- ${domain}`)
	.join("\n")}`}

**Repository**: [github.com/vwh/temp-mail](https://github.com/vwh/temp-mail)  
**Issues**: [Report bugs or request features](https://github.com/vwh/temp-mail/issues)
`,
			contact: {
				name: "API Support",
				url: "https://github.com/vwh/temp-mail",
			},
			license: {
				name: "MIT",
				url: "https://github.com/vwh/temp-mail/blob/main/LICENSE",
			},
		},
		servers: [
			{
				url: "/",
				description: "This deployment",
			},
		],
		tags: [
			{
				name: "Claims",
				description: "Operations for claiming and releasing email addresses",
			},
			{
				name: "Emails",
				description: "Authorized operations for managing emails by claimed email address",
			},
			{
				name: "Inbox",
				description: "Authorized operations for individual email messages",
			},
			{
				name: "Domains",
				description: "Get information about supported email domains",
			},
		],
		"x-repository": "https://github.com/vwh/temp-mail",
		"x-issues": "https://github.com/vwh/temp-mail/issues",
	});

	// Swagger UI - Traditional documentation
	app.get("/swagger", swaggerUI({ url: "/openapi.json" }));

	// Scalar - Modern documentation
	app.get(
		"/",
		Scalar({
			url: "/openapi.json",
			theme: "purple",
		}),
	);
}
