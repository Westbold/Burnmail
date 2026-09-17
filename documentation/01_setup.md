# Setup

Passworthy uses Bun, a Cloudflare Worker, Email Routing, and D1. There is no R2 attachment
store or outbound SMTP account. Do not add deployment domains or API hostnames to Git.

## Install and check

```bash
bun install --frozen-lockfile
bun test
bun run tsc
bun run check
bun run deploy --dry-run --outdir dist
```

## Database

For an existing deployment, keep the configured D1 binding and database. Do not run
`db:create` again. For a genuinely new installation, log in with `bunx wrangler login`, run
`bun run db:create`, and update the D1 account/database identifiers in `wrangler.jsonc`.
Then apply `bun run db:tables` and `bun run db:indexes`. Both scripts target remote D1.
The schema contains `emails` and `claims`; attachments are not stored.

## Runtime configuration

Create the Worker secret `EMAIL_DOMAINS` with a comma-separated list of the receiving domains.
Use the Cloudflare dashboard or `bunx wrangler secret put EMAIL_DOMAINS`. Never place the
real value in a command committed to this repository. A missing value supports no recipients;
malformed hostnames are rejected rather than silently allowing arbitrary domains.

Copy `.dev.vars.example` to the ignored `.dev.vars` for local development. Its reserved
fixture value is not a production receiving domain. The generated platform types are in
`worker-configuration.d.ts`; project-specific runtime secrets are declared in `src/env.d.ts`.

## Email Routing

Configure each receiving domain in Cloudflare DNS. Enable Email Routing, review its MX/SPF
and DKIM records, and configure a catch-all action that sends to the existing Worker.
Preserve unrelated mail-provider records and routing rules. Hostnames belong in Cloudflare's
configuration, not in tracked examples, source constants, or deployment notes.

The recipient must have a claim before incoming mail is processed. Both the claim API and
incoming-email handler use the runtime allowlist.

## Optional services

Webhook forwarding requires Worker secrets `WEBHOOK_URL` and `WEBHOOK_SECRET`. Telegram
logging requires `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_LOG_ENABLE=true`.
Neither is required for basic inbox operation. Keep all values in Cloudflare secrets or
ignored local configuration.

`bun run cf-info` inspects account resources using privately supplied credentials. Its output
can contain deployment details; do not paste that output into the repository or public logs.

## Development mode

`bun run dev` runs `wrangler dev --remote`. It uses remote resources, so it can affect live
data. Unit tests are the safer default for isolated development. Use a separately configured
Worker/database for integration development.

See [deployment](04_cloudflare_deployment.md) for private build configuration and
[testing](02_testing.md) for validation commands.
