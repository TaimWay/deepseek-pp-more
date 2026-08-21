const fs = require('fs');
let installJs = fs.readFileSync('packages/deepseek-pp-host/scripts/install.js', 'utf-8');
installJs = installJs.replace(/let artifactName = '';\n[\s\S]*?console\.log\('✅ Download complete\.'\);/, 
`try {
    let artifactName = '';
    const arch = os.arch();
    if (isWindows && arch === 'x64') {
      artifactName = 'deepseek-pp-host-windows-amd64.exe';
    } else if (isLinux && arch === 'x64') {
      artifactName = 'deepseek-pp-host-linux-amd64';
    } else if (isMac && arch === 'arm64') {
      artifactName = 'deepseek-pp-host-macos-arm64';
    } else {
      throw new Error(\`Unsupported platform/architecture for pre-compiled binary: \${platform}/\${arch}\`);
    }
    
    const url = \`https://github.com/TaimWay/deepseek-pp-more/releases/latest/download/\${artifactName}\`;
    console.log(\`Downloading from: \${url}\`);
    
    const dir = path.dirname(binaryPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    await downloadFile(url, binaryPath);
    console.log('✅ Download complete.');`
);
fs.writeFileSync('packages/deepseek-pp-host/scripts/install.js', installJs);
