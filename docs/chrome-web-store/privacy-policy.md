# DeepSeek++ More Privacy Policy

Effective date: 2026-07-14

DeepSeek++ More is a browser extension that enhances DeepSeek chat workflows with user-controlled floating chat on normal web pages, memory, skills, project context, saved items, prompt presets, MCP tools, side-panel Vision image attachments, multimodal media analysis, browser control tools, inline tool execution, local exports, downloadable artifacts, optional sync, automation, and optional side-panel chat.

This Privacy Policy explains what data the extension handles, how that data is used, when it may be transferred, and what controls users have.

## 1. Single Purpose

DeepSeek++ More has one purpose: to enhance DeepSeek chat workflows with user-controlled floating chat on normal web pages, memory, skills, projects, saved items, presets, tools, side-panel Vision image attachments, multimodal media analysis, browser control, local exports, optional sync, automation, and optional side-panel chat that the user controls.

## 2. Data Handled by the Extension

DeepSeek++ More may handle the following data only when needed for its user-facing features:

- DeepSeek conversation content, including prompts, model responses, and tool-call text shown on `chat.deepseek.com`.
- User-created extension data, including memories, skills, local Skill supporting files selected by the user, project context, project files or source notes, saved snippets, bookmarks, prompt presets, MCP server settings, automation tasks, theme settings, background settings, pet settings, and tool execution history.
- Optional DeepSeek API Key, when the user configures official API chat in the side panel.
- Optional OpenAI and Gemini API keys, model names, and request URLs, when the user configures multimodal image or video analysis.
- Optional sync settings, including WebDAV server URL, username, password, remote path, Google Drive or OneDrive OAuth app credentials, sync authorization tokens, provider selection, and sync state, when the user configures sync.
- Optional MCP configuration, including endpoint URLs, request headers, environment variables, native host names, discovered tool metadata, and tool results, when the user configures MCP tools.
- User-selected image files, file names, MIME types, file sizes, upload state, and DeepSeek file references, only when the user explicitly attaches images in side-panel Vision mode.
- User-selected image or video files, file names, MIME types, file sizes, and analysis results, only when the user explicitly attaches media for multimodal analysis.
- Browser tab titles, URLs, Accessibility Tree snapshots, and browser-control tool results only when the user enables Browser Control and selects or uses a controlled tab.
- Normal web pages may be modified locally to display the DS++ Chat floating launcher. The launcher does not automatically read or send page body content.
- DeepSeek session data available to the web page, only when needed to submit user-requested automation or continuation prompts.
- DeepSeek conversation history, individual message text, saved items, generated artifact content, and attachment metadata when the user explicitly starts a local export or download.

DeepSeek++ More does not intentionally collect financial information, health information, precise location, payment information, or browsing history.

## 3. How Data Is Used

DeepSeek++ More uses handled data only to provide its disclosed features:

- Store and retrieve local memories, skills, project context, saved items, presets, settings, tasks, MCP configuration, and tool history.
- Select relevant memories, skills, projects, saved items, presets, and tool definitions for use in DeepSeek prompts.
- Detect tool-call markup in DeepSeek responses, execute enabled tools, and render readable tool results.
- Return selected tool results to the active DeepSeek conversation when the user enables tool execution.
- Send side-panel chat messages to the official DeepSeek API when the user configures a DeepSeek API Key.
- Show a user-controllable DS++ Chat floating launcher on normal web pages. The launcher can be turned off from Appearance settings and does not automatically send page body content.
- Attach user-selected images to a side-panel web chat message in Vision mode when the user explicitly selects or pastes images and sends that message.
- Analyze user-selected images or videos through the local Multimodal Native Host and the user's configured OpenAI/Gemini-compatible endpoints when the user attaches media for multimodal analysis.
- Run automation tasks created by the user.
- Export the user's DeepSeek conversation history, individual messages, saved items, or generated artifacts into local files when the user starts an export or download.
- Sync memories, custom skills, and presets to a user-configured WebDAV server, Google Drive app data area, or OneDrive app folder when sync is enabled.
- Connect to user-configured MCP endpoints or Native Messaging hosts when the user tests or executes those tools, including reading supporting files from a local Skill folder selected by the user when that Skill requires them.
- Control a selected browser tab through Chrome's debugger API when the user enables Browser Control and the AI calls an enabled `browser_*` tool.

The extension does not use handled data for advertising, user profiling for advertising, credit decisions, or unrelated analytics.

## 4. Local Storage

Most extension data is stored locally in the user's browser using extension storage and IndexedDB. This includes memories, custom skills, project context, saved items, presets, settings, automation tasks, MCP configuration, DeepSeek API Key, multimodal API settings, and tool execution history.

Conversation export artifacts, saved-item exports, and generated downloadable files are created only after the user starts an export or download and are saved through the browser's local download flow. DeepSeek++ More does not upload exported files.

Local data remains in the browser until the user edits or deletes it, clears browser extension data, or uninstalls the extension.

## 5. Data Transfer and Sharing

DeepSeek++ More does not operate a backend service for collecting extension data. The extension does not sell user data.

Data may be transferred only as part of user-facing features:

- To DeepSeek, when the user sends a chat message, attaches selected images in side-panel Vision mode, runs an automation task, or allows the extension to return selected context or tool results to a DeepSeek conversation.
- To the official DeepSeek API, when the user configures a DeepSeek API Key and sends a side-panel chat message.
- To Bing (`cn.bing.com` or `www.bing.com`), when the user invokes the built-in web search tool; the search query is sent to Bing and the resulting titles, links, and snippets are returned to the active DeepSeek conversation.
- To the local Multimodal Native Host, and from that host to user-configured OpenAI/Gemini-compatible endpoints, when the user attaches images or videos for multimodal analysis.
- To a WebDAV server, Google Drive app data area, or OneDrive app folder selected and configured by the user, when the user enables sync.
- To MCP endpoints selected and configured by the user, when the user tests or executes MCP tools.
- To a local Native Messaging host configured by the user, when local/native MCP or multimodal tooling is enabled.
- To DeepSeek as text tool results, when Browser Control returns the selected tab's Accessibility Tree snapshot or action result to the active conversation.

The extension does not transfer user data to advertising platforms, data brokers, information resellers, or unrelated third parties.

## 6. Permissions

DeepSeek++ More requests these Chrome permissions for the following purposes:

- `storage`: store local memories, skills, project context, saved items, presets, settings, automation tasks, MCP configuration, and tool history.
- `alarms`: schedule and wake user-created automation tasks.
- `contextMenus`: let the user send selected page text to side-panel chat or a configured right-click scenario.
- `nativeMessaging`: connect to user-configured local MCP/native hosts, including the optional Shell and Multimodal Native Hosts.
- `offscreen`: host an invisible extension document that runs isolated JavaScript, TypeScript, Python, and HTML sandbox requests outside the DeepSeek page, preventing the chat tab from being blocked by sandbox execution.
- `debugger`: attach to a user-selected browser tab only when Browser Control is enabled, so DeepSeek++ More can read an Accessibility Tree snapshot and perform user-visible browser actions requested through `browser_*` tools.
- `tabs`: list browser tabs and select the target tab for Browser Control. Tab group names may be shown when the browser exposes them without an additional required permission.
- `identity`: start the user-approved Google Drive or OneDrive OAuth sign-in flow when the user enables one of those sync providers.
- `sidePanel`: provide the extension management UI in Chrome's side panel.
- `<all_urls>` content script match: show the optional DS++ Chat floating launcher on normal web pages. The launcher skips DeepSeek pages to avoid duplicate UI, can be turned off from Appearance settings, and does not automatically read or send page body content.
- `*://chat.deepseek.com/*`: run on the DeepSeek web app so the extension can apply user-selected context, render tool results, export user-requested conversation history, support local downloads, and support automation inside DeepSeek conversations.
- `https://api.deepseek.com/*`: send side-panel chat requests to the official DeepSeek API when the user configures an API Key.
- `*://cn.bing.com/*` and `*://www.bing.com/*`: run the built-in web search tool only when the user requests a search, then return the resulting titles, links, and snippets to the active DeepSeek conversation.
- `https://accounts.google.com/*`, `https://oauth2.googleapis.com/*`, and `https://www.googleapis.com/*`: complete user-approved Google Drive sync sign-in and read/write the extension's sync file in the user's Google Drive app data area.
- `https://login.microsoftonline.com/*` and `https://graph.microsoft.com/*`: complete user-approved OneDrive sync sign-in and read/write the extension's sync file in the user's OneDrive app folder.
- Optional `http://*/*` and `https://*/*` host permissions: connect to user-configured WebDAV or MCP endpoints. These permissions are requested for specific origins when needed.

## 7. User Controls

Users can manage extension data from the DeepSeek++ More side panel. Users can:

- View, create, edit, export, import, and delete memories.
- Create, edit, attach, and remove project context and project files.
- Create, search, insert, export, and delete saved snippets and bookmarks.
- Export DeepSeek conversation history as local HTML, Markdown, PDF, or image-manifest files.
- Export individual messages, saved items, and generated artifacts through local browser downloads.
- Create, edit, and delete custom skills and prompt presets.
- Change prompt controls such as memory injection, preset cadence, and response language.
- Enable, disable, test, edit, and delete MCP servers.
- Configure or remove multimodal API settings, install and enable the Multimodal Native Host, and attach or remove selected media before sending.
- Switch side-panel web chat between Default, Expert, and Vision modes, and attach or remove selected Vision images before sending.
- Enable or disable Browser Control, select the target tab, tune snapshot budgets, and detach from the current tab.
- Create, pause, run, edit, and delete automation tasks.
- Configure or remove the DeepSeek API Key used for official API side-panel chat.
- Turn the normal-page DS++ Chat floating launcher on or off from Appearance settings.
- Configure or remove WebDAV, Google Drive, or OneDrive sync settings.
- Clear or change visual settings such as background and pet preferences.
- Remove the extension or clear browser extension data through Chrome.

## 8. Security

DeepSeek++ More stores extension data locally in the browser by default. Users should only configure trusted WebDAV servers, cloud sync accounts, MCP endpoints, and Native Messaging hosts. HTTPS endpoints are recommended for remote WebDAV and MCP connections.

The extension does not hardcode third-party credentials. Optional credentials, including DeepSeek API Key, OpenAI/Gemini API keys, WebDAV credentials, and Google/Microsoft OAuth app credentials or sync tokens, are provided by the user and stored locally for the features the user configures.

## 9. Chrome Web Store Limited Use

DeepSeek++ More complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data handled by the extension is used only for the extension's disclosed, user-facing features.

DeepSeek++ More does not:

- Sell user data.
- Use user data for personalized advertising.
- Transfer user data to advertising platforms, data brokers, or information resellers.
- Use user data for purposes unrelated to floating chat, memory, skills, tools, side-panel Vision image attachments, multimodal analysis, automation, sync, or extension settings.

## 10. Children

DeepSeek++ More is not directed to children and does not knowingly collect personal information from children.

## 11. Changes to This Policy

This Privacy Policy may be updated when extension features, permissions, or data practices change. The effective date at the top of this document will be updated when material changes are made.

## 12. Contact

For privacy or support questions, open an issue at:

`https://github.com/zhu1090093659/deepseek-pp/issues`

---

# DeepSeek++ More 隐私政策（中文参考）

生效日期：2026-07-14

DeepSeek++ More 是一个浏览器扩展，用于增强 DeepSeek 对话工作流，提供用户可控的普通网页悬浮聊天、长期记忆、技能、项目上下文、保存项、提示词预设、MCP 工具、侧边栏识图图片附件、多模态媒体分析、浏览器控制工具、内联工具执行、本地导出、可下载产物、可选同步、自动化任务和可选侧边栏对话。

本隐私政策说明扩展会处理哪些数据、如何使用这些数据、何时可能传输数据，以及用户可以如何控制自己的数据。

## 1. 单一用途

DeepSeek++ More 的单一用途是增强 DeepSeek 对话工作流，提供由用户控制的普通网页悬浮聊天、记忆、技能、项目、保存项、预设、工具、侧边栏识图图片附件、多模态媒体分析、浏览器控制、本地导出、可选同步、自动化和可选侧边栏对话能力。

## 2. 扩展处理的数据

DeepSeek++ More 只会在提供用户可见功能所需时处理以下数据：

- DeepSeek 对话内容，包括 `chat.deepseek.com` 上的提示词、模型回复和工具调用文本。
- 用户创建的扩展数据，包括记忆、技能、用户选择的本地 Skill 支持文件、项目上下文、项目文件或资料说明、保存片段、书签、提示词预设、MCP 服务设置、自动化任务、主题设置、背景设置、宠物设置和工具执行历史。
- 用户配置官方 API 侧边栏对话时提供的 DeepSeek API Key。
- 用户配置多模态图片或视频分析时提供的 OpenAI 和 Gemini API Key、模型名称和请求地址。
- 用户配置同步时提供的同步设置，包括 WebDAV 服务器地址、用户名、密码、远程路径、Google Drive 或 OneDrive OAuth 应用凭据、同步授权令牌、同步提供方选择和同步状态。
- 用户配置 MCP 工具时提供的 MCP 配置，包括端点地址、请求头、环境变量、本机 host 名称、工具元数据和工具结果。
- 用户在侧边栏识图模式中明确附加图片时选择的图片文件、文件名、MIME 类型、文件大小、上传状态和 DeepSeek 文件引用。
- 用户明确附加媒体进行多模态分析时选择的图片或视频文件、文件名、MIME 类型、文件大小和分析结果。
- 用户启用浏览器控制并选择或使用受控标签页时处理的浏览器标签页标题、URL、Accessibility Tree 快照和浏览器控制工具结果。
- 普通网页可能会被本地修改以显示 DS++ Chat 悬浮入口；该入口不会自动读取或发送页面正文。
- DeepSeek 网页会话中可用的会话数据，仅在执行用户请求的自动化任务或续跑提示词时使用。
- 用户明确开始本地导出或下载时读取的 DeepSeek 对话历史、单条消息文本、保存项、生成产物内容和附件元数据。

DeepSeek++ More 不会有意收集金融信息、健康信息、精确位置、支付信息或浏览历史。

## 3. 数据用途

DeepSeek++ More 只会将数据用于已经披露的功能：

- 保存和读取本地记忆、技能、项目上下文、保存项、预设、设置、任务、MCP 配置和工具历史。
- 为 DeepSeek 提示词选择并使用相关记忆、技能、项目、保存项、预设和工具定义。
- 识别 DeepSeek 回复中的工具调用标记，执行已启用的工具，并展示可读的工具结果。
- 在用户启用工具执行时，将选定工具结果回传到当前 DeepSeek 对话。
- 用户配置 DeepSeek API Key 时，将侧边栏对话消息发送到 DeepSeek 官方 API。
- 在普通网页显示用户可控的 DS++ Chat 悬浮入口。该入口可在外观设置中关闭，且不会自动发送页面正文。
- 用户在侧边栏识图模式中明确选择或粘贴图片并发送该消息时，将用户选择的图片附加到本次 DeepSeek 对话。
- 用户附加媒体进行多模态分析时，通过本机多模态 Native Host 和用户配置的 OpenAI/Gemini 兼容端点分析用户选择的图片或视频。
- 运行用户创建的自动化任务。
- 在用户主动开始导出或下载时，将 DeepSeek 对话历史、单条消息、保存项或生成产物导出为本地文件。
- 在用户启用同步时，将记忆、自定义技能和预设同步到用户配置的 WebDAV 服务器、Google Drive 应用数据空间或 OneDrive 应用文件夹。
- 在用户测试或执行工具时，连接用户配置的 MCP 端点或 Native Messaging host；当本地 Skill 需要支持文件时，仅从用户选择的 Skill 目录按需读取这些文件。
- 用户启用浏览器控制且 AI 调用已启用的 `browser_*` 工具时，通过 Chrome debugger API 控制用户选中的浏览器标签页。

扩展不会将数据用于广告、广告画像、信用决策或无关分析。

## 4. 本地存储

大多数扩展数据默认通过浏览器扩展存储和 IndexedDB 保存在用户浏览器本地，包括记忆、自定义技能、项目上下文、保存项、预设、设置、自动化任务、MCP 配置、DeepSeek API Key、多模态 API 设置和工具执行历史。

对话导出文件、保存项导出和生成的可下载文件只会在用户主动开始导出或下载后生成，并通过浏览器本地下载流程保存。DeepSeek++ More 不会上传导出的文件。

本地数据会保留到用户编辑或删除、清除浏览器扩展数据，或卸载扩展为止。

## 5. 数据传输与共享

DeepSeek++ More 不运营用于收集扩展数据的后台服务。扩展不会出售用户数据。

数据只会在用户可见功能需要时传输：

- 当用户发送聊天消息、在侧边栏识图模式附加用户选择的图片、运行自动化任务，或允许扩展将选定上下文/工具结果回传到 DeepSeek 对话时，传输给 DeepSeek。
- 用户配置 DeepSeek API Key 并发送侧边栏对话时，传输给 DeepSeek 官方 API。
- 当用户调用内置联网搜索工具时，将搜索查询发送到 Bing（`cn.bing.com` 或 `www.bing.com`），并把结果标题、链接和摘要返回到当前 DeepSeek 对话。
- 用户附加图片或视频进行多模态分析时，传输给本机多模态 Native Host，并由该 host 传输给用户配置的 OpenAI/Gemini 兼容端点。
- 当用户启用同步时，传输给用户选择并配置的 WebDAV 服务器、Google Drive 应用数据空间或 OneDrive 应用文件夹。
- 当用户测试或执行 MCP 工具时，传输给用户选择并配置的 MCP 端点。
- 当用户启用本机/Native MCP 或多模态工具时，传输给用户配置的本地 Native Messaging host。
- 当浏览器控制返回受控标签页的 Accessibility Tree 快照或动作结果时，作为文本工具结果传输给 DeepSeek 当前对话。

扩展不会将用户数据传输给广告平台、数据经纪商、信息转售商或无关第三方。

## 6. 权限说明

DeepSeek++ More 请求以下 Chrome 权限：

- `storage`：保存本地记忆、技能、项目上下文、保存项、预设、设置、自动化任务、MCP 配置和工具历史。
- `alarms`：调度和唤醒用户创建的自动化任务。
- `contextMenus`：让用户把网页选中文本发送到侧边栏对话或已配置的右键场景。
- `nativeMessaging`：连接用户配置的本地 MCP/native host，包括可选的 Shell 和多模态 Native Host。
- `offscreen`：提供不可见的扩展文档，用于在 DeepSeek 页面之外隔离运行 JavaScript、TypeScript、Python 和 HTML 沙箱请求，避免沙箱执行阻塞聊天标签页。
- `debugger`：仅在用户启用浏览器控制后附着到用户选择的浏览器标签页，用于读取 Accessibility Tree 快照并执行用户可见的 `browser_*` 工具动作。
- `tabs`：列出浏览器标签页并选择浏览器控制的目标标签页；如果浏览器无需额外必需权限即可提供标签组名称，界面可能显示该信息帮助用户识别目标标签页。
- `identity`：当用户启用 Google Drive 或 OneDrive 同步时，启动由用户批准的 OAuth 登录流程。
- `sidePanel`：在 Chrome 侧边栏中提供扩展管理界面。
- `<all_urls>` 内容脚本匹配：在普通网页显示可选 DS++ Chat 悬浮入口。该入口会跳过 DeepSeek 页面以避免重复界面，可在外观设置中关闭，且不会自动读取或发送页面正文。
- `*://chat.deepseek.com/*`：在 DeepSeek 网页版中运行，用于应用用户选择的上下文、展示工具结果、导出用户主动请求的对话历史、支持本地下载，并支持 DeepSeek 对话内的自动化。
- `https://api.deepseek.com/*`：当用户配置 API Key 时，将侧边栏对话请求发送到 DeepSeek 官方 API。
- `*://cn.bing.com/*` 和 `*://www.bing.com/*`：仅在用户请求联网搜索时运行内置搜索工具，并把结果标题、链接和摘要返回到当前 DeepSeek 对话。
- `https://accounts.google.com/*`、`https://oauth2.googleapis.com/*` 和 `https://www.googleapis.com/*`：完成用户批准的 Google Drive 同步登录，并在用户的 Google Drive 应用数据空间读写扩展同步文件。
- `https://login.microsoftonline.com/*` 和 `https://graph.microsoft.com/*`：完成用户批准的 OneDrive 同步登录，并在用户的 OneDrive 应用文件夹读写扩展同步文件。
- 可选的 `http://*/*` 和 `https://*/*` 主机权限：连接用户配置的 WebDAV 或 MCP 端点。扩展只会在需要时针对具体来源请求权限。

## 7. 用户控制

用户可以在 DeepSeek++ More 侧边栏中管理扩展数据，包括：

- 查看、创建、编辑、导出、导入和删除记忆。
- 创建、编辑、附加和移除项目上下文与项目文件。
- 创建、搜索、插入、导出和删除保存片段与书签。
- 将 DeepSeek 对话历史导出为本地 HTML、Markdown、PDF 或图片清单文件。
- 通过浏览器本地下载导出单条消息、保存项和生成产物。
- 创建、编辑和删除自定义技能和提示词预设。
- 调整记忆注入、预设注入频率、回复语言等提示词控制。
- 启用、禁用、测试、编辑和删除 MCP 服务。
- 配置或移除多模态 API 设置，安装和启用多模态 Native Host，并在发送前附加或移除选中的媒体。
- 在侧边栏网页对话中切换默认、专家和识图模式，并在发送前附加或移除选择的识图图片。
- 启用或停用浏览器控制、选择目标标签页、调整快照预算，并从当前标签页断开附着。
- 创建、暂停、运行、编辑和删除自动化任务。
- 配置或移除用于官方 API 侧边栏对话的 DeepSeek API Key。
- 在外观设置中启用或停用普通网页 DS++ Chat 悬浮入口。
- 配置或移除 WebDAV、Google Drive 或 OneDrive 同步设置。
- 清除或修改背景、宠物等视觉设置。
- 通过 Chrome 卸载扩展或清除浏览器扩展数据。

## 8. 安全

DeepSeek++ More 默认将扩展数据保存在用户浏览器本地。用户应只配置可信的 WebDAV 服务器、云同步账户、MCP 端点和 Native Messaging host。远程 WebDAV 和 MCP 连接建议使用 HTTPS。

扩展不会硬编码第三方凭据。包括 DeepSeek API Key、OpenAI/Gemini API Key、WebDAV 凭据以及 Google/Microsoft OAuth 应用凭据或同步令牌在内的可选凭据由用户提供，并仅为用户配置的功能本地保存和使用。

## 9. Chrome Web Store Limited Use

DeepSeek++ More 遵守 Chrome Web Store 用户数据政策，包括 Limited Use 要求。扩展处理的数据只会用于已经披露的用户可见功能。

DeepSeek++ More 不会：

- 出售用户数据。
- 将用户数据用于个性化广告。
- 将用户数据传输给广告平台、数据经纪商或信息转售商。
- 将用户数据用于与记忆、技能、工具、侧边栏识图图片附件、多模态分析、自动化、同步或扩展设置无关的用途。

## 10. 儿童

DeepSeek++ More 不面向儿童，也不会有意收集儿童个人信息。

## 11. 政策变更

当扩展功能、权限或数据处理方式发生变化时，本隐私政策可能会更新。发生重大变更时，文档顶部的生效日期会同步更新。

## 12. 联系方式

如有隐私或支持问题，请在以下地址提交 issue：

`https://github.com/zhu1090093659/deepseek-pp/issues`
