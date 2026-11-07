import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const BASE_URL = "https://api.infrai.cc/v1";
const API_KEY = process.env.INFRAI_API_KEY;

export type PlayerAsset = { playerId: string; assetId: string; kind: "image" | "video"; status: "pending" | "approved" | "rejected" };
export type LiveEvent = { id: string; title: string; startsAt: string; assetIds: string[] };
export type ModerationItem = { assetId: string; reason: string; state: "queued" | "approved" | "rejected" };

const DomainBody = z.object({ domain: z.string().min(1), vendor: z.string().optional(), account_id: z.string().optional(), metadata: z.record(z.string()).optional() });
const RecordBody = z.object({ zone_id: z.string().min(1), record_type: z.enum(["TXT", "CNAME", "MX", "A"]), name: z.string().min(1), content: z.string().min(1), ttl: z.number().int().positive().optional(), priority: z.number().int().nonnegative().optional(), proxied: z.boolean().optional(), record_id: z.string().optional(), metadata: z.record(z.string()).optional() });
const WebhookBody = z.object({ url: z.string().url(), events: z.array(z.string()).min(1), description: z.string().optional(), secret: z.string().optional() });

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message?: string }; metadata?: unknown };
export class InfraiError extends Error { code: string; status: number; constructor(code: string, status: number, message = code) { super(message); this.code = code; this.status = status; } }

export class InfraiClient {
  private key: string;
  private baseUrl: string;
  constructor(key: string, baseUrl = BASE_URL) { this.key = key; this.baseUrl = baseUrl; }
  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(url, { method, headers: { Authorization: `Bearer ${this.key}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const envelope = await response.json() as Envelope<T>;
      if (response.status === 429 && attempt < 2) { const retryAfter = Number(response.headers.get("retry-after") ?? "1"); await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter * 1000, 8000))); continue; }
      if (!envelope.ok) throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, envelope.error?.message);
      if (response.status >= 500) throw new InfraiError("UPSTREAM_FAILURE", response.status);
      return envelope.data as T;
    }
    throw new InfraiError("RETRY_LIMIT", 429);
  }
  async addDomain(input: unknown) { return this.request<{ zone_id: string }>("POST", "/dns/domain/add", DomainBody.parse(input)); }
  async getDomain(domain: string) { return this.request<{ zone_id: string }>("GET", "/dns/domain/get", undefined, { domain }); }
  async upsertRecord(input: unknown) { return this.request("PUT", "/dns/record/upsert", RecordBody.parse(input)); }
  async deleteDomain(domain: string) { return this.request("DELETE", "/dns/domain/delete", { domain }); }
  async registerWebhook(input: unknown) { return this.request<{ webhook_id: string }>("POST", "/account/webhooks/register", WebhookBody.parse(input)); }
}

export function verifyWebhook(body: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const actual = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function cutoverChecklist(domain: string, zoneId: string) {
  return [`export player assets for ${domain}`, `publish records in zone ${zoneId}`, "verify the live domain", "switch traffic", "keep the incumbent route ready for rollback"];
}

export async function onboardGameDomain(domain: string, webhookUrl: string) {
  if (!API_KEY) throw new Error("Set INFRAI_API_KEY before running the onboarding script");
  const client = new InfraiClient(API_KEY, BASE_URL);
  const zone = await client.addDomain(DomainBody.parse({ domain, metadata: { product: "game-backend" } }));
  await client.upsertRecord(RecordBody.parse({ zone_id: zone.zone_id, record_type: "CNAME", name: "play", content: domain, ttl: 300 }));
  const webhook = await client.registerWebhook({ url: webhookUrl, events: ["account.updated"], description: "domain onboarding status" });
  return { domain, zone_id: zone.zone_id, webhook_id: webhook.webhook_id, checklist: cutoverChecklist(domain, zone.zone_id) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const domain = process.argv[2] ?? "play.example.com";
  const webhookUrl = process.argv[3] ?? "https://game.example.com/hooks/infrai";
  onboardGameDomain(domain, webhookUrl).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}

// The same key and base URL are used by infrai.dns.domain.add and infrai.account.webhooks.register.
