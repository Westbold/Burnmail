import { createId } from "@paralleldrive/cuid2";
import PostalMime from "postal-mime";
import { EMAIL_LIMITS } from "@/config/constants";
import { emailContentFits, readBoundedEmail } from "@/utils/emailLimits";
import { getDomains } from "@/config/domains";
import * as db from "@/database/d1";
import { emailSchema } from "@/schemas/emails";
import { now } from "@/utils/helpers";
import { getDomain, processEmailContent } from "@/utils/mail";
import { PerformanceTimer } from "@/utils/performance";
import { sendEmailWebhook } from "@/utils/webhook";

/**
 * Cloudflare email router handler.
 */
export async function handleEmail(
	message: ForwardableEmailMessage,
	env: CloudflareBindings,
	ctx: ExecutionContext,
) {
	try {
		if (!getDomains(env).includes(getDomain(message.to).toLowerCase())) return;

		if (message.rawSize > EMAIL_LIMITS.MAX_RAW_BYTES) {
			message.setReject("Email exceeds the size limit");
			return;
		}
		const timer = new PerformanceTimer("email-processing");
		const emailId = createId();
		const { result: claim, error: claimError } = await db.getClaimByEmailAddress(
			env.D1,
			message.to,
		);

		if (claimError) {
			throw new Error(`Failed to check address claim: ${claimError.message}`);
		}

		if (!claim) {
			timer.end();
			return;
		}

		const raw = await readBoundedEmail(message.raw);
		if (raw === null) {
			message.setReject("Email exceeds the size limit");
			return;
		}
		const email = await PostalMime.parse(raw);

		// Process email content
		const { htmlContent, textContent } = processEmailContent(
			email.html ?? null,
			email.text ?? null,
		);

		if (!emailContentFits([message.from, message.to, email.subject, htmlContent, textContent])) {
			message.setReject("Email exceeds the content limit");
			return;
		}
		const emailData = emailSchema.parse({
			id: emailId,
			from_address: message.from,
			to_address: message.to,
			subject: email.subject || null,
			received_at: now(),
			html_content: htmlContent,
			text_content: textContent,
		});

		// Insert email
		const { success, error } = await db.insertEmail(env.D1, emailData);

		if (!success) {
			throw new Error(`Failed to insert email: ${error}`);
		}

		ctx.waitUntil(sendEmailWebhook(emailData, env));
		timer.end(); // Log processing time
	} catch (error) {
		console.error("Failed to process email:", error);
		throw error;
	}
}
