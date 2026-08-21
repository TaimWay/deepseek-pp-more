const fs = require('fs');
let installJs = fs.readFileSync('packages/deepseek-pp-host/scripts/install.js', 'utf-8');
installJs = installJs.replace(
  "console.error(`❌ Error: Unsupported platform/architecture for pre-compiled binary: ${platform}/${arch}. Please compile manually with 'cargo build --release'.`);\n    process.exit(1);",
  "throw new Error(`Unsupported platform/architecture for pre-compiled binary: ${platform}/${arch}`);"
);
fs.writeFileSync('packages/deepseek-pp-host/scripts/install.js', installJs);
