# Remaining verification and completed cleanup

Snapshot: September 17, 2026. See `04_cloudflare_deployment.md` for the deployed resources
and the working `workers.dev` API. Do not recreate the Worker or D1 database.

## Public DNS and external delivery

Cloudflare's authoritative servers answered correctly, but the initial external checks found
NXDOMAIN at public resolvers. Registration was active with the expected nameservers.
The live API passed HTTPS and D1 access-control tests; external SMTP receipt was not proven
in those checks. DNS and mail delivery were not retested during the cleanup below.

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

## Automatic deployment: authorization still required

A fresh attempt to connect `Westbold/Passworthy-Temp-Email` to Cloudflare Builds returned
error `8000008`: the repository is disconnected from the Git account. The Worker has no
build triggers, and the build-token list is empty. Account-token permission discovery also
returned `9109 Unauthorized`, so this MCP connection cannot provision a build token.

No automatic-deployment trigger was created, and no automated deployment was claimed as
successful. The existing running Worker and its routing were left intact.

Complete the one-time Cloudflare GitHub authorization under **Workers & Pages > temp-mail >
Settings > Builds > Connect**, select `Westbold/Passworthy-Temp-Email`, and use the build
settings already recorded in `04_cloudflare_deployment.md`. Cloudflare's default generated
build token avoids placing a Cloudflare API token in GitHub source or chat.
