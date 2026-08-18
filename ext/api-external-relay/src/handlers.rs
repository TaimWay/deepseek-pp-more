use axum::{
    body::Body,
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::bridge::{BridgeManager, StreamEvent};
use crate::types::{
    BridgeFromExtensionMessage, BridgeToExtensionMessage, ChatCompletionChoice,
    ChatCompletionChoiceMessage, ChatCompletionChunk, ChatCompletionChunkChoice,
    ChatCompletionChunkDelta, ChatCompletionRequest, ChatCompletionResponse, ErrorResponse,
    ModelCard, ModelListResponse, ToolEvent, Usage,
};

#[derive(Clone)]
pub struct AppState {
    pub bridge: Arc<BridgeManager>,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
}

// ----------------------------------------------------------------------------
// Health / Status
// ----------------------------------------------------------------------------

pub async fn health_handler(State(state): State<AppState>) -> impl IntoResponse {
    let bridge_status = state.bridge.get_status().await;
    let has_keys = state.bridge.has_authorized_keys().await || state.api_key.is_some();
    let body = serde_json::json!({
        "status": "ok",
        "service": "deepseek-pp-api-external-relay",
        "version": env!("CARGO_PKG_VERSION"),
        "bridge": bridge_status,
        "auth_required": has_keys,
    });
    Json(body)
}

// ----------------------------------------------------------------------------
// Models List (/v1/models and /models)
// ----------------------------------------------------------------------------

pub async fn list_models_handler(State(state): State<AppState>) -> impl IntoResponse {
    let status = state.bridge.get_status().await;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let models = status
        .supported_models
        .into_iter()
        .map(|id| ModelCard {
            id,
            object: "model".to_string(),
            created: now,
            owned_by: "deepseek-pp".to_string(),
        })
        .collect();

    Json(ModelListResponse {
        object: "list".to_string(),
        data: models,
    })
}

// ----------------------------------------------------------------------------
// Chat Completions (/v1/chat/completions and /chat/completions)
// ----------------------------------------------------------------------------

pub async fn chat_completions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ChatCompletionRequest>,
) -> Response {
    // 1. Authentication check (supports multi-key or CLI fallback)
    let auth_header = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");

    let token = if let Some(stripped) = auth_header.strip_prefix("Bearer ") {
        stripped.trim()
    } else {
        auth_header.trim()
    };

    let is_authorized = if state.bridge.has_authorized_keys().await {
        state.bridge.is_api_key_valid(token).await
    } else if let Some(expected_key) = &state.api_key {
        token == expected_key
    } else {
        true
    };

    if !is_authorized {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse::new(
                "Incorrect API key provided. Authorization header must match configured API key.",
                "authentication_error",
                Some("invalid_api_key"),
            )),
        )
            .into_response();
    }

    if !token.is_empty() {
        state.bridge.notify_key_used(token, Some(&payload.model)).await;
    }

    // 2. Validate payload
    if payload.messages.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(
                "Missing 'messages' in request body.",
                "invalid_request_error",
                Some("missing_messages"),
            )),
        )
            .into_response();
    }

    let request_id = format!("chatcmpl-{}", Uuid::new_v4().simple());
    let model = payload.model.clone();
    let stream = payload.stream.unwrap_or(false);
    let created = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // 3. Dispatch to BridgeManager
    let rx_result = state
        .bridge
        .dispatch_request(
            request_id.clone(),
            payload,
            if token.is_empty() { None } else { Some(token.to_string()) },
        )
        .await;

    let mut rx = match rx_result {
        Ok(rx) => rx,
        Err(err_msg) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse::new(
                    err_msg,
                    "service_unavailable",
                    Some("bridge_disconnected"),
                )),
            )
                .into_response();
        }
    };

    // 4. Return Streaming (SSE) or Non-Streaming JSON Response
    if stream {
        let sse_model = model.clone();
        let sse_req_id = request_id.clone();
        let bridge_cancel = state.bridge.clone();
        let cancel_id = request_id.clone();

        let sse_stream = async_stream::stream! {
            let mut sent_first = false;

            while let Some(event) = rx.recv().await {
                match event {
                    StreamEvent::Chunk { text_delta, reasoning_delta, phase: _, tool_calls } => {
                        let delta = if !sent_first {
                            sent_first = true;
                            ChatCompletionChunkDelta {
                                role: Some("assistant".to_string()),
                                content: text_delta,
                                reasoning_content: reasoning_delta,
                                tool_calls,
                                tool_events: None,
                            }
                        } else {
                            ChatCompletionChunkDelta {
                                role: None,
                                content: text_delta,
                                reasoning_content: reasoning_delta,
                                tool_calls,
                                tool_events: None,
                            }
                        };

                        let chunk = ChatCompletionChunk {
                            id: sse_req_id.clone(),
                            object: "chat.completion.chunk".to_string(),
                            created,
                            model: sse_model.clone(),
                            choices: vec![ChatCompletionChunkChoice {
                                index: 0,
                                delta,
                                finish_reason: None,
                            }],
                            usage: None,
                        };

                        if let Ok(json_str) = serde_json::to_string(&chunk) {
                            yield Ok::<_, axum::Error>(format!("data: {}\n\n", json_str));
                        }
                    }
                    StreamEvent::ToolEvent { tool_event } => {
                        let chunk = ChatCompletionChunk {
                            id: sse_req_id.clone(),
                            object: "chat.completion.chunk".to_string(),
                            created,
                            model: sse_model.clone(),
                            choices: vec![ChatCompletionChunkChoice {
                                index: 0,
                                delta: ChatCompletionChunkDelta {
                                    role: None,
                                    content: None,
                                    reasoning_content: None,
                                    tool_calls: None,
                                    tool_events: Some(vec![tool_event]),
                                },
                                finish_reason: None,
                            }],
                            usage: None,
                        };

                        if let Ok(json_str) = serde_json::to_string(&chunk) {
                            yield Ok::<_, axum::Error>(format!("data: {}\n\n", json_str));
                        }
                    }
                    StreamEvent::Done { finish_reason, full_text: _, full_reasoning: _, tool_calls: _, usage } => {
                        let final_chunk = ChatCompletionChunk {
                            id: sse_req_id.clone(),
                            object: "chat.completion.chunk".to_string(),
                            created,
                            model: sse_model.clone(),
                            choices: vec![ChatCompletionChunkChoice {
                                index: 0,
                                delta: ChatCompletionChunkDelta {
                                    role: None,
                                    content: None,
                                    reasoning_content: None,
                                    tool_calls: None,
                                    tool_events: None,
                                },
                                finish_reason: Some(finish_reason),
                            }],
                            usage,
                        };

                        if let Ok(json_str) = serde_json::to_string(&final_chunk) {
                            yield Ok::<_, axum::Error>(format!("data: {}\n\n", json_str));
                        }
                        yield Ok::<_, axum::Error>("data: [DONE]\n\n".to_string());
                        break;
                    }
                    StreamEvent::Error { error, code } => {
                        let err_resp = ErrorResponse::new(error, "server_error", code);
                        if let Ok(json_str) = serde_json::to_string(&err_resp) {
                            yield Ok::<_, axum::Error>(format!("data: {}\n\n", json_str));
                        }
                        yield Ok::<_, axum::Error>("data: [DONE]\n\n".to_string());
                        break;
                    }
                }
            }

            bridge_cancel.cancel_request(&cancel_id).await;
        };

        Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "text/event-stream; charset=utf-8")
            .header("Cache-Control", "no-cache")
            .header("Connection", "keep-alive")
            .header("X-Accel-Buffering", "no")
            .body(Body::from_stream(sse_stream))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "SSE response build failed").into_response())
    } else {
        // Non-streaming: wait for completion
        let mut final_text: Option<String> = None;
        let mut final_reasoning: Option<String> = None;
        let mut final_tool_calls: Option<Vec<crate::types::ToolCall>> = None;
        let mut final_tool_events: Vec<ToolEvent> = Vec::new();
        let mut final_finish_reason = "stop".to_string();
        let mut final_usage = Usage {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };

        while let Some(event) = rx.recv().await {
            match event {
                StreamEvent::Chunk { text_delta, reasoning_delta, phase: _, tool_calls: _ } => {
                    if let Some(t) = text_delta {
                        final_text.get_or_insert_with(String::new).push_str(&t);
                    }
                    if let Some(r) = reasoning_delta {
                        final_reasoning.get_or_insert_with(String::new).push_str(&r);
                    }
                }
                StreamEvent::ToolEvent { tool_event } => {
                    final_tool_events.push(tool_event);
                }
                StreamEvent::Done { finish_reason, full_text, full_reasoning, tool_calls, usage } => {
                    if full_text.is_some() {
                        final_text = full_text;
                    }
                    if full_reasoning.is_some() {
                        final_reasoning = full_reasoning;
                    }
                    if tool_calls.is_some() {
                        final_tool_calls = tool_calls;
                    }
                    final_finish_reason = finish_reason;
                    if let Some(u) = usage {
                        final_usage = u;
                    } else {
                        let comp_len = final_text.as_ref().map(|s| s.chars().count() as u32).unwrap_or(0);
                        final_usage = Usage {
                            prompt_tokens: 10,
                            completion_tokens: comp_len,
                            total_tokens: 10 + comp_len,
                        };
                    }
                    break;
                }
                StreamEvent::Error { error, code } => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse::new(error, "server_error", code)),
                    )
                        .into_response();
                }
            }
        }

        let resp = ChatCompletionResponse {
            id: request_id,
            object: "chat.completion".to_string(),
            created,
            model,
            choices: vec![ChatCompletionChoice {
                index: 0,
                message: ChatCompletionChoiceMessage {
                    role: "assistant".to_string(),
                    content: final_text,
                    reasoning_content: final_reasoning,
                    tool_calls: final_tool_calls,
                    tool_events: if final_tool_events.is_empty() {
                        None
                    } else {
                        Some(final_tool_events)
                    },
                },
                finish_reason: final_finish_reason,
            }],
            usage: final_usage,
        };

        Json(resp).into_response()
    }
}

// ----------------------------------------------------------------------------
// WebSocket Handler (/ws and /extension-bridge)
// ----------------------------------------------------------------------------

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<AppState>,
) -> Response {
    if let Some(expected_token) = state.bridge.expected_extension_token() {
        if query.token.as_deref() != Some(expected_token) {
            return (
                StatusCode::UNAUTHORIZED,
                "Unauthorized: invalid extension token",
            )
                .into_response();
        }
    }

    ws.on_upgrade(move |socket| handle_ws_connection(socket, state.bridge))
}

async fn handle_ws_connection(socket: WebSocket, bridge: Arc<BridgeManager>) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<BridgeToExtensionMessage>();

    bridge.register_connection(tx.clone()).await;

    // Task to forward outgoing messages to WebSocket sink
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Ok(json_str) = serde_json::to_string(&msg) {
                if let Err(e) = ws_sink.send(WsMessage::Text(json_str.into())).await {
                    debug!("Failed to send message over WS: {}", e);
                    break;
                }
            }
        }
    });

    // Read incoming messages from WebSocket stream
    while let Some(Ok(msg)) = ws_stream.next().await {
        match msg {
            WsMessage::Text(text) => {
                match serde_json::from_str::<BridgeFromExtensionMessage>(&text) {
                    Ok(parsed) => {
                        bridge.handle_incoming_message(parsed).await;
                    }
                    Err(e) => {
                        warn!("Failed to parse incoming WS message: {} (raw: {})", e, text);
                    }
                }
            }
            WsMessage::Ping(_data) => {
                debug!("Received WS ping from extension");
            }
            WsMessage::Close(_) => {
                info!("WebSocket client sent close frame");
                break;
            }
            _ => {}
        }
    }

    write_task.abort();
    bridge.unregister_connection().await;
}
