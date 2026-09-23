# Burnmail deployment runbook

Keep real receiving domains, app/API hostnames, mailbox addresses, and credentials out of Git.
The existing Worker and D1 identifiers remain unchanged so the rebrand does not recreate resources.

## Private configuration

| Scope | Name | Value supplied privately |
| --- | --- | --- |
| Worker secret | `EMAIL_DOMAINS` | Comma-separated receiving-domain allowlist |
| Worker and Builds secrets | `API_HOSTNAME` | API hostname; `api.` under the root zone |
| Worker and Builds secrets | `APP_HOSTNAME` | Webmail hostname; `app.` under the root zone |
| Worker and Builds secrets | `ROOT_HOSTNAME` | Receiving zone apex used for web redirects |
| Builds secret | `EMAIL_DOMAINS` | Expected runtime allowlist for source audit and smoke tests |

Build secrets are not automatically runtime bindings. Set the Worker copies separately.
Wrangler preserves existing secrets on deployment. Never place their values in Wrangler source.

The app root serves Burnmail. The API root still serves API documentation. The zone apex and
other subdomains redirect to the app root. Provision a proxied wildcard DNS record for the
redirect hostnames; preserve existing specific DNS records. The deployment wrapper maintains
app/API/apex custom domains and the wildcard Worker route. No additional mail route is needed.
Standard zone TLS covers the apex and first-level subdomains, not arbitrary nested hostnames.

## Automatic deployment

Keep the existing GitHub repository connection. Production branch is `main`, root is `/`,
build command is `bun install --frozen-lockfile && bun test && bun run tsc`, and deploy command
is `bun run deploy`. Cloudflare's managed build token supplies deployment credentials.

The wrapper audits tracked files for private configuration, generates an ignored temporary
Wrangler configuration containing the private routes, deploys the application and static
assets, and removes that file. It enforces Worker query-string log redaction with a partial
Worker update, then checks API/DNS, webmail assets, API docs links, redirects, and URL cleanup.
The existing database binding, retention settings, cleanup schedule, and mail rules are kept.

A dry run needs no private configuration or credentials and does not mutate Cloudflare.
A build/test failure stops deployment. A failed post-deployment check reports failure but
does not automatically roll back an already deployed version. Inspect the active version.

## Manual deployment

Supply `API_HOSTNAME`, `APP_HOSTNAME`, `ROOT_HOSTNAME`, and the expected `EMAIL_DOMAINS` through
ignored environment configuration. Supply a scoped `CLOUDFLARE_API_TOKEN` with Worker write,
D1 read, zone read, and Worker route edit permissions for the target resources. The token is
also used to preserve query-log redaction after upload. Run `bun run deploy`; do not commit
or paste tokens into commands stored in this repository.

For a fresh installation, follow [setup](01_setup.md). Do not recreate an existing database.
Worker secrets can create versions; never promote unrelated preview code just to edit a secret.

## Verification and privacy

URL login uses `email` and `key`, opens existing claims only, and never auto-claims. Query
credentials are converted to a fragment and cleared from the browser's current URL. The
initial query still reaches the server, so prefer fragment access links and keep both forms
private. Worker query-log redaction does not control every upstream or external log/history.

Use [webmail](06_frontend.md) for behavior and [verification](05_pending_verification.md) for
external-email testing. DNS/API success alone is not an external SMTP delivery test.
Public DNS and `/domains` are public; private configuration is not endpoint concealment.
Existing Git history and old build artifacts are separate from the current tracked files.
