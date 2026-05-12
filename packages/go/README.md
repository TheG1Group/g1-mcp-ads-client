# mcpads (Go)

🚧 **Phase 6 GA — pending implementation.**

Phase 5b ships JS/TS reference SDK first; Go equivalent lands in Phase 6.

## Planned design

Mirrors `@theg1team/mcp-ads-client` (JS) API:

```go
package main

import (
    "context"
    "os"

    mcpads "github.com/TheG1Team/g1-mcp-ads-client/packages/go"
)

func main() {
    client := mcpads.New(mcpads.Options{
        ClientApp:    "my-ai-app",
        ClientSecret: os.Getenv("MCP_ADS_CLIENT_SECRET"),
    })

    ad, err := client.ServeAd(context.Background(), mcpads.ServeAdRequest{
        ContextSummary: "User asking about Tokyo flight prices",
        ConversationID: "550e8400-e29b-41d4-a716-446655440000",
        MessageIndex:   7,
        Agent: mcpads.Agent{
            Kind:      "mcp",
            Model:     "claude-opus-4-7",
            ClientApp: "my-ai-app",
        },
        Locale:      "en-US",
        UserIDHash:  "a3f5b7c9...",
    })
    if err != nil || ad == nil {
        return
    }

    // Render ad.Markdown + ad.ImageURL с mandatory ad.SponsoredLabel.
    _ = client.ConfirmRender(context.Background(), mcpads.ConfirmRenderRequest{
        ImpID: ad.ImpID,
    })
}
```

## Planned dependencies

- stdlib only — `net/http`, `encoding/json`, `context`. Optional `golang.org/x/sync/singleflight` for OAuth token dedup.
- Go ≥1.22.

## Spec compliance

Same as JS SDK — implements `mcp-ads-v1.0` end-to-end.

## Publish target

`github.com/TheG1Team/g1-mcp-ads-client/packages/go` (Go module). MIT.

## Phase

Per FINAL-PLAN.md Phase 6 GA (W22-W24 nominal post-D5 adjustment).
