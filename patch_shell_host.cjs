const fs = require('fs');
const p = 'packages/shell-host/package.json';
const j = JSON.parse(fs.readFileSync(p));
j.version = '1.15.0';
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
