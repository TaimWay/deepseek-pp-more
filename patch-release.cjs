const fs = require('fs');

let yml = fs.readFileSync('.github/workflows/release.yml', 'utf-8');

const buildRelayJob = `
  build-relay:
    name: Build API Relay
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            artifact_name: deepseek-pp-host-linux-amd64
            bin_name: deepseek-pp-host
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            artifact_name: deepseek-pp-host-windows-amd64.exe
            bin_name: deepseek-pp-host.exe
          - os: macos-latest
            target: aarch64-apple-darwin
            artifact_name: deepseek-pp-host-macos-arm64
            bin_name: deepseek-pp-host
          - os: macos-13
            target: x86_64-apple-darwin
            artifact_name: deepseek-pp-host-macos-amd64
            bin_name: deepseek-pp-host
    steps:
      - uses: actions/checkout@v4
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: \${{ matrix.target }}
      - name: Build
        working-directory: packages/deepseek-pp-host
        run: cargo build --release --target \${{ matrix.target }}
      - name: Rename and Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: \${{ matrix.artifact_name }}
          path: packages/deepseek-pp-host/target/\${{ matrix.target }}/release/\${{ matrix.bin_name }}

  release:
    needs: build-relay`;

yml = yml.replace('  release:', buildRelayJob);

// Add download artifact before Publish GitHub Release
const downloadArtifact = `
      - name: Download Relay Binaries
        uses: actions/download-artifact@v4
        with:
          path: relay-binaries
          merge-multiple: true

      - name: Publish GitHub Release`;

yml = yml.replace('      - name: Publish GitHub Release', downloadArtifact);

// Add relay binaries to RELEASE_FILES
const releaseFilesMod = `          mapfile -t RELEASE_FILES <<< "$ZIP_FILES"
          
          # Add relay binaries to release files
          mapfile -t RELAY_BINARIES < <(find relay-binaries -type f)
          RELEASE_FILES+=("\${RELAY_BINARIES[@]}")
`;

yml = yml.replace('          mapfile -t RELEASE_FILES <<< "$ZIP_FILES"', releaseFilesMod);

fs.writeFileSync('.github/workflows/release.yml', yml);
