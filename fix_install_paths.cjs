const fs = require('fs');
let code = fs.readFileSync('packages/deepseek-pp-host/scripts/install.js', 'utf8');

// Replace binaryPath logic
code = code.replace(
  /const rustBinaryExt = isWindows \? '\.exe' : '';\nconst binaryPath = path\.join\(__dirname, '\.\.', 'target', 'release', \`deepseek-pp-host\$\{rustBinaryExt\}\`\);/,
  `const rustBinaryExt = isWindows ? '.exe' : '';
const home = os.homedir();
let installRoot = '';
if (isWindows) {
  installRoot = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'DeepSeek++', 'ApiRelayHost');
} else if (isMac) {
  installRoot = path.join(home, 'Library', 'Application Support', 'DeepSeek++', 'ApiRelayHost');
} else {
  installRoot = path.join(home, '.local', 'share', 'deepseek-pp', 'api-relay-host');
}
const binaryPath = path.join(installRoot, \`deepseek-pp-host\$\{rustBinaryExt\}\`);`
);

// Replace getManifestPaths logic for Windows
code = code.replace(
  /\} else if \(isWindows\) \{\n    return \[path\.join\(__dirname, '\.\.', \`\$\{HOST_NAME\}\.json\`\)\];\n  \}/,
  `} else if (isWindows) {
    return [path.join(installRoot, \`\$\{HOST_NAME\}\.json\`)];
  }`
);

// We need to also patch the fallback local cargo build logic, because it builds in __dirname/.. but the binary should be copied to binaryPath
code = code.replace(
  /execSync\('cargo build --release', \{ cwd: path\.join\(__dirname, '\.\.'\), stdio: 'inherit' \}\);/,
  `execSync('cargo build --release', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
      const localBuiltPath = path.join(__dirname, '..', 'target', 'release', \`deepseek-pp-host\$\{rustBinaryExt\}\`);
      if (fs.existsSync(localBuiltPath)) {
        fs.copyFileSync(localBuiltPath, binaryPath);
        if (!isWindows) fs.chmodSync(binaryPath, 0o755);
      } else {
        throw new Error('Local build succeeded but binary not found.');
      }`
);

fs.writeFileSync('packages/deepseek-pp-host/scripts/install.js', code);
