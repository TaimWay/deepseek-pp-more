const fs = require('fs');

let content = fs.readFileSync('scripts/i18n-coverage-audit.mjs', 'utf-8');

// The stale items to remove
const staleIncludes = [
  '问问 DeepSeek：选中文本',
  '问问 DeepSeek',
  '帮你解释网站',
  '点我询问',
  '有什么想聊的吗？',
  '点击开启快捷问答',
  'button[aria-label*="上传"]',
  '联网搜索 (扩展)',
  '启用扩展联网搜索增强',
  '允许调用 Agent Call',
  '记忆管理'
];

for (const inc of staleIncludes) {
  // Regex to match the object in the lineAllowlist array
  // Example:
  //  {
  //    path: 'entrypoints/content.ts',
  //    includes: '问问 DeepSeek',
  //    reason: 'in-page pet hover tooltip',
  //  },
  // Since there are multiple "问问 DeepSeek" related ones, we match carefully.
  // Actually, we can parse it, or just use string replacement.
}

// Better way to manipulate:
const startIndex = content.indexOf('const lineAllowlist = [');
const endIndex = content.indexOf('];', startIndex);

const before = content.substring(0, startIndex);
let arrayStr = content.substring(startIndex, endIndex + 2);
const after = content.substring(endIndex + 2);

const newItems = [
  {
    path: 'entrypoints/background/chat-runtime-service.ts',
    includes: '> 正在执行操作',
    reason: 'inline agent tool call status text injection'
  },
  {
    path: 'entrypoints/background.ts',
    includes: '问问 DeepSeek："%s"',
    reason: 'context menu title for selection ask in background service worker'
  },
  {
    path: 'entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx',
    includes: '刷新状态',
    reason: 'Native Host installation UI text'
  },
  {
    path: 'entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx',
    includes: '⚙️ 终端安装向导 (Mac / Linux / Windows)',
    reason: 'Native Host installation UI text'
  },
  {
    path: 'entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx',
    includes: '已安装',
    reason: 'Native Host installation UI text'
  },
  {
    path: 'entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx',
    includes: '请在你的电脑终端中执行以下命令',
    reason: 'Native Host installation UI text'
  },
  {
    path: 'entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx',
    includes: '配置完成后，请点击右上角的 [刷新] 按钮。',
    reason: 'Native Host installation UI text'
  }
];

// Instead of parsing, we can just remove blocks containing the stale strings.
for (const inc of staleIncludes) {
  const regex = new RegExp(`\\{\\s*path: '[^']+',\\s*includes: '${inc.replace(/\\[/g, '\\\\[').replace(/\\]/g, '\\\\]').replace(/\\?/g, '\\\\?')}',\\s*reason: '[^']+',?\\s*\\},?\\s*`, 'g');
  arrayStr = arrayStr.replace(regex, '');
}

// Add new items
let newItemsStr = newItems.map(item => `  {\n    path: '${item.path}',\n    includes: '${item.includes}',\n    reason: '${item.reason}',\n  },`).join('\n');

arrayStr = arrayStr.replace(/];/, newItemsStr + '\n];');

fs.writeFileSync('scripts/i18n-coverage-audit.mjs', before + arrayStr + after);
