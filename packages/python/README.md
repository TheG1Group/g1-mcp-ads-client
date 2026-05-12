# theg1team-mcp-ads-client (Python)

🚧 **Phase 6 GA — pending implementation.**

Phase 5b ships JS/TS reference SDK first; Python equivalent lands in Phase 6.

## Planned design

Mirrors `@theg1team/mcp-ads-client` (JS) API:

```python
from theg1team_mcp_ads_client import MCPAdsClient

client = MCPAdsClient(
    client_app="my-ai-app",
    client_secret=os.environ["MCP_ADS_CLIENT_SECRET"],
)

ad = await client.serve_ad(
    context_summary="User asking about Tokyo flight prices",
    conversation_id="550e8400-e29b-41d4-a716-446655440000",
    message_index=7,
    agent={"kind": "mcp", "model": "claude-opus-4-7", "client_app": "my-ai-app"},
    locale="en-US",
    user_id_hash="a3f5b7c9...",
)

if ad:
    # Render ad.markdown + ad.image_url с mandatory ad.sponsored_label.
    await client.confirm_render(imp_id=ad.imp_id)
```

## Planned dependencies

- `httpx` — async HTTP client (with `trio` + `asyncio` support).
- `pydantic` v2 — request/response validation.
- Python ≥3.10.

## Spec compliance

Same as JS SDK — implements `mcp-ads-v1.0` spec end-to-end (OAuth client_credentials JWT § 6, BR/BResp contracts § 4–5, render confirmation § 10).

## Publish target

`theg1team-mcp-ads-client` on pypi.org. MIT.

## Phase

Per FINAL-PLAN.md Phase 6 GA (W22-W24 nominal post-D5 adjustment).
