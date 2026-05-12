# g1-mcp-ads-client

MCP Ads format SDK suite. OSS MIT. Implements [`g1-adtech-plan/specs/mcp-ads-v1.0.md`](https://github.com/TheG1Team/g1-adtech-plan/blob/main/specs/mcp-ads-v1.0.md).

| Language | Status | Package | Phase |
|---|---|---|---|
| JavaScript / TypeScript | ✅ **live (skeleton)** | `@theg1team/mcp-ads-client` | 5b pilot |
| Python | 🚧 stub (Phase 6 GA) | `theg1team-mcp-ads-client` (pypi) | 6 |
| Go | 🚧 stub (Phase 6 GA) | `github.com/TheG1Team/g1-mcp-ads-client/packages/go` | 6 |
| MCP-native (no SDK) | ✅ available now | direct tool call | 5b pilot |

## What это

AI clients (Claude.ai, Cursor, agent surfaces) use this SDK to embed **MCP Ads** в their LLM response streams. The SDK:

1. **Authenticates** через OAuth client_credentials → short-lived JWT (5min TTL).
2. **Requests** ad для conversational context via `ads_serve_for_context` MCP tool at `mcp.g1.network`.
3. **Renders** markdown ≤4KB inline + image URL pointer + mandatory localized "Sponsored" label.
4. **Confirms** render via server-side POST к `adserver.g1.network/api/v1/mcp-ads/render-confirm` — **billing source of truth** (per spec § 10).
5. **Honors** user skip flag (g1-side `mcp_ads_user_prefs`; SDK passes hashed user_id; spec § 7).

## Quick start (JS/TS)

```bash
npm install @theg1team/mcp-ads-client
```

```typescript
import { MCPAdsClient } from "@theg1team/mcp-ads-client";

const client = new MCPAdsClient({
	client_app: "my-ai-app",
	client_secret: process.env.MCP_ADS_CLIENT_SECRET!,
});

// In the middle of rendering an LLM response:
const ad = await client.serveAd({
	context_summary: "User asking about Tokyo flight prices",
	conversation_id: "550e8400-e29b-41d4-a716-446655440000",
	message_index: 7,
	agent: { kind: "mcp", model: "claude-opus-4-7", client_app: "my-ai-app" },
	locale: "en-US",
	user_id_hash: "a3f5b7c9..." // SHA-256 hex (64)
});

if (ad) {
	// Render ad.markdown inline в response stream
	// Render ad.image_url <img>
	// Display ad.sponsored_label ("Sponsored") prominently

	// Immediately (or after <30s): confirm render
	await client.confirmRender({ imp_id: ad.imp_id });
}
```

## Phase 6 GA scope

Per FINAL-PLAN.md Phase 6: full SDK suite (JS/TS + Python + Go + MCP-native), all 7 locales, multiple whitelisted AI clients. Python + Go stubs в this repo will be filled out then.

## License

MIT — see [LICENSE](LICENSE).

## Version policy

SemVer + 12mo deprecation для breaking changes (FINAL-PLAN §5 SDK versioning policy).
