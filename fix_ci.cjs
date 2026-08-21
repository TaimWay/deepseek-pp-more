const fs = require('fs');

// 1. Fix shell-host-external-contract.test.ts by making packages/deepseek-pp-host/package.json match root version 1.15.0
const hostPkgPath = 'packages/deepseek-pp-host/package.json';
const hostPkg = JSON.parse(fs.readFileSync(hostPkgPath, 'utf8'));
hostPkg.version = '1.15.0';
fs.writeFileSync(hostPkgPath, JSON.stringify(hostPkg, null, 2) + '\n');

// 2. Fix whats-new-panel.test.ts
const testPath = 'tests/whats-new-panel.test.ts';
let testContent = fs.readFileSync(testPath, 'utf8');
testContent = testContent.replace(
  /expect\(container\.textContent\)\.toContain\('浏览器控制可在侧边栏选择目标标签页'\);\n\s*expect\(container\.textContent\)\.toContain\('第三方 Skill 会按来源分组展示'\);/,
  "expect(container.textContent).toContain('内联智能体升级');\n    expect(container.textContent).toContain('开放 API 与中转升级');"
);
fs.writeFileSync(testPath, testContent);

