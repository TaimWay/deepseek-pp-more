const { execSync } = require('child_process');
// simulate rust host executing cmd /C
const cmdString = `powershell.exe -NoProfile -Command "echo \\"$env:TEMP\\deepseek-pp-relay.log\\""`;
console.log("String:", cmdString);
