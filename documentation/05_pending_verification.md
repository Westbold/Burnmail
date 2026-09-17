# Deployment verification and completed cleanup

Snapshot: September 17, 2026. This file supersedes the earlier status in
`04_cloudflare_deployment.md`: GitHub authorization, automatic deployment, public DNS,
and the custom HTTPS API are now verified. Actual external SMTP delivery is still untested.
Do not recreate the Worker or D1 database.

## Automatic deployment: verified successful

The account owner completed Cloudflare's GitHub authorization. Cloudflare MCP verified
the repository connection and production trigger at `2026-09-17T20:29:18Z`.
A documentation-only commit was then pushed to `main` through the GitHub connector.
Cloudflare recorded its trigger source as `push_event` and successfully deployed it.
This was not a manually started build or a direct MCP code upload.

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

### First successful push-based deployment

| Evidence | Value |
| --- | --- |
| Source commit | `a168be000de4f85fea6b86f4b9101a2e060bda87` |
| Cloudflare build ID | `fe2d5926-32e6-44fb-915a-93d357f180c4` |
| Trigger source | `push_event` |
| Result | `success` |
| Build completed | `2026-09-17T20:30:12.541Z` |
| Deployed version | `fb2c4b14-32d5-405e-89ce-d1f0d271e2cd` |
| Deployment ID | `4f3ce6c3-e61b-41ce-8c3a-0d0a5d0eeb2b` |
| Active traffic | 100% on that version when checked at `2026-09-17T20:30:49Z` |

The build logs confirm 9 tests passed, 0 failed, TypeScript passed, and `bun run deploy`
completed successfully. The deployment API independently confirmed that the uploaded
version became the active deployment. Later commits can supersede this recorded version.

A push to `main` now triggers Cloudflare to install locked dependencies, run the tests and
TypeScript check, then deploy. A failed test or TypeScript command stops this command chain
before deployment. Investigate failures under **Workers & Pages > temp-mail > Deployments**.
GitHub's separate Worker Build workflow is a code/build check, not the deployment mechanism.
No Cloudflare deployment credential is needed in GitHub source or chat.

## Production DNS and API checks: passed

The existing Production Smoke Test was rerun after the first automated deployment.
All three jobs passed: public DNS, `api.0357000.xyz`, and the `workers.dev` API.

Run: https://github.com/Westbold/Passworthy-Temp-Email/actions/runs/35267882267

| Job | Job ID | Result |
| --- | --- | --- |
| Public mail DNS | `105370878632` | Passed |
| Custom HTTPS API | `105370879170` | Passed |
| Workers.dev HTTPS API | `105370880724` | Passed |

At `2026-09-17T20:30:39Z`, both assigned authoritative servers, `1.1.1.1`, `8.8.8.8`,
and Google DNS over HTTPS returned the three Cloudflare MX records. The SPF record was
also verified. The earlier new-domain NXDOMAIN blocker is resolved in these checks.

Both API jobs checked valid HTTPS, `/health`, the `0357000.xyz` allowlist, and same-origin
API documentation. They also exercised the actual D1 database: claim creation, idempotency,
conflicting-claim rejection, inbox listing/counts, missing/wrong-key rejection, and deletion.
The jobs release their randomly generated temporary claims after testing.

Working API and interactive documentation:

- https://api.0357000.xyz
- https://temp-mail.westbold-passworthy.workers.dev

At the post-deploy Cloudflare settings check, the existing D1 database binding was preserved,
Email Routing was enabled and ready, the catch-all still targeted `temp-mail`, and the
`0 */2 * * *` cleanup schedule remained active. No production mail-routing rule was changed.

## Remaining verification: external SMTP delivery

DNS and HTTP/API success do not prove that an actual message from an external mail server
has been accepted and stored. No fresh external email was sent during this redeployment test.

Use the claim/send/read procedure in `04_cloudflare_deployment.md` for that final check.
Claim the address before sending: inbound mail for unclaimed addresses is discarded.
No other manual step is required to enable automatic redeployment.

To repeat the DNS/API checks, use **Actions > Production Smoke Test > Run workflow > main**.
This is an on-demand test, not recurring monitoring and not an external SMTP delivery test.

## Test destination cleanup: completed

The unused verification destination `cfcheck-df05426fb4e243ea@0357000.xyz` was deleted at
the user's request. Its destination ID was `e14f3218613f4f10ab6032d3e39f4ff8`.
Cloudflare returned HTTP 200, then a follow-up GET returned `2015`, `Address not found`.
The temporary claim and messages were already removed. The entry was not recreated.

The staging Worker, staging database table, and one-time GitHub transfer workflow used for
the initial MCP deployment were removed. Personal domains are not used by this project.

Official deployment behavior: https://developers.cloudflare.com/workers/ci-cd/builds/
