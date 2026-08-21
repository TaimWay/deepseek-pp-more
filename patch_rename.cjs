const fs = require('fs');
let content = fs.readFileSync('.github/workflows/release.yml', 'utf-8');
content = content.replace(
  /      - name: Rename and Upload artifact\n        uses: actions\/upload-artifact@v4\n        with:\n          name: \$\{\{ matrix.artifact_name \}\}\n          path: packages\/deepseek-pp-host\/target\/\$\{\{ matrix.target \}\}\/release\/\$\{\{ matrix.bin_name \}\}/g,
  `      - name: Rename binary
        shell: bash
        run: |
          mv "packages/deepseek-pp-host/target/\${{ matrix.target }}/release/\${{ matrix.bin_name }}" "packages/deepseek-pp-host/target/\${{ matrix.target }}/release/\${{ matrix.artifact_name }}"
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: \${{ matrix.artifact_name }}
          path: packages/deepseek-pp-host/target/\${{ matrix.target }}/release/\${{ matrix.artifact_name }}`
);
fs.writeFileSync('.github/workflows/release.yml', content);
