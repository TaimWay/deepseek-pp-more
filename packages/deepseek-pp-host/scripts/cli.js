#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const command = args[0];

if (command === 'install') {
  console.log('Installing DeepSeek++ Native Host...');
  // Pass the remaining args to install.js
  require('./install.js');
} else if (command === 'build') {
  console.log('Building Rust binary...');
  execSync('cargo build --release', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
} else {
  console.log(`
Usage:
  deepseek-ppmore-ext-apirelay install --browser chrome --extension-id <ID>
  deepseek-ppmore-ext-apirelay build
  `);
}
