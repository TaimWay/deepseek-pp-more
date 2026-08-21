const fs = require('fs');

let yml = fs.readFileSync('.github/workflows/release.yml', 'utf-8');
yml = yml.replace(/\s*- os: macos-latest\n\s*target: x86_64-apple-darwin\n\s*artifact_name: deepseek-pp-host-macos-amd64\n\s*bin_name: deepseek-pp-host\n/, '\n');
fs.writeFileSync('.github/workflows/release.yml', yml);

let installJs = fs.readFileSync('packages/deepseek-pp-host/scripts/install.js', 'utf-8');
installJs = installJs.replace(/\} else if \(isMac && arch === 'x64'\) \{\n    artifactName = 'deepseek-pp-host-macos-amd64';\n  /, '');
fs.writeFileSync('packages/deepseek-pp-host/scripts/install.js', installJs);
