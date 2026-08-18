#[cfg(feature = "tls")]
use axum_server::tls_rustls::RustlsConfig;
#[cfg(feature = "tls")]
use std::path::Path;
#[cfg(feature = "tls")]
use tracing::info;

#[cfg(feature = "tls")]
pub async fn load_or_create_tls_config(
    cert_path: Option<&Path>,
    key_path: Option<&Path>,
) -> Result<RustlsConfig, Box<dyn std::error::Error + Send + Sync>> {
    if let (Some(cert_p), Some(key_p)) = (cert_path, key_path) {
        info!("Loading TLS certificate from {:?}", cert_p);
        let config = RustlsConfig::from_pem_file(cert_p, key_p).await?;
        return Ok(config);
    }

    info!("Generating self-signed TLS certificate for localhost/127.0.0.1...");
    let subject_alt_names = vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "::1".to_string(),
    ];
    let cert = rcgen::generate_simple_self_signed(subject_alt_names)?;
    let cert_pem = cert.cert.pem();
    let key_pem = cert.key_pair.serialize_pem();

    let config = RustlsConfig::from_pem(cert_pem.into_bytes(), key_pem.into_bytes()).await?;
    info!("Self-signed TLS certificate ready.");
    Ok(config)
}
