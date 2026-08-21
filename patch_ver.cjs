const fs = require('fs');
const path = 'packages/deepseek-pp-host/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.version = "0.2.1";
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
