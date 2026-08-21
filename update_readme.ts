import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('README.md', 'utf8');

const additionalRows = `| 开放 API 与中转 | 新增跨平台 NPM 包 \`deepseek-ppmore-ext-apirelay\`，一键安装 Native Host 与 API 中转服务器；彻底修复中转守护进程 PID 误判与轮回重启 BUG；UI 新增安装向导、连接状态指示与自动刷新。 |
| 快捷提问 (Ask) | 修复全局右键菜单“问问 DeepSeek”的触发逻辑限制；支持直接唤起对话面板；增强外部页面调用的工具过滤。 |
| UI 体验增强 | 侧边栏对话流式输出彻底过滤工具执行的丑陋 XML 标签；新增精美的 \`> 正在执行操作: [工具名]...\` 执行指示器；支持 Github Flavored Markdown（表格、HTML标签）原生渲染。 |
| 联网与突破 | 针对“深度思考模式（Expert Mode）”屏蔽网址链接的限制，在工具回传阶段实现 \`http/https\` 协议嗅探与自动转义，完美规避官方防火墙阻断。 |`;

// Insert after the last row of the 1.14.0 table
content = content.replace(
  /\| 权限变化 \| Chrome、Edge 和 Firefox 均不新增浏览器权限。 \|/,
  `| 权限变化 | Chrome、Edge 和 Firefox 均不新增浏览器权限。 |\n${additionalRows}`
);

// Optional: also update the header description text
content = content.replace(
  /1\.14\.0 是内联智能体交付体验升级与流式稳定性修复版本：最终回答与图表、代码产物改由 DeepSeek 原生渲染，推理过程分步展示，流式传输与代码块渲染更稳定。/,
  '1.14.0 是内联智能体交互与系统整合升级版本：不仅提升了原生流式渲染稳定性，还重构了本地 API 中转与 Native Host 安装体验，强化了右键快捷提问，并在侧边栏对话中彻底隐藏工具 XML 标签以增强沉浸感。'
);

writeFileSync('README.md', content, 'utf8');
