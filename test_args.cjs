const { execSync } = require('child_process');
const fs = require('fs');
fs.writeFileSync('dump_args.js', `console.log(JSON.stringify(process.argv));`);
try {
  const result = execSync(`pwsh -NoProfile -Command "Start-Process -FilePath node -ArgumentList 'dump_args.js --host \\"127.0.0.1\\" --port 32333' -PassThru -Wait -NoNewWindow"`);
  console.log(result.toString());
} catch (e) {
  console.log("Error:", e.stdout.toString(), e.stderr.toString());
}
