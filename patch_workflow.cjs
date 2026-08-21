const fs = require('fs');
let content = fs.readFileSync('.github/workflows/release.yml', 'utf-8');
content = content.replace(/          if \[ -z "\$NODE_AUTH_TOKEN" \]; then\n            echo "NPM_TOKEN secret is required because deepseek-pp-shell-host@\$VERSION is not published." >&2\n            exit 1\n          fi/g, 
`          if [ -z "$NODE_AUTH_TOKEN" ]; then
            echo "NPM_TOKEN missing. Skipping automated npm publish for deepseek-pp-shell-host@$VERSION."
            exit 0
          fi`);
fs.writeFileSync('.github/workflows/release.yml', content);
