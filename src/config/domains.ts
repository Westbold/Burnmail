/** Receiving domains are runtime configuration, never source-code constants. */
export interface DomainConfig {
	EMAIL_DOMAINS?: string;
}

export function getDomains(env: DomainConfig = {}): string[] {
	const domains = (env.EMAIL_DOMAINS ?? "")
		.split(",")
		.map((domain) => domain.trim().toLowerCase())
		.filter(Boolean);

	const hostname =
		/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
	if (domains.some((domain) => domain.length > 253 || !hostname.test(domain))) {
		throw new Error("EMAIL_DOMAINS must contain comma-separated DNS hostnames");
	}

	// A missing configuration supports no domains; there is no production fallback.
	return [...new Set(domains)];
}
