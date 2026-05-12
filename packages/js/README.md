# @theg1team/mcp-ads-client (JS/TS)

JavaScript / TypeScript reference SDK для **MCP Ads format**. OSS MIT.

Implements [`mcp-ads-v1.0` spec](https://github.com/TheG1Team/g1-adtech-plan/blob/main/specs/mcp-ads-v1.0.md) end-to-end: OAuth client_credentials JWT auth + `ads_serve_for_context` MCP tool call + server-side render-confirm POST (billing source of truth per spec § 10).

## Install

```bash
npm install @theg1team/mcp-ads-client
```

## Usage

```typescript
import { MCPAdsClient } from "@theg1team/mcp-ads-client";

const client = new MCPAdsClient({
	client_app: "my-ai-app",
	client_secret: process.env.MCP_ADS_CLIENT_SECRET!,
});

// Mid-conversation render:
const ad = await client.serveAd({
	context_summary: "User asking about Tokyo flight prices",
	conversation_id: "550e8400-e29b-41d4-a716-446655440000",
	message_index: 7,
	agent: { kind: "mcp", model: "claude-opus-4-7", client_app: "my-ai-app" },
	locale: "en-US",
	user_id_hash: "a3f5b7c9...",  // SHA-256 hex (64 chars), caller responsibility
});

if (ad) {
	// 1. Render ad.markdown inline в response stream
	// 2. Display ad.sponsored_label ("Sponsored", "Werbung", ...) prominently
	// 3. Within ≤30s, confirm render — this is the billing source of truth
	await client.confirmRender({ imp_id: ad.imp_id });
}
```

## License

MIT.
