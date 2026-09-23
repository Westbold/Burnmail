/** Runtime secrets are declared separately from generated platform types. */
interface CloudflareBindings {
	API_HOSTNAME?: string;
	APP_HOSTNAME?: string;
	ROOT_HOSTNAME?: string;
	ASSETS?: Fetcher;
	EMAIL_DOMAINS?: string;
}
