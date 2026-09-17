// Only domains owned and routed to this deployment belong in this list.
export const DOMAINS = [
	{
		owner: "Westbold",
		domain: "0357000.xyz",
	},
] satisfies {
	owner: string;
	domain: string;
}[];

export const DOMAINS_SET = new Set(DOMAINS.map((d) => d.domain));
