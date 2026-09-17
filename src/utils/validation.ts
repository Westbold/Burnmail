import { type DomainConfig, getDomains } from "@/config/domains";
import { ERR } from "@/utils/http";
import { getDomain } from "@/utils/mail";

/** Validate the recipient against this request's runtime allowlist. */
export function validateEmailDomain(emailAddress: string, env: DomainConfig) {
	const domains = getDomains(env);
	if (!domains.includes(getDomain(emailAddress).toLowerCase())) {
		return {
			valid: false,
			error: ERR("Domain not supported", "DomainError", {
				supported_domains: domains,
			}),
		};
	}
	return { valid: true };
}
