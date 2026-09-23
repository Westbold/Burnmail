/** Read-only checks. Never print hostnames, login URLs, or credentials. */
async function verifyWebmail(): Promise<void> {
	const appHost = process.env.APP_HOSTNAME;
	const rootHost = process.env.ROOT_HOSTNAME;
	const apiHost = process.env.API_HOSTNAME;
	if (!appHost || !rootHost || !apiHost) throw new Error("Webmail host configuration missing");
	const appOrigin = `https://${appHost}`;
	async function get(url: string): Promise<Response> {
		try {
			return await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
		} catch {
			throw new Error("Webmail request failed: DNS, TLS, or network readiness");
		}
	}
	function check(ok: unknown, label: string): asserts ok {
		if (!ok) throw new Error(`Webmail smoke test failed: ${label}`);
	}
	const ui = await get(appOrigin);
	const html = await ui.text();
	check(ui.status === 200 && html.includes("<title>Burnmail</title>"), `app root (HTTP ${ui.status})`);
	check(html.includes('href="/api-docs"'), "docs link");
	const docs = await get(`${appOrigin}/api-docs`);
	check(
		docs.status === 302 && docs.headers.get("location") === `https://${apiHost}/`,
		`docs target (HTTP ${docs.status})`,
	);
	const api = await get(`https://${apiHost}/`);
	check(api.status === 200 && (await api.text()).includes("api-reference"), "API root docs");
	for (const host of [rootHost, `unconfigured-smoke.${rootHost}`]) {
		const response = await get(`https://${host}/`);
		check(
			response.status === 302 && response.headers.get("location") === `${appOrigin}/`,
			`hostname redirect (HTTP ${response.status})`,
		);
	}
	for (const path of ["/app/app.js", "/app/api.js", "/app/styles.css"]) {
		check((await get(appOrigin + path)).status === 200, "static asset");
	}
	const query = new URLSearchParams({ email: "inbox@example.test", key: "test+&=#value" });
	const login = await get(`${appOrigin}/?${query}`);
	check(login.status === 302, "query credential cleanup");
	const target = new URL(login.headers.get("location") ?? "", appOrigin);
	check(!target.search && target.origin === appOrigin, "login redirect origin");
	check(new URLSearchParams(target.hash.slice(1)).get("key") === "test+&=#value", "encoded key");
	check(
		(await get(`${appOrigin}/emails/not-a-real-endpoint/invalid`)).status !== 200,
		"no API HTML fallback",
	);
}

export async function checkWebmail(): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await verifyWebmail();
			console.log(
				"PASS Burnmail app, docs link, apex and wildcard redirects, assets, and query login cleanup",
			);
			return;
		} catch (error) {
			// Only messages generated above are emitted; never include a URL or response body.
			const message = error instanceof Error ? error.message : "Unknown webmail check error";
			console.error(message.startsWith("Webmail ") ? message : "Webmail verification failed");
			if (attempt === 5) throw new Error("Webmail did not pass post-deployment verification");
			await Bun.sleep(2000 * (attempt + 1));
		}
	}
}
