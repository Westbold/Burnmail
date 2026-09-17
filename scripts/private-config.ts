import { readFile } from "node:fs/promises";

/** Check every tracked file without printing private values into build logs. */
export async function checkPrivateConfig(root: string): Promise<void> {
	const forbidden = [process.env.API_HOSTNAME, ...(process.env.EMAIL_DOMAINS ?? "").split(",")]
		.map((value) => value?.trim().toLowerCase())
		.filter((value): value is string => Boolean(value));
	const listing = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root });
	if (listing.exitCode !== 0) throw new Error("Cannot audit tracked deployment configuration");
	const files = listing.stdout.toString().split("\0").filter(Boolean);
	for (const file of files) {
		const content = (await readFile(`${root}/${file}`, "utf8")).toLowerCase();
		if (forbidden.some((value) => content.includes(value))) {
			throw new Error(`Private deployment configuration found in tracked file: ${file}`);
		}
	}
	console.log(`PASS private-configuration audit (${files.length} tracked files)`);
}
