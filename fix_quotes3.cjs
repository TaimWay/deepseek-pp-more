const fs = require('fs');
let code = fs.readFileSync('core/external-api/process.ts', 'utf8');
code = code.replace(/ : \\\`/g, " : \`");
fs.writeFileSync('core/external-api/process.ts', code);
