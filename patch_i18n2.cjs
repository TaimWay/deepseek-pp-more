const fs = require('fs');

let content = fs.readFileSync('scripts/i18n-coverage-audit.mjs', 'utf-8');

const toRemove = [
`  {
    path: 'entrypoints/content.ts',
    includes: 'button[aria-label*="上传"]',
    reason: 'DeepSeek DOM upload button selector',
  },`,
`  {
    path: 'entrypoints/content.ts',
    includes: '联网搜索 (扩展)',
    reason: 'input toolbox extension search toggle chip',
  },`,
`  {
    path: 'entrypoints/content.ts',
    includes: '启用扩展联网搜索增强',
    reason: 'input toolbox extension search tooltip',
  },`,
`  {
    path: 'entrypoints/content.ts',
    includes: '允许调用 Agent Call',
    reason: 'input toolbox agent call toggle button and tooltip',
  },`,
`  {
    path: 'entrypoints/content.ts',
    includes: '记忆管理',
    reason: 'input toolbox memory management button and tooltip',
  },`
];

for (const rm of toRemove) {
  content = content.replace(rm, '');
}

fs.writeFileSync('scripts/i18n-coverage-audit.mjs', content);
