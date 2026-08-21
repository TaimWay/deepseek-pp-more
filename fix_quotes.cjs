const fs = require('fs');
let code = fs.readFileSync('core/external-api/process.ts', 'utf8');

const replacement = `    const pwshScript = \`
$relayBin = if (Test-Path ~\\\\dev\\\\TaimWay\\\\deepseek-pp-more\\\\ext\\\\api-external-relay\\\\target\\\\release\\\\api-external-relay.exe) { ~\\\\dev\\\\TaimWay\\\\deepseek-pp-more\\\\ext\\\\api-external-relay\\\\target\\\\release\\\\api-external-relay.exe } else { (Get-Command api-external-relay.exe -ErrorAction SilentlyContinue).Source }
if (-not $relayBin) { Write-Output 'RELAY_NOT_FOUND'; exit 0 }
$log = Join-Path $env:TEMP 'deepseek-pp-relay.log'
$proc = Start-Process -FilePath $relayBin -ArgumentList '\$\{argsStr\}' -RedirectStandardOutput $log -RedirectStandardError $log -PassThru -WindowStyle Minimized
Write-Output $proc.Id
\`.trim();

    const utf16le = new Uint8Array(pwshScript.length * 2);
    for (let i = 0; i < pwshScript.length; i++) {
      utf16le[i * 2] = pwshScript.charCodeAt(i) & 0xff;
      utf16le[i * 2 + 1] = pwshScript.charCodeAt(i) >> 8;
    }
    let binary = '';
    for (let i = 0; i < utf16le.byteLength; i++) {
      binary += String.fromCharCode(utf16le[i]);
    }
    const encoded = typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');

    const startCmd = isWindows ? \\\`powershell.exe -NoProfile -EncodedCommand \$\{encoded\}\\\` : \\\``;

code = code.replace(/const startCmd = isWindows \? `powershell\.exe -NoProfile -Command "[\s\S]*?"`\.trim\(\) : `/, replacement);

fs.writeFileSync('core/external-api/process.ts', code);
