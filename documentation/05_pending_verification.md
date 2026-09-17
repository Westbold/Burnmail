# Remaining verification and cleanup

Snapshot: September 17, 2026. See `04_cloudflare_deployment.md` for the deployed resources
and the working `workers.dev` API. Do not recreate the Worker or D1 database.

## Public DNS and external delivery

Cloudflare's authoritative servers answer correctly, but the first external checks found
NXDOMAIN at public resolvers. Registration is active with the expected nameservers.
The live API passed HTTPS and D1 access-control tests; external SMTP receipt is not yet proven.

Run **Actions > Production Smoke Test > Run workflow > main** to repeat DNS and API checks.
The workflow checks both API hostnames independently. After public MX records resolve, use
the claim/send/read sequence in the deployment guide for a real external email test.
A green Worker Build is not a mail-delivery test.

## Unverified test destination: deletion temporarily blocked

An automatically generated Cloudflare verification email was requested for:

`cfcheck-df05426fb4e243ea@0357000.xyz`

Destination ID: `e14f3218613f4f10ab6032d3e39f4ff8`.

No email was observed in D1 before the test was ended. The test claim and any test messages
were removed. The destination-address entry itself is still unverified: Cloudflare rejected
deletion with error `2032`, `Destination address has been created too recently`.

No routing rule forwards to this address. The production catch-all sends directly to the
`temp-mail` Worker, so the unverified entry is not a production dependency. Do not verify it.

Once Cloudflare permits deletion, open **Compute > Email Service > Email Routing >
Destination Addresses**, find the exact address above, and delete it. Alternatively delete
that exact destination ID through Cloudflare MCP. Do not delete the catch-all routing rule.

The staging Worker, staging database table, and one-time GitHub staging workflow used for the
initial code upload have already been removed. No Cloudflare API token was stored in GitHub.
