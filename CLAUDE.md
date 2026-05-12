# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Project context:** part of g1.network ad-tech build per `g1-adtech-plan/FINAL-PLAN.md`. **Phase 5b pilot** ships JS/TS reference SDK; **Phase 6 GA** adds Python + Go + MCP-native packages. Implements `specs/mcp-ads-v1.0.md` end-to-end.

## Project Overview

Multi-language SDK monorepo:
- `packages/js/` — TypeScript/JavaScript reference SDK. Universal target (Node + browser + Workers). Published к `@theg1team/mcp-ads-client` (npm public, OSS).
- `packages/python/` — stub README only. Phase 6 GA implementation.
- `packages/go/` — stub README only. Phase 6 GA implementation.
- MCP-native (no SDK) — AI clients calling `ads_serve_for_context` MCP tool directly через `mcp.g1.network` gateway with their existing JWT setup. Documented в README; no code в this repo.

## Architecture (JS/TS)

- `MCPAdsClient` class:
  - Constructor: `client_app`, `client_secret`, optional `gateway_url`, `adserver_url`, `oauth_token_url`.
  - Manages OAuth client_credentials → JWT (5min TTL). Auto-refreshes when ≤30s before expiry.
  - `serveAd(req)` → POST к gateway `/mcp/ads_serve_for_context` с JWT header. Returns null (no-bid) or `{ imp_id, markdown, image_url?, advertiser, cta?, sponsored_label, click_token, ... }`.
  - `confirmRender({ imp_id, rendered_at?, viewability? })` → fire-and-forget POST к adserver `/api/v1/mcp-ads/render-confirm`. **Billing source of truth** per spec § 10.
- Inline types (no separate types.ts; package is small).
- Build: tsup → ESM + CJS + .d.ts. No IIFE (SDK targets Node/server-side primarily).
- Test: vitest. No DOM stubs needed (SDK is fetch-based, framework-agnostic).

## Engineering standards (FINAL-PLAN §2 + §22a OSS)

- **MIT license** (OSS).
- **No `@theg1team/*` internal deps** — external AI clients consume directly.
- **Universal target**: ES2020, runs Node 18+ and modern browsers. No Node-only APIs unless feature-detected.
- **TypeScript strict**.
- **SemVer + 12mo deprecation** для breaking changes.
- **Cryptographic auth via JWT** (per spec § 6) — никаких static API keys в SDK code. Secret is OAuth `client_secret` only used at token-exchange time.
- **No telemetry / analytics** beyond what the spec requires (render-confirm POST).

## Spec compliance map (mcp-ads-v1.0.md)

| Spec section | SDK responsibility |
|---|---|
| § 4 BidRequest extensions | Build `imp.mcp` + `ext.agent` payload |
| § 5 BidResponse contract | Parse `bid.ext.mcp` markdown + image_url + metadata |
| § 6 AI client authentication | OAuth client_credentials → JWT 5min TTL + auto-refresh |
| § 7 User skip mechanism | Pass `user_id_hash` (SHA-256 hex); SDK не вычисляет hash сама — caller responsibility |
| § 9.4 Mandatory `Sponsored` label | Returned в response; SDK exposes; render is caller responsibility |
| § 10 Render confirmation | `confirmRender()` method — fire-and-forget POST, billing source of truth |
| § 11 NBR codes | Surface как typed error на 4xx + nbr response |

## Don't

- Don't add runtime deps — keep SDK small и self-contained.
- Don't depend на `@theg1team/*` workspace packages.
- Don't store the static OAuth `client_secret` — accept at constructor only, hold в closure, never log.
- Don't expose raw JWT в logs.
- Don't auto-render markdown — return data; rendering is the AI client's responsibility (security + UX boundary).
- Don't cache ads — every bid request is fresh per spec § 9.2 (re-classify on EVERY bid).

## Publish flow (JS only Phase 5b)

1. `cd packages/js && pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
2. `pnpm version <patch|minor|major>`.
3. `git push --tags` → GitHub Actions `publish-js.yml` runs `pnpm publish` к npmjs.org.
4. jsDelivr + unpkg auto-mirror within 1-5 min.

## Verification

Before commit: `pnpm typecheck && pnpm lint && pnpm test`.
