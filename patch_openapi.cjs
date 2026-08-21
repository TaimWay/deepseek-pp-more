const fs = require('fs');

let content = fs.readFileSync('entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx', 'utf-8');

content = content.replace(/>\s*刷新状态\s*<\/button>/, ">{t('sidepanel.settings.refreshStatus')}</button>");
content = content.replace(/<span>⚙️ 终端安装向导 \(Mac \/ Linux \/ Windows\)<\/span>/, "<span>{t('sidepanel.settings.terminalInstallGuide')}</span>");
content = content.replace(/<span className="text-\[10px\] text-green-600 dark:text-green-400 font-normal">已安装<\/span>/, `<span className="text-[10px] text-green-600 dark:text-green-400 font-normal">{t('sidepanel.settings.installed')}</span>`);
content = content.replace(/请在你的电脑终端中执行以下命令，完成 Native Host 的自动注册或更新：/, "{t('sidepanel.settings.runInstallCommandPrompt')}");
content = content.replace(/配置完成后，请点击右上角的 \[刷新\] 按钮。/, "{t('sidepanel.settings.clickRefreshAfterConfig')}");

fs.writeFileSync('entrypoints/sidepanel/components/settings/OpenApiSubPage.tsx', content);
