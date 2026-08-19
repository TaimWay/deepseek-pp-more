use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, info, warn};

use crate::types::{
    BridgeFromExtensionMessage, BridgeToExtensionMessage, ChatCompletionRequest, ToolCall,
    ToolCallChunk, ToolEvent, Usage,
};

#[derive(Debug, Clone)]
pub enum StreamEvent {
    Chunk {
        text_delta: Option<String>,
        reasoning_delta: Option<String>,
        #[allow(dead_code)]
        phase: Option<String>,
        tool_calls: Option<Vec<ToolCallChunk>>,
    },
    ToolEvent {
        tool_event: ToolEvent,
    },
    Done {
        finish_reason: String,
        full_text: Option<String>,
        full_reasoning: Option<String>,
        tool_calls: Option<Vec<ToolCall>>,
        usage: Option<Usage>,
    },
    Error {
        error: String,
        code: Option<String>,
    },
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BridgeStatus {
    pub connected: bool,
    pub extension_version: Option<String>,
    pub has_deepseek_auth: Option<bool>,
    pub has_official_api_key: Option<bool>,
    pub supported_models: Vec<String>,
    pub active_requests: usize,
    pub authorized_keys_count: usize,
}

pub struct BridgeManager {
    ws_sender: Arc<RwLock<Option<mpsc::UnboundedSender<BridgeToExtensionMessage>>>>,
    pending_requests: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<StreamEvent>>>>,
    active_requests_counter: AtomicUsize,
    extension_version: Arc<RwLock<Option<String>>>,
    has_deepseek_auth: Arc<RwLock<Option<bool>>>,
    has_official_api_key: Arc<RwLock<Option<bool>>>,
    supported_models: Arc<RwLock<Vec<String>>>,
    authorized_api_keys: Arc<RwLock<HashSet<String>>>,
    expected_extension_token: Option<String>,
}

impl BridgeManager {
    pub fn new(expected_extension_token: Option<String>) -> Self {
        Self {
            ws_sender: Arc::new(RwLock::new(None)),
            pending_requests: Arc::new(RwLock::new(HashMap::new())),
            active_requests_counter: AtomicUsize::new(0),
            extension_version: Arc::new(RwLock::new(None)),
            has_deepseek_auth: Arc::new(RwLock::new(None)),
            has_official_api_key: Arc::new(RwLock::new(None)),
            supported_models: Arc::new(RwLock::new(vec![
                "deepseek-v4-flash".to_string(),
                "deepseek-v4-pro".to_string(),
                "deepseek-v4-vision".to_string(),
                "deepseek-chat".to_string(),
                "deepseek-reasoner".to_string(),
            ])),
            authorized_api_keys: Arc::new(RwLock::new(HashSet::new())),
            expected_extension_token,
        }
    }

    pub fn expected_extension_token(&self) -> Option<&str> {
        self.expected_extension_token.as_deref()
    }

    pub async fn is_connected(&self) -> bool {
        self.ws_sender.read().await.is_some()
    }

    pub async fn has_authorized_keys(&self) -> bool {
        !self.authorized_api_keys.read().await.is_empty()
    }

    pub async fn is_api_key_valid(&self, token: &str) -> bool {
        let keys = self.authorized_api_keys.read().await;
        if keys.is_empty() {
            return true;
        }
        keys.contains(token)
    }

    pub async fn notify_key_used(&self, key: &str, model: Option<&str>) {
        if let Some(sender) = self.ws_sender.read().await.as_ref() {
            let _ = sender.send(BridgeToExtensionMessage::KeyUsed {
                key: key.to_string(),
                model: model.map(|m| m.to_string()),
                tokens: None,
            });
        }
    }

    pub async fn get_status(&self) -> BridgeStatus {
        let connected = self.is_connected().await;
        let ext_ver = self.extension_version.read().await.clone();
        let ds_auth = *self.has_deepseek_auth.read().await;
        let api_auth = *self.has_official_api_key.read().await;
        let models = self.supported_models.read().await.clone();
        let active = self.active_requests_counter.load(Ordering::Relaxed);
        let keys_count = self.authorized_api_keys.read().await.len();

        BridgeStatus {
            connected,
            extension_version: ext_ver,
            has_deepseek_auth: ds_auth,
            has_official_api_key: api_auth,
            supported_models: models,
            active_requests: active,
            authorized_keys_count: keys_count,
        }
    }

    pub async fn register_connection(&self, sender: mpsc::UnboundedSender<BridgeToExtensionMessage>) {
        info!("DeepSeek++ browser extension connected via WebSocket.");
        {
            let mut ws_guard = self.ws_sender.write().await;
            *ws_guard = Some(sender.clone());
        }

        // Send handshake initialization
        let _ = sender.send(BridgeToExtensionMessage::HandshakeInit {
            relay_version: env!("CARGO_PKG_VERSION").to_string(),
            required_auth: self.expected_extension_token.is_some(),
        });
    }

    pub async fn unregister_connection(&self) {
        warn!("DeepSeek++ browser extension disconnected.");
        {
            let mut ws_guard = self.ws_sender.write().await;
            *ws_guard = None;
        }

        // Fail any pending requests
        let mut pending = self.pending_requests.write().await;
        for (id, sender) in pending.drain() {
            let _ = sender.send(StreamEvent::Error {
                error: "Extension disconnected during request processing.".to_string(),
                code: Some("extension_disconnected".to_string()),
            });
            debug!("Aborted pending request {} due to extension disconnect", id);
        }
        self.active_requests_counter.store(0, Ordering::Relaxed);
    }

    pub async fn handle_incoming_message(&self, message: BridgeFromExtensionMessage) {
        match message {
            BridgeFromExtensionMessage::HandshakeAck {
                status,
                version,
                has_deepseek_auth,
                has_official_api_key,
                supported_models,
                authorized_api_keys,
            } => {
                info!("Extension Handshake ACK received. Status: {}", status);
                if let Some(v) = version {
                    *self.extension_version.write().await = Some(v);
                }
                if let Some(auth) = has_deepseek_auth {
                    *self.has_deepseek_auth.write().await = Some(auth);
                }
                if let Some(api) = has_official_api_key {
                    *self.has_official_api_key.write().await = Some(api);
                }
                if let Some(models) = supported_models {
                    if !models.is_empty() {
                        *self.supported_models.write().await = models;
                    }
                }
                if let Some(keys) = authorized_api_keys {
                    let mut key_set = self.authorized_api_keys.write().await;
                    *key_set = keys.into_iter().collect();
                    info!("Synchronized {} authorized API keys from extension.", key_set.len());
                }
            }
            BridgeFromExtensionMessage::SyncApiKeys { keys } => {
                let mut key_set = self.authorized_api_keys.write().await;
                *key_set = keys.into_iter().collect();
                info!("Updated {} authorized API keys from extension.", key_set.len());
            }
            BridgeFromExtensionMessage::ChatChunk {
                id,
                text_delta,
                reasoning_delta,
                phase,
                tool_calls,
            } => {
                let pending = self.pending_requests.read().await;
                if let Some(sender) = pending.get(&id) {
                    let _ = sender.send(StreamEvent::Chunk {
                        text_delta,
                        reasoning_delta,
                        phase,
                        tool_calls,
                    });
                }
            }
            BridgeFromExtensionMessage::ChatDone {
                id,
                finish_reason,
                full_text,
                full_reasoning,
                tool_calls,
                usage,
            } => {
                let mut pending = self.pending_requests.write().await;
                if let Some(sender) = pending.remove(&id) {
                    self.active_requests_counter.fetch_sub(1, Ordering::Relaxed);
                    let _ = sender.send(StreamEvent::Done {
                        finish_reason: finish_reason.unwrap_or_else(|| "stop".to_string()),
                        full_text,
                        full_reasoning,
                        tool_calls,
                        usage,
                    });
                }
            }
            BridgeFromExtensionMessage::ChatError { id, error, code } => {
                let mut pending = self.pending_requests.write().await;
                if let Some(sender) = pending.remove(&id) {
                    self.active_requests_counter.fetch_sub(1, Ordering::Relaxed);
                    let _ = sender.send(StreamEvent::Error { error, code });
                }
            }
            BridgeFromExtensionMessage::ToolEvent {
                id,
                tool_name,
                status,
                result,
            } => {
                let pending = self.pending_requests.read().await;
                if let Some(sender) = pending.get(&id) {
                    let _ = sender.send(StreamEvent::ToolEvent {
                        tool_event: ToolEvent {
                            id,
                            tool_name,
                            status,
                            result,
                        },
                    });
                } else {
                    warn!("Tool event for unknown request {} ignored", id);
                }
            }
            BridgeFromExtensionMessage::Ping { timestamp } => {
                debug!("Received PING from extension with timestamp {}", timestamp);
                if let Some(sender) = self.ws_sender.read().await.as_ref() {
                    let _ = sender.send(BridgeToExtensionMessage::Pong { timestamp });
                }
            }
            BridgeFromExtensionMessage::Pong { timestamp: _ } => {
                debug!("Received PONG from extension");
            }
        }
    }

    pub async fn dispatch_request(
        &self,
        request_id: String,
        req: ChatCompletionRequest,
        api_key: Option<String>,
    ) -> Result<mpsc::UnboundedReceiver<StreamEvent>, String> {
        let ws_sender = {
            let mut sender = self.ws_sender.read().await.clone();
            if sender.is_none() {
                // Wait up to 3 seconds for reconnection in case extension is reconnecting
                for _ in 0..15 {
                    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                    sender = self.ws_sender.read().await.clone();
                    if sender.is_some() {
                        break;
                    }
                }
            }
            sender.ok_or_else(|| {
                "DeepSeek++ browser extension is not connected. Please open browser with DeepSeek++ extension running.".to_string()
            })?
        };

        let (tx, rx) = mpsc::unbounded_channel();
        {
            let mut pending = self.pending_requests.write().await;
            pending.insert(request_id.clone(), tx);
            self.active_requests_counter.fetch_add(1, Ordering::Relaxed);
        }

        let thinking_enabled = req
            .thinking
            .as_ref()
            .map(|t| t.is_enabled())
            .unwrap_or(false);

        let reasoning_effort = req
            .reasoning_effort
            .clone()
            .unwrap_or_else(|| "high".to_string());

        let bridge_msg = BridgeToExtensionMessage::ChatCompletionRequest {
            id: request_id.clone(),
            model: req.model,
            messages: req.messages,
            stream: req.stream.unwrap_or(false),
            thinking: thinking_enabled,
            reasoning_effort,
            temperature: req.temperature,
            max_tokens: req.max_tokens,
            session_id: req.session_id,
            tools: req.tools,
            tool_choice: req.tool_choice,
            api_key,
        };

        if let Err(e) = ws_sender.send(bridge_msg) {
            let mut pending = self.pending_requests.write().await;
            pending.remove(&request_id);
            self.active_requests_counter.fetch_sub(1, Ordering::Relaxed);
            return Err(format!("Failed to send request to extension: {}", e));
        }

        Ok(rx)
    }

    pub async fn cancel_request(&self, request_id: &str) {
        let mut pending = self.pending_requests.write().await;
        if pending.remove(request_id).is_some() {
            self.active_requests_counter.fetch_sub(1, Ordering::Relaxed);
            if let Some(ws_sender) = self.ws_sender.read().await.as_ref() {
                let _ = ws_sender.send(BridgeToExtensionMessage::CancelRequest {
                    id: request_id.to_string(),
                });
            }
            debug!("Cancelled request {}", request_id);
        }
    }
}
