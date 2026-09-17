# Deployment verification checklist

This runbook replaces the old domain-specific deployment snapshots. Consult the private
Cloudflare account for live hostnames, version IDs, routing records, and build logs.

## After a change

Confirm the intended `main` commit triggered Cloudflare Builds, the tests and TypeScript
check passed, and the new Worker version became active. Check that `EMAIL_DOMAINS` remains
a Worker secret, the D1 binding is preserved, and the configured cleanup schedule is active.

The deployment wrapper runs live smoke tests after uploading. Those tests verify public
mail DNS, HTTPS, health, the runtime allowlist, documentation origin, claims, and access
control. Temporary test claims are deleted. They do not prove external SMTP delivery.

## External mail test

Choose a fresh test address from private configuration and generate a strong random claim
key. Claim the address through the API before sending to it. Send a uniquely identifiable
message from a separate mailbox, then retrieve its summary and full body with the same key.
Finally release the claim, which deletes its stored messages.

Check unclaimed-address handling separately only with your own test mail. Incoming mail
for unclaimed or unsupported recipients must not be stored or forwarded to the webhook.
Do not commit recipient addresses, message bodies, or bearer keys as test evidence.

## Cleanup and troubleshooting

Do not recreate deleted verification destinations or old staging resources. The production
catch-all should target the Worker directly, not a temporary verification address.

For DNS problems, compare Cloudflare's authoritative records with a public recursive resolver.
For API failures, inspect the private build logs, runtime secret, D1 binding, and active
version. For incoming-mail problems, verify the address was claimed before sending and
inspect Email Routing delivery logs. Keep all hostname-specific diagnostics outside Git.

The optional on-demand GitHub smoke workflow requires the private `SMOKE_BASE_URL` Actions
secret. Automatic deployment already runs the equivalent test inside Cloudflare Builds.
