/** Runtime secrets are declared separately from generated platform types. */
interface CloudflareBindings {
	MCP_REQUEST_LIMIT?: RateLimit;
	MCP_CREATE_LIMIT?: RateLimit;
	API_HOSTNAME?: string;
	APP_HOSTNAME?: string;
	ROOT_HOSTNAME?: string;
	ASSETS?: Fetcher;
	EMAIL_DOMAINS?: string;
}
