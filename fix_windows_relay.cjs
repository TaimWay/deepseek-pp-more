const fs = require('fs');
let code = fs.readFileSync('core/external-api/process.ts', 'utf8');

// Replace getRelayProcessStatus
code = code.replace(
  /const cmd = \`lsof -i :\$\{port\} -sTCP:LISTEN -t \|\| pgrep -x api-external-relay \|\| pgrep -f "\[a\]pi-external-relay"\`;/,
  `const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows');
    const cmd = isWindows
      ? \`powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort \$\{port\} -State Listen -ErrorAction SilentlyContinue).OwningProcess; if (-not \\$?) { (Get-Process api-external-relay -ErrorAction SilentlyContinue).Id }"\`
      : \`lsof -i :\$\{port\} -sTCP:LISTEN -t || pgrep -x api-external-relay || pgrep -f "[a]pi-external-relay"\`;`
);

// Replace startRelayProcess
code = code.replace(
  /const startCmd = `[\s\S]*?`\.trim\(\);/,
  `const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows');
    
    let argsArray = [\`--host \\"\$\{host\}\\"\`, \`--port \$\{port\}\`];
    if (options.apiKey) argsArray.push(\`--api-key \\"\$\{options.apiKey.replace(/"/g, '\\\\"')\}\\"\`);
    if (options.extensionToken) argsArray.push(\`--extension-token \\"\$\{options.extensionToken.replace(/"/g, '\\\\"')\}\\"\`);
    if (options.tls) argsArray.push('--tls');
    const argsStr = argsArray.join(' ');

    const startCmd = isWindows ? \`powershell.exe -NoProfile -Command "
\\$relayBin = if (Test-Path ~\\\\dev\\\\TaimWay\\\\deepseek-pp-more\\\\ext\\\\api-external-relay\\\\target\\\\release\\\\api-external-relay.exe) { ~\\\\dev\\\\TaimWay\\\\deepseek-pp-more\\\\ext\\\\api-external-relay\\\\target\\\\release\\\\api-external-relay.exe } else { (Get-Command api-external-relay.exe -ErrorAction SilentlyContinue).Source }
if (-not \\$relayBin) { Write-Output 'RELAY_NOT_FOUND'; exit 0 }
\\$proc = Start-Process -FilePath \\$relayBin -ArgumentList '\$\{argsStr\}' -PassThru -WindowStyle Hidden
Write-Output \\$proc.Id
"\`.trim() : \`
if [ -x "$HOME/dev/TaimWay/deepseek-pp-more/ext/api-external-relay/target/release/api-external-relay" ]; then
  RELAY_BIN="$HOME/dev/TaimWay/deepseek-pp-more/ext/api-external-relay/target/release/api-external-relay"
elif command -v api-external-relay >/dev/null 2>&1; then
  RELAY_BIN=$(command -v api-external-relay)
else
  RELAY_BIN=$(find "$HOME/dev" "$HOME/.local/bin" "$HOME/.cargo/bin" /usr/local/bin "$HOME" -maxdepth 5 -name "api-external-relay" -type f -perm /111 2>/dev/null | head -n 1)
fi

if [ -n "$RELAY_BIN" ] && [ -x "$RELAY_BIN" ]; then
  nohup "$RELAY_BIN" --host "\$\{host\}" --port \$\{port\} \$\{options.apiKey ? \`--api-key "\$\{options.apiKey.replace(/"/g, '\\\\\\"')\}"\` : ''\} \$\{options.extensionToken ? \`--extension-token "\$\{options.extensionToken.replace(/"/g, '\\\\\\"')\}"\` : ''\} \$\{options.tls ? '--tls' : ''\} > /tmp/deepseek-pp-relay.log 2>&1 &
  echo $!
else
  echo "RELAY_NOT_FOUND"
fi
\`.trim();`
);

// Replace stopRelayProcess
code = code.replace(
  /const killCmd = \`pkill -f "\[a\]pi-external-relay.*--port \$\{port\}" \|\| kill \$\(lsof -t -i:\$\{port\}\) 2>\/dev\/null \|\| pkill -x "api-external-relay" \|\| pkill -f "\[a\]pi-external-relay"\`;/,
  `const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows');
    const killCmd = isWindows 
      ? \`powershell.exe -NoProfile -Command "Stop-Process -Name api-external-relay -Force -ErrorAction SilentlyContinue; \\$pidToKill = (Get-NetTCPConnection -LocalPort \$\{port\} -State Listen -ErrorAction SilentlyContinue).OwningProcess; if (\\$pidToKill) { Stop-Process -Id \\$pidToKill -Force -ErrorAction SilentlyContinue }"\`
      : \`pkill -f "[a]pi-external-relay.*--port \$\{port\}" || kill $(lsof -t -i:\$\{port\}) 2>/dev/null || pkill -x "api-external-relay" || pkill -f "[a]pi-external-relay"\`;`
);

fs.writeFileSync('core/external-api/process.ts', code);
