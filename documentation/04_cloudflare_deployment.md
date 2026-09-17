# Passworthy Cloudflare deployment

## Deployment snapshot: September 17, 2026

The application is **deployed**, not merely provisioned. Its `workers.dev` endpoint passed
live HTTPS and D1 authorization tests. The receiving domain is configured, but public DNS
and an actual incoming email are not yet verified as working.

| Resource | Value |
| --- | --- |
| Company receiving domain | `0357000.xyz` |
| Working API and interactive documentation | `https://temp-mail.westbold-passworthy.workers.dev` |
| Configured custom API hostname, pending public DNS | `https://api.0357000.xyz` |
| Cloudflare account | `Leon@westbold.com's Account` |
| Account ID | `71f5759e26857110109f0877de8ab0ad` |
| DNS zone ID | `689331e6733c6347f3aacae508f1c2ef` |
| Worker | `temp-mail` |
| Worker ID | `244965baf92949609738f10b0251d521` |
| Actual deployment time | `2026-09-17T19:54:17.208081Z` |
| Deployment ID returned by the upload API | `b1978925593e44d9bbb444b969f322c3` |
| D1 database | `temp-mail-d1` |
| D1 ID | `ba7290ed-c10d-4548-940a-566d279d6859` |
| D1 binding | `D1` |
| Application source commit | `a9d7572905daba930e11227a0d1b90ce559d47a6` |

Personal domains, including `leibmann.org`, are not involved in this deployment.

## What is configured

- Only `0357000.xyz` is allowed in `src/config/domains.ts`; upstream domains were removed.
- Email Routing is enabled, synced, and reports `ready`.
- The enabled catch-all rule sends mail to the `temp-mail` Worker.
- All three Cloudflare MX records, SPF, and the Cloudflare-provided DKIM record are installed.
- The Worker exports `fetch`, `email`, and `scheduled` handlers.
- The D1 `emails` and `claims` tables and four email indexes are present.
- The actual cleanup trigger is `0 */2 * * *`.
- Messages older than three hours are eligible for deletion on that two-hour schedule.
  This is not a promise to delete each message at exactly three hours old. Claims do not expire.
- Telegram logging is disabled. Webhook forwarding is disabled because its secrets are absent.
- Interactive API documentation uses this deployment, not the upstream API.
- `api.0357000.xyz` is attached as a Worker custom domain and recorded in `wrangler.jsonc`.

Do not create another Worker or run `db:create` again.

## Verified checks and remaining blocker

[Production smoke run](https://github.com/Westbold/Passworthy-Temp-Email/actions/runs/35267882267)

The `workers.dev` API job passed at `2026-09-17T19:57:06Z`:

- Valid HTTPS and HTTP 200 from `/health`.
- `/domains` returns only `0357000.xyz`.
- `/openapi.json` keeps requests on the same origin.
- Claim creation and same-key idempotency against the real D1 database.
- Conflicting claims return 409; missing keys return 401; wrong keys return 403.
- Authorized inbox listing and counts work.
- Wrong-key deletion and unsupported domains are denied.
- Test claims were released; released inbox access returns 404.

The DNS job at `2026-09-17T19:57:03Z` found:

| Query target | Observed result |
| --- | --- |
| `darwin.ns.cloudflare.com` | Correct authoritative NS records and all three MX records |
| `pola.ns.cloudflare.com` | Correct authoritative NS records and all three MX records |
| `1.1.1.1` | NXDOMAIN for the new domain |
| `8.8.8.8` | NXDOMAIN for the new domain |
| Google DNS over HTTPS | NXDOMAIN, with an `xyz.` SOA authority response |

Cloudflare Registrar reports the registration as active, created at
`2026-09-17T19:49:21Z`, with the expected Cloudflare nameservers. This is consistent with
new-registration DNS publication/propagation still being incomplete. The configured records
are correct at Cloudflare's authoritative servers; public DNS convergence has not been proven.
Do not replace or move the nameservers to try to fix this discrepancy.

A Cloudflare verification email was requested for a temporary claimed test address.
No message had reached D1 at `2026-09-17T19:59:55Z`. Therefore actual external email delivery
must not be described as tested successfully yet. The custom API hostname also failed its
public reachability test while the domain was unresolved.

The repeatable **Production Smoke Test** workflow is available under GitHub Actions.
Select **Run workflow**, branch `main`, to repeat both HTTPS/API jobs and the DNS check.
It uses no Cloudflare token, creates random temporary test claims, and cleans them up.
It does not run on a recurring schedule and does not test external SMTP delivery.

## Start using the working API

The application receives email; it does not provide an outbound SMTP account or a paid mailbox.
Each address must be claimed before mail is sent to it. Unclaimed mail is deliberately discarded.
The claim key is an application secret you generate, not a Cloudflare API token.

Example for Bash with OpenSSL and curl installed:

```bash
API='https://temp-mail.westbold-passworthy.workers.dev'
ADDRESS='test@0357000.xyz'
KEY="$(openssl rand -hex 32)"

curl --fail-with-body -X PUT "$API/claims/$ADDRESS" \
  -H "Authorization: Bearer $KEY"
```

Keep `KEY` private and save it in your own secret store. Reusing the address with a different
key returns 409. A new address is first-claim-wins; this prototype has no separate administrator
approval gate for claiming unused addresses.

After public MX resolution works, send an email from another mailbox to `test@0357000.xyz`,
then read it using the same terminal session/key:

```bash
curl --fail-with-body "$API/emails/$ADDRESS" \
  -H "Authorization: Bearer $KEY"

# Use an id from that list to retrieve the full message:
curl --fail-with-body "$API/inbox/EMAIL_ID" \
  -H "Authorization: Bearer $KEY"
```

Releasing an address also deletes its stored emails:

```bash
curl --fail-with-body -X DELETE "$API/claims/$ADDRESS" \
  -H "Authorization: Bearer $KEY"
```

Attachments are not stored. Once `api.0357000.xyz` resolves and passes HTTPS checks, it can
replace the longer API hostname without changing inbox keys or data.

## How this deployment was performed

Cloudflare's GitHub integration is still unapproved: the repository connection API returned
error `8000008`. This did **not** prevent the initial application deployment.

The tested GitHub Actions artifact was downloaded and verified. A short-lived, checksum-gated
Cloudflare staging Worker accepted only that exact public JavaScript artifact. It stored the
artifact temporarily in a dedicated staging table; Cloudflare MCP read it, verified its SHA-256
again, and uploaded the complete application using the Worker upload API with its D1 binding.

- Build run: `35267342928`
- Build artifact: `10517570343`
- Application bundle size: `581041` bytes
- Application bundle SHA-256: `48b70480ca86d001a77a7b84709f571dc0cfee9b77894a9daf6ad40b28bded2d`

The temporary staging Worker, its database table, and the one-time GitHub transfer workflow
were removed after deployment. No Cloudflare API credentials were written to GitHub.
Later commits add deployment configuration, tests, and this record; they do not change the
application bundle's source code.

## Future automatic deployment: optional separate authorization

The running service does not require this step, but pushes to `main` do not automatically
update production until Cloudflare's Git integration is connected or another deployment
mechanism is configured. The **Worker Build** workflow only tests and bundles code.

To enable Cloudflare Builds:

1. Open [Workers & Pages](https://dash.cloudflare.com/71f5759e26857110109f0877de8ab0ad/workers-and-pages).
2. Select **temp-mail > Settings > Builds > Connect**.
3. Authorize Cloudflare's GitHub integration for **Westbold/Passworthy-Temp-Email**.
4. Use branch `main`, root `/`, build command
   `bun install --frozen-lockfile && bun test && bun run tsc`, and deploy command `bun run deploy`.
5. Use Cloudflare's default generated build token and save the connection.

The existing `wrangler.jsonc` already identifies the account, database, cron, runtime variables,
and custom API hostname. Keep any future webhook or Telegram secrets in Cloudflare secrets,
not in repository files.
