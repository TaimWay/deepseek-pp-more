const fs = require('fs');
let code = fs.readFileSync('core/external-api/process.ts', 'utf8');

code = code.replace(
  "\\$proc = Start-Process -FilePath \\$relayBin -ArgumentList '${argsStr}' -PassThru -WindowStyle Hidden",
  "\\$proc = Start-Process -FilePath \\$relayBin -ArgumentList '${argsStr}' -RedirectStandardOutput \\\"\\$env:TEMP\\\\deepseek-pp-relay.log\\\" -RedirectStandardError \\\"\\$env:TEMP\\\\deepseek-pp-relay.log\\\" -PassThru -WindowStyle Hidden"
);

fs.writeFileSync('core/external-api/process.ts', code);
