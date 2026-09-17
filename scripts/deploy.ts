import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkPrivateConfig } from "./private-config";

async function main(): Promise<void> {
	const root = fileURLToPath(new URL("../", import.meta.url).href);
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const hostname = process.env.API_HOSTNAME?.trim().toLowerCase();
	const config = JSON.parse(await readFile(`${root}/wrangler.jsonc`, "utf8"));

	if (!dryRun) {
		if (!hostname || !/^[a-z0-9.-]+$/.test(hostname) || !hostname.includes(".")) {
			throw new Error("Set API_HOSTNAME privately before deploying");
		}
		await checkPrivateConfig(root);
		config.routes = [{ pattern: hostname, custom_domain: true }];
	}

	// Keep this beside the source config so relative main/binding paths stay correct.
	const temporaryConfig = `${root}/.wrangler.deploy-${randomUUID()}.json`;
	await writeFile(temporaryConfig, JSON.stringify(config), { mode: 0o600, flag: "wx" });
	try {
		const child = Bun.spawn(
			["bunx", "wrangler", "deploy", "--minify", "--config", temporaryConfig, ...args],
			{ cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
		);
		if ((await child.exited) !== 0) throw new Error("Wrangler deployment failed");
	} finally {
		await unlink(temporaryConfig);
	}

	if (!dryRun) {
		const smoke = Bun.spawn(["bun", "run", "scripts/smoke.ts"], {
			cwd: root,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		if ((await smoke.exited) !== 0) {
			throw new Error("Deployment completed, but the post-deploy smoke test failed");
		}
	}
}

main().catch((error: Error) => {
	console.error(error.message);
	process.exitCode = 1;
});
