use api_external_relay::bridge::BridgeManager;
use api_external_relay::cli::Args;
use api_external_relay::handlers::{
    chat_completions_handler, health_handler, list_models_handler, ws_handler, AppState,
};
#[cfg(feature = "tls")]
use api_external_relay::tls;

use axum::{
    routing::{get, post},
    Router,
};
use clap::Parser;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 1. Initialize Logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(false)
        .finish();
    let _ = tracing::subscriber::set_global_default(subscriber);

    // 2. Parse CLI arguments
    let args = Args::parse();

    let addr: SocketAddr = format!("{}:{}", args.host, args.port).parse()?;
    let api_key_display = if args.api_key.is_some() {
        "Enabled (Bearer Token required)"
    } else {
        "Disabled (Public access)"
    };

    // 3. Create Bridge and AppState
    let bridge = Arc::new(BridgeManager::new(args.extension_token.clone()));
    let app_state = AppState {
        bridge: bridge.clone(),
        api_key: args.api_key.clone(),
    };

    // 4. Build Router
    let app = Router::new()
        .route("/", get(health_handler))
        .route("/health", get(health_handler))
        .route("/status", get(health_handler))
        .route("/v1/models", get(list_models_handler))
        .route("/models", get(list_models_handler))
        .route("/v1/chat/completions", post(chat_completions_handler))
        .route("/chat/completions", post(chat_completions_handler))
        .route("/ws", get(ws_handler))
        .route("/extension-bridge", get(ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    // 5. Start Server (TLS or Plain HTTP)
    #[cfg(feature = "tls")]
    if args.tls {
        let tls_config = tls::load_or_create_tls_config(
            args.tls_cert.as_deref(),
            args.tls_key.as_deref(),
        )
        .await?;

        println!("\n╔═══════════════════════════════════════════════════════════════════════╗");
        println!("║   DeepSeek++ OpenAI API External Relay v0.1.0 (HTTPS / TLS)           ║");
        println!("╠═══════════════════════════════════════════════════════════════════════╣");
        println!("║  Server Address:    https://{}                           ║", addr);
        println!("║  OpenAI Endpoint:   https://{}/chat/completions          ║", addr);
        println!("║  WebSocket Bridge:  wss://{}/ws                         ║", addr);
        println!("║  API Key Auth:      {:<49} ║", api_key_display);
        println!("╚═══════════════════════════════════════════════════════════════════════╝\n");

        info!("Starting HTTPS relay server on {}", addr);
        axum_server::bind_rustls(addr, tls_config)
            .serve(app.into_make_service())
            .await?;
        return Ok(());
    }

    println!("\n╔═══════════════════════════════════════════════════════════════════════╗");
    println!("║   DeepSeek++ OpenAI API External Relay v0.1.0 (HTTP)                  ║");
    println!("╠═══════════════════════════════════════════════════════════════════════╣");
    println!("║  Server Address:    http://{}                            ║", addr);
    println!("║  OpenAI Endpoint:   http://{}/chat/completions           ║", addr);
    println!("║  WebSocket Bridge:  ws://{}/ws                          ║", addr);
    println!("║  API Key Auth:      {:<49} ║", api_key_display);
    println!("╚═══════════════════════════════════════════════════════════════════════╝\n");

    info!("Starting HTTP relay server on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
