// External imports
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";

// Configuration imports
import { getDomains } from "@/config/domains";

// Database imports
import { createDatabaseService } from "@/database";
import type { DatabaseService } from "@/database/service";

// Schema imports
import {
	claimAddressRoute,
	deleteEmailRoute,
	deleteEmailsRoute,
	getDomainsRoute,
	getEmailRoute,
	getEmailsCountRoute,
	getEmailsRoute,
	releaseAddressClaimRoute,
} from "@/schemas/emails/routeDefinitions";

// Utility imports
import { extractBearerToken, hashAuthorizationKey } from "@/utils/auth";
import { now } from "@/utils/helpers";
import { ERR, OK } from "@/utils/http";
import { validateEmailDomain } from "@/utils/validation";

const emailRoutes = new OpenAPIHono<{ Bindings: CloudflareBindings }>();
type AppContext = Context<{ Bindings: CloudflareBindings }>;

async function getAuthorizationHash(c: AppContext) {
	const token = extractBearerToken(c.req.header("Authorization") ?? null);
	if (!token) {
		return {
			error: ERR("Missing or invalid Authorization header", "Unauthorized"),
			status: 401,
		} as const;
	}

	return { authKeyHash: await hashAuthorizationKey(token) } as const;
}

async function authorizeClaim(
	dbService: DatabaseService,
	emailAddress: string,
	authKeyHash: string,
) {
	const { result: claim, error } = await dbService.getClaimByEmailAddress(emailAddress);

	if (error) {
		return { error: ERR(error.message, "D1Error"), status: 500 } as const;
	}

	if (!claim) {
		return { error: ERR("Address not claimed", "NotFound"), status: 404 } as const;
	}

	if (claim.auth_key_hash !== authKeyHash) {
		return {
			error: ERR("Authorization key does not match claim", "Forbidden"),
			status: 403,
		} as const;
	}

	return { claim } as const;
}

// @ts-ignore - OpenAPI route handler type mismatch with error response status codes
emailRoutes.openapi(claimAddressRoute, async (c) => {
	const { emailAddress } = c.req.valid("param");

	const domainValidation = validateEmailDomain(emailAddress, c.env);
	if (!domainValidation.valid) return c.json(domainValidation.error, 404);

	const authorization = await getAuthorizationHash(c);
	if ("error" in authorization) return c.json(authorization.error, authorization.status);

	const dbService = createDatabaseService(c.env.D1);
	const { result: existingClaim, error: claimError } =
		await dbService.getClaimByEmailAddress(emailAddress);

	if (claimError) return c.json(ERR(claimError.message, "D1Error"), 500);
	if (existingClaim) {
		if (existingClaim.auth_key_hash !== authorization.authKeyHash) {
			return c.json(ERR("Address already claimed", "Conflict"), 409);
		}

		return c.json(OK({ message: "Address claimed successfully", email_address: emailAddress }));
	}

	const { success, error } = await dbService.insertClaim(
		emailAddress,
		authorization.authKeyHash,
		now(),
	);

	if (!success) return c.json(ERR(error?.message ?? "Failed to claim address", "D1Error"), 500);
	return c.json(OK({ message: "Address claimed successfully", email_address: emailAddress }));
});

// @ts-ignore - OpenAPI route handler type mismatch with error response status codes
emailRoutes.openapi(releaseAddressClaimRoute, async (c) => {
	const { emailAddress } = c.req.valid("param");

	const domainValidation = validateEmailDomain(emailAddress, c.env);
	if (!domainValidation.valid) return c.json(domainValidation.error, 404);

	const authorization = await getAuthorizationHash(c);
	if ("error" in authorization) return c.json(authorization.error, authorization.status);

	const dbService = createDatabaseService(c.env.D1);
	const claimAuthorization = await authorizeClaim(
		dbService,
		emailAddress,
		authorization.authKeyHash,
	);
	if ("error" in claimAuthorization)
		return c.json(claimAuthorization.error, claimAuthorization.status);

	const { meta: deleteEmailMeta, error: deleteEmailError } =
		await dbService.deleteEmailsByRecipient(emailAddress);
	if (deleteEmailError) return c.json(ERR(deleteEmailError.message, "D1Error"), 500);

	const { error: deleteClaimError } = await dbService.deleteClaimByEmailAddress(emailAddress);
	if (deleteClaimError) return c.json(ERR(deleteClaimError.message, "D1Error"), 500);

	return c.json(
		OK({
			message: "Claim released successfully",
			deleted_count: deleteEmailMeta?.changes ?? 0,
		}),
	);
});

// @ts-ignore - OpenAPI route handler type mismatch with error response status codes
emailRoutes.openapi(getEmailsRoute, async (c) => {
	const { emailAddress } = c.req.valid("param");
	const { limit, offset } = c.req.valid("query");

	const domainValidation = validateEmailDomain(emailAddress, c.env);
	if (!domainValidation.valid) return c.json(domainValidation.error, 404);

	const authorization = await getAuthorizationHash(c);
	if ("error" in authorization) return c.json(authorization.error, authorization.status);

	const dbService = createDatabaseService(c.env.D1);
	const claimAuthorization = await authorizeClaim(
		dbService,
		emailAddress,
		authorization.authKeyHash,
	);
	if ("error" in claimAuthorization)
		return c.json(claimAuthorization.error, claimAuthorization.status);

	const { results, error } = await dbService.getEmailsByRecipient(emailAddress, limit, offset);

	if (error) return c.json(ERR(error.message, "D1Error"), 500);
	return c.json(OK(results));
});

// @ts-ignore - OpenAPI route handler type mismatch with error response status codes
emailRoutes.openapi(getEmailsCountRoute, async (c) => {
	const { emailAddress } = c.req.valid("param");

	const domainValidation = validateEmailDomain(emailAddress, c.env);
	if (!domainValidation.valid) return c.json(domainValidation.error, 404);

	const authorization = await getAuthorizationHash(c);
	if ("error" in authorization) return c.json(authorization.error, authorization.status);

	const dbService = createDatabaseService(c.env.D1);
	const claimAuthorization = await authorizeClaim(
		dbService,
		emailAddress,
		authorization.authKeyHash,
	);
	if ("error" in claimAuthorization)
		return c.json(claimAuthorization.error, claimAuthorization.status);

	const { count, error } = await dbService.countEmailsByRecipient(emailAddress);

	if (error) return c.json(ERR(error.message, "D1Error"), 500);
	return c.json(OK({ count }));
});

// @ts-ignore - OpenAPI route handler type mismatch with error response status codes
emailRoutes.openapi(deleteEmailsRoute, async (c) => {
	const { emailAddress } = c.req.valid("param");

	const domainValidation = validateEmailDomain(emailAddress, c.env);
	if (!domainValidation.valid) return c.json(domainValidation.error, 404);

	const authorization = await getAuthorizationHash(c);
	if ("error" in authorization) return c.json(authorization.error, authorization.status);

	const dbService = createDatabaseService(c.env.D1);
	const claimAuthorization = await authorizeClaim(
		dbService,
		emailAddress,
		authorization.authKeyHash,
	);
	if ("error" in claimAuthorization)
		return c.json(claimAuthorization.error, claimAuthorization.status);

	const { meta, error } = await dbService.deleteEmailsByRecipient(emailAddress);

	if (error) return c.json(ERR(error.message, "D1Error"), 500);
	if (meta && meta.changes === 0)
		return c.json(ERR("No emails found for deletion", "NotFound"), 404);
	return c.json(OK({ message: "Emails deleted successfully", deleted_count: meta?.changes }));
});

// @ts-ignore - OpenAPI route handler type mismatch with error response status codes
emailRoutes.openapi(getEmailRoute, async (c) => {
	const { emailId } = c.req.valid("param");

	const authorization = await getAuthorizationHash(c);
	if ("error" in authorization) return c.json(authorization.error, authorization.status);

	const dbService = createDatabaseService(c.env.D1);
	const { result, error } = await dbService.getEmailById(emailId);

	if (error) return c.json(ERR(error.message, "D1Error"), 500);
	if (!result) return c.json(ERR("Email not found", "NotFound"), 404);

	const claimAuthorization = await authorizeClaim(
		dbService,
		result.to_address,
		authorization.authKeyHash,
	);
	if ("error" in claimAuthorization)
		return c.json(claimAuthorization.error, claimAuthorization.status);

	return c.json(OK(result));
});

// @ts-ignore - OpenAPI route handler type mismatch with error response status codes
emailRoutes.openapi(deleteEmailRoute, async (c) => {
	const { emailId } = c.req.valid("param");

	const authorization = await getAuthorizationHash(c);
	if ("error" in authorization) return c.json(authorization.error, authorization.status);

	const dbService = createDatabaseService(c.env.D1);
	const { result, error: getEmailError } = await dbService.getEmailById(emailId);

	if (getEmailError) return c.json(ERR(getEmailError.message, "D1Error"), 500);
	if (!result) return c.json(ERR("Email not found", "NotFound"), 404);

	const claimAuthorization = await authorizeClaim(
		dbService,
		result.to_address,
		authorization.authKeyHash,
	);
	if ("error" in claimAuthorization)
		return c.json(claimAuthorization.error, claimAuthorization.status);

	const { meta, error } = await dbService.deleteEmailById(emailId);

	if (error) return c.json(ERR(error.message, "D1Error"), 500);
	if (meta && meta.changes === 0) return c.json(ERR("Email not found", "NotFound"), 404);
	return c.json(OK({ message: "Email deleted successfully" }));
});

emailRoutes.openapi(getDomainsRoute, async (c) => {
	c.header("Cache-Control", "no-store");
	return c.json(OK(getDomains(c.env)));
});

export default emailRoutes;
