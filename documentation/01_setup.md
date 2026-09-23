# Setup

Burnmail uses Bun, a Cloudflare Worker, Email Routing, and D1. There is no R2 attachment
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

Create the Worker secret `EMAIL_DOMAINS` with a comma-separated list of receiving domains.
Use the Cloudflare dashboard or `bunx wrangler secret put EMAIL_DOMAINS`. Never put its real
value in a command committed to this repository. Missing configuration supports no recipients.

Set `API_HOSTNAME`, `APP_HOSTNAME`, and `ROOT_HOSTNAME` as Worker secrets for production host
routing. Set the same hostnames as private Cloudflare Builds secrets for deployment routes.
The app/API hostnames must be the corresponding `app.` and `api.` names under the root zone.
See the deployment runbook for DNS and authentication requirements.

Copy `.dev.vars.example` to the ignored `.dev.vars` for development. Its reserved fixture is
not a production receiving domain. With no app hostname configured, local webmail is at
`/app/` and API docs remain at `/`. Platform types are in `worker-configuration.d.ts`;
project-specific runtime bindings are declared in `src/env.d.ts`.

## Email Routing

Configure receiving domains in Cloudflare DNS. Enable Email Routing, review MX/SPF and DKIM,
and configure the catch-all to send to the existing Worker. Preserve unrelated mail-provider
records and routing rules. Web redirects do not change which email domains can receive mail.
Claim an address before sending mail to it; unclaimed recipients are discarded.

## Optional services

Webhook forwarding requires `WEBHOOK_URL` and `WEBHOOK_SECRET`. Telegram logging requires
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_LOG_ENABLE=true`. Neither is required.
Keep values in Cloudflare secrets or ignored local files. `bun run cf-info` can expose
infrastructure details in its output; do not publish that output.

## Development mode

`bun run dev` uses `wrangler dev --remote` and can affect live data. Use local Wrangler mode
with a local D1 database or a separate development Worker for isolated integration testing.

See [deployment](04_cloudflare_deployment.md), [testing](02_testing.md), and
[webmail](06_frontend.md) for deployment, URL login, and verification details.
