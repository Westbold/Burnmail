# Passworthy Cloudflare deployment

## Provisioning snapshot: 2026-09-17

Infrastructure has been provisioned, but this snapshot is **not a completed deployment**.
At the last Cloudflare check, the Worker had `deployed_on: null`, no code version was live,
and the connected account returned no DNS zones. Update this snapshot after deployment.

| Resource | Value |
| --- | --- |
| Cloudflare account | Leon@westbold.com's Account |
| Account ID | `71f5759e26857110109f0877de8ab0ad` |
| Worker name | `temp-mail` |
| Worker ID | `244965baf92949609738f10b0251d521` |
| Reserved API URL; not yet live at this snapshot | `https://temp-mail.westbold-passworthy.workers.dev` |
| D1 database | `temp-mail-d1` |
| D1 database ID | `ba7290ed-c10d-4548-940a-566d279d6859` |
| D1 binding | `D1` |

The D1 `emails` and `claims` tables and all four indexes from `sql/indexes.sql` already exist.
**Do not run `db:create` again.** `wrangler.jsonc` already points at this account and database.

The repository has a credential-free `Worker Build` workflow that runs tests, checks
TypeScript, bundles the Worker, and uploads the bundle as a GitHub Actions artifact.
The separate existing CI workflow checks formatting and lint. A green build is not a deployment.

Telegram logging is disabled because no Telegram secrets were supplied. Webhook forwarding
remains disabled unless both webhook secrets are supplied. No credentials are stored in this file.
The configured cleanup schedule is every two hours and removes messages older than three hours;
this schedule becomes live only after a successful deployment. Claims do not expire.

## 1. Authorize Cloudflare's Git integration and deploy

The Cloudflare MCP connection could not connect this GitHub repository: the API returned
error `8000008`, saying the project is disconnected from the Git account. The ChatGPT GitHub
connection and Cloudflare's own GitHub integration are separate authorizations.
Token administration also returned `9109 Unauthorized`; no API token was created.

1. Open [Workers & Pages for this account](https://dash.cloudflare.com/71f5759e26857110109f0877de8ab0ad/workers-and-pages).
2. Open the existing **temp-mail** Worker. Do not create a second Worker.
3. Select **Settings > Builds > Connect**.
4. Connect GitHub. In GitHub's authorization/install screen, choose **Westbold** and grant
   access only to **Passworthy-Temp-Email**. Approve the installation or organization request
   as required by your GitHub account.
5. Select **Westbold/Passworthy-Temp-Email** and use these settings:

   | Setting | Value |
   | --- | --- |
   | Production branch | `main` |
   | Root directory | `/` |
   | Worker name | `temp-mail` |
   | Build command | `bun install --frozen-lockfile && bun test && bun run tsc` |
   | Deploy command | `bun run deploy` |
   | Deploy authentication | Cloudflare's default automatically generated build token |

6. Save the connection. If the wizard offers **Save and Deploy**, use it. Otherwise a new
   commit on `main` triggers the first build; the domain-configuration commit in the next
   section can be that commit. An authorized MCP session can also start the configured build.
7. Inspect the Cloudflare build logs. A completed deploy should produce an active version
   and `GET /health` should return HTTP 200. The GitHub workflow only validates the code;
   Cloudflare Builds performs production deployments once this connection is configured.

Do not paste Cloudflare tokens into GitHub source files, build commands, issue comments, or chat.

Official references: [connect an existing Worker](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-an-existing-worker),
[build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## 2. Select an owned receiving domain

No receiving domain was provided, and the connected Cloudflare account returned no zones.
The domains currently listed in `src/config/domains.ts` belong to the upstream project;
listing them in this fork does not provide ownership or route their mail here.

Choose the exact domain or subdomain to receive mail on, for example `inbox.example.com`.
That example is a placeholder, not a working address. A `workers.dev` URL is the HTTP API
address, not an automatically provisioned receiving email domain.

- If the parent domain already uses Cloudflare in another account, authorize that account
  and deliberately decide where the Worker and database belong before changing account IDs.
  Do not transfer a production zone just to match this snapshot.
- If the domain needs onboarding to this account, add it to Cloudflare, preserve its existing
  DNS records, and set the exact Cloudflare-assigned nameservers at the domain registrar.
  Registrar login/consent is a separate step that these connectors cannot perform.
- Do not replace existing business-mail MX records. Prefer a dedicated domain or an unused
  mail subdomain when the parent domain already receives normal business mail.

Once the domain is chosen and visible to the authorized Cloudflare MCP connection, the
remaining allowlist and routing operations can be performed through GitHub and Cloudflare MCP.
The operator need not manually duplicate those operations. For manual completion, follow below.

## 3. Configure the allowlist and inbound routing

Replace `src/config/domains.ts` with only the domain(s) you own and will route to this Worker.
For one domain, use this shape and replace the placeholder before committing:

```ts
export const DOMAINS: { owner: string; domain: string }[] = [
	{ owner: "Westbold", domain: "inbox.example.com" },
];

export const DOMAINS_SET = new Set(DOMAINS.map((entry) => entry.domain));
```

Commit to `main`. Confirm both GitHub workflows and the Cloudflare production build succeed.
The route tests use their own reserved fixture domain, so they do not require upstream domains
in the production allowlist. The API explorer uses a relative server URL so authenticated
requests stay on this deployment rather than being sent to the upstream service.

In the Cloudflare dashboard:

1. Open **Compute > Email Service > Email Routing** and select/onboard the relevant domain.
   The domain's **Email > Email Routing** entry may also lead to this screen.
2. Enable Email Routing and review the proposed MX, SPF, and other required DNS records.
   Do not approve removal/replacement of another mail provider's records on a hostname that
   must keep receiving mail through that provider.
3. For a receiving subdomain, add it under Email Routing **Settings > Subdomains** and use
   the exact matching subdomain in the allowlist.
4. Under **Routing Rules**, enable the **Catch-all** rule for the intended receiving scope.
5. Set action to **Send to Worker**, choose **temp-mail**, and save. Preserve unrelated
   address-specific rules and verify their precedence rather than deleting them.

References: [route emails](https://developers.cloudflare.com/email-service/get-started/route-emails/),
[subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/),
[routing rules](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/).

## 4. Verify end to end

Deployment is complete only after these checks pass:

1. `GET https://temp-mail.westbold-passworthy.workers.dev/health` returns 200.
2. `GET /domains` lists the exact owned receiving domain, not upstream domains.
3. `PUT /claims/<your-test-address>` with a fresh, strong `Authorization: Bearer <key>`
   successfully claims a test address. Save the key privately; it is required for that inbox.
4. Reading that inbox with no key or the wrong key is denied, while the correct key succeeds.
5. Send an ordinary test email from a separate mailbox to the claimed address. Verify it appears
   through `GET /emails/<your-test-address>` and that its content is retrievable from `/inbox/<id>`.
6. Verify the Worker has the `D1` binding, runtime variables, and `0 */2 * * *` cleanup trigger.
7. Release the temporary test claim with `DELETE /claims/<your-test-address>` using the same
   key after testing; this also deletes that address's stored email.

Claim before sending: email sent to an unclaimed address is deliberately discarded. Attachments
are not stored. The public health endpoint alone does not prove DNS or email delivery works.

Optional Telegram/webhook secrets can be added after the base service is working. They are not
required for the initial deployment.
