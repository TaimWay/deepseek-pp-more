# Chrome Web Store Listing Draft

Last updated: 2026-08-08

## Package

- Current version: `1.14.0`
- Upload package: `dist/deepseek-plus-plus-1.14.0-chrome.zip`
- Category: Productivity
- Default language: English (United States)
- Homepage URL: `https://github.com/zhu1090093659/deepseek-pp`
- Support URL: `https://github.com/zhu1090093659/deepseek-pp/issues`
- Privacy policy URL: publish `docs/chrome-web-store/privacy-policy.md` and use its public URL.

## Store Listing

### Name

DeepSeek++ More

### Short Description

Bilingual memory, floating chat, Skills, MCP tools, multimodal media, automation, Browser Control, and inline tools for DeepSeek.

### Detailed Description

DeepSeek++ More enhances the DeepSeek web app with English and Simplified Chinese support, floating chat on normal web pages, persistent memory, reusable Skills, project context, saved snippets, built-in web search and page fetch tools, system prompt presets, MCP tool execution, Vision mode image attachments, multimodal image/video analysis, optional Browser Control, local conversation export, downloadable artifacts, optional sync, and scheduled automation.

Use it to keep useful facts across conversations, work in English or Simplified Chinese, open a lightweight DS++ Chat window from normal web pages, attach project material when a task needs context, search the web when current information is needed, fetch page text for summarization, trigger custom or imported Skills with slash commands, connect user-configured MCP tools, attach user-selected images in side-panel Vision mode, analyze user-selected images or videos through a local Multimodal Native Host, operate a user-selected browser tab after Browser Control is enabled, save and insert reusable snippets, export conversations locally, optionally sync extension data through WebDAV, Google Drive, or OneDrive, and let DeepSeek continue a task after tool results are returned. The extension runs on chat.deepseek.com for DeepSeek-specific enhancements and can show a user-controllable floating chat launcher on other web pages. The side panel manages memories, Skills, projects, saved items, presets, built-in tools, multimodal API settings, Browser Control, MCP servers, automation tasks, sync settings, and visual preferences.

Key features:

- Long-term memory for user profile, feedback, topic context, and references.
- English and Simplified Chinese UI, tool guidance, built-in Skill behavior, and continuation prompts.
- Floating DS++ Chat launcher on normal web pages, with an Appearance setting to turn it off.
- Project context and downloadable artifacts for reusable task materials and generated files.
- Saved snippets and bookmarks with search, prompt insertion, and Markdown/JSON export.
- Built-in web search and page fetch tools for current information and page summarization.
- Skill system with slash-command activation, bundled workflow Skills, user-defined prompts, and local or GitHub Skill imports.
- MCP tool management for user-configured remote or local tool services.
- Side-panel Vision mode for attaching user-selected images to the DeepSeek conversation only when the user sends the message.
- Multimodal media workflow for analyzing user-selected images through OpenAI and videos through Gemini after the user installs and enables the Multimodal Native Host.
- Optional Browser Control for a user-selected tab, with text snapshots and visible browser actions after the user enables it.
- Inline tool execution UI that keeps execution traces readable without exposing implementation markers.
- Agent-style continuation that can pass tool results back into the same conversation.
- Local export for DeepSeek conversation history, with readable HTML, Markdown, PDF, and image-manifest outputs.
- Scheduled automation tasks that can run manually or on a timer.
- Optional sync for memories, skills, and presets through WebDAV, Google Drive, or OneDrive.
- Local customization, including DeepSeek page background, floating chat visibility, and a small floating DeepSeek pet.

DeepSeek++ More does not operate a backend service for extension data. User configuration and extension data are stored locally in the browser unless the user explicitly enables WebDAV, Google Drive, or OneDrive sync, connects a user-configured MCP endpoint/native host, sends selected images to DeepSeek by using side-panel Vision mode, or sends selected media to a user-configured multimodal provider through the local Multimodal Native Host. The floating chat launcher does not automatically read or send page body content; content enters chat only when the user types, sends, or uses a selected-text action.

## zh-CN Localization Draft

### Name

DeepSeek++ More

### Short Description

为 DeepSeek 增加中英文体验、悬浮聊天、长期记忆、Skill、MCP 工具、多模态媒体、自动化任务、浏览器控制和类原生工具执行体验。

### Detailed Description

DeepSeek++ More 为 DeepSeek 网页版增加中英文支持、普通网页悬浮聊天、长期记忆、Skill 技能、项目上下文、保存片段、内置网络搜索和网页获取工具、系统提示词预设、MCP 工具调用、识图模式图片附件、图片/视频多模态分析、可选浏览器控制、本地对话导出、可下载产物、可选同步和自动化任务。

你可以用它跨对话保存有用信息，在中文或英文环境中使用一致的界面和工具提示，在普通网页打开轻量 DS++ Chat 窗口，在任务需要背景时附加项目资料，在需要实时信息时搜索互联网，获取网页文本用于总结，通过 `/skill` 快速切换工作模式，导入本机或 GitHub Skill，连接自己配置的 MCP 工具，在侧边栏识图模式中附加用户选择的图片，通过本机多模态 Native Host 分析用户选择的图片或视频，在启用浏览器控制后操作用户选定的标签页，保存并插入常用片段，本地导出对话，可选择通过 WebDAV、Google Drive 或 OneDrive 同步扩展数据，并让 DeepSeek 在工具结果返回后继续推进任务。扩展在 chat.deepseek.com 提供 DeepSeek 专属增强，也可在其他网页显示用户可控的悬浮聊天入口。侧边栏用于管理记忆、Skill、项目、保存项、预设、内置工具、多模态 API 设置、浏览器控制、MCP 服务、自动化任务、同步设置和个性化选项。

核心功能：

- 长期记忆：保存用户画像、行为反馈、话题上下文和参考资料。
- 中英文体验：界面、工具说明、内置 Skill 行为和续跑提示可跟随所选语言。
- 普通网页 DS++ Chat 悬浮入口，可在外观设置中关闭。
- 项目上下文和可下载产物：复用任务资料并保存生成文件。
- 保存片段和书签：支持搜索、插入 prompt，并导出 Markdown/JSON。
- 内置网络工具：支持联网搜索和网页文本获取。
- Skill 系统：支持斜杠命令触发内置工作流、自定义、本机导入或 GitHub 导入技能。
- MCP 工具：支持用户配置的远程或本机工具服务。
- 侧边栏识图模式：只在用户发送消息时，把用户选择的图片附加到 DeepSeek 对话。
- 多模态媒体：用户安装并启用多模态 Native Host 后，可通过 OpenAI 分析图片、通过 Gemini 分析视频。
- 可选浏览器控制：用户启用并选择目标标签页后，可提供文本快照和可见浏览器动作。
- 工具执行展示：隐藏原始调用格式，展示清晰的执行结果。
- Agent 式续跑：工具结果可回传到同一会话继续生成。
- 本地对话导出：支持将 DeepSeek 对话记录导出为 HTML、Markdown、PDF 和图片清单。
- 自动化任务：支持手动触发和定时触发。
- 可选同步：通过 WebDAV、Google Drive 或 OneDrive 同步记忆、技能和预设。
- 个性化设置：支持 DeepSeek 页面背景、悬浮聊天显示和悬浮小鲸鱼。

DeepSeek++ More 不运营用于收集扩展数据的后台服务。除非用户主动开启 WebDAV、Google Drive 或 OneDrive 同步、配置 MCP 端点/本机 host、在侧边栏识图模式中把选中的图片发送给 DeepSeek，或通过本机多模态 Native Host 把选中的媒体发送给用户配置的多模态服务，否则扩展数据保存在浏览器本地。悬浮聊天入口不会自动读取或发送页面正文；只有用户主动输入、发送或使用选中文本操作时，内容才进入聊天流程。

## Assets

Mandatory assets prepared in this repo:

- Extension icon: `assets/chrome-web-store-icon-128.png` (`128x128`)
- Small promotional image: `assets/chrome-web-store-promo-small-440x280.png` (`440x280`)
- Top promotional image: `assets/chrome-web-store-promo-top-1400x560.png` (`1400x560`)
- Screenshot: `docs/chrome-web-store/assets/screenshot-inline-tools-1280x800.png` (`1280x800`)

Optional existing screenshots for future store-gallery polish:

- `assets/screenshot-inline-tools.png`
- `assets/screenshot-sidepanel-memory.png`
- `assets/screenshot-sidepanel-saved.png`
- `assets/screenshot-sidepanel-projects.png`
- `assets/screenshot-sidepanel-skill.png`
- `assets/screenshot-sidepanel-mcp.png`
- `assets/screenshot-sidepanel-tools.png`
- `assets/screenshot-sidepanel-browser.png`
- `assets/screenshot-sidepanel-automation.png`
- `assets/screenshot-sidepanel-settings.png`
