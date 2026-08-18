export const DEFAULT_EXTERNAL_API_HOST = '127.0.0.1';
export const DEFAULT_EXTERNAL_API_RELAY_URL = 'ws://127.0.0.1:3000/ws';
export const DEFAULT_EXTERNAL_API_PORT = 3000;

export type ExternalApiKeyMode = 'full_agent' | 'proxy_only';

export interface ExternalApiKey {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  usageCount: number;
  enabled: boolean;
  mode?: ExternalApiKeyMode;
  allowAgentTools?: boolean;
  allowMultimodal?: boolean;
  injectSystemInfo?: boolean;
  enableMemory?: boolean;
  overrideModel?: string;
  backend?: ExternalApiBackend;
}

export interface ExternalApiToolFunction {
  name: string;
  arguments: string;
}

export interface ExternalApiToolCall {
  id: string;
  type: 'function';
  function: ExternalApiToolFunction;
}

export interface ExternalApiTextContentPart {
  type: 'text';
  text: string;
}

export interface ExternalApiImageUrlContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: string;
  };
}

export interface ExternalApiFileContentPart {
  type: 'file' | 'input_file';
  file?: {
    file_id?: string;
    data?: string;
    mime_type?: string;
    name?: string;
  };
}

export type ExternalApiContentPart =
  | ExternalApiTextContentPart
  | ExternalApiImageUrlContentPart
  | ExternalApiFileContentPart
  | { type: string; [key: string]: unknown };

export interface ExternalApiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | ExternalApiContentPart[] | null;
  reasoning_content?: string;
  thinking_content?: string;
  name?: string;
  tool_calls?: ExternalApiToolCall[];
  tool_call_id?: string;
}

export interface ExternalApiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type ExternalApiBackend = 'auto' | 'web' | 'official-api';

export interface ExternalApiConfig {
  enabled: boolean;
  relayHost: string;
  relayWsUrl: string;
  apiKey: string; // legacy single key / fallback
  apiKeys: ExternalApiKey[]; // managed key collection
  extensionToken: string;
  preferredBackend: ExternalApiBackend;
  defaultModel: string;
  corsEnabled: boolean;
  autoStartRelay: boolean;
  relayPort: number;
  allowAgentTools: boolean;
  allowMultimodal: boolean;
  injectSystemInfo: boolean;
  enableMemory: boolean;
}

export const DEFAULT_EXTERNAL_API_CONFIG: ExternalApiConfig = {
  enabled: true,
  relayHost: DEFAULT_EXTERNAL_API_HOST,
  relayWsUrl: DEFAULT_EXTERNAL_API_RELAY_URL,
  apiKey: '',
  apiKeys: [],
  extensionToken: '',
  preferredBackend: 'auto',
  defaultModel: 'deepseek-v4-flash',
  corsEnabled: true,
  autoStartRelay: false,
  relayPort: DEFAULT_EXTERNAL_API_PORT,
  allowAgentTools: true,
  allowMultimodal: true,
  injectSystemInfo: true,
  enableMemory: false,
};

export interface ExternalApiStatus {
  enabled: boolean;
  connected: boolean;
  relayWsUrl: string;
  activeRequests: number;
  lastConnectedAt: number | null;
  lastError: string | null;
  latencyMs?: number | null;
}

export interface ExternalApiProcessStatus {
  running: boolean;
  pid: number | null;
  port: number;
  nativeHostAvailable: boolean;
  lastCheckedAt: number;
  errorMessage: string | null;
}

// ----------------------------------------------------------------------------
// Bridge Messages (Between Relay WebSocket Server and Browser Extension)
// ----------------------------------------------------------------------------

export interface BridgeToExtensionHandshakeInit {
  type: 'HANDSHAKE_INIT';
  relay_version: string;
  required_auth: boolean;
}

export interface BridgeToExtensionChatRequest {
  type: 'CHAT_COMPLETION_REQUEST';
  id: string;
  model: string;
  messages: ExternalApiChatMessage[];
  stream: boolean;
  thinking: boolean;
  reasoning_effort: string;
  temperature?: number;
  max_tokens?: number;
  used_api_key?: string;
  api_key?: string;
  session_id?: string;
  tools?: ExternalApiToolDefinition[];
  tool_choice?: unknown;
}

export interface BridgeToExtensionCancelRequest {
  type: 'CANCEL_REQUEST';
  id: string;
}

export interface BridgeToExtensionPing {
  type: 'PING';
  timestamp: number;
}

export interface BridgeToExtensionKeyUsed {
  type: 'KEY_USED';
  key: string;
  model?: string;
  tokens?: number;
}

export type BridgeToExtensionMessage =
  | BridgeToExtensionHandshakeInit
  | BridgeToExtensionChatRequest
  | BridgeToExtensionCancelRequest
  | BridgeToExtensionPing
  | BridgeToExtensionKeyUsed;

export interface BridgeFromExtensionHandshakeAck {
  type: 'HANDSHAKE_ACK';
  status: 'ok' | 'auth_failed';
  version?: string;
  has_deepseek_auth?: boolean;
  has_official_api_key?: boolean;
  supported_models?: string[];
  authorized_api_keys?: string[];
}

export interface BridgeFromExtensionSyncKeys {
  type: 'SYNC_API_KEYS';
  keys: string[];
}

export interface BridgeFromExtensionChatChunk {
  type: 'CHAT_CHUNK';
  id: string;
  text_delta?: string;
  reasoning_delta?: string;
  phase?: 'reasoning' | 'answer';
  tool_calls?: ExternalApiToolCall[];
}

export interface BridgeFromExtensionChatDone {
  type: 'CHAT_DONE';
  id: string;
  finish_reason?: 'stop' | 'length' | 'tool_calls' | string;
  full_text?: string;
  full_reasoning?: string;
  tool_calls?: ExternalApiToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface BridgeFromExtensionChatError {
  type: 'CHAT_ERROR';
  id: string;
  error: string;
  code?: string;
}

export interface BridgeFromExtensionPing {
  type: 'PING';
  timestamp: number;
}

export interface BridgeFromExtensionPong {
  type: 'PONG';
  timestamp: number;
}

export interface BridgeFromExtensionToolEvent {
  type: 'TOOL_EVENT';
  id: string;
  tool_name: string;
  status: 'started' | 'succeeded' | 'failed';
  result?: string;
}

export type BridgeFromExtensionMessage =
  | BridgeFromExtensionHandshakeAck
  | BridgeFromExtensionSyncKeys
  | BridgeFromExtensionChatChunk
  | BridgeFromExtensionChatDone
  | BridgeFromExtensionChatError
  | BridgeFromExtensionPing
  | BridgeFromExtensionPong
  | BridgeFromExtensionToolEvent;

export const DEFAULT_EXTERNAL_API_SESSION_KEY = 'system-post';
export const EXTERNAL_API_SESSIONS_STORAGE_KEY = 'deepseek_pp_external_api_sessions';

export interface ExternalApiSessionMeta {
  chatSessionId: string;
  sessionKey: string;
  title?: string;
  createdAt: number;
  lastUsedAt: number;
  messageCount: number;
  model: string;
}


