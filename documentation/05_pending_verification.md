# Deployment verification and completed cleanup

Snapshot: September 17, 2026. See `04_cloudflare_deployment.md` for the deployed resources
and the working `workers.dev` API. Do not recreate the Worker or D1 database.
This file supersedes the earlier guide's statement that GitHub authorization is still missing.

## Public DNS and external delivery

Cloudflare's authoritative servers answered correctly, but the initial external checks found
NXDOMAIN at public resolvers. Registration was active with the expected nameservers.
The live API passed HTTPS and D1 access-control tests; external SMTP receipt was not proven
in those checks. Those historical results do not establish the current DNS status.

Run **Actions > Production Smoke Test > Run workflow > main** to repeat DNS and API checks.
The workflow checks both API hostnames independently. After public MX records resolve, use
the claim/send/read sequence in the deployment guide for a real external email test.
A green Worker Build is not a mail-delivery test.

## Test destination cleanup: completed

The unused verification destination was deleted through Cloudflare MCP at the user's request:

`cfcheck-df05426fb4e243ea@0357000.xyz`

Deleted destination ID: `e14f3218613f4f10ab6032d3e39f4ff8`.

Cloudflare returned success with HTTP 200 for the deletion. A subsequent GET for that exact
ID returned error `2015`, `Address not found`, confirming removal. The earlier temporary
restriction (`2032`, address created too recently) no longer blocked deletion.

The test claim and test messages had already been removed. The production catch-all was
read back after deletion and remains enabled with action `worker` and value `temp-mail`.
No production mail-routing rule was deleted or changed. No destination cleanup remains.

The staging Worker, staging database table, and one-time GitHub staging workflow used for the
initial code upload were already removed. No Cloudflare API token was stored in GitHub.

## Automatic deployment: connected

After the account owner completed Cloudflare's GitHub authorization, the Cloudflare API
confirmed the repository connection and production trigger at `2026-09-17T20:29:18Z`.
The previous missing-authorization blocker is resolved.

| Setting | Verified value |
| --- | --- |
| Repository | `Westbold/Passworthy-Temp-Email` |
| Production branch | `main` |
| Worker | `temp-mail` |
| Root directory | `/` |
| Build command | `bun install --frozen-lockfile && bun test && bun run tsc` |
| Deploy command | `bun run deploy` |
| Production trigger ID | `d6a58a39-647d-43de-8bbd-169407abd6ab` |
| Credential | Cloudflare-managed Workers Builds token |
| Included paths | `*` |
| Excluded paths | None |

A push to `main` now triggers Cloudflare to install locked dependencies, run the tests and
TypeScript check, then deploy. A failed build must be investigated in Cloudflare's build
logs; GitHub's separate Worker Build workflow alone does not confirm a production deployment.
No Cloudflare deployment credential is needed in GitHub source or chat.

This documentation-only commit is the first push-based deployment test after connecting.
It changes no application behavior. At connection verification, no Cloudflare build had yet
run; check the resulting Cloudflare build and active deployment before declaring the test
successful. In the Cloudflare dashboard, open **Workers & Pages > temp-mail > Deployments**
and inspect the build for this commit.

Official documentation: https://developers.cloudflare.com/workers/ci-cd/builds/
