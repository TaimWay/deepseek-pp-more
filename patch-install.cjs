const fs = require('fs');

let installJs = fs.readFileSync('packages/deepseek-pp-host/scripts/install.js', 'utf-8');

const downloadLogic = `
const https = require('https');

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirects
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      } else if (response.statusCode !== 200) {
        reject(new Error(\`Failed to download, status code: \${response.statusCode}\`));
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            if (!isWindows) {
              fs.chmodSync(dest, 0o755);
            }
            resolve();
          });
        });
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function ensureBinary() {
  if (fs.existsSync(binaryPath)) return;
  
  console.log('Rust binary not found locally. Attempting to download pre-compiled binary...');
  
  let artifactName = '';
  const arch = os.arch();
  if (isWindows && arch === 'x64') {
    artifactName = 'deepseek-pp-host-windows-amd64.exe';
  } else if (isLinux && arch === 'x64') {
    artifactName = 'deepseek-pp-host-linux-amd64';
  } else if (isMac && arch === 'x64') {
    artifactName = 'deepseek-pp-host-macos-amd64';
  } else if (isMac && arch === 'arm64') {
    artifactName = 'deepseek-pp-host-macos-arm64';
  } else {
    console.error(\`❌ Error: Unsupported platform/architecture for pre-compiled binary: \${platform}/\${arch}. Please compile manually with 'cargo build --release'.\`);
    process.exit(1);
  }
  
  const url = \`https://github.com/TaimWay/deepseek-pp-more/releases/latest/download/\${artifactName}\`;
  console.log(\`Downloading from: \${url}\`);
  
  const dir = path.dirname(binaryPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  try {
    await downloadFile(url, binaryPath);
    console.log('✅ Download complete.');
  } catch (err) {
    console.error(\`❌ Failed to download binary: \${err.message}\`);
    console.log('Attempting to fallback to local cargo build...');
    try {
      execSync('cargo build --release', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
    } catch (buildErr) {
      console.error('❌ Local build also failed.', buildErr.message);
      process.exit(1);
    }
  }
}
`;

installJs = installJs.replace("try {\n  if (!fs.existsSync(binaryPath)) {\n    console.log('Rust binary not found. Attempting to build...');\n    execSync('cargo build --release', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });\n  }", `
${downloadLogic}

async function main() {
try {
  await ensureBinary();`);

installJs = installJs.replace(/} catch \(err\) {\n  console.error\('Failed to install Native Host:', err.message\);\n  process.exit\(1\);\n}/, `} catch (err) {
  console.error('Failed to install Native Host:', err.message);
  process.exit(1);
}
}
main();`);

fs.writeFileSync('packages/deepseek-pp-host/scripts/install.js', installJs);
