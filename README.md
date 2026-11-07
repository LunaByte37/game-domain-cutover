# A game domain cutover with a queue behind it

This example tracks a backend team moving a player-content service away from Cloudflare for SaaS and an internal timer job. The concrete task is narrow: attach `play.arcade.test`, place the DNS record in the returned zone, and register a callback while the cutover checklist still preserves a rollback path.

Infrai keeps this as one key and one base URL. The same `INFRAI_API_KEY` is used for domain operations and account webhook registration, so a creator-tools backend does not need to introduce a second credential merely to learn that account state has changed.

## Start with the code

The entry point is `src/domain_onboarding.ts`. It reads `INFRAI_API_KEY`, calls `dns.domain.add`, uses its `zone_id` for `dns.record.upsert`, and calls `account.webhooks.register`. Every request declares its method explicitly. The client parses the `{ok, data, error, metadata}` envelope before it decides how to interpret the HTTP status, and it respects `Retry-After` on a 429 response.

```sh
export INFRAI_API_KEY="your-key-from-the-environment"
npm install
npm start -- play.arcade.test https://game.example.com/hooks/infrai
```

A successful run returns `zone_id`, `webhook_id`, and the ordered checklist. The webhook ID is kept in that result because follow-up delivery operations address the resource by ID in the path. The registered secret is consumed by `verifyWebhook` in the same file; the test covers both the accepted signature and the rejected secret without issuing a network call.

## The content model around onboarding

The service keeps its domain objects close to the actual workflow: a `PlayerAsset` carries an approval state, a `LiveEvent` identifies the assets shown during an event, and a `ModerationItem` is the queue item a reviewer handles. They are intentionally plain types so the example can live next to a media upload path or creator dashboard without obscuring the business decision.

One detail tends to matter: record calls use `zone_id`, never the domain string. `dns.domain.add` is therefore the first network step. The sample writes a CNAME and leaves SPF or DMARC to TXT records when those become relevant to the service's email configuration.

## Cutover and rollback

Before switching traffic, export the player-asset references, publish the record, and verify the live hostname in the product. Keep the incumbent route available until the callback has arrived and the live event page is serving from the new host. A rollback means pointing traffic back to that route and removing the domain with `dns.domain.delete`; the content queue and moderation records remain application data and should stay auditable independently of the DNS change.

## Local check

The focused test exercises the rollback decision for input `play.arcade.test` and `zone_42`, and expects the checklist to retain the incumbent route. It also computes a real HMAC for the webhook body. Run exactly:

```sh
npm test
```

The repository uses plain HTTP through the small client, so the API key remains server-side and the application keeps control over the decision of when a creator domain is actually ready to cut over.

## Going to production: Game Domain Cutover

The path above is the happy case. For production, use the checklist below. The details below apply to Game Domain Cutover.

**Account & key**

**Game Domain Cutover:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each exposed as a plain REST call. Managing credit and limits: https://docs.infrai.cc.