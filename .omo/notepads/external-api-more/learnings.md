# Learnings — external-api-more

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## [2026-08-18 20:26] Task 1 done
- convertClientToolsToDescriptors lives in service.ts (NOT contracts.ts) — single authority, hoisted + exported; background.ts imports it from there.
- executeViaOfficialApi (service.ts:611) mirrors web path: buildPrompt first-turn augmentation, built-in loop via executeToolCall, client-declared calls returned as tool_calls with finish_reason 'tool_calls'.
- Web path passes clientTools on first-turn AND user-message turns (service.ts:978-1025).
- BridgeFromExtensionToolEvent type in contracts.ts:247; added to BridgeFromExtensionMessage.
- TDD: baseline 8/8, red 4, final 13/13 green. Commit 439c84a (4 files only).

## [2026-08-18 20:26] Task 8 done
- Rename surface: i18n manifest name/actionTitle, package.json name, zip prefixes (scripts/package-sources.mjs, release-assets-check.mjs, workflow, submit scripts), README/README_EN, chrome-web-store docs.
- Gecko ID `deepseek-pp@zhu1090093659.github` intact (wxt.config.ts:131); Chrome ID intact.
- grep deepseek-plus-plus → zero matches post-commit. Commit 1c3c46b (13 files).
- Note: worker-reported "out-of-scope" file lists in task results were pre-existing working-tree changes (external-api relay leftovers, sidepanel i18n), NOT worker changes. Verify via git show --stat before trusting worker summaries.

## [2026-08-18] Task 5 done
- ToolEventStatus as strict serde enum (rename_all=lowercase) mirrors TS 'started'|'succeeded'|'failed' union; invalid status fails whole-message parse at WS boundary → ws_handler warn + continue (fail-closed, no connection drop) — satisfies "unknown TOOL_EVENT ignored with warn" QA scenario.
- Bridge TOOL_EVENT `id` IS the request id (`chatcmpl-<uuid>`), not a separate event id — events route to the pending request sender by it; unknown id → warn log.
- SSE tool-event chunk: separate ChatCompletionChunk sharing stream id/model/created; delta carries only tool_events; `data: [DONE]` preserved on both paths.
- Byte-identity proof: negative assertion — "tool_events" substring absent from raw SSE body when no events (skip_serializing_if None on delta + message).
- Non-streaming accumulates tool_events into final message (None when empty — response shape unchanged).
- Default relay model list already = 5 catalog ids incl deepseek-v4-vision; pinned by exact-list test (order: flash, pro, vision, chat, reasoner).
- Whole `ext/` dir was untracked pre-existing relay work — committed entire crate (10 files) in this task per plan's "your scope" note; staged explicitly to avoid `target/` (not gitignored!).
- Commit 3db1678.

## [2026-08-18 20:50] Task 2 done
- The input-box multimodal entry is `analyzeMultimodalMedia` (entrypoints/background/multimodal-handlers.ts:64, module-private) invoked via ANALYZE_MULTIMODAL_MEDIA runtime command; the actual analysis is MCP tool calls (analyze_images/analyze_video). Exporting that function + hoisting its deps object into `multimodalHandlerDependencies` lets external-api reuse it without a second pipeline.
- Deps interface lives in service.ts (not contracts.ts); CHAT_ERROR.code is a free-form string — no contracts change for new codes.
- service.ts imports `getMultimodalSettingsStatus` from core/multimodal/settings directly (task-specified); tests must `vi.mock('../core/multimodal/settings')` — module mock, not chrome mock, keeps service pure.
- media.ts normalizer is strict: dataUrl header mime must equal input.mimeType, sizeBytes must match decoded base64 length exactly (padding math: floor(len/4)*3 - padding). Build inputs accordingly or the background pipeline rejects them.
- Failure-path codes: multimodal_unavailable (no route: disabled/unconfigured/unroutable/no dep) vs multimodal_analysis_failed (pipeline ran but returned !ok).
- Order matters: analysis text composes via buildMultimodalAnalysisPrompt BEFORE buildPrompt augmentation (mirrors input-box flow where analysis wraps the user prompt first).
- Test pattern: vi.fn stubs for analyze dep must type the request param (vi.fn(async (request: MultimodalMediaAnalyzeRequest) => ...)) or mock.calls[0][0] types as undefined → tsc error.
- Full-suite flakiness: persistence-burst-budget + tool-provider-import-boundary time out under heavy parallel load but pass in isolation — run suspect files standalone before blaming a change.

## [2026-08-18 20:51] Task 2 done
- `analyzeMultimodalMedia?` optional dep on ExternalApiServiceDependencies; implemented in background.ts reusing `multimodalHandlerDependencies` (single authoritative deps object).
- `collectMultimodalMediaInputs` gathers image_url data URLs + file/input_file parts; unroutable parts → explicit CHAT_ERROR, never silent drop.
- Fail-closed: allowMultimodal && dep present && provider configured (`getMultimodalSettingsStatus`) → analyze; else CHAT_ERROR `multimodal_unavailable` / `multimodal_analysis_failed`.
- Media bytes never enter official API messages. Web path untouched. Commit ddc08a9.

## [2026-08-18 20:51] Task 5 done
- Rust relay: `ToolEvent` struct + `tool_events: Option<Vec<ToolEvent>>` on ChatCompletionChunkDelta AND ChatCompletionChoiceMessage (both skip_serializing_if None → byte-identical SSE without tool events).
- StreamEvent::ToolEvent routed to pending request by id; unknown id → warn only.
- SSE appends ChatCompletionChunk with delta.tool_events; non-streaming accumulates onto final message; `data: [DONE]` preserved both paths.
- Default model list already = exact 5 catalog ids; pinned by test_models_list_exact_catalog. Commit 3db1678.
- NOTE: cargo deps (aws-lc/ring) already compiled — relay builds fast after first.

## [2026-08-18] Task 3 done
- Audit verdict: NO active v4-pro->flash degradation on either wire. Official: config.model flows to createOfficialDeepSeekRequestBody untouched (official-api.ts:90 `model: config.model`). Web: pro -> webModelType 'expert'. Web 'expert' mode current (core/model/store.ts SUPPORTED_MODEL_TYPES = {expert, vision}).
- Real gaps were: vision id missing from handshake, silent flash fallback for unmappable models, duplicated catalog.
- EXTERNAL_API_MODEL_CATALOG exported from contracts.ts (as const, 5 ids); service handshake spreads it; relay bridge.rs already exact-match (T5 pinned).
- resolveDeepSeekModelParams is pure -> hoisted to module scope + exported; ExternalApiModelError(code 'model_not_supported') for unmappable; web path resolves BEFORE createChatSession so bad models never orphan a session.
- Full-path official-body test: override submitOfficialPrompt dep with vi.fn delegating to REAL submitOfficialDeepSeekStreaming + fetchImpl mock returning SSE; assert fetch body JSON. This is the strongest wire contract — use for future wire tests.
- relay test_models_list_exact_catalog + bridge.rs: no churn needed.
- Commit: fix(external-api): honor deepseek-v4-pro on the wire and expose full model catalog

## [2026-08-18 21:01] Task 3 verified (commit 05cb61b)
- EXTERNAL_API_MODEL_CATALOG exported from contracts.ts (as const, 5 ids incl deepseek-v4-vision); service handshake spreads it; SUPPORTED_MODELS import replaced by catalog.
- Wire fix verified in diff: expert branch sets officialModel='deepseek-v4-pro' (previously degraded); vision/image/multimodal → webModelType 'vision'; flash → 'deepseek-v4-flash'; unmappable → ExternalApiModelError (no silent fallback).
- Vision gating: effectiveModelType = hasImages && allowMultimodal ? 'vision' : webModelType.
- Commit scope exactly 3 files: contracts.ts, service.ts, tests/external-api-bridge.test.ts — no Rust churn (relay bridge.rs untouched), no pre-existing files committed.
- 21/21 bridge tests green, compile green, prompt:freeze green.
- T7 dependency satisfied: settings UI can import EXTERNAL_API_MODEL_CATALOG directly.

## [2026-08-18 21:12] Task 4 done
- Gate helpers live in contracts.ts next to ExternalApiConfig: `EXTERNAL_API_RELAY_AUTH_GATE_MESSAGE` (shared, contains "requires at least one enabled API key"), `isLoopbackHost` (''/127.0.0.1/localhost/::1), `hasEnabledExternalApiKeys` (apiKeys.some(enabled) || legacy apiKey.trim()), `getFirstAuthorizedApiKey` (first enabled key else legacy apiKey).
- process.ts gate checks ONLY options.apiKey (`{ apiKeys: [], apiKey: options.apiKey }`) — so callers MUST pass the effective key or managed-key-only users get falsely refused on 0.0.0.0. service.ts + controller pass `getFirstAuthorizedApiKey(config)`; service getAuthorizedApiKeys now delegates to hasEnabledExternalApiKeys (gate == authorization).
- connectWs gate placement: INSIDE the `nativeAvailable` branch, before startRelayProcess; on refusal set lastError + emitStatusUpdate + return (no socket created, status surfaces the gate message). Bare `catch {}` after auto-start untouched (T6).
- relayWsUrl rewrite in handleSaveExternalApiConfig: derive `ws://${host}:${port}/ws`, rewrite only when it differs (stored value kept when already consistent → backward compatible; store.ts normalize untouched).
- Test trick: vi.mock process module with `importOriginal` + `vi.fn((o) => actual.startRelayProcess(o))` delegation — spy args on the wrapper while the REAL gate logic still runs. Real startRelayProcess in vitest hits real isNativeHostAvailable (chrome undefined → false) — harmless, returns ok:false.
- RED: 4/5 new tests failed pre-impl (auto-start host/token args, service gate, process gate, loopback service allow); loopback process allow passed from the start (guard). GREEN: 26/26.
- TS gotcha: helper param type must be `Pick<Config,'apiKeys'> & { apiKey?: string }` not `Pick<...,'apiKey'>` — process options have optional apiKey.
- Commit e8e8a90 (5 files: contracts, process, service, useSettingsController, tests). prompt:freeze green, compile green, no golden diff.

## [2026-08-18 21:13] Task 4 verified (commit e8e8a90)
- contracts.ts now exports: EXTERNAL_API_RELAY_AUTH_GATE_MESSAGE (shared string incl "requires at least one enabled API key"), isLoopbackHost (''/127.0.0.1/localhost/::1), hasEnabledExternalApiKeys (enabled keys OR legacy apiKey), getFirstAuthorizedApiKey.
- process.ts: extensionToken?: string option; `--extension-token "..."` shell arg with same `.replace(/"/g,'\\"')` escaping as apiKey; gate BEFORE native call (non-loopback + no apiKey → {ok:false,message:GATE}).
- service.ts: getAuthorizedApiKeys delegates to hasEnabledExternalApiKeys + legacy fallback (gate == authorization); connectWs auto-start passes host+extensionToken+getFirstAuthorizedApiKey; service-side gate sets lastError + emitStatusUpdate + return.
- useSettingsController: handleStartRelayProcess gate + passes extensionToken+effective key; handleSaveExternalApiConfig rewrites relayWsUrl from host+port when inconsistent (store.ts normalize untouched).
- KEY DESIGN: process gate only sees single apiKey, so service/controller pass getFirstAuthorizedApiKey — managed-key-only users aren't falsely refused on 0.0.0.0.
- Test trick: vi.mock('../core/external-api/process') with importOriginal + vi.fn wrapping startRelayProcess — real gate logic runs under the mock so process-path gate test exercises real code.
- Commit included pre-existing untracked process.ts (whole file, 283 lines) — correct since it's feature code.
