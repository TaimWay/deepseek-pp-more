use api_external_relay::bridge::BridgeManager;
use api_external_relay::handlers::{
    chat_completions_handler, get_model_handler, health_handler, list_models_handler, AppState,
};
use api_external_relay::types::{
    BridgeFromExtensionMessage, BridgeToExtensionMessage, ChatCompletionResponse, ModelCard,
    ModelListResponse, ToolEventStatus, Usage,
};
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tokio::sync::mpsc;
use tower::ServiceExt;

fn create_test_router(api_key: Option<String>) -> (Router, Arc<BridgeManager>) {
    let bridge = Arc::new(BridgeManager::new(None));
    let app_state = AppState {
        bridge: bridge.clone(),
        api_key,
    };

    let router = Router::new()
        .route("/health", get(health_handler))
        .route("/models", get(list_models_handler))
        .route("/v1/models", get(list_models_handler))
        .route("/models/{model}", get(get_model_handler))
        .route("/v1/models/{model}", get(get_model_handler))
        .route("/chat/completions", post(chat_completions_handler))
        .route("/v1/chat/completions", post(chat_completions_handler))
        .with_state(app_state);

    (router, bridge)
}

#[tokio::test]
async fn test_health_endpoint() {
    let (app, _) = create_test_router(None);
    let req = Request::builder()
        .uri("/health")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ok");
    assert_eq!(json["service"], "deepseek-pp-api-external-relay");
}

#[tokio::test]
async fn test_models_list_endpoint() {
    let (app, _) = create_test_router(None);
    let req = Request::builder()
        .uri("/v1/models")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let models: ModelListResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(models.object, "list");
    assert!(models.data.iter().any(|m| m.id == "deepseek-v4-flash"));
    assert!(models.data.iter().any(|m| m.id == "deepseek-v4-pro"));
}

#[tokio::test]
async fn test_single_model_endpoint() {
    let (app, _) = create_test_router(None);
    let req = Request::builder()
        .uri("/v1/models/deepseek-v4-pro")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let model: ModelCard = serde_json::from_slice(&body).unwrap();
    assert_eq!(model.id, "deepseek-v4-pro");
    assert_eq!(model.object, "model");
    assert_eq!(model.owned_by, "deepseek-pp");
}

#[tokio::test]
async fn test_api_key_auth_enforcement() {
    let (app, _) = create_test_router(Some("secret-key-123".to_string()));

    // 1. Missing Authorization header -> 401
    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"hi"}]}"#))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // 2. Wrong Authorization key -> 401
    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .header("authorization", "Bearer wrong-key")
        .body(Body::from(r#"{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"hi"}]}"#))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_chat_completions_extension_disconnected() {
    let (app, _) = create_test_router(None);

    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"hello"}]}"#))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);

    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"]["type"], "service_unavailable");
}

#[tokio::test]
async fn test_chat_completions_non_streaming_success() {
    let (app, bridge) = create_test_router(None);
    let (mock_tx, mut mock_rx) = mpsc::unbounded_channel::<BridgeToExtensionMessage>();

    // Connect mock extension
    bridge.register_connection(mock_tx).await;

    // Background task to simulate extension answering request
    let bridge_clone = bridge.clone();
    tokio::spawn(async move {
        while let Some(msg) = mock_rx.recv().await {
            match msg {
                BridgeToExtensionMessage::ChatCompletionRequest { id, .. } => {
                    // Send chunk with reasoning
                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ChatChunk {
                            id: id.clone(),
                            text_delta: None,
                            reasoning_delta: Some("Thinking through the problem...".to_string()),
                            phase: Some("reasoning".to_string()),
                            tool_calls: None,
                        })
                        .await;

                    // Send chunk with text
                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ChatChunk {
                            id: id.clone(),
                            text_delta: Some("Hello from DeepSeek++!".to_string()),
                            reasoning_delta: None,
                            phase: Some("answer".to_string()),
                            tool_calls: None,
                        })
                        .await;

                    // Send done
                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ChatDone {
                            id,
                            finish_reason: Some("stop".to_string()),
                            full_text: Some("Hello from DeepSeek++!".to_string()),
                            full_reasoning: Some("Thinking through the problem...".to_string()),
                            tool_calls: None,
                            usage: Some(Usage {
                                prompt_tokens: 15,
                                completion_tokens: 10,
                                total_tokens: 25,
                            }),
                        })
                        .await;
                }
                _ => {}
            }
        }
    });

    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{
                "model": "deepseek-v4-flash",
                "messages": [
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": "Hello!"}
                ],
                "thinking": {"type": "enabled"},
                "reasoning_effort": "high",
                "stream": false
            }"#,
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let completion: ChatCompletionResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(completion.object, "chat.completion");
    assert_eq!(completion.model, "deepseek-v4-flash");
    assert_eq!(completion.choices.len(), 1);
    assert_eq!(completion.choices[0].message.role, "assistant");
    assert_eq!(
        completion.choices[0].message.content.as_deref(),
        Some("Hello from DeepSeek++!")
    );
    assert_eq!(
        completion.choices[0].message.reasoning_content.as_deref(),
        Some("Thinking through the problem...")
    );
    assert_eq!(completion.usage.total_tokens, 25);
}

#[tokio::test]
async fn test_chat_completions_streaming_sse() {
    let (app, bridge) = create_test_router(None);
    let (mock_tx, mut mock_rx) = mpsc::unbounded_channel::<BridgeToExtensionMessage>();

    bridge.register_connection(mock_tx).await;

    let bridge_clone = bridge.clone();
    tokio::spawn(async move {
        while let Some(msg) = mock_rx.recv().await {
            match msg {
                BridgeToExtensionMessage::ChatCompletionRequest { id, .. } => {
                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ChatChunk {
                            id: id.clone(),
                            text_delta: Some("Streaming chunk 1".to_string()),
                            reasoning_delta: None,
                            phase: Some("answer".to_string()),
                            tool_calls: None,
                        })
                        .await;

                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ChatDone {
                            id,
                            finish_reason: Some("stop".to_string()),
                            full_text: Some("Streaming chunk 1".to_string()),
                            full_reasoning: None,
                            tool_calls: None,
                            usage: Some(Usage {
                                prompt_tokens: 5,
                                completion_tokens: 5,
                                total_tokens: 10,
                            }),
                        })
                        .await;
                }
                _ => {}
            }
        }
    });

    let req = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{
                "model": "deepseek-v4-flash",
                "messages": [{"role": "user", "content": "Stream me"}],
                "stream": true
            }"#,
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers().get("content-type").unwrap(),
        "text/event-stream; charset=utf-8"
    );

    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body_str = String::from_utf8(body.to_vec()).unwrap();
    assert!(body_str.contains("data: "));
    assert!(body_str.contains("Streaming chunk 1"));
    assert!(body_str.contains("data: [DONE]"));
}

/// Parse SSE body into the list of JSON payloads (skips `[DONE]` terminator).
fn parse_sse_data(body: &str) -> Vec<serde_json::Value> {
    body.lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .filter(|payload| *payload != "[DONE]")
        .filter_map(|payload| serde_json::from_str(payload).ok())
        .collect()
}

/// Extract all `choices[0].delta.tool_events` entries from parsed SSE payloads.
fn collect_sse_tool_events(payloads: &[serde_json::Value]) -> Vec<serde_json::Value> {
    payloads
        .iter()
        .filter_map(|p| p["choices"][0]["delta"]["tool_events"].as_array())
        .flatten()
        .cloned()
        .collect()
}

#[tokio::test]
async fn test_tool_event_streams_over_sse() {
    let (app, bridge) = create_test_router(None);
    let (mock_tx, mut mock_rx) = mpsc::unbounded_channel::<BridgeToExtensionMessage>();

    bridge.register_connection(mock_tx).await;

    let bridge_clone = bridge.clone();
    tokio::spawn(async move {
        while let Some(msg) = mock_rx.recv().await {
            match msg {
                BridgeToExtensionMessage::ChatCompletionRequest { id, .. } => {
                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ToolEvent {
                            id: id.clone(),
                            tool_name: "web_search".to_string(),
                            status: ToolEventStatus::Started,
                            result: None,
                        })
                        .await;

                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ChatChunk {
                            id: id.clone(),
                            text_delta: Some("Searching the web".to_string()),
                            reasoning_delta: None,
                            phase: Some("answer".to_string()),
                            tool_calls: None,
                        })
                        .await;

                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ToolEvent {
                            id: id.clone(),
                            tool_name: "web_search".to_string(),
                            status: ToolEventStatus::Succeeded,
                            result: Some("3 results found".to_string()),
                        })
                        .await;

                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ChatDone {
                            id,
                            finish_reason: Some("stop".to_string()),
                            full_text: Some("Searching the web".to_string()),
                            full_reasoning: None,
                            tool_calls: None,
                            usage: Some(Usage {
                                prompt_tokens: 5,
                                completion_tokens: 5,
                                total_tokens: 10,
                            }),
                        })
                        .await;
                }
                _ => {}
            }
        }
    });

    let req = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{
                "model": "deepseek-v4-flash",
                "messages": [{"role": "user", "content": "Search for me"}],
                "stream": true
            }"#,
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body_str = String::from_utf8(body.to_vec()).unwrap();
    assert!(body_str.contains("data: [DONE]"));

    let payloads = parse_sse_data(&body_str);
    let tool_events = collect_sse_tool_events(&payloads);
    assert_eq!(tool_events.len(), 2, "expected 2 tool events, got {:?}", tool_events);

    assert_eq!(tool_events[0]["id"], tool_events[1]["id"]);
    assert_eq!(tool_events[0]["tool_name"], "web_search");
    assert_eq!(tool_events[0]["status"], "started");
    assert!(tool_events[0].get("result").is_none());

    assert_eq!(tool_events[1]["tool_name"], "web_search");
    assert_eq!(tool_events[1]["status"], "succeeded");
    assert_eq!(tool_events[1]["result"], "3 results found");

    // The tool-event chunks share the stream id/model/created of text chunks.
    let text_chunk = payloads
        .iter()
        .find(|p| p["choices"][0]["delta"]["content"] == "Searching the web")
        .unwrap();
    let event_chunk = payloads
        .iter()
        .find(|p| p["choices"][0]["delta"]["tool_events"].is_array())
        .unwrap();
    assert_eq!(text_chunk["id"], event_chunk["id"]);
    assert_eq!(text_chunk["model"], event_chunk["model"]);
    assert_eq!(text_chunk["created"], event_chunk["created"]);
}

#[tokio::test]
async fn test_sse_without_tool_events_omits_tool_events_field() {
    let (app, bridge) = create_test_router(None);
    let (mock_tx, mut mock_rx) = mpsc::unbounded_channel::<BridgeToExtensionMessage>();

    bridge.register_connection(mock_tx).await;

    let bridge_clone = bridge.clone();
    tokio::spawn(async move {
        while let Some(msg) = mock_rx.recv().await {
            match msg {
                BridgeToExtensionMessage::ChatCompletionRequest { id, .. } => {
                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ChatChunk {
                            id: id.clone(),
                            text_delta: Some("Plain answer".to_string()),
                            reasoning_delta: None,
                            phase: Some("answer".to_string()),
                            tool_calls: None,
                        })
                        .await;

                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ChatDone {
                            id,
                            finish_reason: Some("stop".to_string()),
                            full_text: Some("Plain answer".to_string()),
                            full_reasoning: None,
                            tool_calls: None,
                            usage: Some(Usage {
                                prompt_tokens: 5,
                                completion_tokens: 5,
                                total_tokens: 10,
                            }),
                        })
                        .await;
                }
                _ => {}
            }
        }
    });

    let req = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{
                "model": "deepseek-v4-flash",
                "messages": [{"role": "user", "content": "Plain please"}],
                "stream": true
            }"#,
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body_str = String::from_utf8(body.to_vec()).unwrap();

    // Absence of the field anywhere in the wire output = byte-identical to
    // the pre-tool-event relay output.
    assert!(
        !body_str.contains("tool_events"),
        "tool_events must not appear when absent, got: {}",
        body_str
    );
    assert!(body_str.contains("Plain answer"));
    assert!(body_str.contains("data: [DONE]"));
}

#[tokio::test]
async fn test_models_list_exact_catalog() {
    let (app, _) = create_test_router(None);
    let req = Request::builder()
        .uri("/v1/models")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let models: ModelListResponse = serde_json::from_slice(&body).unwrap();

    let ids: Vec<&str> = models.data.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "deepseek-v4-flash",
            "deepseek-v4-pro",
            "deepseek-v4-vision",
            "deepseek-chat",
            "deepseek-reasoner",
        ]
    );
}

#[tokio::test]
async fn test_tool_events_accumulated_in_non_streaming_response() {
    let (app, bridge) = create_test_router(None);
    let (mock_tx, mut mock_rx) = mpsc::unbounded_channel::<BridgeToExtensionMessage>();

    bridge.register_connection(mock_tx).await;

    let bridge_clone = bridge.clone();
    tokio::spawn(async move {
        while let Some(msg) = mock_rx.recv().await {
            match msg {
                BridgeToExtensionMessage::ChatCompletionRequest { id, .. } => {
                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ToolEvent {
                            id: id.clone(),
                            tool_name: "web_fetch".to_string(),
                            status: ToolEventStatus::Started,
                            result: None,
                        })
                        .await;

                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ToolEvent {
                            id: id.clone(),
                            tool_name: "web_fetch".to_string(),
                            status: ToolEventStatus::Failed,
                            result: Some("HTTP 404".to_string()),
                        })
                        .await;

                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ChatChunk {
                            id: id.clone(),
                            text_delta: Some("Final text".to_string()),
                            reasoning_delta: None,
                            phase: Some("answer".to_string()),
                            tool_calls: None,
                        })
                        .await;

                    bridge_clone
                        .handle_incoming_message(BridgeFromExtensionMessage::ChatDone {
                            id,
                            finish_reason: Some("stop".to_string()),
                            full_text: Some("Final text".to_string()),
                            full_reasoning: None,
                            tool_calls: None,
                            usage: Some(Usage {
                                prompt_tokens: 5,
                                completion_tokens: 5,
                                total_tokens: 10,
                            }),
                        })
                        .await;
                }
                _ => {}
            }
        }
    });

    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{
                "model": "deepseek-v4-flash",
                "messages": [{"role": "user", "content": "Fetch a page"}],
                "stream": false
            }"#,
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let completion: ChatCompletionResponse = serde_json::from_slice(&body).unwrap();

    let tool_events = completion.choices[0]
        .message
        .tool_events
        .as_ref()
        .expect("final message must carry accumulated tool_events");
    assert_eq!(tool_events.len(), 2);
    assert_eq!(tool_events[0].tool_name, "web_fetch");
    assert_eq!(tool_events[0].status, ToolEventStatus::Started);
    assert_eq!(tool_events[1].tool_name, "web_fetch");
    assert_eq!(tool_events[1].status, ToolEventStatus::Failed);
    assert_eq!(tool_events[1].result.as_deref(), Some("HTTP 404"));
}

#[tokio::test]
async fn test_multi_api_key_sync_and_validation() {
    let (app, bridge) = create_test_router(None);

    // Sync 2 keys from extension
    bridge
        .handle_incoming_message(BridgeFromExtensionMessage::SyncApiKeys {
            keys: vec!["sk-key-1".to_string(), "sk-key-2".to_string()],
        })
        .await;

    // 1. Valid key 1 -> 503 (since extension mock is not attached, but authentication passes)
    let req1 = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .header("authorization", "Bearer sk-key-1")
        .body(Body::from(r#"{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"hi"}]}"#))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::SERVICE_UNAVAILABLE); // 503 = auth passed, bridge not connected

    // 2. Valid key 2 -> 503
    let req2 = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .header("authorization", "Bearer sk-key-2")
        .body(Body::from(r#"{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"hi"}]}"#))
        .unwrap();
    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::SERVICE_UNAVAILABLE);

    // 3. Invalid key 3 -> 401 Unauthorized
    let req3 = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .header("authorization", "Bearer sk-invalid")
        .body(Body::from(r#"{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"hi"}]}"#))
        .unwrap();
    let resp3 = app.clone().oneshot(req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_ping_pong_message_handling() {
    let (_app, bridge) = create_test_router(None);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    bridge.register_connection(tx).await;

    // Discard handshake init
    let init = rx.recv().await.unwrap();
    match init {
        BridgeToExtensionMessage::HandshakeInit { .. } => {}
        other => panic!("Expected HandshakeInit, got {:?}", other),
    }

    // Send PING from extension to bridge
    bridge
        .handle_incoming_message(BridgeFromExtensionMessage::Ping { timestamp: 123456789 })
        .await;

    // Bridge should reply with PONG
    let pong = rx.recv().await.unwrap();
    match pong {
        BridgeToExtensionMessage::Pong { timestamp } => {
            assert_eq!(timestamp, 123456789);
        }
        other => panic!("Expected Pong, got {:?}", other),
    }
}


