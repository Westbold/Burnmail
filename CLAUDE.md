# Passworthy contributor instructions

This repository implements claim-based temporary inboxes for Passworthy using Bun,
TypeScript, Hono, Cloudflare Email Routing, and D1. Read README.md and documentation/03_apispec.md
for behavior; do not copy upstream hosted-service assumptions into project documentation.

## Configuration boundary

Never commit a live receiving domain, API hostname, actual test mailbox address, or secret.
Do not hide such values in encoded strings. EMAIL_DOMAINS is a Worker secret read at runtime;
API_HOSTNAME is private build configuration. All tests and examples use reserved test domains.
Keep .env, .dev.vars, generated deployment configs, and hostname-specific diagnostics ignored.
Preserve the original copyright notice in LICENSE.

## Invariants

- Claims are required before receipt and are protected by hashed bearer keys.
- The domain allowlist is request/environment-specific, with no production fallback.
- Unsupported and unclaimed mail is discarded before parsing, storing, or forwarding.
- Releasing a claim deletes the recipient's stored mail. Claims otherwise do not expire.
- Attachments are not stored. Webhooks are centralized and signed separately from claim keys.
- The API explorer stays on the current origin; its examples must not embed runtime domains.

## Workflow

Run bun test, bun run tsc, bun run check, and bun run deploy --dry-run --outdir dist before
shipping. Unit tests use in-memory doubles and reserved domains. bun run dev uses remote
Cloudflare resources, so do not treat it as an isolated database.

Production main pushes deploy through Cloudflare Builds. Use bun run deploy, which injects
the private custom route, cleans up its generated config, and runs production smoke tests.
Do not bypass it with a plain Wrangler deployment or recreate existing D1 resources.

Keep code straightforward, typed, and small. Follow the repository's Biome formatting.
Add regression tests for auth, runtime configuration, and message handling when changing them.
