use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(name = "api-external-relay", version = "0.1.0", about = "OpenAI-compatible API Relay for DeepSeek++ Browser Extension")]
pub struct Args {
    /// Host address to bind to
    #[arg(short = 'H', long, env = "HOST", default_value = "127.0.0.1")]
    pub host: String,

    /// Port to listen on
    #[arg(short, long, env = "PORT", default_value_t = 3000)]
    pub port: u16,

    /// Bearer API key required for client requests (if empty, auth is disabled)
    #[arg(short = 'k', long = "api-key", env = "API_KEY")]
    pub api_key: Option<String>,

    /// Secret token for extension WebSocket connection authentication
    #[arg(long = "extension-token", env = "EXTENSION_TOKEN")]
    pub extension_token: Option<String>,

    /// Enable HTTPS / TLS server with self-signed certificate if none provided
    #[arg(long = "tls", visible_alias = "https", env = "ENABLE_TLS")]
    pub tls: bool,

    /// Path to TLS certificate PEM file
    #[arg(long = "tls-cert", env = "TLS_CERT")]
    pub tls_cert: Option<PathBuf>,

    /// Path to TLS private key PEM file
    #[arg(long = "tls-key", env = "TLS_KEY")]
    pub tls_key: Option<PathBuf>,
}
