type Inbox = { email_address: string; claim_key: string };
type ToolResult = {
	isError?: boolean;
	content: { type: string; text?: string }[];
	structuredContent: {
		success: boolean;
		result?: unknown;
		status?: number;
		error?: { code: string; retryable: boolean };
	};
};

function check(condition: unknown, label: string): asserts condition {
	if (!condition) throw new Error(`MCP smoke test failed: ${label}`);
}

/** Only creates and removes its own random inbox. Never logs credentials or message bodies. */
export async function checkMcp(base: URL): Promise<void> {
	check(base.protocol === "https:" && !base.username && !base.password, "HTTPS endpoint");
	let id = 0;
	async function rpc(method: string, params: Record<string, unknown> = {}) {
		const response = await fetch(new URL("/mcp", base), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
			redirect: "error",
			signal: AbortSignal.timeout(15000),
		});
		check(response.status === 200, "transport status");
		check(response.headers.get("Cache-Control") === "no-store", "no-store responses");
		check(
			!response.headers.has("Mcp-Session-Id") && !response.headers.has("Set-Cookie"),
			"stateless transport",
		);
		const raw = await response.text();
		const text = response.headers.get("Content-Type")?.includes("text/event-stream")
			? raw
					.split("\n")
					.find((line) => line.startsWith("data: "))
					?.slice(6)
			: raw;
		check(text, "JSON result");
		const payload = JSON.parse(text) as { result?: unknown; error?: unknown };
		check(!payload.error && payload.result, "tool result, not a protocol error");
		return payload.result;
	}
	async function call(name: string, args: Record<string, unknown> = {}) {
		const reply = (await rpc("tools/call", { name, arguments: args })) as ToolResult;
		check(
			JSON.stringify(JSON.parse(reply.content[0]?.text ?? "null")) ===
				JSON.stringify(reply.structuredContent),
			"matching text and structured results",
		);
		return reply;
	}
	function value<T>(reply: ToolResult): T {
		check(!reply.isError && reply.structuredContent.success, "successful tool execution");
		return reply.structuredContent.result as T;
	}
	function failure(reply: ToolResult, status: number, code: string) {
		check(reply.isError && !reply.structuredContent.success, "tool error flag");
		check(
			reply.structuredContent.status === status && reply.structuredContent.error?.code === code,
			"typed error status/code",
		);
		check(
			reply.structuredContent.error?.retryable === false,
			"non-retryable authorization/not-found error",
		);
	}

	const { tools } = (await rpc("tools/list")) as {
		tools: { name: string; outputSchema?: unknown; annotations: { destructiveHint?: boolean } }[];
	};
	const names = [
		"list_domains",
		"create_inbox",
		"list_messages",
		"read_message",
		"count_messages",
		"delete_message",
		"clear_inbox",
		"release_inbox",
		"reconcile_inbox",
	];
	check(
		JSON.stringify(tools.map((t) => t.name).sort()) === JSON.stringify(names.sort()),
		"nine-tool discovery",
	);
	check(
		tools.every((t) => t.outputSchema),
		"declared result schemas",
	);
	for (const name of ["delete_message", "clear_inbox", "release_inbox"]) {
		check(
			tools.find((t) => t.name === name)?.annotations.destructiveHint === true,
			"destructive annotations retained",
		);
	}
	check(value<string[]>(await call("list_domains")).length > 0, "receiving domains");
	const inbox = value<Inbox>(await call("create_inbox", { prefix: "mcp-smoke" }));
	try {
		check(value<unknown[]>(await call("list_messages", inbox)).length === 0, "new inbox empty");
		check(value<{ count: number }>(await call("count_messages", inbox)).count === 0, "empty count");
		const page = value<{ data: unknown[]; hasNext: boolean }>(
			await call("reconcile_inbox", { ...inbox, since: 0, limit: 1 }),
		);
		check(page.data.length === 0 && !page.hasNext, "empty reconciliation");
		failure(
			await call("count_messages", { ...inbox, claim_key: "deliberately-wrong-test-key" }),
			403,
			"FORBIDDEN",
		);
		failure(
			await call("release_inbox", { ...inbox, claim_key: "deliberately-wrong-test-key" }),
			403,
			"FORBIDDEN",
		);
		const message_id = `z${crypto.randomUUID().replaceAll("-", "").slice(0, 23)}`;
		for (const name of ["read_message", "delete_message"])
			failure(await call(name, { ...inbox, message_id }), 404, "NOT_FOUND");
		for (let i = 0; i < 2; i++)
			check(
				value<{ deleted_count: number }>(await call("clear_inbox", inbox)).deleted_count === 0,
				"idempotent empty clear",
			);
	} finally {
		value(await call("release_inbox", inbox));
	}
	failure(await call("count_messages", inbox), 404, "NOT_FOUND");
	console.log(
		"PASS live MCP discovery, typed errors, empty-clear retries, authorization, and release; test inbox removed",
	);
}

if (import.meta.main) {
	const configured =
		process.env.API_BASE_URL ||
		(process.env.API_HOSTNAME ? `https://${process.env.API_HOSTNAME}` : "");
	try {
		if (!configured) throw new Error("Missing endpoint");
		await checkMcp(new URL(configured));
	} catch {
		console.error(
			"MCP smoke test failed. Check private deployment configuration; no credentials logged.",
		);
		process.exitCode = 1;
	}
}
