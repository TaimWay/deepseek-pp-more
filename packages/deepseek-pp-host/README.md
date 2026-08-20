# deepseek-ppmore-ext-apirelay

**API Relay & Native Messaging Host** for the [DeepSeek++ More](https://github.com/TaimWay/deepseek-pp-more) browser extension.

This package provides a lightweight, high-performance Rust daemon that bridges your browser extension with the host operating system. It exposes an **OpenAI-compatible HTTP/WebSocket API** on your local machine, allowing any external software (like NextChat, Cursor, or your own scripts) to seamlessly leverage the DeepSeek web page's inference capabilities.

## ✨ Features

- **No Rust Required (Cargo-free)**: Pre-compiled binaries are automatically fetched for your OS during installation.
- **Cross-Platform**: Supports Windows (x64), Linux (x64), and macOS (x64 & ARM64).
- **OpenAI Compatible**: Exposes standard `/v1/chat/completions` endpoints.
- **Auto-Daemon**: Controlled directly by the DeepSeek++ More browser extension via Native Messaging.
- **Fallback Compilation**: Automatically falls back to local `cargo build` if GitHub downloads are blocked or you are on an unsupported CPU architecture.

## 🚀 Installation

You must install this host and bind it to your specific browser extension ID.

```bash
# For Chrome
npx deepseek-ppmore-ext-apirelay install --browser chrome --extension-id <YOUR_EXTENSION_ID>

# For Edge
npx deepseek-ppmore-ext-apirelay install --browser edge --extension-id <YOUR_EXTENSION_ID>

# For Firefox
npx deepseek-ppmore-ext-apirelay install --browser firefox --extension-id <YOUR_EXTENSION_ID>
```

> **How to find your Extension ID:**
> Go to your browser's extensions page (e.g., `chrome://extensions/`), enable "Developer Mode", and copy the ID of the *DeepSeek++ More* extension.

### What does the install command do?
1. Detects your OS and CPU architecture.
2. Downloads the extremely fast, pre-compiled Rust binary from our GitHub Releases.
3. Automatically writes the correct Native Messaging Host manifest JSON (`com.deepseek_pp.shell.json`) to your browser's configuration directory (or Windows Registry).
4. Grants necessary execution permissions.

## 🛠 Usage

Once installed, **you don't need to run anything manually**.

1. Open your browser and navigate to the DeepSeek++ More extension settings.
2. The extension will automatically spawn the Native Host daemon in the background.
3. You can monitor the API Relay's connection status, port, and health directly from the extension's UI panel.

## 💻 Building from Source

If you prefer to compile the Rust binary yourself, ensure you have [Rust & Cargo](https://rustup.rs/) installed:

```bash
git clone https://github.com/TaimWay/deepseek-pp-more.git
cd deepseek-pp-more/packages/deepseek-pp-host

# Build the Rust binary
cargo build --release

# Run the installer (it will detect your local build)
npm start -- install --browser chrome --extension-id <YOUR_EXTENSION_ID>
```

## 📄 License

Apache-2.0
