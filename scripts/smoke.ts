import { randomBytes } from "node:crypto";
import { resolveMx } from "node:dns/promises";

type Payload = Record<string, unknown>;
type Request = (path: string, method?: string, token?: string) => Promise<[number, Payload]>;

function check(condition: unknown, label: string): asserts condition {
	if (!condition) throw new Error(`Smoke test failed: ${label}`);
}

async function waitForHealth(request: Request): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			check((await request("/health"))[0] === 200, "HTTPS and D1 health");
			return;
		} catch (error) {
			if (attempt === 11) throw error;
			await Bun.sleep(2000);
		}
	}
}

async function main(): Promise<void> {
	const configured =
		process.env.API_BASE_URL ||
		(process.env.API_HOSTNAME ? `https://${process.env.API_HOSTNAME}` : "");
	if (!configured) throw new Error("Set API_BASE_URL or API_HOSTNAME privately");
	const base = new URL(configured);
	if (base.protocol !== "https:" || base.username || base.password) {
		throw new Error("The smoke-test endpoint must be an HTTPS URL without credentials");
	}

	async function request(path: string, method = "GET", token?: string): Promise<[number, Payload]> {
		try {
			const response = await fetch(new URL(path, base), {
				method,
				headers: token ? { Authorization: `Bearer ${token}` } : {},
				signal: AbortSignal.timeout(10000),
				redirect: "error",
			});
			return [response.status, (await response.json()) as Payload];
		} catch {
			throw new Error("Smoke-test request failed; endpoint and response are not logged");
		}
	}

	await waitForHealth(request);
	const [domainStatus, domainBody] = await request("/domains");
	check(domainStatus === 200 && Array.isArray(domainBody.result), "domain configuration");
	const domains = domainBody.result as string[];
	check(
		domains.length > 0 && domains.every((domain) => typeof domain === "string"),
		"nonempty allowlist",
	);
	const expected = (process.env.EMAIL_DOMAINS ?? "")
		.split(",")
		.map((x) => x.trim().toLowerCase())
		.filter(Boolean);
	if (expected.length) {
		check(
			JSON.stringify([...new Set(expected)].sort()) === JSON.stringify([...domains].sort()),
			"runtime secret matches deployment configuration",
		);
	}
	for (const domain of domains) {
		const records = await resolveMx(domain);
		check(
			records.filter((r) => r.exchange.endsWith(".mx.cloudflare.net")).length === 3,
			"public mail DNS",
		);
	}
	const [docStatus, document] = await request("/openapi.json");
	check(docStatus === 200 && Array.isArray(document.servers), "API documentation");
	check(
		document.servers.every((server: { url: string }) => server.url === "/"),
		"same-origin API docs",
	);
	console.log("PASS HTTPS, D1 health, runtime allowlist, public MX, and API documentation");

	const address = `smoke-${randomBytes(12).toString("hex")}@${domains[0]}`;
	const key = randomBytes(32).toString("hex");
	const otherKey = randomBytes(32).toString("hex");
	const claim = `/claims/${encodeURIComponent(address)}`;
	const inbox = `/emails/${encodeURIComponent(address)}`;
	let claimed = false;
	try {
		check((await request(inbox))[0] === 401, "missing-key denial");
		check((await request(claim, "PUT", key))[0] === 200, "claim creation");
		claimed = true;
		check((await request(claim, "PUT", key))[0] === 200, "claim idempotency");
		check((await request(claim, "PUT", otherKey))[0] === 409, "claim conflict");
		check((await request(inbox, "GET", otherKey))[0] === 403, "wrong-key denial");
		const [status, body] = await request(inbox, "GET", key);
		check(status === 200 && Array.isArray(body.result) && body.result.length === 0, "inbox read");
		check(
			(await request(`/emails/count/${encodeURIComponent(address)}`, "GET", key))[0] === 200,
			"inbox count",
		);
		check((await request(claim, "DELETE", otherKey))[0] === 403, "wrong-key deletion denial");
		console.log(
			"PASS live claim creation, idempotency, conflicts, inbox access, and authorization",
		);
	} finally {
		if (claimed) check((await request(claim, "DELETE", key))[0] === 200, "test-claim cleanup");
	}
	check((await request(inbox, "GET", key))[0] === 404, "released inbox denial");
	console.log("PASS temporary claim removed; no test recipient or key logged");
}

main().catch(() => {
	console.error("Production smoke test failed. Check private deployment logs and configuration.");
	process.exitCode = 1;
});
