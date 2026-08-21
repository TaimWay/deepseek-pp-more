const fs = require('fs');
let code = fs.readFileSync('packages/deepseek-pp-host/scripts/install.js', 'utf8');
code = code.replace(
  'if (response.statusCode !== 200) { else if (response.statusCode !== 200) {\\n        reject(new Error(`Failed to download, status code: ${response.statusCode}`));\\n      } else {',
  `if (response.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(\`Failed to download, status code: \$\{response.statusCode\}\`));
        } else {`
);
fs.writeFileSync('packages/deepseek-pp-host/scripts/install.js', code);
