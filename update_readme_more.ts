import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('README.md', 'utf8');

// 1. Replace the GitHub URLs with the user's fork repository
content = content.replace(/zhu1090093659\/deepseek-pp/g, 'TaimWay/deepseek-pp-more');

// 2. Enhance the "DeepSeek++ More" specific feature section
const moreFeatures = `
## 🔥 DeepSeek++ More 独占特性

由于本项目是基于原版 \`DeepSeek++\` 的激进增强分支（Fork），我们在原版强大的“工具执行与记忆”底座上，新增了以下独家功能：

- **OpenAI 兼容中转（API Relay）**：内置并打包了 HTTP/WebSocket 中转服务器。你可以让任何支持 OpenAI 接口格式的外部软件（如其他 Agent、IDE 插件），无缝白嫖 DeepSeek 网页版的强大推理能力。
- **全网右键唤起**：任何页面选中文字，一键右键“问问 DeepSeek”或者直接唤出侧边栏悬浮面板，彻底打破对话窗口的边界。
- **极致的沉浸式对话 UI**：剥离并隐藏了烦人的底层 XML 工具调用标签，重新设计了清爽的 \`> 正在执行操作: [工具名]...\` 状态指示器；支持 Github Flavored Markdown（原生表格与 HTML）渲染。
- **深度模式防火墙突围**：原版 DeepSeek Web 会在 Expert 模式下粗暴屏蔽外部 \`http/https\` 链接。本项目独家实现了底层链接混淆与协议转义，在工具抓取网页后能完美将结果喂给模型，摆脱降智拦截。
- **跨平台一键部署包**：发布了专属的 \`deepseek-ppmore-ext-apirelay\` NPM 包，Windows/Mac/Linux 均可通过一条命令全自动拉起 Native Host 与 Relay 守护进程，并在扩展设置页提供实时的 PID 与可视化连通性监控。
`;

// Insert it right after the 产品定位 section
content = content.replace(
  /## 目录/,
  moreFeatures + '\n## 目录'
);

writeFileSync('README.md', content, 'utf8');
