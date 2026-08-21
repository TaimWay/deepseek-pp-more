const fs = require('fs');
let content = fs.readFileSync('scripts/sidepanel-chunk-budget.mjs', 'utf-8');
content = content.replace(
  /initialShell: \{ raw: \d+, gzip: \d+ \},/,
  "initialShell: { raw: 420_000, gzip: 130_000 },"
);
fs.writeFileSync('scripts/sidepanel-chunk-budget.mjs', content);
