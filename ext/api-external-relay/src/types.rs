use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub r#type: String,
    pub function: ToolCallFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallChunkFunction {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallChunk {
    pub index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    pub function: ToolCallChunkFunction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolEventStatus {
    Started,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolEvent {
    pub id: String,
    pub tool_name: String,
    pub status: ToolEventStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(default)]
    pub content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ThinkingParam {
    Object { r#type: String },
    Bool(bool),
    String(String),
}

impl ThinkingParam {
    pub fn is_enabled(&self) -> bool {
        match self {
            Self::Object { r#type } => r#type == "enabled" || r#type == "enable",
            Self::Bool(b) => *b,
            Self::String(s) => s == "enabled" || s == "enable" || s == "true",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    #[serde(default = "default_model")]
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub stream: Option<bool>,
    #[serde(default)]
    pub thinking: Option<ThinkingParam>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub top_p: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub presence_penalty: Option<f32>,
    #[serde(default)]
    pub frequency_penalty: Option<f32>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "conversation_id", alias = "chat_id", alias = "chatId", alias = "sessionId")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<serde_json::Value>,
}

fn default_model() -> String {
    "deepseek-v4-flash".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionChoiceMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_events: Option<Vec<ToolEvent>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionChoice {
    pub index: usize,
    pub message: ChatCompletionChoiceMessage,
    pub finish_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<ChatCompletionChoice>,
    pub usage: Usage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionChunkDelta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallChunk>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_events: Option<Vec<ToolEvent>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionChunkChoice {
    pub index: usize,
    pub delta: ChatCompletionChunkDelta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionChunk {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<ChatCompletionChunkChoice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCard {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub owned_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelListResponse {
    pub object: String,
    pub data: Vec<ModelCard>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorDetail {
    pub message: String,
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub param: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

impl ErrorResponse {
    pub fn new(message: impl Into<String>, error_type: impl Into<String>, code: Option<impl Into<String>>) -> Self {
        Self {
            error: ErrorDetail {
                message: message.into(),
                r#type: error_type.into(),
                param: None,
                code: code.map(Into::into),
            },
        }
    }
}

// ----------------------------------------------------------------------------
// Bridge Messages (WebSocket protocol between Relay and DeepSeek++ Extension)
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BridgeToExtensionMessage {
    #[serde(rename = "HANDSHAKE_INIT")]
    HandshakeInit {
        relay_version: String,
        required_auth: bool,
    },
    #[serde(rename = "CHAT_COMPLETION_REQUEST")]
    ChatCompletionRequest {
        id: String,
        model: String,
        messages: Vec<ChatMessage>,
        stream: bool,
        thinking: bool,
        reasoning_effort: String,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tools: Option<Vec<serde_json::Value>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_choice: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        api_key: Option<String>,
    },
    #[serde(rename = "CANCEL_REQUEST")]
    CancelRequest {
        id: String,
    },
    #[serde(rename = "PING")]
    Ping {
        timestamp: u64,
    },
    #[serde(rename = "PONG")]
    Pong {
        timestamp: u64,
    },
    #[serde(rename = "KEY_USED")]
    KeyUsed {
        key: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tokens: Option<u32>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BridgeFromExtensionMessage {
    #[serde(rename = "HANDSHAKE_ACK")]
    HandshakeAck {
        status: String,
        version: Option<String>,
        has_deepseek_auth: Option<bool>,
        has_official_api_key: Option<bool>,
        supported_models: Option<Vec<String>>,
        authorized_api_keys: Option<Vec<String>>,
    },
    #[serde(rename = "SYNC_API_KEYS")]
    SyncApiKeys {
        keys: Vec<String>,
    },
    #[serde(rename = "CHAT_CHUNK")]
    ChatChunk {
        id: String,
        text_delta: Option<String>,
        reasoning_delta: Option<String>,
        phase: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_calls: Option<Vec<ToolCallChunk>>,
    },
    #[serde(rename = "CHAT_DONE")]
    ChatDone {
        id: String,
        finish_reason: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        full_text: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        full_reasoning: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_calls: Option<Vec<ToolCall>>,
        usage: Option<Usage>,
    },
    #[serde(rename = "CHAT_ERROR")]
    ChatError {
        id: String,
        error: String,
        code: Option<String>,
    },
    #[serde(rename = "PING")]
    Ping {
        timestamp: u64,
    },
    #[serde(rename = "PONG")]
    Pong {
        timestamp: u64,
    },
    #[serde(rename = "TOOL_EVENT")]
    ToolEvent {
        id: String,
        tool_name: String,
        status: ToolEventStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<String>,
    },
}
