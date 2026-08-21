const fs = require('fs');
let code = fs.readFileSync('packages/deepseek-pp-host/scripts/install.js', 'utf8');
const newFunc = `function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        response.resume();
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      } else {
        const file = fs.createWriteStream(dest);
        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(\`Failed to download, status code: \$\{response.statusCode\}\`));
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
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}`;
code = code.replace(/function downloadFile\(url, dest\) \{[\s\S]*?\}\)\;\n  \}\)\;\n\}/, newFunc);
fs.writeFileSync('packages/deepseek-pp-host/scripts/install.js', code);
