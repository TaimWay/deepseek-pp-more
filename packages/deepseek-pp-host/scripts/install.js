const os = require('os');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const HOST_NAME = 'com.deepseek_pp.shell';

// Parse args
const args = process.argv.slice(2);
let targetBrowser = 'chrome';
let extensionId = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--browser' && args[i + 1]) {
    targetBrowser = args[i + 1].toLowerCase();
    i++;
  } else if (args[i] === '--extension-id' && args[i + 1]) {
    extensionId = args[i + 1];
    i++;
  }
}

if (!extensionId) {
  console.error("❌ Error: You must provide an extension ID. Example: npx ... install --extension-id abcdefg");
  process.exit(1);
}

// Generate allowed_origins based on browser
let allowedOrigins = [];
if (targetBrowser === 'firefox') {
  // Firefox uses extension IDs differently or uses manifest ID
  allowedOrigins = [`${extensionId}`];
} else {
  allowedOrigins = [`chrome-extension://${extensionId}/`];
}

const platform = os.platform();
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';

const rustBinaryExt = isWindows ? '.exe' : '';
const binaryPath = path.join(__dirname, '..', 'target', 'release', `deepseek-pp-host${rustBinaryExt}`);

const manifest = {
  name: HOST_NAME,
  description: "DeepSeek++ Local Shell Host",
  path: binaryPath,
  type: "stdio",
  allowed_origins: allowedOrigins
};

function getManifestPaths() {
  const home = os.homedir();
  if (isMac) {
    if (targetBrowser === 'edge') return [path.join(home, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts', `${HOST_NAME}.json`)];
    if (targetBrowser === 'firefox') return [path.join(home, 'Library/Application Support/Mozilla/NativeMessagingHosts', `${HOST_NAME}.json`)];
    return [path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts', `${HOST_NAME}.json`)];
  } else if (isLinux) {
    if (targetBrowser === 'edge') return [path.join(home, '.config/microsoft-edge/NativeMessagingHosts', `${HOST_NAME}.json`)];
    if (targetBrowser === 'firefox') return [path.join(home, '.mozilla/native-messaging-hosts', `${HOST_NAME}.json`)];
    return [path.join(home, '.config/google-chrome/NativeMessagingHosts', `${HOST_NAME}.json`)];
  } else if (isWindows) {
    return [path.join(__dirname, '..', `${HOST_NAME}.json`)];
  }
  return [];
}

try {
  if (!fs.existsSync(binaryPath)) {
    console.log('Rust binary not found. Attempting to build...');
    execSync('cargo build --release', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  }

  const manifestPaths = getManifestPaths();
  
  if (isWindows) {
    const manifestPath = manifestPaths[0];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    
    let regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
    if (targetBrowser === 'edge') regKey = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`;
    if (targetBrowser === 'firefox') regKey = `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`;
    
    console.log(`Adding Registry key for ${targetBrowser}...`);
    execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`);
    
  } else {
    for (const manifestPath of manifestPaths) {
      const dir = path.dirname(manifestPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }
  
  console.log(`\n✅ Successfully installed DeepSeek++ Native Host for ${targetBrowser.toUpperCase()}!`);
  console.log(`Allowed Origin: ${allowedOrigins[0]}`);

} catch (err) {
  console.error('Failed to install Native Host:', err.message);
  process.exit(1);
}
