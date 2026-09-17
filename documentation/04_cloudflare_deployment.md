# Cloudflare deployment runbook

Production configuration is stored in Cloudflare. Do not publish receiving domains, API
hostnames, actual mailbox addresses, or credential values in this repository.

## Existing deployment

Reuse the existing `temp-mail` Worker and its D1 binding. The repository's Wrangler config
contains the account/database identifiers, retention settings, and cleanup schedule, but
no domain routes. Email Routing's catch-all is managed in Cloudflare and sends to the Worker.

Before a real deployment, configure:

| Scope | Name | Value supplied privately |
| --- | --- | --- |
| Worker secret | `EMAIL_DOMAINS` | Comma-separated receiving-domain allowlist |
| Cloudflare Builds secret | `API_HOSTNAME` | Custom API hostname |
| Cloudflare Builds secret | `EMAIL_DOMAINS` | Expected runtime allowlist, used only for auditing and verification |

The runtime and build copies of `EMAIL_DOMAINS` should agree. Build variables are not Worker
runtime bindings. Set the Worker secret separately. Wrangler preserves existing secrets
when deploying code; never put their values in `wrangler.jsonc`.

## Automatic deployments

Connect the existing Worker to `Westbold/Passworthy-Temp-Email` in Cloudflare's Git integration.
Use production branch `main`, root `/`, build command
`bun install --frozen-lockfile && bun test && bun run tsc`, and deploy command `bun run deploy`.
Use Cloudflare's managed build token rather than committing a token or putting it into chat.

`bun run deploy` does the following:

1. Requires the private custom hostname and checks tracked files for private configured values.
2. Writes an ignored, owner-readable temporary Wrangler config containing the custom route.
3. Deploys the Worker with the checked-in D1 binding, variables, and schedule.
4. Removes the temporary config, including after a failed Wrangler command.
5. Runs live DNS, HTTPS, and claim-authorization checks without logging recipient addresses.

Do not bypass this wrapper with a plain Wrangler deploy: the wrapper supplies the private
custom-domain route. A dry run skips the private route and live checks and can run in public
CI without secrets. Non-production version uploads do not promote a production deployment.

A build/test failure prevents the deploy command. A post-deploy smoke-test failure is reported
but does not automatically roll back code that has already deployed. Consult the private
Cloudflare build/deployment logs and compare the active version with the intended commit.

## Fresh installations

Follow [setup](01_setup.md). Create a new database only for a new installation; apply the
schema and indexes, set the Worker secret, attach the custom API hostname, and configure
Email Routing for the intended receiving domain. Claim a test address before sending mail.
Keep the actual infrastructure values in Cloudflare or ignored local files.

## Manual deployment and secret maintenance

Supply `API_HOSTNAME` through an ignored `.env` or the shell, authenticate Wrangler, and run
`bun run deploy`. `.env.example` shows only a reserved placeholder. For production, also
supply the expected `EMAIL_DOMAINS` build value to enable the exact source/allowlist audit.

Use Worker secrets for optional webhook and Telegram credentials. Updating a secret can
create or deploy a Worker version; inspect the currently deployed version when undeployed
preview versions exist rather than accidentally promoting a preview.

Public DNS and the public `/domains` endpoint can still reveal a running service's receiving
domains. This separation prevents committing deployment values; it does not hide the public
service. Existing Git history and previously published build artifacts are separate records.
