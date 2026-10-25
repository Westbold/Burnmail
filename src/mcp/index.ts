import { createMcpHandler, hostHeaderValidationResponse } from "@modelcontextprotocol/server";
import { createServer } from "./tools";

/** The only integration point: no sessions, global servers, OAuth, storage, or network proxy. */
export async function handleMcp(
	request: Request,
	env: CloudflareBindings,
	ctx: ExecutionContext,
): Promise<Response> {
	const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
	const reply = (body: BodyInit | null, status: number) => new Response(body, { status, headers });
	const url = new URL(request.url);
	const host = env.API_HOSTNAME?.trim().toLowerCase();
	const hosts = host ? [host] : ["localhost", "127.0.0.1", "[::1]"];
	if (
		!hosts.includes(url.hostname) ||
		(request.headers.has("Host") && hostHeaderValidationResponse(request, hosts))
	)
		return reply("Not found", 404);
	const origin = request.headers.get("Origin");
	if (origin !== null && origin !== url.origin) return reply("Forbidden origin", 403);
	if (origin) headers.set("Access-Control-Allow-Origin", origin);
	headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
	headers.set(
		"Access-Control-Allow-Headers",
		"Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, MCP-Method, MCP-Name",
	);
	if (request.method === "OPTIONS") return reply(null, 204);
	if (request.method !== "POST") {
		headers.set("Allow", "POST, OPTIONS");
		return reply("Method not allowed", 405);
	}
	// A configured edge limiter keeps transport state out of Worker memory and D1.
	try {
		const allowed = await env.MCP_REQUEST_LIMIT?.limit({
			key: `burnmail:mcp:request:${request.headers.get("CF-Connecting-IP") ?? "local"}`,
		});
		if (!allowed) return reply("MCP rate limiting unavailable", 503);
		if (!allowed.success) {
			headers.set("Retry-After", "60");
			return reply("Rate limited", 429);
		}
		const handler = createMcpHandler(() => createServer(request, env, ctx), {
			legacy: "stateless",
			maxRequestBodySize: 16 * 1024,
			maxSubscriptions: 0,
			keepAliveMs: 0,
		});
		const response = await handler.fetch(request);
		const result = new Response(response.body, response);
		for (const [name, value] of headers) result.headers.set(name, value);
		return result;
	} catch {
		return reply("MCP service unavailable", 500);
	}
}
