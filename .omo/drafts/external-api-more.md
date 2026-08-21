---
slug: external-api-more
status: approved
intent: clear
review_required: false
pending-action: plan written to .omo/plans/external-api-more.md; execution via $start-work in a new session
approach: Upgrade the existing external API relay (Rust ext/api-external-relay + TS core/external-api) to close 9 of 11 feedback gaps, fix 2 model/connection bugs, and rename the product to DeepSeek++ More. Reuse existing surfaces (bridge protocol, per-key policy, settings subpage); add official-api backend parity, client-tool schema injection, multimodal exposure, host passthrough, model catalog unification, relay process resurrection, and heartbeat timeout detection.
---

# Draft: external-api-more

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

- c1 external-api-service (TS bridge + execution) | parity between web/official backends + client-tool prompt injection + tool event streaming + host passthrough + disconnect abort | active | core/external-api/service.ts
- c2 external-api-process | relay process resurrection + host-aware status/start | active | core/external-api/process.ts
- c3 rust-relay | model catalog metadata + SSE tool events + multimodal passthrough | active | ext/api-external-relay/src/*
- c4 open-api-settings | host security warning, model catalog view, multimodal expose config | active | entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx
- c5 model-resolution | V4 Pro wire correctness + unified supported model list (incl deepseek-v4-vision) | active | core/external-api/service.ts:132, core/deepseek/official-api.ts, ext/api-external-relay/src/bridge.rs:66
- c6 rename | DeepSeek++ More display + package.json name + zip scripts + docs | active | core/i18n/resources/*/manifest.ts, package.json, scripts/*.mjs, README*.md, .github/workflows/chrome-web-store.yml
- c7 tests | bridge contract tests for new behaviors | active | tests/external-api-bridge.test.ts

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

- 工具执行反馈形式 | 内置工具执行进度以结构化事件流经 relay SSE（新增字段/事件类型），最终答案照常返回 | 标准 OpenAI function-calling 式反馈；不破坏现有 CHAT_DONE | reversible (bridge protocol internal)
- 多模态开放方式 | 复用现有 chat-completions 路径：image_url/input_file 在 official 后端不再丢弃；配置了 OpenAI/Gemini 分析时优先走扩展自有分析管线，否则走 DeepSeek vision 上传（现状） | 用户明确"过程参考第一项"；避免新端点 | reversible
- 改名边界 | 显示名 + package.json name + zip/release 脚本 + README/文档；Gecko ID 与 Chrome Web Store ID 不变 | 换 ID 会孤儿化已安装用户 | irreversible - RESOLVED: 全面改名
- 模型名获取面 | 统一模型目录 = 5 个 DeepSeek id（含 deepseek-v4-vision）+ web 模式别名，经 handshake 与 /v1/models 下发 | 用户 item 10 直指此缺；多模态 OpenAI/Gemini 模型不混入 DeepSeek 目录 | reversible
- 连接稳定性面 | relay 进程死亡时按 backoff 重启（非仅首次）；心跳增加 PONG 超时检测；断线 abort 在飞请求并向客户端发 CHAT_ERROR | 对症 item 11 | reversible
- 0.0.0.0 暴露安全 | 非 loopback 绑定要求至少一个启用 key 且 UI 警告；extensionToken 继续保护 /ws | 安全基线；开放 API 无鉴权 = 风险 | irreversible - RESOLVED: 强制 key + 警告
- 多模态开放面 | official 后端补图片透传 + 复用 core/multimodal 自有 OpenAI/Gemini 分析管线（allowMultimodal 门控），经 chat-completions 路径 | 用户 item 4 明确"过程参考第一项" | RESOLVED: 透传 + 自有管线

## Findings (cited - path:lines)

- Relay 已支持 --host/--port/--tls/--api-key/--extension-token；默认 127.0.0.1:3000；路由 /v1/chat/completions + /v1/models + /ws | ext/api-external-relay/src/cli.rs:6-33, main.rs:47-57
- 设置页已有 host 选择(127.0.0.1/0.0.0.0)+port+backend+defaultModel+每 key 配置+开关，但无暴露安全提示 | entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx:300-380
- 自动启动 relay 时未传 host：connectWs 只传 { port, apiKey } → 0.0.0.0 选择对自动启动无效（手动启动 handleStartRelayProcess 已传 host） | core/external-api/service.ts:243-251 vs useSettingsController.ts:1115-1118
- 客户端工具(request.tools)被转成 descriptor 参与 extractToolCalls，但 schema 从未渲染进模型 prompt（web 路径 buildExternalApiPrompt 只渲染内置工具） | core/external-api/service.ts:575-595, entrypoints/background.ts:1645-1682
- official-api 路径不调用 buildPrompt：无系统注入、无内置工具执行、图片 content 部分被 mapMessagesToOfficialApi 丢弃 | core/external-api/service.ts:609-732, 1165-1192
- web 路径：首轮+后续 user 消息走 buildPrompt 注入时间/模型/工具表/记忆；executes built-in tools + MAX_CHAT_TOOL_STEPS 循环 | core/external-api/service.ts:846-1141, entrypoints/background.ts:1633-1687
- SUPPORTED_MODELS 缺 deepseek-v4-vision（relay 默认列表有，扩展 HANDSHAKE_ACK 覆盖后丢失）；resolveDeepSeekModelParams 支持 vision/expert 但模型目录不含 | core/external-api/service.ts:132-137, ext/api-external-relay/src/bridge.rs:66-72
- 模型解析：'pro'→web expert+official deepseek-v4-pro；用户实测仍走 V4 Flash（web 'expert' 模式或 official 模型 id 落地差异）→ 需 wire 级审计 | core/external-api/service.ts:531-573, core/chat/official-api-config.ts:49-51
- relay 进程仅 reconnectAttempt==0 时 auto-start；进程死亡后永不重启；心跳 PING 无 PONG 超时检测（半开 TCP 假活）；ws.onclose 不 abort activeControllers | core/external-api/service.ts:139-141, 183-191, 200-251, 339-352
- 改名面：i18n manifest name/actionTitle='DeepSeek++'（en+zh）；package.json name 'deepseek-plus-plus'；zip 脚本/发布 workflow 硬编码 'deepseek-plus-plus-' 前缀 | core/i18n/resources/en/manifest.ts:2-4, zh-CN/manifest.ts:2-4, package.json:2, scripts/release-assets-check.mjs:32, scripts/package-sources.mjs:17, .github/workflows/chrome-web-store.yml:76
- 现有测试 8 项覆盖 handshake/双后端/cancel/key sync/会话复用/内置工具循环/客户端工具 | tests/external-api-bridge.test.ts:41-418

## Decisions (with rationale)

- d1 官方后端补齐 parity：系统注入(时间/模型/工具表/记忆) + 内置工具执行循环 + 多模态图片透传 | 用户 item 1/4/5 明指；避免双后端行为分裂
- d2 客户端工具 schema 渲染进模型 prompt（web+official 两路径） | item 3；否则模型不知道外部向量表存在
- d3 工具执行以结构化事件流回传 relay（新增 BridgeFromExtension→relay 事件/字段），最终答案照常 | item 1 "向外部程序反馈信息"
- d4 host 透传：connectWs auto-start 传 relayHost；relayWsUrl 由 host+port 派生 | item 2
- d5 非 loopback 绑定安全门：无启用 key 时拒绝/警告 | 安全基线 + item 2
- d6 统一模型目录 + 审计 V4 Pro wire 正确性 + 契约测试 | item 9/10
- d7 连接韧性：进程复活 + PONG 超时 + 断线 abort | item 11
- d8 改名 DeepSeek++ More / deepseek_pp_more，ID 不变 | item 7
- d9 非 loopback 绑定：强制至少一个启用 API key + 设置页红色警告；startRelayProcess 同时透传 extensionToken 保护 /ws | 用户已确认（安全决策）
- d10 全面改名：i18n 显示名 + package.json name=deepseek-pp-more + zip 脚本前缀 + CWS workflow + README/README_EN + docs/chrome-web-store 文案；Gecko/CWS ID 不变 | 用户已确认
- d11 多模态 = official 后端图片透传 + 扩展自有 OpenAI/Gemini 分析管线（core/multimodal，allowMultimodal 门控）经 chat-completions 暴露 | 用户已确认

## Scope IN

- external-api service：official 后端 parity、客户端工具注入、工具事件流、host 透传、断线 abort、PONG 超时、进程复活
- external-api process：host-aware start/status
- rust relay：模型目录元数据、SSE 工具事件、必要字段透传
- OpenApiSubPage：0.0.0.0 安全提示与鉴权门、模型目录展示、多模态开放配置
- 模型解析审计与修复（V4 Pro wire 正确性）
- 改名：i18n + package.json + zip 脚本 + workflow + README/docs
- 契约测试扩展

## Scope OUT (Must NOT have)

- 不改 Gecko ID / Chrome Web Store ID / 扩展目录名
- 不新增持久化键；不新增第二套同步/配置权威（沿用 deepseek_pp_external_api_config）
- 不新增 relay 独立新端点（多模态/工具反馈走既有 chat-completions 路径与桥消息）
- 不动 pi 生态锁版与注入管线；不动 stream-codec 权威
- 不实现 Android/移动端；不引入新生产依赖（Rust 侧仅改既有 crate 用法）
- 不删除既有配置兼容迁移（normalizeExternalApiConfig 保持向后兼容）

## Open questions

- 全部已答复：Q1 非 loopback 强制 key + 警告；Q2 全面改名；Q3 透传 + 自有分析管线。无剩余阻塞问题。

## Approval gate
status: awaiting-approval
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
