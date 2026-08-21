const fs = require('fs');
let content = fs.readFileSync('scripts/i18n-coverage-audit.mjs', 'utf-8');

const toRemove = [
  { path: 'entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx', includes: '刷新状态' },
  { path: 'entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx', includes: '⚙️ 终端安装向导 (Mac / Linux / Windows)' },
  { path: 'entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx', includes: '已安装' },
  { path: 'entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx', includes: '请在你的电脑终端中执行以下命令' },
  { path: 'entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx', includes: '配置完成后，请点击右上角的 [刷新] 按钮。' }
];

for (const rm of toRemove) {
  const regex = new RegExp(`\\s*\\{\\s*path: '${rm.path.replace(/\//g, '\\/')}',\\s*includes: '${rm.includes.replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\(/g, '\\(').replace(/\)/g, '\\)')}',\\s*reason: '[^']+',\\s*\\},`, 'g');
  content = content.replace(regex, '');
}

fs.writeFileSync('scripts/i18n-coverage-audit.mjs', content);
