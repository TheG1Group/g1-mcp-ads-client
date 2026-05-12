/**
 * `@theg1team/mcp-ads-client` — JS/TS SDK для MCP Ads format.
 *
 * Implements `mcp-ads-v1.0` spec:
 *   § 6 — OAuth client_credentials → 5min JWT, auto-refresh ≤30s before exp
 *   § 4.3 — BidRequest with imp.mcp extension
 *   § 5 — BidResponse markdown + image + JSON metadata
 *   § 10 — Render confirmation POST (billing source of truth)
 *
 * Universal target — Node 18+ + modern browsers. No runtime deps.
 */

const DEFAULT_GATEWAY_URL = "https://mcp.g1.network";
const DEFAULT_ADSERVER_URL = "https://adserver.g1.network";
const DEFAULT_OAUTH_TOKEN_URL = "https://auth.g1.network/oauth/token";
const TOKEN_REFRESH_LEAD_S = 30; // refresh когда remaining ≤30s

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AgentKind = "web" | "mcp";

export interface AgentExt {
	kind: AgentKind;
	model?: string;
	client_app: string;
}

export interface ServeAdRequest {
	context_summary: string;
	conversation_id: string;
	message_index: number;
	agent: AgentExt;
	locale?: string;
	user_id_hash?: string;
}

export interface ServeAdResponse {
	imp_id: string;
	markdown: string;
	image_url?: string;
	advertiser: string;
	cta?: string;
	click_token: string;
	sponsored_label: string;
	sponsored_label_locale?: string;
	integrity_hash?: string;
}

export interface ConfirmRenderRequest {
	imp_id: string;
	rendered_at?: number;
	viewability?: number;
}

export interface MCPAdsClientOptions {
	client_app: string;
	client_secret: string;
	gateway_url?: string;
	adserver_url?: string;
	oauth_token_url?: string;
	/** Override fetch (for testing). */
	fetch?: typeof globalThis.fetch;
}

export class MCPAdsError extends Error {
	readonly nbr?: number;
	readonly status?: number;
	constructor(message: string, opts?: { nbr?: number; status?: number }) {
		super(message);
		this.name = "MCPAdsError";
		this.nbr = opts?.nbr;
		this.status = opts?.status;
	}
}

interface TokenCache {
	token: string;
	exp_unix_s: number;
}

export class MCPAdsClient {
	private readonly clientApp: string;
	private readonly clientSecret: string;
	private readonly gatewayUrl: string;
	private readonly adserverUrl: string;
	private readonly oauthTokenUrl: string;
	private readonly fetcher: typeof globalThis.fetch;
	private tokenCache: TokenCache | null = null;
	private tokenPromise: Promise<string> | null = null;

	constructor(opts: MCPAdsClientOptions) {
		if (!opts.client_app) throw new Error("MCPAdsClient: client_app required");
		if (!opts.client_secret) throw new Error("MCPAdsClient: client_secret required");
		this.clientApp = opts.client_app;
		this.clientSecret = opts.client_secret;
		this.gatewayUrl = (opts.gateway_url ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
		this.adserverUrl = (opts.adserver_url ?? DEFAULT_ADSERVER_URL).replace(/\/+$/, "");
		this.oauthTokenUrl = opts.oauth_token_url ?? DEFAULT_OAUTH_TOKEN_URL;
		this.fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
	}

	/**
	 * Request an ad для the given conversational context. Returns null когда
	 * no-bid (e.g., user opted out, vertical-lock conflict, sensitive cooldown,
	 * QPS quota exhausted, etc.).
	 */
	async serveAd(req: ServeAdRequest): Promise<ServeAdResponse | null> {
		this.validateServeAdRequest(req);
		const token = await this.getToken();
		const res = await this.fetcher(`${this.gatewayUrl}/mcp/ads_serve_for_context`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-mcp-ads-client-token": token,
			},
			body: JSON.stringify(req),
		});

		if (res.status === 204 || res.status === 404) return null;
		if (!res.ok) {
			let nbr: number | undefined;
			try {
				const errBody = (await res.json()) as { nbr?: number };
				nbr = errBody?.nbr;
			} catch {
				// non-JSON error
			}
			throw new MCPAdsError(`serveAd: HTTP ${res.status}`, { status: res.status, nbr });
		}

		const body = (await res.json()) as { ok: boolean; nbr?: number } & ServeAdResponse;
		if (body.nbr !== undefined && body.nbr > 0) return null;
		if (!body.imp_id || !body.markdown) {
			throw new MCPAdsError("serveAd: malformed response (missing imp_id/markdown)");
		}
		return {
			imp_id: body.imp_id,
			markdown: body.markdown,
			image_url: body.image_url,
			advertiser: body.advertiser,
			cta: body.cta,
			click_token: body.click_token,
			sponsored_label: body.sponsored_label ?? "Sponsored",
			sponsored_label_locale: body.sponsored_label_locale,
			integrity_hash: body.integrity_hash,
		};
	}

	/**
	 * Confirm impression render — **billing source of truth** per spec § 10.
	 * Fire-and-forget by default (returns Promise that resolves but errors
	 * are swallowed); pass `{ throwOnError: true }` to surface failures.
	 */
	async confirmRender(
		req: ConfirmRenderRequest,
		opts: { throwOnError?: boolean } = {},
	): Promise<void> {
		// Synchronous input validation always throws — caller bugs should never
		// be silently swallowed even в fire-and-forget mode.
		if (!UUID_RE.test(req.imp_id)) {
			throw new MCPAdsError("confirmRender: imp_id must be UUID v4");
		}
		if (req.viewability !== undefined && (req.viewability < 0 || req.viewability > 1)) {
			throw new MCPAdsError("confirmRender: viewability must be in [0, 1]");
		}

		try {
			const token = await this.getToken();
			const body: Record<string, unknown> = {
				imp_id: req.imp_id,
				rendered_at: req.rendered_at ?? Date.now(),
				client_token: token,
			};
			if (req.viewability !== undefined) body.viewability = req.viewability;

			const res = await this.fetcher(`${this.adserverUrl}/api/v1/mcp-ads/render-confirm`, {
				method: "POST",
				headers: { "content-type": "application/json", "x-mcp-ads-client-token": token },
				body: JSON.stringify(body),
			});
			if (!res.ok && opts.throwOnError) {
				throw new MCPAdsError(`confirmRender: HTTP ${res.status}`, { status: res.status });
			}
		} catch (err) {
			if (opts.throwOnError) throw err;
			// Fire-and-forget: swallow transport + token errors silently.
		}
	}

	// ── Internal ────────────────────────────────────────────────────

	private async getToken(): Promise<string> {
		const nowSec = Math.floor(Date.now() / 1000);
		if (this.tokenCache && this.tokenCache.exp_unix_s - nowSec > TOKEN_REFRESH_LEAD_S) {
			return this.tokenCache.token;
		}
		if (this.tokenPromise) return this.tokenPromise;
		this.tokenPromise = this.fetchNewToken().finally(() => {
			this.tokenPromise = null;
		});
		return this.tokenPromise;
	}

	private async fetchNewToken(): Promise<string> {
		const res = await this.fetcher(this.oauthTokenUrl, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_id: this.clientApp,
				client_secret: this.clientSecret,
				scope: "ads:serve-for-context",
				audience: "mcp.g1.network",
			}).toString(),
		});
		if (!res.ok) {
			throw new MCPAdsError(`OAuth token exchange failed: HTTP ${res.status}`, {
				status: res.status,
			});
		}
		const body = (await res.json()) as {
			access_token: string;
			expires_in: number;
			token_type?: string;
		};
		if (!body.access_token || !body.expires_in) {
			throw new MCPAdsError("OAuth response missing access_token/expires_in");
		}
		const exp_unix_s = Math.floor(Date.now() / 1000) + body.expires_in;
		this.tokenCache = { token: body.access_token, exp_unix_s };
		return body.access_token;
	}

	private validateServeAdRequest(req: ServeAdRequest): void {
		if (!req.context_summary) {
			throw new MCPAdsError("serveAd: context_summary required");
		}
		if (req.context_summary.length > 2048) {
			throw new MCPAdsError("serveAd: context_summary must be ≤2048 chars (spec § 4.1)");
		}
		if (!UUID_RE.test(req.conversation_id)) {
			throw new MCPAdsError("serveAd: conversation_id must be UUID v4");
		}
		if (!Number.isInteger(req.message_index) || req.message_index < 0) {
			throw new MCPAdsError("serveAd: message_index must be non-negative integer");
		}
		if (!req.agent || !req.agent.kind || !req.agent.client_app) {
			throw new MCPAdsError("serveAd: agent.kind and agent.client_app required");
		}
		if (req.agent.client_app !== this.clientApp) {
			throw new MCPAdsError(
				`serveAd: agent.client_app (${req.agent.client_app}) must match constructor client_app (${this.clientApp})`,
			);
		}
		if (req.user_id_hash && !/^[0-9a-f]{64}$/.test(req.user_id_hash)) {
			throw new MCPAdsError("serveAd: user_id_hash must be SHA-256 hex (64 chars)");
		}
	}
}

export default MCPAdsClient;
