# Burnmail

Claim-based temporary inboxes for Burnmail. A Cloudflare Worker receives inbound mail,
stores messages in D1, and exposes an authenticated HTTP API for reading and deleting them.

**Claim first, receive second.** Mail for an unclaimed or unsupported address is discarded
before parsing, storage, or webhook delivery. Claims persist until explicitly released;
messages are temporary. This is an inbound-email service, not an SMTP sending account.

## How it works

1. Choose an address on a configured receiving domain and claim it with a strong bearer key.
2. Cloudflare Email Routing sends incoming messages to the Worker. Claimed recipients are
   stored in D1; optional webhook forwarding happens after storage.
3. Read, count, or delete messages using the same key. Release the claim to delete its mail
   and make the address available again.

The key is hashed before storage. Repeating a claim with the same key is idempotent; a
competing key receives `409 Conflict`. Claims are first-come, first-served: the prototype
does not have a separate administrator approval gate. Keep claim keys in your secret store.

## Webmail

Burnmail lives at the root of the privately configured app hostname. The API hostname's
root remains the API documentation. The receiving zone's apex and unconfigured subdomains
redirect to the app. Old `/app/` webmail links redirect to its new root.

The app header links to `/api-docs`, which redirects to the configured API documentation.
An existing mailbox can be opened with `/?email=<URL-encoded-address>&key=<URL-encoded-key>`.
Use `URLSearchParams` to encode both values, especially `+`, `&`, `#`, and `=`. Opening a
link never claims a new address. Missing, invalid, or wrong credentials do not bypass auth.

The Worker converts login query parameters to a fragment; the browser consumes the
credentials, clears them from its current history entry, and opens the inbox with its
bearer header. Copied access links still use `#email=...&key=...` by default. Both forms
are full-access credentials, not read-only links. Query links reach the server on their
first request and can be retained outside this application; prefer fragments when possible.
The deployment enables Worker query-string log redaction. Do not share real links publicly.

## API quick start

Set `API_BASE_URL` and `EMAIL_ADDRESS` privately in your shell or secret manager. This
repository intentionally does not contain live receiving domains or deployment hostnames.
Examples in the detailed docs use reserved test addresses, not working inboxes.

```bash
: "${API_BASE_URL:?Set the deployment URL privately}"
: "${EMAIL_ADDRESS:?Set the recipient address privately}"
CLAIM_KEY="$(openssl rand -hex 32)"

# Claim before sending any email to this address.
curl --fail-with-body -X PUT "$API_BASE_URL/claims/$EMAIL_ADDRESS" \
  -H "Authorization: Bearer $CLAIM_KEY"

# After sending a message from another mailbox, list its summary.
curl --fail-with-body "$API_BASE_URL/emails/$EMAIL_ADDRESS" \
  -H "Authorization: Bearer $CLAIM_KEY"

# Retrieve the body using an id returned by the list endpoint.
curl --fail-with-body "$API_BASE_URL/inbox/EMAIL_ID" \
  -H "Authorization: Bearer $CLAIM_KEY"
```

Save `CLAIM_KEY` before closing the shell. There is no key-recovery API. Use the same key to
release an address and delete all of its stored messages:

```bash
curl --fail-with-body -X DELETE "$API_BASE_URL/claims/$EMAIL_ADDRESS" \
  -H "Authorization: Bearer $CLAIM_KEY"
```

The API hostname serves interactive documentation at `/`, Swagger UI at `/swagger`, and its
OpenAPI document at `/openapi.json`. The API explorer uses the current origin.

| Method | Path | Purpose |
| --- | --- | --- |
| `PUT` | `/claims/{emailAddress}` | Claim an address; requires a bearer key |
| `DELETE` | `/claims/{emailAddress}` | Release the claim and delete its messages |
| `GET` | `/emails/{emailAddress}` | List summaries, newest first; `limit` and `offset` supported |
| `GET` | `/emails/count/{emailAddress}` | Count messages |
| `DELETE` | `/emails/{emailAddress}` | Delete messages without releasing the claim |
| `GET` | `/inbox/{emailId}` | Retrieve a complete stored message |
| `DELETE` | `/inbox/{emailId}` | Delete one message |
| `GET` | `/domains` | Read the runtime receiving-domain allowlist; public |
| `GET` | `/health` | Check Worker and database health; public |

Except for the two public endpoints and documentation, requests require
`Authorization: Bearer <claim-key>`. See [the API specification](documentation/03_apispec.md)
for response shapes and error behavior.

## Configuration stays outside Git

| Setting | Location | Purpose |
| --- | --- | --- |
| `EMAIL_DOMAINS` | Cloudflare Worker secret | Comma-separated receiving domains; no hard-coded fallback |
| `API_HOSTNAME`, `APP_HOSTNAME`, `ROOT_HOSTNAME` | Worker and Cloudflare Builds secrets | Host routing and temporary deployment routes; no hostname literals in Git |
| `EMAIL_DOMAINS` | Cloudflare Builds secret | Matches the runtime allowlist for source audits and post-deploy verification |
| `D1` | Wrangler binding | Message and claim database |
| `HOURS_TO_DELETE_D1` | Wrangler variable | Message retention threshold; currently `3` |
| `TELEGRAM_LOG_ENABLE` | Wrangler variable | Optional operational logging; disabled by default |
| `WEBHOOK_URL`, `WEBHOOK_SECRET` | Worker secrets | Optional centralized webhook destination and signing key |

Live domains and API hostnames must not be committed in code, tests, workflows, documentation,
or examples. Do not encode them into source as a workaround. Local `.env` and `.dev.vars`
files and generated deployment configs are ignored. Public DNS and `/domains` remain public;
keeping values out of Git is not a claim that the running service conceals them.

## Development and deployment

Requires Bun. Install the locked dependencies, then run checks without Cloudflare credentials:

```bash
bun install --frozen-lockfile
bun test
bun run tsc
bun run check
bun run deploy --dry-run --outdir dist
```

Tests use reserved fixture domains and do not depend on production configuration. For local
Worker development, copy `.dev.vars.example` to `.dev.vars` and set the desired test allowlist.
`bun run dev` uses Wrangler's **remote** development mode; it is not an isolated local database.
See [setup](documentation/01_setup.md) before using live resources.

Production pushes to `main` are deployed by Cloudflare Builds. The build command runs locked
installation, tests, and TypeScript checks. `bun run deploy` then audits tracked files for
private configuration, injects the private hostnames into an ignored temporary config, deploys,
deletes that config, and runs live API/DNS/webmail smoke tests. The existing D1 binding and mail
routing are retained. A post-deploy smoke-test failure reports a failed build but does not
automatically roll back the deployed version.

For a fresh installation, follow [the deployment runbook](documentation/04_cloudflare_deployment.md).
Do not recreate an existing database. Production secrets are managed in Cloudflare, not in
the repository. The separate GitHub **Worker Build** workflow tests and bundles code; it is
not the production deployment mechanism.

## Retention and delivery behavior

Cleanup runs every two hours and deletes messages older than the configured retention
threshold. With the current three-hour threshold, deletion happens on a later cleanup run,
not at the exact three-hour mark. Claims do not expire. Attachments are not stored.

Webhook forwarding is enabled only when both webhook secrets are set. Each stored message
is sent as JSON with `X-Webhook-Signature: HMAC-SHA512=<base64 signature>`, computed over the
exact UTF-8 request body. Delivery failures are logged without deleting the stored message;
there is no durable webhook retry queue. See [webhook details](documentation/03_apispec.md#webhook-delivery).

The webmail renders sanitized HTML in an isolated, scriptless frame, with a Text alternative
and per-message opt-in for remote images. The server's basic cleanup is not a substitute
for client-side isolation. Delete mailbox requires typing the address, permanently removes
its stored messages, and releases the claim; the address may subsequently be claimed again. A successful health check does not prove that a real
external email has traversed DNS, routing, and storage.

## Project layout

```text
src/config/       Runtime configuration and constants
src/database/     D1 queries and service layer
src/handlers/     Incoming email and scheduled cleanup
src/routes/       HTTP endpoints and claim authorization
src/schemas/      Validation and OpenAPI schemas
src/utils/        Authentication, content processing, logging, webhooks
scripts/          Private-config deployment and live smoke tests
sql/              Database schema and indexes
documentation/    Setup, API reference, deployment, and verification
```

See [testing](documentation/02_testing.md) and [verification](documentation/05_pending_verification.md)
for repeatable checks and the external email-delivery test.

## License and attribution

MIT; see [LICENSE](LICENSE). This project is derived from `vwh/temp-mail`. The original
copyright notice is preserved. Upstream hosted services, donated domains, and third-party
clients are not part of this deployment.

The Cloudflare Worker and D1 identifiers retain their existing deployment names to avoid
recreating resources or disrupting inboxes. Product UI and API titles use Burnmail.
