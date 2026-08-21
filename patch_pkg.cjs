const fs = require('fs');
const path = 'packages/deepseek-pp-host/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.files = ["scripts", "src", "Cargo.toml", "Cargo.lock", "README.md"];
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
