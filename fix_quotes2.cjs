const fs = require('fs');
let code = fs.readFileSync('core/external-api/process.ts', 'utf8');
code = code.replace(/\\\`powershell\.exe/g, "\`powershell.exe").replace(/\$\{encoded\}\\\`/g, "\$\{encoded\}\`");
fs.writeFileSync('core/external-api/process.ts', code);
