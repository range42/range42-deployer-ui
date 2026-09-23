# Shared native SDN acceptance — 23 September 2026

The served UI revision is `86e1499fce7cf1920d4d939f63c70072af7630df`, paired with
backend revision `4e70f1358c7ef5dedab122e8443b3e6bf9abbe86` and the verified
`native-sdn-20260921` runtime. The full guest cycle ran on backend `69ac8cb`;
the final backend update corrects event draining after runner exit.

## Authored scenario and runtime operations

The actual UI reviewed and generated the two-guest concrete scenario used in
shared deployment `c723a4bfb3014757`. Saved project revision
`4e2242ef1f6af243041c0fe83f7879f0efa44859` deployed successfully. Both guests
received the uploaded file and passed guest-to-guest SSH and fresh outbound
HTTPS probes. The live runtime report separates declared/configured values,
timestamped native NAT observations and actual traffic verification.

The actual browser reviewed and submitted an owned VM alias with mandatory
scope acknowledgment. Its operation succeeded; the first Playwright observer's
30-second HTTP wait expired during backend preparation, so the accepted attempt
was recovered from history instead of resubmitting it. The subsequent alias
deletion returned HTTP 201, completed successfully and produced no page errors.

The paired API also completed rule create/update/reorder/delete, alias rename,
NAT disable/enable with independent guest traffic probes, VM/scenario firewall
switch readback, a later saved content revision and owned teardown. Host/DC
switches stayed unchanged; this run does not claim guest filtering enforcement.
The owned VNet/NAT rule were deleted, allocations released and the original
48 guests, shared networks and unrelated NAT rules preserved.

## Real Git save and cache regression

GitHub caches authenticated JSON reads for 60 seconds. The initial live save
acquired an editor lease but reread stale branch/lease state and refused its own
write. The GitHub provider now uses `cache: 'no-store'` for JSON requests. A real
Chromium test reproduced the failure with browser caching enabled and verifies
the correction; CI runs that browser regression.

The corrected served UI recovered the expired lease, saved the project as
`b68e8bd0c407f345bf819f1f8a06da90c5f7abfa`, then saved the sanitized runtime
result as `fb4964015a07222d1422666be7d7525851f9239a` and recorded its receipt.
The last commit changes only the result file and project index; target manifests
and inventory match the original deployment. There were no page errors. Closing
the browser left an expiring editor lease, which was verified expired afterward.

## Validation and limits

The corrected UI passed 1,927 unit tests (10 skipped), 109 focused Git tests,
migrated type checks, production build and the actual-cache browser regression.
Two catalog waits timed out during a concurrent local build/test run; those
files and the full suite passed on a bounded-worker rerun. Existing controlled
browser fixtures cover desktop/mobile review, refusal, accessibility and drafts.
The installed head passed CI, including the new cache regression.

See the [backend acceptance record](https://github.com/range42/range42-backend-api/blob/feat/sdn-scoped-operations-20260922/docs/shared-sdn-acceptance-20260923.md)
for exact upstream revisions, execution IDs, traffic evidence, refusal paths,
installation details and coverage limits. Raw private captures and credentials
are not committed. The paired PR stacks still need review, merge and promotion.

The final served UI loaded the runtime report at 1280px and 390px without page
errors or write requests; both panels fit their viewport. Shared report reads
were slow during concurrent acceptance activity (one measured 83 seconds); this
run verifies correctness, not a response-time target.
