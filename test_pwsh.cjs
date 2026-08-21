const { execSync } = require('child_process');
const cmd = `powershell.exe -NoProfile -Command "$log = $env:TEMP + '\\deepseek-pp-relay.log'; echo $log"`;
console.log(cmd);
