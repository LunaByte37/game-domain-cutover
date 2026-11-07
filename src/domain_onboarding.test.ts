import test from "node:test";
import assert from "node:assert/strict";
import { cutoverChecklist, verifyWebhook } from "./domain_onboarding.ts";
import { createHmac } from "node:crypto";

test("cutover keeps a rollback route after the game domain is switched", () => {
  const steps = cutoverChecklist("play.arcade.test", "zone_42");
  assert.equal(steps[1], "publish records in zone zone_42");
  assert.equal(steps.at(-1), "keep the incumbent route ready for rollback");
});

test("webhook signature is accepted only for the registered secret", () => {
  const body = JSON.stringify({ event: "account.updated" });
  const signature = createHmac("sha256", "creator-secret").update(body).digest("hex");
  assert.equal(verifyWebhook(body, signature, "creator-secret"), true);
  assert.equal(verifyWebhook(body, signature, "other-secret"), false);
});
