import { handleEmail } from "@/handlers/emailHandler";
import { handleHttp } from "@/handlers/httpHandler";
import { handleScheduled } from "@/handlers/scheduledHandler";

export default {
	// Hono ( Cloudflare Worker )
	fetch: handleHttp,

	// Cloudflare email router
	email: handleEmail,

	// Cloudflare Scheduled Functions
	scheduled: (event: ScheduledEvent, env: CloudflareBindings, ctx: ExecutionContext) => {
		switch (event.cron) {
			case "0 */2 * * *":
				return handleScheduled(event, env, ctx);
		}
	},
};
