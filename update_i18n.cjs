const fs = require('fs');

function insertI18n(file, block) {
  let content = fs.readFileSync(file, 'utf-8');
  content = content.replace(/startRelaySuccess: /, block + '\n    startRelaySuccess: ');
  fs.writeFileSync(file, content);
}

const zhCNBlock = `    refreshStatus: '刷新状态',
    terminalInstallGuide: '⚙️ 终端安装向导 (Mac / Linux / Windows)',
    installed: '已安装',
    runInstallCommandPrompt: '请在你的电脑终端中执行以下命令，完成 Native Host 的自动注册或更新：',
    clickRefreshAfterConfig: '配置完成后，请点击右上角的 [刷新] 按钮。',`;

const enBlock = `    refreshStatus: 'Refresh Status',
    terminalInstallGuide: '⚙️ Terminal Install Guide (Mac / Linux / Windows)',
    installed: 'Installed',
    runInstallCommandPrompt: 'Please run the following command in your terminal to automatically register or update the Native Host:',
    clickRefreshAfterConfig: 'After configuring, please click the [Refresh] button in the top right corner.',`;

insertI18n('core/i18n/resources/zh-CN/sidepanel.ts', zhCNBlock);
insertI18n('core/i18n/resources/en/sidepanel.ts', enBlock);
