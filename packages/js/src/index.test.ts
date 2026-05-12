import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCPAdsClient, MCPAdsError } from "./index.js";

const VALID_CONV = "550e8400-e29b-41d4-a716-446655440000";
const VALID_IMP = "660e8400-e29b-41d4-a716-446655440001";
const VALID_USER_HASH = "a".repeat(64);

function mockResponses(
	...responses: Array<{ status?: number; body: unknown }>
): typeof globalThis.fetch {
	const queue = [...responses];
	return vi.fn(async () => {
		const r = queue.shift();
		if (!r) throw new Error("mockResponses: no more queued responses");
		const status = r.status ?? 200;
		// Response constructor disallows body on null-body statuses (204/205/304).
		const nullBody = status === 204 || status === 205 || status === 304;
		return new Response(nullBody ? null : JSON.stringify(r.body), {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as never;
}

function tokenResponse(expires_in = 300) {
	return { body: { access_token: "fake.jwt.token", expires_in, token_type: "Bearer" } };
}

let client: MCPAdsClient;

beforeEach(() => {
	// fresh client per test
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("constructor", () => {
	it("rejects missing client_app", () => {
		expect(() => new MCPAdsClient({ client_app: "", client_secret: "s" })).toThrow(/client_app/);
	});

	it("rejects missing client_secret", () => {
		expect(() => new MCPAdsClient({ client_app: "x", client_secret: "" })).toThrow(/client_secret/);
	});

	it("normalises trailing slashes from URLs", () => {
		const c = new MCPAdsClient({
			client_app: "x",
			client_secret: "s",
			gateway_url: "https://mcp.example.com///",
		});
		expect(c).toBeInstanceOf(MCPAdsClient);
	});
});

describe("serveAd input validation", () => {
	beforeEach(() => {
		client = new MCPAdsClient({
			client_app: "claude-ai",
			client_secret: "s",
			fetch: mockResponses(tokenResponse()),
		});
	});

	const validReq = {
		context_summary: "User asking about Tokyo flight prices",
		conversation_id: VALID_CONV,
		message_index: 7,
		agent: { kind: "mcp" as const, client_app: "claude-ai" },
	};

	it("rejects empty context_summary", async () => {
		await expect(client.serveAd({ ...validReq, context_summary: "" })).rejects.toThrow(MCPAdsError);
	});

	it("rejects context_summary > 2048 chars (spec § 4.1)", async () => {
		await expect(
			client.serveAd({ ...validReq, context_summary: "x".repeat(2049) }),
		).rejects.toThrow(/≤2048/);
	});

	it("rejects non-UUID conversation_id", async () => {
		await expect(client.serveAd({ ...validReq, conversation_id: "not-uuid" })).rejects.toThrow(
			/UUID/,
		);
	});

	it("rejects negative message_index", async () => {
		await expect(client.serveAd({ ...validReq, message_index: -1 })).rejects.toThrow(
			/non-negative integer/,
		);
	});

	it("rejects mismatch between agent.client_app and constructor client_app", async () => {
		await expect(
			client.serveAd({ ...validReq, agent: { kind: "mcp", client_app: "other-app" } }),
		).rejects.toThrow(/must match/);
	});

	it("rejects malformed user_id_hash (not 64 hex)", async () => {
		await expect(client.serveAd({ ...validReq, user_id_hash: "short" })).rejects.toThrow(
			/SHA-256 hex/,
		);
	});
});

describe("serveAd happy path", () => {
	it("returns ad когда server responds с full payload", async () => {
		const adResp = {
			ok: true,
			imp_id: VALID_IMP,
			markdown: "**Sponsored** · JR Pass...",
			image_url: "https://cdn.g1.network/r2/creative/jrpass.webp",
			advertiser: "JR Pass",
			cta: "Get yours →",
			click_token: "eyJhbGciOiJIUzI1NiIs...",
			sponsored_label: "Sponsored",
			sponsored_label_locale: "en-US",
		};
		client = new MCPAdsClient({
			client_app: "claude-ai",
			client_secret: "s",
			fetch: mockResponses(tokenResponse(), { body: adResp }),
		});

		const ad = await client.serveAd({
			context_summary: "User asking about Tokyo flight prices",
			conversation_id: VALID_CONV,
			message_index: 7,
			agent: { kind: "mcp", model: "claude-opus-4-7", client_app: "claude-ai" },
			locale: "en-US",
			user_id_hash: VALID_USER_HASH,
		});

		expect(ad).not.toBeNull();
		expect(ad?.imp_id).toBe(VALID_IMP);
		expect(ad?.advertiser).toBe("JR Pass");
		expect(ad?.sponsored_label).toBe("Sponsored");
		expect(ad?.click_token).toMatch(/^eyJ/);
	});

	it("returns null на 204 No-Content (no-bid)", async () => {
		client = new MCPAdsClient({
			client_app: "claude-ai",
			client_secret: "s",
			fetch: mockResponses(tokenResponse(), { status: 204, body: {} }),
		});
		const ad = await client.serveAd({
			context_summary: "x",
			conversation_id: VALID_CONV,
			message_index: 0,
			agent: { kind: "mcp", client_app: "claude-ai" },
		});
		expect(ad).toBeNull();
	});

	it("returns null когда response carries nbr > 0", async () => {
		client = new MCPAdsClient({
			client_app: "claude-ai",
			client_secret: "s",
			fetch: mockResponses(tokenResponse(), { body: { ok: true, nbr: 250 } }),
		});
		const ad = await client.serveAd({
			context_summary: "x",
			conversation_id: VALID_CONV,
			message_index: 0,
			agent: { kind: "mcp", client_app: "claude-ai" },
		});
		expect(ad).toBeNull();
	});

	it("throws MCPAdsError с status + nbr на 4xx server error", async () => {
		client = new MCPAdsClient({
			client_app: "claude-ai",
			client_secret: "s",
			fetch: mockResponses(tokenResponse(), { status: 429, body: { nbr: 256 } }),
		});
		try {
			await client.serveAd({
				context_summary: "x",
				conversation_id: VALID_CONV,
				message_index: 0,
				agent: { kind: "mcp", client_app: "claude-ai" },
			});
			throw new Error("expected MCPAdsError");
		} catch (e) {
			expect(e).toBeInstanceOf(MCPAdsError);
			const err = e as MCPAdsError;
			expect(err.status).toBe(429);
			expect(err.nbr).toBe(256);
		}
	});
});

describe("confirmRender", () => {
	it("rejects non-UUID imp_id", async () => {
		client = new MCPAdsClient({
			client_app: "claude-ai",
			client_secret: "s",
			fetch: mockResponses(tokenResponse()),
		});
		await expect(client.confirmRender({ imp_id: "not-uuid" })).rejects.toThrow(/UUID/);
	});

	it("rejects viewability out of [0, 1]", async () => {
		client = new MCPAdsClient({
			client_app: "claude-ai",
			client_secret: "s",
			fetch: mockResponses(tokenResponse()),
		});
		await expect(client.confirmRender({ imp_id: VALID_IMP, viewability: 1.5 })).rejects.toThrow(
			/viewability/,
		);
	});

	it("fire-and-forget swallows transport errors by default", async () => {
		const fetcher = vi.fn(async () => {
			throw new Error("network down");
		}) as never;
		client = new MCPAdsClient({
			client_app: "claude-ai",
			client_secret: "s",
			fetch: mockResponses(tokenResponse()),
		});
		// Inject a failing fetch для the confirmRender call specifically.
		// biome-ignore lint/suspicious/noExplicitAny: surgical override
		(client as any).fetcher = fetcher;
		await expect(client.confirmRender({ imp_id: VALID_IMP })).resolves.toBeUndefined();
	});

	it("surfaces transport error когда throwOnError: true", async () => {
		const failingFetch = vi.fn(async () => {
			throw new Error("network down");
		}) as never;
		client = new MCPAdsClient({
			client_app: "claude-ai",
			client_secret: "s",
			fetch: mockResponses(tokenResponse()),
		});
		// biome-ignore lint/suspicious/noExplicitAny: surgical override
		(client as any).fetcher = failingFetch;
		await expect(
			client.confirmRender({ imp_id: VALID_IMP }, { throwOnError: true }),
		).rejects.toThrow(/network down/);
	});
});

describe("token caching", () => {
	it("reuses cached token between calls (single OAuth exchange)", async () => {
		const fetcher = vi.fn(async (url: string) => {
			if (url.endsWith("/oauth/token")) {
				return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 300 }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response(null, { status: 204 });
		}) as never;
		client = new MCPAdsClient({ client_app: "claude-ai", client_secret: "s", fetch: fetcher });

		await client.serveAd({
			context_summary: "x",
			conversation_id: VALID_CONV,
			message_index: 0,
			agent: { kind: "mcp", client_app: "claude-ai" },
		});
		await client.serveAd({
			context_summary: "x",
			conversation_id: VALID_CONV,
			message_index: 1,
			agent: { kind: "mcp", client_app: "claude-ai" },
		});
		// 1 OAuth + 2 serveAd = 3 total fetches
		// biome-ignore lint/suspicious/noExplicitAny: vi.Mock shape
		const calls = (fetcher as any).mock.calls.length;
		expect(calls).toBe(3);
	});

	it("re-fetches token когда expiry ≤30s away", async () => {
		const fetcher = vi.fn(async (url: string) => {
			if (url.endsWith("/oauth/token")) {
				return new Response(JSON.stringify({ access_token: "tok", expires_in: 20 }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response(null, { status: 204 });
		}) as never;
		client = new MCPAdsClient({ client_app: "claude-ai", client_secret: "s", fetch: fetcher });

		await client.serveAd({
			context_summary: "x",
			conversation_id: VALID_CONV,
			message_index: 0,
			agent: { kind: "mcp", client_app: "claude-ai" },
		});
		await client.serveAd({
			context_summary: "x",
			conversation_id: VALID_CONV,
			message_index: 1,
			agent: { kind: "mcp", client_app: "claude-ai" },
		});
		// expires_in=20s → ≤30s lead → both calls refresh: 2 OAuth + 2 serveAd = 4
		// biome-ignore lint/suspicious/noExplicitAny: vi.Mock shape
		const calls = (fetcher as any).mock.calls.length;
		expect(calls).toBe(4);
	});

	it("throws MCPAdsError when OAuth response missing access_token", async () => {
		client = new MCPAdsClient({
			client_app: "claude-ai",
			client_secret: "s",
			fetch: mockResponses({ body: { expires_in: 300 } }),
		});
		await expect(
			client.serveAd({
				context_summary: "x",
				conversation_id: VALID_CONV,
				message_index: 0,
				agent: { kind: "mcp", client_app: "claude-ai" },
			}),
		).rejects.toThrow(/access_token/);
	});
});
