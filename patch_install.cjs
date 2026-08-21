const fs = require('fs');
let content = fs.readFileSync('packages/deepseek-pp-host/scripts/install.js', 'utf-8');
content = content.replace(
  /const file = fs.createWriteStream\(dest\);\n    https\.get\(url, \(response\) => \{\n      if \(response\.statusCode === 301 \|\| response\.statusCode === 302\) \{\n        \/\/ Handle redirects\n        downloadFile\(response\.headers\.location, dest\)\.then\(resolve\)\.catch\(reject\);\n      \}/g,
  `https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirects
        response.resume(); // consume the body to close connection
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      } else {
        const file = fs.createWriteStream(dest);
        if (response.statusCode !== 200) {`
);
content = content.replace(
  /\} else if \(response.statusCode !== 200\) \{\n        reject\(new Error\(\`Failed to download, status code: \$\{response\.statusCode\}\`\)\);\n      \} else \{/g,
  `if (response.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(\`Failed to download, status code: \$\{response.statusCode\}\`));
        } else {`
);
fs.writeFileSync('packages/deepseek-pp-host/scripts/install.js', content);
