import fs from 'fs';

let content = fs.readFileSync('core/whats-new.ts', 'utf-8');
content = content.replace(/export const WHATS_NEW_ITEMS: WhatsNewItem\[\] = \[[\s\S]*?\];/, `export const WHATS_NEW_ITEMS: WhatsNewItem[] = [
  { id: 'inline-agent', titleKey: 'sidepanel.whatsNew.items.inlineAgent' },
  { id: 'api-relay', titleKey: 'sidepanel.whatsNew.items.apiRelay' },
  { id: 'quick-ask', titleKey: 'sidepanel.whatsNew.items.quickAsk' },
  { id: 'ui-ux', titleKey: 'sidepanel.whatsNew.items.uiUx' },
];`);
fs.writeFileSync('core/whats-new.ts', content);

let zh = fs.readFileSync('core/i18n/resources/zh-CN/sidepanel.ts', 'utf-8');
zh = zh.replace(/whatsNew: \{[\s\S]*?\},/, `whatsNew: {
    title: '版本更新内容',
    subtitle: '该更新不仅提升了原生流式渲染稳定性，还重构了本地 API 中转与 Native Host 安装体验，强化了右键快捷提问，并在侧边栏彻底隐藏工具 XML 标签以增强沉浸感。',
    versionBadge: 'v{version}',
    dismiss: '知道了',
    items: {
      inlineAgent: '内联智能体升级，最终回答改由网页原生渲染，并直接展示 mermaid/xychart 图表卡片。',
      apiRelay: '开放 API 与中转升级，新增跨平台 NPM 包 deepseek-ppmore-ext-apirelay，一键部署守护进程。',
      quickAsk: '修复全局右键菜单“问问 DeepSeek”逻辑，支持网页直接划词唤出侧边栏悬浮提问。',
      uiUx: 'UI 体验增强，侧边栏输出彻底过滤工具 XML 标签；独家绕过 Expert 模式屏蔽网址链接的限制。',
    },
  },`);
fs.writeFileSync('core/i18n/resources/zh-CN/sidepanel.ts', zh);

let en = fs.readFileSync('core/i18n/resources/en/sidepanel.ts', 'utf-8');
en = en.replace(/whatsNew: \{[\s\S]*?\},/, `whatsNew: {
    title: 'What\\'s New',
    subtitle: 'This update improves native streaming stability, overhauls the API Relay & Native Host installation, enhances the Quick Ask context menu, and completely hides XML tags in the side panel for a better immersive experience.',
    versionBadge: 'v{version}',
    dismiss: 'Got it',
    items: {
      inlineAgent: 'Inline Agent upgrade: Final answers are now rendered natively by the web page, supporting mermaid/xychart charts.',
      apiRelay: 'API Relay overhaul: Added cross-platform NPM package deepseek-ppmore-ext-apirelay for one-click deployment.',
      quickAsk: 'Fixed global "Ask DeepSeek" context menu logic, allowing text selection to trigger floating chat instantly.',
      uiUx: 'UI & UX enhancements: Side panel completely hides XML tool tags; exclusive bypass for URL blocks in Expert Mode.',
    },
  },`);
fs.writeFileSync('core/i18n/resources/en/sidepanel.ts', en);

let pkg = fs.readFileSync('package.json', 'utf-8');
pkg = pkg.replace(/"version": "1.14.0"/g, '"version": "1.15.0"');
fs.writeFileSync('package.json', pkg);
