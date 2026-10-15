import { createRoute } from "@hono/zod-openapi";
import {
	claimReleaseSuccessResponseSchema,
	claimSuccessResponseSchema,
	domainErrorResponseSchema,
	domainsSuccessResponseSchema,
	emailAddressParamSchema,
	emailDeleteSuccessResponseSchema,
	emailDetailSuccessResponseSchema,
	emailIdParamSchema,
	emailListSuccessResponseSchema,
	emailQuerySchema,
	emailsCountSuccessResponseSchema,
	emailsDeleteSuccessResponseSchema,
	errorResponseSchema,
	notFoundErrorResponseSchema,
	reconciliationQuerySchema,
	reconciliationSuccessResponseSchema,
	validationErrorResponseSchema,
} from "./index";

const bearerSecurity = [{ bearerAuth: [] }];
const errorJson = {
	"application/json": {
		schema: errorResponseSchema,
	},
};
const unauthorizedResponse = {
	content: errorJson,
	description: "Missing or invalid Authorization bearer token",
};
const forbiddenResponse = {
	content: errorJson,
	description: "Authorization bearer token does not match the address claim",
};

// Claim address route
export const claimAddressRoute = createRoute({
	method: "put",
	path: "/claims/{emailAddress}",
	security: bearerSecurity,
	request: {
		params: emailAddressParamSchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: claimSuccessResponseSchema,
				},
			},
			description: "Address claimed successfully",
		},
		400: {
			content: {
				"application/json": {
					schema: validationErrorResponseSchema,
				},
			},
			description: "Validation error - invalid email format",
		},
		401: unauthorizedResponse,
		404: {
			content: {
				"application/json": {
					schema: domainErrorResponseSchema,
				},
			},
			description: "Domain not supported - returns list of supported domains",
		},
		409: {
			content: errorJson,
			description: "Address already claimed by a different bearer token",
		},
	},
	tags: ["Claims"],
	summary: "Claim address",
	description: "Permanently claim an email address with the Authorization bearer key.",
});

// Release address claim route
export const releaseAddressClaimRoute = createRoute({
	method: "delete",
	path: "/claims/{emailAddress}",
	security: bearerSecurity,
	request: {
		params: emailAddressParamSchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: claimReleaseSuccessResponseSchema,
				},
			},
			description: "Claim released successfully",
		},
		400: {
			content: {
				"application/json": {
					schema: validationErrorResponseSchema,
				},
			},
			description: "Validation error - invalid email format",
		},
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: {
			content: errorJson,
			description: "Domain not supported or claim not found",
		},
	},
	tags: ["Claims"],
	summary: "Release address claim",
	description: "Release an email address claim and delete all emails for that address.",
});

// Get emails route
export const getEmailsRoute = createRoute({
	method: "get",
	path: "/emails/{emailAddress}",
	security: bearerSecurity,
	request: {
		params: emailAddressParamSchema,
		query: emailQuerySchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: emailListSuccessResponseSchema,
				},
			},
			description: "Successfully retrieved emails for the specified address",
		},
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: {
			content: errorJson,
			description: "Domain not supported or claim not found",
		},
		400: {
			content: {
				"application/json": {
					schema: validationErrorResponseSchema,
				},
			},
			description: "Validation error - invalid email format",
		},
	},
	tags: ["Emails"],
	summary: "Get emails",
	description:
		"Retrieve all emails for a claimed email address with the matching Authorization bearer token.",
});

// Get emails count route
export const getEmailsCountRoute = createRoute({
	method: "get",
	path: "/emails/count/{emailAddress}",
	security: bearerSecurity,
	request: {
		params: emailAddressParamSchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: emailsCountSuccessResponseSchema,
				},
			},
			description: "Successfully retrieved the count of emails for the specified address",
		},
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: {
			content: errorJson,
			description: "Domain not supported or claim not found",
		},
		400: {
			content: {
				"application/json": {
					schema: validationErrorResponseSchema,
				},
			},
			description: "Validation error - invalid email format",
		},
	},
	tags: ["Emails"],
	summary: "Get email count",
	description:
		"Retrieve the total number of emails for a claimed email address with the matching Authorization bearer token.",
});

// Delete emails route
export const deleteEmailsRoute = createRoute({
	method: "delete",
	path: "/emails/{emailAddress}",
	security: bearerSecurity,
	request: {
		params: emailAddressParamSchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: emailsDeleteSuccessResponseSchema,
				},
			},
			description: "Successfully deleted all emails for the address",
		},
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: {
			content: errorJson,
			description: "Domain not supported, claim not found, or no emails found",
		},
		400: {
			content: {
				"application/json": {
					schema: validationErrorResponseSchema,
				},
			},
			description: "Validation error - invalid email format",
		},
	},
	tags: ["Emails"],
	summary: "Delete all emails",
	description:
		"Delete all emails associated with a claimed email address using the matching Authorization bearer token",
});

// Get single email route
export const getEmailRoute = createRoute({
	method: "get",
	path: "/inbox/{emailId}",
	security: bearerSecurity,
	request: {
		params: emailIdParamSchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: emailDetailSuccessResponseSchema,
				},
			},
			description: "Successfully retrieved email details",
		},
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: {
			content: {
				"application/json": {
					schema: notFoundErrorResponseSchema,
				},
			},
			description: "Email not found",
		},
		400: {
			content: {
				"application/json": {
					schema: validationErrorResponseSchema,
				},
			},
			description: "Validation error - invalid email ID format",
		},
	},
	tags: ["Inbox"],
	summary: "Get email inbox",
	description:
		"Retrieve full email content by email ID using the matching Authorization bearer token for the recipient claim",
});

// Delete single email route
export const deleteEmailRoute = createRoute({
	method: "delete",
	path: "/inbox/{emailId}",
	security: bearerSecurity,
	request: {
		params: emailIdParamSchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: emailDeleteSuccessResponseSchema,
				},
			},
			description: "Successfully deleted the email",
		},
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: {
			content: {
				"application/json": {
					schema: notFoundErrorResponseSchema,
				},
			},
			description: "Email not found",
		},
		400: {
			content: {
				"application/json": {
					schema: validationErrorResponseSchema,
				},
			},
			description: "Validation error - invalid email ID format",
		},
	},
	tags: ["Inbox"],
	summary: "Delete email inbox",
	description:
		"Delete a specific inbox by its email ID using the matching Authorization bearer token for the recipient claim",
});

export const reconcileEmailsRoute = createRoute({
	method: "get",
	path: "/reconciliation/{emailAddress}",
	security: bearerSecurity,
	request: {
		params: emailAddressParamSchema,
		query: reconciliationQuerySchema,
	},
	responses: {
		200: {
			content: { "application/json": { schema: reconciliationSuccessResponseSchema } },
			description: "Full stored emails with navigable pagination links",
		},
		400: { content: errorJson, description: "Invalid reconciliation query" },
		401: unauthorizedResponse,
		403: forbiddenResponse,
		404: { content: errorJson, description: "Unsupported domain or address not claimed" },
		500: { content: errorJson, description: "Database reconciliation failure" },
	},
	tags: ["Reconciliation"],
	summary: "Reconcile missed inbound emails",
	description:
		"Retrieve stored full messages for one claimed mailbox. Follow links.next while hasNext; repeat with an overlapping since window and deduplicate by message ID.",
});

// Get domains route
export const getDomainsRoute = createRoute({
	method: "get",
	path: "/domains",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: domainsSuccessResponseSchema,
				},
			},
			description: "List of all supported email domains",
		},
	},
	tags: ["Domains"],
	summary: "Get supported domains",
	description: "Retrieve a list of all supported email domains",
});
