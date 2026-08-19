import type { SubmitPromptInput, ModelTurn } from '../deepseek/automation-client-port';
import type {
  OfficialDeepSeekCallbacks,
  OfficialDeepSeekMessage,
  OfficialDeepSeekTurn,
  SubmitOfficialDeepSeekInput,
} from '../deepseek/official-api';
import type { OfficialDeepSeekModel, OfficialDeepSeekReasoningEffort } from '../chat/official-api-config-contract';
import {
  buildMultimodalAnalysisPrompt,
  type MultimodalMediaAnalyzeRequest,
  type MultimodalMediaAnalyzeResponse,
  type MultimodalMediaInput,
  type MultimodalMediaKind,
} from '../multimodal';
import { getMultimodalSettingsStatus } from '../multimodal/settings';
import {
  DEFAULT_EXTERNAL_API_SESSION_KEY,
  EXTERNAL_API_MODEL_CATALOG,
  EXTERNAL_API_RELAY_AUTH_GATE_MESSAGE,
  getFirstAuthorizedApiKey,
  hasEnabledExternalApiKeys,
  isLoopbackHost,
  type BridgeFromExtensionMessage,
  type BridgeToExtensionChatRequest,
  type BridgeToExtensionMessage,
  type ExternalApiBackend,
  type ExternalApiChatMessage,
  type ExternalApiConfig,
  type ExternalApiContentPart,
  type ExternalApiImageUrlContentPart,
  type ExternalApiFileContentPart,
  type ExternalApiStatus,
  type ExternalApiTextContentPart,
  type ExternalApiToolCall,
  type ExternalApiToolDefinition,
  type ExternalApiSessionMeta,
} from './contracts';
import {
  loadActiveExternalApiSessions,
  recordApiKeyUsage,
  recordExternalApiSession,
  removeExternalApiSessions,
} from './store';
import { isNativeHostAvailable, startRelayProcess } from './process';
import { logDebug, logInfo, logWarn, logError } from '../diagnostics/log-buffer';
import type { ToolCall, ToolDescriptor, ToolProviderIdentity, ToolResult } from '../tool/types';
import type { JsonValue } from '../tool/types';
import type { RuntimeToolCallOptions } from '../tool/runtime';
import { extractToolCalls, stripToolCalls } from '../interceptor/tool-parser';
import { createStreamingToolTextAccumulator } from '../interceptor/streaming-tool-text';

import type { DeepSeekUploadedFile } from '../deepseek/contracts';

export interface ExternalApiToolExecutionRecord {
  name: string;
  provider?: ToolProviderIdentity;
  result: ToolResult;
}

export interface ExternalApiPromptBuildRequest {
  prompt: string;
  isFirstMessage: boolean;
  messageCount: number;
  allowAgentTools?: boolean;
  injectSystemInfo?: boolean;
  enableMemory?: boolean;
  effectiveModel?: string;
  clientTools?: ExternalApiToolDefinition[];
}

export interface ExternalApiPromptBuildResult {
  augmented: string;
  enabledDescriptors: ToolDescriptor[];
}

export interface ExternalApiServiceDependencies {
  getConfig(): Promise<ExternalApiConfig>;
  getDeepSeekApiKey(): Promise<string | null>;
  loadClientHeaders(preferredTabId?: number): Promise<Record<string, string> | null>;
  createChatSession(headers: Record<string, string>, signal: AbortSignal): Promise<string>;
  createPowHeaders(headers: Record<string, string>, signal: AbortSignal): Promise<Record<string, string>>;
  uploadFile?(
    input: {
      file: Blob;
      filename: string;
      modelType: string | null;
      clientHeaders: Record<string, string>;
      powHeaders?: Record<string, string>;
    },
    signal?: AbortSignal,
  ): Promise<DeepSeekUploadedFile | null>;
  analyzeMultimodalMedia?(request: MultimodalMediaAnalyzeRequest): Promise<MultimodalMediaAnalyzeResponse>;
  submitWebPrompt(
    input: {
      chatSessionId: string;
      parentMessageId: number | null;
      modelType: string | null;
      prompt: string;
      refFileIds: string[];
      thinkingEnabled: boolean;
      searchEnabled: boolean;
      clientHeaders: Record<string, string>;
      powHeaders: Record<string, string>;
    },
    callbacks: {
      onTextChunk(chunk: string, accumulated: string): void;
      onReasoningChunk(chunk: string, accumulated: string): void;
    },
    signal: AbortSignal,
  ): Promise<ModelTurn>;
  submitOfficialPrompt(
    input: {
      apiKey: string;
      config?: {
        model: OfficialDeepSeekModel;
        thinking: 'enabled' | 'disabled';
        reasoningEffort: OfficialDeepSeekReasoningEffort;
      };
      messages: OfficialDeepSeekMessage[];
    },
    callbacks: {
      onTextChunk(chunk: string, accumulated: string): void;
      onReasoningChunk(chunk: string, accumulated: string): void;
    },
    signal: AbortSignal,
  ): Promise<OfficialDeepSeekTurn>;
  buildPrompt?(request: ExternalApiPromptBuildRequest): Promise<ExternalApiPromptBuildResult>;
  executeToolCall?(call: ToolCall, options?: RuntimeToolCallOptions): Promise<ToolResult>;
  getToolDescriptors?(): Promise<ToolDescriptor[]>;
  continueWithToolResults?(toolResults: string): string;
  onStatusChange?(status: ExternalApiStatus): void;
  reportError?(code: string, error: unknown): void;
  WebSocketImpl?: typeof WebSocket;
}

export interface ExternalApiService {
  start(): Promise<void>;
  stop(): void;
  reconnect(): Promise<void>;
  ensureConnected(): Promise<void>;
  getStatus(): ExternalApiStatus;
  handleConfigUpdated(newConfig: ExternalApiConfig): Promise<void>;
  getPendingInterceptions(): Array<{ id: string; timestamp: number; request: BridgeToExtensionChatRequest }>;
  resolveInterception(id: string, action: 'approve' | 'reject', modified?: BridgeToExtensionChatRequest): boolean;
}

export interface ResolvedCallPolicy {
  isProxyOnly: boolean;
  allowAgentTools: boolean;
  allowMultimodal: boolean;
  injectSystemInfo: boolean;
  enableMemory: boolean;
  effectiveModel: string;
  effectiveBackend: ExternalApiBackend;
  toolGranularSettings?: Record<string, boolean>;
  maxToolSteps?: number;
}

const RECONNECT_INTERVALS_MS = [1000, 2000, 4000, 8000];
const HEARTBEAT_INTERVAL_MS = 15000;
const STREAM_STALL_TIMEOUT_MS = 45000;

const CLIENT_TOOL_PROVIDER: ToolProviderIdentity = {
  kind: 'local',
  id: 'client',
  displayName: 'External Client',
  transport: 'in_process',
};

export function convertClientToolsToDescriptors(tools?: ExternalApiToolDefinition[]): ToolDescriptor[] {
  if (!tools || tools.length === 0) return [];
  return tools.map((t) => ({
    id: `client:${t.function.name}`,
    name: t.function.name,
    title: t.function.name,
    invocationName: t.function.name,
    provider: CLIENT_TOOL_PROVIDER,
    description: t.function.description || `Client function ${t.function.name}`,
    inputSchema: {
      type: 'object',
      properties: (t.function.parameters?.properties as Record<string, JsonValue> | undefined) || {},
      required: (t.function.parameters?.required as string[] | undefined) || [],
    },
    execution: {
      mode: 'auto',
      enabled: true,
      risk: 'low',
    },
  }));
}

export class ExternalApiModelError extends Error {
  readonly code = 'model_not_supported';

  constructor(model: string) {
    super(`Requested model "${model}" is not supported by the external API.`);
    this.name = 'ExternalApiModelError';
  }
}

export interface ResolvedDeepSeekModelParams {
  webModelType: string | null;
  thinkingEnabled: boolean;
  officialModel: OfficialDeepSeekModel;
}

export function resolveDeepSeekModelParams(
  requestedModel?: string,
  explicitThinking?: boolean,
): ResolvedDeepSeekModelParams {
  const modelLower = (requestedModel || '').toLowerCase().trim();
  let webModelType: string | null = null;
  let thinkingEnabled = explicitThinking ?? false;
  let officialModel: OfficialDeepSeekModel = 'deepseek-v4-flash';

  if (
    modelLower.includes('pro') ||
    modelLower.includes('reasoner') ||
    modelLower.includes('r1') ||
    modelLower.includes('expert')
  ) {
    webModelType = 'expert';
    thinkingEnabled = true;
    officialModel = 'deepseek-v4-pro';
  } else if (
    modelLower.includes('vision') ||
    modelLower.includes('image') ||
    modelLower.includes('multimodal')
  ) {
    webModelType = 'vision';
  } else if (
    modelLower === 'deepseek-v4-flash' ||
    modelLower === 'deepseek-chat' ||
    modelLower === 'chat'
  ) {
    webModelType = null;
    officialModel = 'deepseek-v4-flash';
  } else {
    throw new ExternalApiModelError(requestedModel || '');
  }

  if (explicitThinking !== undefined) {
    thinkingEnabled = explicitThinking;
  }

  return { webModelType, thinkingEnabled, officialModel };
}

export function createExternalApiService(
  dependencies: ExternalApiServiceDependencies,
): ExternalApiService {
  const WebSocketClass = dependencies.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);

  let currentConfig: ExternalApiConfig | null = null;
  let ws: WebSocket | null = null;
  let isRunning = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let lastConnectedAt: number | null = null;
  let lastError: string | null = null;
  let latencyMs: number | null = null;
  const activeControllers = new Map<string, AbortController>();

  function getStatus(): ExternalApiStatus {
    const openState = WebSocketClass?.OPEN ?? 1;
    return {
      enabled: currentConfig?.enabled ?? false,
      connected: ws !== null && ws.readyState === openState,
      relayWsUrl: currentConfig?.relayWsUrl ?? '',
      activeRequests: activeControllers.size,
      lastConnectedAt,
      lastError,
      latencyMs,
    };
  }

  function emitStatusUpdate() {
    dependencies.onStatusChange?.(getStatus());
  }

  function getAuthorizedApiKeys(config: ExternalApiConfig): string[] {
    if (!hasEnabledExternalApiKeys(config)) return [];
    const active = config.apiKeys.filter((k) => k.enabled).map((k) => k.key);
    if (active.length > 0) return active;
    return [config.apiKey.trim()];
  }

  function startHeartbeat() {
    stopHeartbeat();
    pingTimer = setInterval(() => {
      const openState = WebSocketClass?.OPEN ?? 1;
      if (ws && ws.readyState === openState) {
        sendToRelay({ type: 'PING', timestamp: Date.now() });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function scheduleReconnect() {
    if (!isRunning || !currentConfig?.enabled) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);

    const baseDelay = RECONNECT_INTERVALS_MS[Math.min(reconnectAttempt, RECONNECT_INTERVALS_MS.length - 1)];
    const jitter = Math.floor(Math.random() * 500);
    const delay = baseDelay + jitter;
    reconnectAttempt++;

    reconnectTimer = setTimeout(() => {
      if (isRunning && currentConfig?.enabled) {
        void connectWs();
      }
    }, delay);
  }

  function sendToRelay(msg: BridgeFromExtensionMessage) {
    const openState = WebSocketClass?.OPEN ?? 1;
    if (!ws || ws.readyState !== openState) {
      return;
    }
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      dependencies.reportError?.('external_api_ws_send_failed', err);
    }
  }

  async function connectWs(options?: { waitConnect?: boolean }): Promise<void> {
    if (!WebSocketClass) {
      lastError = 'WebSocket is not available in current environment.';
      emitStatusUpdate();
      return;
    }

    if (!currentConfig) {
      currentConfig = await dependencies.getConfig();
    }

    if (!currentConfig.enabled) {
      return;
    }

    if (currentConfig.autoStartRelay !== false && reconnectAttempt === 0) {
      try {
        const nativeAvailable = await isNativeHostAvailable();
        if (nativeAvailable) {
          const port = currentConfig.relayPort || 3000;
          if (!isLoopbackHost(currentConfig.relayHost) && !hasEnabledExternalApiKeys(currentConfig)) {
            lastError = EXTERNAL_API_RELAY_AUTH_GATE_MESSAGE;
            emitStatusUpdate();
            return;
          }
          await startRelayProcess({
            host: currentConfig.relayHost,
            port,
            apiKey: getFirstAuthorizedApiKey(currentConfig),
            extensionToken: currentConfig.extensionToken,
          });
        }
      } catch {}
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      try {
        if (ws) {
          try {
            ws.close();
          } catch {}
          ws = null;
        }

        let wsUrl = currentConfig!.relayWsUrl;
        if (currentConfig!.extensionToken) {
          const separator = wsUrl.includes('?') ? '&' : '?';
          wsUrl = `${wsUrl}${separator}token=${encodeURIComponent(currentConfig!.extensionToken)}`;
        }

        const socket = new WebSocketClass(wsUrl);
        ws = socket;

        const connectTimeout = options?.waitConnect
          ? setTimeout(() => {
              settle();
            }, 2500)
          : null;

        socket.onopen = async () => {
          if (connectTimeout) clearTimeout(connectTimeout);
          if (ws !== socket) {
            settle();
            return;
          }
          reconnectAttempt = 0;
          lastConnectedAt = Date.now();
          lastError = null;
          emitStatusUpdate();
          startHeartbeat();

          const [apiKey, clientHeaders] = await Promise.all([
            dependencies.getDeepSeekApiKey().catch(() => null),
            dependencies.loadClientHeaders().catch(() => null),
          ]);

          const authorizedKeys = currentConfig ? getAuthorizedApiKeys(currentConfig) : [];

          sendToRelay({
            type: 'HANDSHAKE_ACK',
            status: 'ok',
            version: '1.14.0',
            has_deepseek_auth: Boolean(clientHeaders),
            has_official_api_key: Boolean(apiKey),
            supported_models: [...EXTERNAL_API_MODEL_CATALOG],
            authorized_api_keys: authorizedKeys,
          });

          settle();
        };

        socket.onmessage = (event) => {
          if (ws !== socket) return;
          try {
            const raw = typeof event.data === 'string' ? event.data : '';
            const msg = JSON.parse(raw) as BridgeToExtensionMessage;
            handleIncomingBridgeMessage(msg);
          } catch (err) {
            dependencies.reportError?.('external_api_message_parse_failed', err);
          }
        };

        socket.onerror = () => {
          if (connectTimeout) clearTimeout(connectTimeout);
          if (ws !== socket) {
            settle();
            return;
          }
          lastError = 'WebSocket connection error';
          emitStatusUpdate();
          settle();
        };

        socket.onclose = () => {
          if (connectTimeout) clearTimeout(connectTimeout);
          if (ws !== socket) {
            settle();
            return;
          }
          ws = null;
          stopHeartbeat();
          emitStatusUpdate();
          if (isRunning && currentConfig?.enabled) {
            scheduleReconnect();
          }
          settle();
        };

        if (!options?.waitConnect) {
          settle();
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        emitStatusUpdate();
        settle();
      }
    });
  }

  function handleIncomingBridgeMessage(msg: BridgeToExtensionMessage) {
    switch (msg.type) {
      case 'HANDSHAKE_INIT':
        // Relay server ready
        break;
      case 'CHAT_COMPLETION_REQUEST':
        void processChatCompletionRequest(msg);
        break;
      case 'CANCEL_REQUEST': {
        const controller = activeControllers.get(msg.id);
        if (controller) {
          controller.abort();
          activeControllers.delete(msg.id);
          emitStatusUpdate();
        }
        break;
      }
      case 'PING':
        sendToRelay({ type: 'PONG', timestamp: msg.timestamp });
        break;
      case 'KEY_USED':
        if (msg.key) {
          void recordApiKeyUsage(msg.key).then((updated) => {
            if (updated) {
              currentConfig = updated;
              emitStatusUpdate();
            }
          });
        }
        break;
    }
  }

  const sessionStore = new Map<string, ExternalApiSessionMeta>();
  let sessionsHydrated = false;

  const pendingInterceptions = new Map<
    string,
    {
      request: BridgeToExtensionChatRequest;
      timestamp: number;
      resolve: (req: BridgeToExtensionChatRequest) => void;
      reject: (err: Error) => void;
    }
  >();

  async function ensureSessionsHydrated(): Promise<void> {
    if (sessionsHydrated) return;
    try {
      const loaded = await loadActiveExternalApiSessions();
      for (const [k, v] of loaded) {
        sessionStore.set(k, v);
      }
      sessionsHydrated = true;
    } catch {
      // Ignore load failures
    }
  }

  async function processChatCompletionRequest(initialRequest: BridgeToExtensionChatRequest) {
    let request = initialRequest;
    const controller = new AbortController();
    activeControllers.set(request.id, controller);
    emitStatusUpdate();

    await ensureSessionsHydrated();

    const config = currentConfig ?? (await dependencies.getConfig());

    // Request interception gate (Developer Options)
    if (config.interceptRequests) {
      logInfo('external_api', `Intercepted request [${request.id}] pending developer approval`);
      try {
        request = await new Promise<BridgeToExtensionChatRequest>((resolve, reject) => {
          pendingInterceptions.set(request.id, {
            request,
            timestamp: Date.now(),
            resolve: (modified) => {
              pendingInterceptions.delete(request.id);
              resolve(modified);
            },
            reject: (err) => {
              pendingInterceptions.delete(request.id);
              reject(err);
            },
          });
        });
      } catch (interceptionErr) {
        sendToRelay({
          type: 'CHAT_ERROR',
          id: request.id,
          error: interceptionErr instanceof Error ? interceptionErr.message : 'Request rejected by developer',
          code: 'request_rejected',
        });
        return;
      }
    }

    const usedKey = request.api_key || request.used_api_key;
    if (usedKey) {
      void recordApiKeyUsage(usedKey).then((updated) => {
        if (updated) {
          currentConfig = updated;
          emitStatusUpdate();
        }
      });
    }

    try {
      const apiKey = await dependencies.getDeepSeekApiKey().catch(() => null);
      const config = currentConfig ?? (await dependencies.getConfig());

      const matchedKey =
        (usedKey ? config.apiKeys.find((k) => k.key === usedKey || k.key.trim() === usedKey.trim()) : null) ||
        config.apiKeys.find((k) => k.enabled);

      const isProxyOnly = matchedKey?.mode === 'proxy_only';
      const allowAgentTools = isProxyOnly ? false : (matchedKey?.allowAgentTools ?? config.allowAgentTools ?? true);
      const allowMultimodal = matchedKey?.allowMultimodal ?? config.allowMultimodal ?? true;
      const injectSystemInfo = matchedKey?.injectSystemInfo ?? config.injectSystemInfo ?? true;
      const enableMemory = matchedKey?.enableMemory ?? config.enableMemory ?? false;
      let effectiveBackend =
        matchedKey?.backend && matchedKey.backend !== 'auto' ? matchedKey.backend : config.preferredBackend;
      const effectiveModel =
        request.model || matchedKey?.overrideModel || config.defaultModel || 'deepseek-v4-flash';

      const mediaCollection = collectMultimodalMediaInputs(request.messages);
      const requestedVision = effectiveModel.toLowerCase().includes('vision');

      // If user specifically requested vision model, but official API backend has no multimodal provider configured,
      // route to DeepSeek Web backend where native vision is supported.
      if (requestedVision && effectiveBackend === 'auto') {
        const officialVisionConfigured = await isMultimodalProviderConfigured();
        if (!officialVisionConfigured) {
          effectiveBackend = 'web';
        }
      }

      const callPolicy: ResolvedCallPolicy = {
        isProxyOnly,
        allowAgentTools,
        allowMultimodal,
        injectSystemInfo,
        enableMemory,
        effectiveModel,
        effectiveBackend,
        toolGranularSettings: config.toolGranularSettings,
        maxToolSteps: config.maxToolSteps,
      };

      const shouldUseOfficialApi =
        effectiveBackend === 'official-api' ||
        (effectiveBackend === 'auto' && Boolean(apiKey));

      const lastMessage = request.messages[request.messages.length - 1];
      const lastMessageContent = extractMessageText(lastMessage?.content);
      const requestLogDetails = [
        `Backend: ${shouldUseOfficialApi ? 'official-api' : 'web'}`,
        `Effective Model: ${effectiveModel}`,
        `Stream: ${request.stream ?? false}`,
        `Messages: ${request.messages.length}`,
        `Session Key: ${getSessionKey(request)}`,
        `Thinking: ${request.thinking ?? 'auto'}`,
        `Client Tools: ${request.tools?.length ? request.tools.map((t) => t.function?.name || 'function').join(', ') : 'none'}`,
        `Last Message (${lastMessage?.role || 'unknown'}): ${lastMessageContent.slice(0, 160)}${lastMessageContent.length > 160 ? '...' : ''}`,
      ].join('\n');

      logInfo('external_api', `Received request [${request.id}]`, requestLogDetails);

      if (shouldUseOfficialApi && apiKey) {
        await executeViaOfficialApi(request, apiKey, callPolicy, controller.signal);
      } else {
        await executeViaWebSession(request, callPolicy, controller.signal);
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logError('external_api', `Chat request failed: ${request.id}`, errorMessage);
        sendToRelay({
          type: 'CHAT_ERROR',
          id: request.id,
          error: errorMessage,
          code: err instanceof ExternalApiModelError ? err.code : 'stream_error',
        });
      }
    } finally {
      activeControllers.delete(request.id);
      emitStatusUpdate();
    }
  }

  const MAX_CHAT_TOOL_STEPS = 20;

  function getSessionKey(request: BridgeToExtensionChatRequest): string {
    if (request.session_id && request.session_id.trim()) {
      return request.session_id.trim();
    }
    if (request.user && request.user.trim()) {
      return `user-${request.user.trim()}`;
    }
    const firstUserMsg = request.messages.find((m) => m.role === 'user');
    if (firstUserMsg) {
      const text = extractMessageText(firstUserMsg.content).trim();
      if (text) {
        const cleanSlug = text
          .replace(/[^\p{L}\p{N}\s_-]/gu, '')
          .trim()
          .slice(0, 24)
          .replace(/\s+/g, '-');
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
          hash = (hash << 5) - hash + text.charCodeAt(i);
          hash |= 0;
        }
        const hex = Math.abs(hash).toString(16).slice(0, 6);
        return cleanSlug ? `chat-${cleanSlug}-${hex}` : `chat-${hex}`;
      }
    }
    return DEFAULT_EXTERNAL_API_SESSION_KEY;
  }

  function cleanWebSessionText(text: string): string {
    return text.replace(/^Link reading is unavailable in Expert Mode\. Please use Instant Mode\.\s*/i, '');
  }

  function extractMessageText(content?: string | ExternalApiContentPart[] | null): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object') {
            if (part.type === 'text' && typeof (part as ExternalApiTextContentPart).text === 'string') {
              return (part as ExternalApiTextContentPart).text;
            }
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    return String(content);
  }

  function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const trimmed = dataUrl.trim();
    const match = /^data:([a-zA-Z0-9+\/.-]+)(?:;[a-zA-Z0-9_-]+=[^;]+)*;base64,([A-Za-z0-9+/=\r\n\s]+)$/s.exec(trimmed);
    if (match) {
      return {
        mimeType: match[1].toLowerCase(),
        base64: match[2].replace(/[\r\n\s]+/g, ''),
      };
    }
    const clean = trimmed.replace(/[\r\n\s]+/g, '');
    if (clean.length > 50 && /^[A-Za-z0-9+/]+=*$/.test(clean)) {
      let mime = 'image/jpeg';
      if (clean.startsWith('iVBORw0KGgo')) mime = 'image/png';
      else if (clean.startsWith('R0lGOD')) mime = 'image/gif';
      else if (clean.startsWith('UklGR')) mime = 'image/webp';
      else if (clean.startsWith('/9j/')) mime = 'image/jpeg';
      return { mimeType: mime, base64: clean };
    }
    return null;
  }

  function base64ToBlob(base64: string, mimeType: string): { blob: Blob; filename: string } | null {
    try {
      const clean = base64.replace(/[\r\n\s]+/g, '');
      const byteCharacters = atob(clean);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const ext = mimeType.split('/')[1] || 'png';
      return {
        blob: new Blob([byteArray], { type: mimeType }),
        filename: `upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`,
      };
    } catch {
      return null;
    }
  }

  function dataUrlToBlob(dataUrl: string): { blob: Blob; filename: string } | null {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return null;
    return base64ToBlob(parsed.base64, parsed.mimeType);
  }

  async function fetchUrlToBlob(url: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string } | null> {
    try {
      const resp = await fetch(url, { signal });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const mimeType = blob.type || 'image/jpeg';
      const ext = mimeType.split('/')[1] || 'jpg';
      return {
        blob: new Blob([await blob.arrayBuffer()], { type: mimeType }),
        filename: `upload_${Date.now()}.${ext}`,
      };
    } catch {
      return null;
    }
  }

  interface MultimodalMediaCollection {
    media: MultimodalMediaInput[];
    hasUnroutableMedia: boolean;
  }

  interface MultimodalMediaPartInput {
    id: string;
    kind: MultimodalMediaKind;
    name: string;
    mimeType: string;
    base64Body: string;
    dataUrl?: string;
  }

  async function extractAllImageBlobs(
    messages: ExternalApiChatMessage[],
    signal?: AbortSignal,
  ): Promise<Array<{ blob: Blob; filename: string; fileId?: string }>> {
    const results: Array<{ blob: Blob; filename: string; fileId?: string }> = [];

    for (const msg of messages) {
      const rawImages = (msg as any).images || (msg as any).files;
      if (Array.isArray(rawImages)) {
        for (const img of rawImages) {
          if (typeof img === 'string') {
            const parsed = parseDataUrl(img);
            if (parsed) {
              const blobInfo = base64ToBlob(parsed.base64, parsed.mimeType);
              if (blobInfo) results.push(blobInfo);
            } else if (img.startsWith('http://') || img.startsWith('https://')) {
              const fetched = await fetchUrlToBlob(img, signal);
              if (fetched) results.push(fetched);
            }
          }
        }
      }

      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (!part || typeof part !== 'object') continue;
          const p = part as any;

          if (p.type === 'image_url') {
            const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url;
            if (typeof url === 'string') {
              const parsed = parseDataUrl(url);
              if (parsed) {
                const blobInfo = base64ToBlob(parsed.base64, parsed.mimeType);
                if (blobInfo) results.push(blobInfo);
              } else if (url.startsWith('http://') || url.startsWith('https://')) {
                const fetched = await fetchUrlToBlob(url, signal);
                if (fetched) results.push(fetched);
              }
            }
          } else if (p.type === 'image') {
            const src = p.source;
            if (src?.data && typeof src.data === 'string') {
              const mime = src.media_type || 'image/png';
              const blobInfo = base64ToBlob(src.data, mime);
              if (blobInfo) results.push(blobInfo);
            } else if (typeof p.image === 'string') {
              const parsed = parseDataUrl(p.image);
              if (parsed) {
                const blobInfo = base64ToBlob(parsed.base64, parsed.mimeType);
                if (blobInfo) results.push(blobInfo);
              }
            }
          } else if (p.type === 'file' || p.type === 'input_file') {
            if (p.file?.file_id) {
              results.push({ blob: new Blob([]), filename: '', fileId: p.file.file_id });
            } else if (p.file?.data && typeof p.file.data === 'string') {
              const parsed = parseDataUrl(p.file.data);
              if (parsed) {
                const blobInfo = base64ToBlob(parsed.base64, parsed.mimeType);
                if (blobInfo) results.push(blobInfo);
              }
            }
          }
        }
      }
    }

    return results;
  }

  function collectMultimodalMediaInputs(messages: ExternalApiChatMessage[]): MultimodalMediaCollection {
    const media: MultimodalMediaInput[] = [];
    let hasUnroutableMedia = false;
    let imageIndex = 0;
    let fileIndex = 0;

    for (const msg of messages) {
      const rawImages = (msg as any).images || (msg as any).files;
      if (Array.isArray(rawImages)) {
        for (const img of rawImages) {
          if (typeof img === 'string') {
            const parsed = parseDataUrl(img);
            if (parsed && parsed.mimeType.startsWith('image/')) {
              const index = imageIndex++;
              const input = buildMultimodalMediaPartInput({
                id: `external-media-image-${index}`,
                kind: 'image',
                name: `image-${index}.${extensionFromMime(parsed.mimeType)}`,
                mimeType: parsed.mimeType,
                base64Body: parsed.base64,
                dataUrl: `data:${parsed.mimeType};base64,${parsed.base64}`,
              });
              if (!input) hasUnroutableMedia = true;
              else media.push(input);
            } else {
              hasUnroutableMedia = true;
            }
          }
        }
      }

      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as any;
        if (p.type === 'image_url') {
          const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url;
          const parsed = url ? parseDataUrl(url) : null;
          if (!parsed || !parsed.mimeType.startsWith('image/')) {
            hasUnroutableMedia = true;
            continue;
          }
          const index = imageIndex++;
          const input = buildMultimodalMediaPartInput({
            id: `external-media-image-${index}`,
            kind: 'image',
            name: `image-${index}.${extensionFromMime(parsed.mimeType)}`,
            mimeType: parsed.mimeType,
            base64Body: parsed.base64,
            dataUrl: url && url.startsWith('data:') ? url : `data:${parsed.mimeType};base64,${parsed.base64}`,
          });
          if (!input) hasUnroutableMedia = true;
          else media.push(input);
        } else if (p.type === 'image') {
          const src = p.source;
          const rawData = src?.data || p.image;
          const parsed = typeof rawData === 'string' ? parseDataUrl(rawData) : null;
          const mimeType = (src?.media_type || parsed?.mimeType || 'image/png').toLowerCase();
          const base64Body = parsed?.base64 || (typeof rawData === 'string' ? rawData : '');
          if (!base64Body || !mimeType.startsWith('image/')) {
            hasUnroutableMedia = true;
            continue;
          }
          const index = imageIndex++;
          const input = buildMultimodalMediaPartInput({
            id: `external-media-image-${index}`,
            kind: 'image',
            name: `image-${index}.${extensionFromMime(mimeType)}`,
            mimeType,
            base64Body,
            dataUrl: `data:${mimeType};base64,${base64Body}`,
          });
          if (!input) hasUnroutableMedia = true;
          else media.push(input);
        } else if (p.type === 'file' || p.type === 'input_file') {
          const file = p.file;
          if (!file || typeof file.data !== 'string' || !file.data) {
            hasUnroutableMedia = true;
            continue;
          }
          let mimeType = (file.mime_type || '').toLowerCase();
          let base64Body = file.data;
          let dataUrl: string | undefined;
          if (file.data.startsWith('data:') || file.data.length > 50) {
            const parsed = parseDataUrl(file.data);
            if (parsed) {
              mimeType = parsed.mimeType;
              base64Body = parsed.base64;
              dataUrl = `data:${mimeType};base64,${base64Body}`;
            }
          }
          if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
            hasUnroutableMedia = true;
            continue;
          }
          const kind: MultimodalMediaKind = mimeType.startsWith('image/') ? 'image' : 'video';
          const index = fileIndex++;
          const input = buildMultimodalMediaPartInput({
            id: `external-media-file-${index}`,
            kind,
            name: file.name || `${kind}-${index}.${extensionFromMime(mimeType)}`,
            mimeType,
            base64Body,
            dataUrl: dataUrl ?? (kind === 'image' ? `data:${mimeType};base64,${base64Body}` : undefined),
          });
          if (!input) hasUnroutableMedia = true;
          else media.push(input);
        }
      }
    }
    return { media, hasUnroutableMedia };
  }

  function buildMultimodalMediaPartInput(part: MultimodalMediaPartInput): MultimodalMediaInput | null {
    const sizeBytes = base64DecodedLength(part.base64Body);
    if (sizeBytes === null) return null;
    return {
      id: part.id,
      kind: part.kind,
      name: part.name,
      mimeType: part.mimeType,
      sizeBytes,
      dataUrl: part.kind === 'image' ? part.dataUrl : undefined,
      base64Data: part.kind === 'video' ? part.base64Body : undefined,
    };
  }

  function base64DecodedLength(value: string): number | null {
    const clean = value.replace(/[\r\n\s]+/g, '');
    if (!/^[A-Za-z0-9+/]+=*$/.test(clean)) return null;
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    return Math.floor(clean.length / 4) * 3 - padding;
  }

  function extensionFromMime(mimeType: string): string {
    const ext = mimeType.split('/')[1];
    return ext && /^[a-z0-9]{1,10}$/.test(ext) ? ext : 'bin';
  }

  async function isMultimodalProviderConfigured(): Promise<boolean> {
    try {
      const status = await getMultimodalSettingsStatus();
      return Boolean(status.openaiConfigured || status.geminiConfigured);
    } catch {
      return false;
    }
  }

  function serializeToolExecutions(
    executions: readonly ExternalApiToolExecutionRecord[],
    webModelType?: string | null,
  ): string {
    return executions
      .map((execution) => {
        let detail =
          typeof execution.result.output === 'string'
            ? execution.result.output
            : JSON.stringify(execution.result.output ?? execution.result.detail ?? execution.result.summary);

        // DeepSeek Web in expert mode (R1) intercepts raw http:// and https:// URLs in user prompts
        // and emits "Link reading is unavailable in Expert Mode. Please use Instant Mode."
        // We sanitize raw URL schemes in tool results when feeding back to DeepSeek Web in expert mode.
        if (webModelType === 'expert') {
          detail = detail.replace(/https?:\/\//gi, 'source-url://');
        }

        return `<${execution.name}_result>\n${detail}\n</${execution.name}_result>`;
      })
      .join('\n');
  }

  async function executeViaOfficialApi(
    request: BridgeToExtensionChatRequest,
    apiKey: string,
    callPolicy: ResolvedCallPolicy,
    signal: AbortSignal,
  ) {
    const { officialModel, thinkingEnabled } = resolveDeepSeekModelParams(
      callPolicy.effectiveModel,
      request.thinking,
    );
    const thinking = thinkingEnabled ? 'enabled' : 'disabled';
    const reasoningEffort: OfficialDeepSeekReasoningEffort =
      request.reasoning_effort === 'max' ? 'max' : 'high';

    const clientDescriptors = convertClientToolsToDescriptors(request.tools);
    const builtInDescriptors =
      callPolicy.allowAgentTools && dependencies.getToolDescriptors
        ? await dependencies.getToolDescriptors().catch(() => [])
        : [];
    let availableDescriptors: ToolDescriptor[] = [...builtInDescriptors, ...clientDescriptors];
    let messages = mapMessagesToOfficialApi(request.messages);

    const firstUserIndex = messages.findIndex((m) => m.role === 'user');
    const systemMessages = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => extractMessageText(m.content))
      .filter(Boolean)
      .join('\n\n');
    const firstUserText =
      extractMessageText(request.messages.find((m) => m.role === 'user')?.content) || '';

    // The official DeepSeek API has no image input, so media parts are routed
    // through the existing multimodal analysis pipeline and the analysis text
    // is prepended to the first user message. Media that cannot be routed on
    // this backend fails explicitly instead of being silently dropped.
    let effectiveFirstUserText = firstUserText;
    const mediaCollection = collectMultimodalMediaInputs(request.messages);
    if (mediaCollection.media.length > 0 || mediaCollection.hasUnroutableMedia) {
      const analysisAvailable =
        callPolicy.allowMultimodal &&
        !mediaCollection.hasUnroutableMedia &&
        Boolean(dependencies.analyzeMultimodalMedia) &&
        (await isMultimodalProviderConfigured());
      if (!analysisAvailable || mediaCollection.media.length === 0) {
        sendToRelay({
          type: 'CHAT_ERROR',
          id: request.id,
          error:
            'Multimodal media is not supported on the official API backend without a configured multimodal provider.',
          code: 'multimodal_unavailable',
        });
        return;
      }
      const analysisResponse = await dependencies.analyzeMultimodalMedia!({
        prompt: firstUserText,
        media: mediaCollection.media,
      });
      if (!analysisResponse.ok) {
        sendToRelay({
          type: 'CHAT_ERROR',
          id: request.id,
          error: analysisResponse.error || 'Multimodal media analysis failed.',
          code: 'multimodal_analysis_failed',
        });
        return;
      }
      effectiveFirstUserText = buildMultimodalAnalysisPrompt(firstUserText, analysisResponse.analyses);
    }

    // First-turn prompt augmentation mirrors the web path: system info,
    // built-in + client tool schemas, and memory when enabled are injected
    // into the first user message before it reaches the model.
    if (dependencies.buildPrompt && firstUserIndex >= 0) {
      const buildRes = await dependencies.buildPrompt({
        prompt: effectiveFirstUserText,
        isFirstMessage: true,
        messageCount: 1,
        allowAgentTools: callPolicy.allowAgentTools,
        injectSystemInfo: callPolicy.injectSystemInfo,
        enableMemory: callPolicy.enableMemory,
        effectiveModel: callPolicy.effectiveModel,
        clientTools: request.tools,
      });
      const augmentedUser = systemMessages
        ? `[System Instruction]:\n${systemMessages}\n\n${buildRes.augmented}`
        : buildRes.augmented;
      messages[firstUserIndex] = { role: 'user', content: augmentedUser };
      availableDescriptors = [
        ...builtInDescriptors,
        ...buildRes.enabledDescriptors,
        ...clientDescriptors,
      ];
    } else if (firstUserIndex >= 0 && effectiveFirstUserText !== firstUserText) {
      messages[firstUserIndex] = {
        role: 'user',
        content: systemMessages
          ? `[System Instruction]:\n${systemMessages}\n\n${effectiveFirstUserText}`
          : effectiveFirstUserText,
      };
    }

    let stepCount = 0;

    while (stepCount < MAX_CHAT_TOOL_STEPS) {
      stepCount++;
      let fullText = '';
      let fullReasoning = '';
      let lastChunkTime = Date.now();
      const textAccumulator = createStreamingToolTextAccumulator(availableDescriptors);
      let lastEmittedLength = 0;

      const stallChecker = setInterval(() => {
        if (Date.now() - lastChunkTime > STREAM_STALL_TIMEOUT_MS) {
          clearInterval(stallChecker);
          sendToRelay({
            type: 'CHAT_ERROR',
            id: request.id,
            error: 'Official API response stream stalled (timeout)',
            code: 'stream_timeout',
          });
        }
      }, 5000);

      let turn: OfficialDeepSeekTurn;
      try {
        turn = await dependencies.submitOfficialPrompt(
          {
            apiKey,
            config: {
              model: officialModel,
              thinking,
              reasoningEffort,
            },
            messages,
          },
          {
            onTextChunk: (chunk, acc) => {
              lastChunkTime = Date.now();
              fullText = acc;
              const visible = textAccumulator.append(chunk);
              if (visible.length > lastEmittedLength) {
                const delta = visible.slice(lastEmittedLength);
                lastEmittedLength = visible.length;
                sendToRelay({
                  type: 'CHAT_CHUNK',
                  id: request.id,
                  text_delta: delta,
                  phase: 'answer',
                });
              }
            },
            onReasoningChunk: (chunk, acc) => {
              lastChunkTime = Date.now();
              fullReasoning = acc;
              sendToRelay({
                type: 'CHAT_CHUNK',
                id: request.id,
                reasoning_delta: chunk,
                phase: 'reasoning',
              });
            },
          },
          signal,
        );
      } finally {
        clearInterval(stallChecker);
      }

      const finalVisible = textAccumulator.flush();
      if (finalVisible.length > lastEmittedLength) {
        const delta = finalVisible.slice(lastEmittedLength);
        lastEmittedLength = finalVisible.length;
        sendToRelay({
          type: 'CHAT_CHUNK',
          id: request.id,
          text_delta: delta,
          phase: 'answer',
        });
      }

      const rawAssistantText = turn.assistantText || fullText;

      // Parse tool calls from the official response using the same
      // descriptor set the web path uses (built-ins + enabled + client).
      const toolCalls = extractToolCalls(rawAssistantText, {
        descriptors: availableDescriptors,
      });

      if (toolCalls.length === 0) {
        const cleanFinalText = stripToolCalls(rawAssistantText, {
          descriptors: availableDescriptors,
        });
        sendToRelay({
          type: 'CHAT_DONE',
          id: request.id,
          finish_reason: turn.finished ? 'stop' : 'length',
          full_text: cleanFinalText,
          full_reasoning: turn.reasoningText || fullReasoning || undefined,
          usage: {
            prompt_tokens: Math.ceil(messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) / 4),
            completion_tokens: Math.ceil(cleanFinalText.length / 4),
            total_tokens: Math.ceil(
              (messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) +
                cleanFinalText.length) /
                4,
            ),
          },
        });
        return;
      }

      // Client-declared tool calls return to the caller as tool_calls.
      const clientCalls = toolCalls.filter((c) =>
        request.tools?.some((t) => t.function.name === c.name),
      );

      if (clientCalls.length > 0) {
        const openAiToolCalls: ExternalApiToolCall[] = clientCalls.map((c, i) => ({
          id: c.id || `call_${request.id}_${stepCount}_${i}`,
          type: 'function',
          function: {
            name: c.name,
            arguments: typeof c.payload === 'string' ? c.payload : JSON.stringify(c.payload),
          },
        }));

        sendToRelay({
          type: 'CHAT_DONE',
          id: request.id,
          finish_reason: 'tool_calls',
          full_text: stripToolCalls(rawAssistantText, { descriptors: availableDescriptors }),
          full_reasoning: turn.reasoningText || fullReasoning || undefined,
          tool_calls: openAiToolCalls,
          usage: {
            prompt_tokens: Math.ceil(messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) / 4),
            completion_tokens: Math.ceil(rawAssistantText.length / 4),
            total_tokens: Math.ceil(
              (messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) +
                rawAssistantText.length) /
                4,
            ),
          },
        });
        return;
      }

      // Built-in tool calls execute through the runtime authorization path
      // and the loop continues with the results, mirroring the web path.
      if (callPolicy.allowAgentTools && dependencies.executeToolCall) {
        const executions: ExternalApiToolExecutionRecord[] = [];
        for (const call of toolCalls) {
          sendToRelay({
            type: 'TOOL_EVENT',
            id: request.id,
            tool_name: call.name,
            status: 'started',
          });

          logInfo(
            'external_api',
            `Executing Agent Call [${call.name}] for request ${request.id}`,
            JSON.stringify({ tool: call.name, payload: call.payload }, null, 2),
          );

          let result: ToolResult;
          try {
            result = await dependencies.executeToolCall(call, {
              trustedCapabilityScopeId: `external_api:${request.id}`,
            });
          } catch (execErr) {
            const errMessage = execErr instanceof Error ? execErr.message : String(execErr);
            sendToRelay({
              type: 'TOOL_EVENT',
              id: request.id,
              tool_name: call.name,
              status: 'failed',
              result: errMessage,
            });
            sendToRelay({
              type: 'CHAT_ERROR',
              id: request.id,
              error: errMessage,
              code: 'tool_execution_failed',
            });
            return;
          }
          executions.push({
            name: call.name,
            provider: call.provider,
            result,
          });

          sendToRelay({
            type: 'TOOL_EVENT',
            id: request.id,
            tool_name: call.name,
            status: result.ok ? 'succeeded' : 'failed',
            result: typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? result.detail ?? ''),
          });

          logInfo(
            'external_api',
            `Agent Call completed [${call.name}] result=${result.ok ? 'SUCCESS' : 'FAILED'}`,
            result.summary || result.detail || (typeof result.output === 'string' ? result.output : ''),
          );
        }

        const serialized = serializeToolExecutions(executions);
        const toolResultContent = dependencies.continueWithToolResults
          ? dependencies.continueWithToolResults(serialized)
          : `[Tool Results]:\n${serialized}`;
        messages = [...messages, { role: 'user', content: toolResultContent }];
      } else {
        // No executor available, finish as stop
        const promptTokens = Math.ceil(messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) / 4);
        const completionTokens = Math.ceil(rawAssistantText.length / 4);
        const totalTokens = promptTokens + completionTokens;

        sendToRelay({
          type: 'CHAT_DONE',
          id: request.id,
          finish_reason: 'stop',
          full_text: stripToolCalls(rawAssistantText, { descriptors: availableDescriptors }),
          full_reasoning: turn.reasoningText || fullReasoning || undefined,
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
          },
        });

        logInfo(
          'external_api',
          `Official API Request Completed [${request.id}]`,
          `Tokens: ${promptTokens} prompt + ${completionTokens} completion = ${totalTokens} total`,
        );
        return;
      }
    }
  }

  async function executeViaWebSession(
    request: BridgeToExtensionChatRequest,
    callPolicy: ResolvedCallPolicy,
    signal: AbortSignal,
  ) {
    const { webModelType, thinkingEnabled } = resolveDeepSeekModelParams(
      callPolicy.effectiveModel,
      request.thinking,
    );
    const headers = await dependencies.loadClientHeaders();
    if (!headers) {
      throw new Error(
        'DeepSeek Web login session not found. Please log in to chat.deepseek.com or configure an official DeepSeek API key in extension settings.',
      );
    }

    const sessionKey = getSessionKey(request);
    await ensureSessionsHydrated();
    let session = sessionStore.get(sessionKey);
    let chatSessionId: string;
    let parentMessageId: number | null = null;
    let isFirstTurn = false;
    const refFileIds: string[] = [];

    const userMessages = request.messages.filter((m) => m.role === 'user');
    const assistantMessages = request.messages.filter((m) => m.role === 'assistant');
    const firstUserMsg = userMessages[0];
    const firstUserText = firstUserMsg ? extractMessageText(firstUserMsg.content).trim() : '';

    // If there are assistant messages, this is turn 2+ of a conversation.
    // If there are 0 assistant messages, the external program is initiating a brand new conversation.
    const isMultiTurnTranscript = assistantMessages.length > 0;

    const canResumeExistingSession =
      Boolean(session) &&
      isMultiTurnTranscript &&
      (!session?.firstUserMessage || session.firstUserMessage === firstUserText);

    if (session && canResumeExistingSession) {
      chatSessionId = session.chatSessionId;
      parentMessageId = session.parentMessageId ?? null;
      session.lastUsedAt = Date.now();
      session.messageCount = (session.messageCount || 1) + 1;
      if (!session.firstUserMessage && firstUserText) {
        session.firstUserMessage = firstUserText;
      }
      await recordExternalApiSession(session);
    } else {
      chatSessionId = await dependencies.createChatSession(headers, signal);
      isFirstTurn = true;
      session = {
        chatSessionId,
        sessionKey,
        parentMessageId: null,
        lastUsedAt: Date.now(),
        createdAt: Date.now(),
        messageCount: 1,
        model: callPolicy.effectiveModel,
        refFileIds: [],
        firstUserMessage: firstUserText,
      };
      sessionStore.set(sessionKey, session);
      await recordExternalApiSession(session);
    }

    // Multimodal image attachments handling: extract strictly from current request
    let hasImages = false;
    refFileIds.length = 0;

    if (callPolicy.allowMultimodal) {
      const extractedImages = await extractAllImageBlobs(request.messages, signal);
      for (const img of extractedImages) {
        if (img.fileId) {
          if (!refFileIds.includes(img.fileId)) refFileIds.push(img.fileId);
          hasImages = true;
        } else if (img.blob && img.blob.size > 0 && dependencies.uploadFile) {
          try {
            const uploaded = await dependencies.uploadFile(
              {
                file: img.blob,
                filename: img.filename,
                modelType: 'vision',
                clientHeaders: headers,
              },
              signal,
            );
            if (uploaded?.id) {
              if (!refFileIds.includes(uploaded.id)) refFileIds.push(uploaded.id);
              hasImages = true;
            }
          } catch (err) {
            dependencies.reportError?.('external_api_file_upload_failed', err);
            logError('external_api', `Image upload failed for ${img.filename}`, err instanceof Error ? err.message : String(err));
          }
        }
      }
    }

    const effectiveModelType = (hasImages || refFileIds.length > 0) && callPolicy.allowMultimodal ? 'vision' : webModelType;

    const clientDescriptors = convertClientToolsToDescriptors(request.tools);
    const allBuiltInDescriptors =
      callPolicy.allowAgentTools && dependencies.getToolDescriptors
        ? await dependencies.getToolDescriptors().catch(() => [])
        : [];
    
    // Apply granular tool settings
    const builtInDescriptors = allBuiltInDescriptors.filter((d) => {
      if (callPolicy.toolGranularSettings && d.name in callPolicy.toolGranularSettings) {
        return callPolicy.toolGranularSettings[d.name] !== false;
      }
      return true;
    });

    let availableDescriptors: ToolDescriptor[] = [...builtInDescriptors, ...clientDescriptors];

    const hasChineseContent = /[\u4e00-\u9fa5]/.test(
      request.messages.map((m) => extractMessageText(m.content)).join(' ')
    );
    const defaultImagePrompt = hasChineseContent
      ? '请查看并详细分析上传的图片与文件内容。'
      : 'Please examine and analyze the attached image or file content.';

    // Prepare prompt and descriptors for this turn
    let initialPrompt = '';

    if (isFirstTurn && isMultiTurnTranscript) {
      // Historical transcript ported to a new session: format full multi-turn context
      const formattedTranscript = formatMessagesForWebPrompt(request.messages);
      if (dependencies.buildPrompt) {
        const buildRes = await dependencies.buildPrompt({
          prompt: formattedTranscript,
          isFirstMessage: true,
          messageCount: request.messages.length,
          allowAgentTools: callPolicy.allowAgentTools,
          injectSystemInfo: callPolicy.injectSystemInfo,
          enableMemory: callPolicy.enableMemory,
          effectiveModel: callPolicy.effectiveModel,
          clientTools: request.tools,
        });
        initialPrompt = buildRes.augmented;
        availableDescriptors = [
          ...builtInDescriptors,
          ...buildRes.enabledDescriptors,
          ...clientDescriptors,
        ];
      } else {
        initialPrompt = formattedTranscript;
      }
    } else if (isFirstTurn) {
      const systemMessages = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => extractMessageText(m.content))
        .filter(Boolean)
        .join('\n\n');
      const rawFirstUser =
        extractMessageText(request.messages.find((m) => m.role === 'user')?.content) || '';
      const firstUserMsg = rawFirstUser || (hasImages ? defaultImagePrompt : '');

      if (dependencies.buildPrompt) {
        const buildRes = await dependencies.buildPrompt({
          prompt: firstUserMsg,
          isFirstMessage: true,
          messageCount: 1,
          allowAgentTools: callPolicy.allowAgentTools,
          injectSystemInfo: callPolicy.injectSystemInfo,
          enableMemory: callPolicy.enableMemory,
          effectiveModel: callPolicy.effectiveModel,
          clientTools: request.tools,
        });
        initialPrompt = systemMessages
          ? `[System Instruction]:\n${systemMessages}\n\n${buildRes.augmented}`
          : buildRes.augmented;
        availableDescriptors = [
          ...builtInDescriptors,
          ...buildRes.enabledDescriptors,
          ...clientDescriptors,
        ];
      } else {
        initialPrompt = systemMessages
          ? `[System Instruction]:\n${systemMessages}\n\n${firstUserMsg}`
          : firstUserMsg;
      }
    } else {
      const lastMsg = request.messages[request.messages.length - 1];
      if (lastMsg.role === 'tool') {
        const toolContent = extractMessageText(lastMsg.content);
        initialPrompt = `[Tool Results]:\nTool "${lastMsg.name || lastMsg.tool_call_id || 'function'}":\n${toolContent}`;
      } else if (lastMsg.role === 'user') {
        const rawUserContent = extractMessageText(lastMsg.content);
        const userContent = rawUserContent || (hasImages ? defaultImagePrompt : '');
        if (dependencies.buildPrompt) {
          const buildRes = await dependencies.buildPrompt({
            prompt: userContent,
            isFirstMessage: false,
            messageCount: request.messages.length,
            allowAgentTools: callPolicy.allowAgentTools,
            injectSystemInfo: callPolicy.injectSystemInfo,
            enableMemory: callPolicy.enableMemory,
            effectiveModel: callPolicy.effectiveModel,
            clientTools: request.tools,
          });
          initialPrompt = buildRes.augmented;
          availableDescriptors = [
            ...builtInDescriptors,
            ...buildRes.enabledDescriptors,
            ...clientDescriptors,
          ];
        } else {
          initialPrompt = userContent;
        }
      } else {
        initialPrompt = formatMessagesForWebPrompt(request.messages);
      }
    }

    let currentPrompt = initialPrompt;
    let stepCount = 0;

    while (stepCount < MAX_CHAT_TOOL_STEPS) {
      stepCount++;
      let fullText = '';
      let fullReasoning = '';
      let lastChunkTime = Date.now();
      const textAccumulator = createStreamingToolTextAccumulator(availableDescriptors);
      let lastEmittedLength = 0;

      // CRITICAL: Generate fresh PoW challenges on EACH step because DeepSeek Web consumes PoW tokens per request.
      const stepPowHeaders = await dependencies.createPowHeaders(headers, signal);

      const stallChecker = setInterval(() => {
        if (Date.now() - lastChunkTime > STREAM_STALL_TIMEOUT_MS) {
          clearInterval(stallChecker);
          sendToRelay({
            type: 'CHAT_ERROR',
            id: request.id,
            error: 'DeepSeek Web stream stalled (timeout)',
            code: 'stream_timeout',
          });
        }
      }, 5000);

      let turn: ModelTurn;
      try {
        turn = await dependencies.submitWebPrompt(
          {
            chatSessionId,
            parentMessageId,
            modelType: effectiveModelType,
            prompt: currentPrompt,
            refFileIds,
            thinkingEnabled,
            searchEnabled: false,
            clientHeaders: headers,
            powHeaders: stepPowHeaders,
          },
          {
            onTextChunk: (chunk, acc) => {
              lastChunkTime = Date.now();
              fullText = acc;
              const visible = textAccumulator.append(chunk);
              if (visible.length > lastEmittedLength) {
                const delta = visible.slice(lastEmittedLength);
                lastEmittedLength = visible.length;
                sendToRelay({
                  type: 'CHAT_CHUNK',
                  id: request.id,
                  text_delta: delta,
                  phase: 'answer',
                });
              }
            },
            onReasoningChunk: (chunk, acc) => {
              lastChunkTime = Date.now();
              fullReasoning = acc;
              if (chunk && chunk.trim().length > 0) {
                sendToRelay({
                  type: 'CHAT_CHUNK',
                  id: request.id,
                  reasoning_delta: chunk,
                  phase: 'reasoning',
                });
              }
            },
          },
          signal,
        );
      } catch (submitErr) {
        const errMsg = submitErr instanceof Error ? submitErr.message : String(submitErr);
        logWarn('external_api', `submitWebPrompt error on step ${stepCount}`, errMsg);
        // If the session was deleted or not found on DeepSeek Web, recover by creating a fresh session
        if (!isFirstTurn && (errMsg.includes('not found') || errMsg.includes('session') || errMsg.includes('404'))) {
          sessionStore.delete(sessionKey);
          chatSessionId = await dependencies.createChatSession(headers, signal);
          parentMessageId = null;
          session = {
            chatSessionId,
            sessionKey,
            parentMessageId: null,
            lastUsedAt: Date.now(),
            createdAt: Date.now(),
            messageCount: 1,
            model: callPolicy.effectiveModel,
            refFileIds,
          };
          sessionStore.set(sessionKey, session);
          void recordExternalApiSession(session);
          currentPrompt = formatMessagesForWebPrompt(request.messages);
          const retryPowHeaders = await dependencies.createPowHeaders(headers, signal);
          turn = await dependencies.submitWebPrompt(
            {
              chatSessionId,
              parentMessageId: null,
              modelType: effectiveModelType,
              prompt: currentPrompt,
              refFileIds,
              thinkingEnabled,
              searchEnabled: false,
              clientHeaders: headers,
              powHeaders: retryPowHeaders,
            },
            {
              onTextChunk: (chunk, acc) => {
                lastChunkTime = Date.now();
                fullText = acc;
                const visible = textAccumulator.append(chunk);
                if (visible.length > lastEmittedLength) {
                  const delta = visible.slice(lastEmittedLength);
                  lastEmittedLength = visible.length;
                  sendToRelay({
                    type: 'CHAT_CHUNK',
                    id: request.id,
                    text_delta: delta,
                    phase: 'answer',
                  });
                }
              },
              onReasoningChunk: (chunk, acc) => {
                lastChunkTime = Date.now();
                fullReasoning = acc;
                if (chunk && chunk.trim().length > 0) {
                  sendToRelay({
                    type: 'CHAT_CHUNK',
                    id: request.id,
                    reasoning_delta: chunk,
                    phase: 'reasoning',
                  });
                }
              },
            },
            signal,
          );
        } else {
          sessionStore.delete(sessionKey);
          throw submitErr;
        }
      } finally {
        clearInterval(stallChecker);
      }

      const finalVisible = textAccumulator.flush();
      if (finalVisible.length > lastEmittedLength) {
        const delta = finalVisible.slice(lastEmittedLength);
        lastEmittedLength = finalVisible.length;
        sendToRelay({
          type: 'CHAT_CHUNK',
          id: request.id,
          text_delta: delta,
          phase: 'answer',
        });
      }

      const responseMessageId = turn.responseMessageId ?? parentMessageId;
      parentMessageId = responseMessageId;
      session.parentMessageId = responseMessageId;
      session.refFileIds = refFileIds;
      session.lastUsedAt = Date.now();
      sessionStore.set(sessionKey, session);
      await recordExternalApiSession(session);

      const rawAssistantText = turn.assistantText || fullText;

      // Parse tool calls from model output
      const toolCalls = extractToolCalls(rawAssistantText, {
        descriptors: availableDescriptors,
      });

      const executedToolNames: string[] = [];
      let hasToolError = false;

      if (toolCalls.length === 0) {
        // Normal final completion
        const cleanFinalText = cleanWebSessionText(
          stripToolCalls(rawAssistantText, {
            descriptors: availableDescriptors,
          }),
        );
        const promptTokens = Math.ceil(currentPrompt.length / 4);
        const completionTokens = Math.ceil(cleanFinalText.length / 4);
        const totalTokens = promptTokens + completionTokens;

        sendToRelay({
          type: 'CHAT_DONE',
          id: request.id,
          finish_reason: turn.finished ? 'stop' : 'length',
          full_text: cleanFinalText,
          full_reasoning: fullReasoning || undefined,
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
          },
        });

        if (session) {
          session.promptTokens = (session.promptTokens || 0) + promptTokens;
          session.completionTokens = (session.completionTokens || 0) + completionTokens;
          session.totalTokens = (session.totalTokens || 0) + totalTokens;
          await recordExternalApiSession(session);
        }

        logInfo(
          'external_api',
          `Web Session Request Completed [${request.id}]`,
          `Model: ${callPolicy.effectiveModel}, Tokens: ${promptTokens} prompt + ${completionTokens} completion = ${totalTokens} total`,
        );
        break;
      }

      // Check if any tool call matches client tools
      const clientCalls = toolCalls.filter((c) =>
        request.tools?.some((t) => t.function.name === c.name),
      );

      if (clientCalls.length > 0) {
        const openAiToolCalls: ExternalApiToolCall[] = clientCalls.map((c, i) => ({
          id: c.id || `call_${request.id}_${stepCount}_${i}`,
          type: 'function',
          function: {
            name: c.name,
            arguments: typeof c.payload === 'string' ? c.payload : JSON.stringify(c.payload),
          },
        }));
        const promptTokens = Math.ceil(currentPrompt.length / 4);
        const completionTokens = Math.ceil(rawAssistantText.length / 4);
        const totalTokens = promptTokens + completionTokens;

        sendToRelay({
          type: 'CHAT_DONE',
          id: request.id,
          finish_reason: 'tool_calls',
          full_text: cleanWebSessionText(stripToolCalls(rawAssistantText, { descriptors: availableDescriptors })),
          full_reasoning: fullReasoning || undefined,
          tool_calls: openAiToolCalls,
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
          },
        });

        if (session) {
          session.promptTokens = (session.promptTokens || 0) + promptTokens;
          session.completionTokens = (session.completionTokens || 0) + completionTokens;
          session.totalTokens = (session.totalTokens || 0) + totalTokens;
          session.agentCallCount = (session.agentCallCount || 0) + openAiToolCalls.length;
          session.lastAgentTools = clientCalls.map((c) => c.name);
          await recordExternalApiSession(session);
        }
        break;
      }

      // If built-in tools matched, agent tools allowed, and executor is provided, execute tool and continue loop
      if (callPolicy.allowAgentTools && dependencies.executeToolCall) {
        const executions: ExternalApiToolExecutionRecord[] = [];
        for (const call of toolCalls) {
          executedToolNames.push(call.name);
          sendToRelay({
            type: 'TOOL_EVENT',
            id: request.id,
            tool_name: call.name,
            status: 'started',
          });

          logInfo(
            'external_api',
            `Executing Agent Call [${call.name}] for request ${request.id}`,
            JSON.stringify({ tool: call.name, payload: call.payload }, null, 2),
          );

          let result: ToolResult;
          try {
            result = await dependencies.executeToolCall(call, {
              trustedCapabilityScopeId: `external_api:${request.id}`,
            });
          } catch (err) {
            hasToolError = true;
            result = {
              ok: false,
              name: call.name,
              summary: 'Tool execution failed',
              detail: err instanceof Error ? err.message : String(err),
            };
          }
          if (!result.ok) hasToolError = true;
          executions.push({
            name: call.name,
            provider: call.provider,
            result,
          });

          sendToRelay({
            type: 'TOOL_EVENT',
            id: request.id,
            tool_name: call.name,
            status: result.ok ? 'succeeded' : 'failed',
            result: typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? result.detail ?? ''),
          });

          logInfo(
            'external_api',
            `Agent Call completed [${call.name}] result=${result.ok ? 'SUCCESS' : 'FAILED'}`,
            result.summary || result.detail || (typeof result.output === 'string' ? result.output : ''),
          );
        }

        if (session) {
          session.agentCallCount = (session.agentCallCount || 0) + executedToolNames.length;
          session.lastAgentTools = Array.from(new Set([...(session.lastAgentTools || []), ...executedToolNames]));
          session.lastToolStatus = hasToolError ? 'failed' : 'success';
          await recordExternalApiSession(session);
        }

        const serialized = serializeToolExecutions(executions, effectiveModelType);
        currentPrompt = dependencies.continueWithToolResults
          ? dependencies.continueWithToolResults(serialized)
          : `[Tool Results]:\n${serialized}`;
      } else {
        // No executor available, finish as stop
        const promptTokens = Math.ceil(currentPrompt.length / 4);
        const completionTokens = Math.ceil(rawAssistantText.length / 4);
        const totalTokens = promptTokens + completionTokens;

        sendToRelay({
          type: 'CHAT_DONE',
          id: request.id,
          finish_reason: 'stop',
          full_text: cleanWebSessionText(stripToolCalls(rawAssistantText, { descriptors: availableDescriptors })),
          full_reasoning: fullReasoning || undefined,
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
          },
        });

        if (session) {
          session.promptTokens = (session.promptTokens || 0) + promptTokens;
          session.completionTokens = (session.completionTokens || 0) + completionTokens;
          session.totalTokens = (session.totalTokens || 0) + totalTokens;
          await recordExternalApiSession(session);
        }

        logInfo(
          'external_api',
          `Web Session Request Completed [${request.id}]`,
          `Model: ${callPolicy.effectiveModel}, Tokens: ${promptTokens} prompt + ${completionTokens} completion = ${totalTokens} total`,
        );
        break;
      }
    }
  }

  function formatMessagesForWebPrompt(messages: ExternalApiChatMessage[]): string {
    if (messages.length === 1 && messages[0].role === 'user') {
      return extractMessageText(messages[0].content);
    }

    const segments: string[] = [];
    for (const msg of messages) {
      const text = extractMessageText(msg.content);
      if (msg.role === 'system') {
        segments.push(`[System Instruction]:\n${text}`);
      } else if (msg.role === 'user') {
        segments.push(`User: ${text}`);
      } else if (msg.role === 'assistant') {
        segments.push(`Assistant: ${text}`);
      } else if (msg.role === 'tool') {
        segments.push(`[Tool Results]:\nTool "${msg.name || msg.tool_call_id || 'function'}":\n${text}`);
      }
    }
    return segments.join('\n\n');
  }

  function mapMessagesToOfficialApi(messages: ExternalApiChatMessage[]): OfficialDeepSeekMessage[] {
    const result: OfficialDeepSeekMessage[] = [];
    let systemPrefix = '';

    for (const m of messages) {
      const text = extractMessageText(m.content);
      if (m.role === 'system') {
        systemPrefix += `[System Instruction]:\n${text}\n\n`;
      } else if (m.role === 'user') {
        const content = systemPrefix ? `${systemPrefix}${text}` : text;
        systemPrefix = '';
        result.push({ role: 'user', content });
      } else if (m.role === 'assistant') {
        result.push({ role: 'assistant', content: text });
      } else if (m.role === 'tool') {
        result.push({
          role: 'user',
          content: `[Tool Result ${m.tool_call_id || m.name || ''}]:\n${text}`,
        });
      }
    }

    if (systemPrefix && result.length === 0) {
      result.push({ role: 'user', content: systemPrefix.trim() });
    }

    return result;
  }

  return {
    async start() {
      isRunning = true;
      currentConfig = await dependencies.getConfig();
      if (currentConfig.enabled) {
        await connectWs();
      }
    },
    stop() {
      isRunning = false;
      stopHeartbeat();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {}
        ws = null;
      }
      emitStatusUpdate();
    },
    async reconnect() {
      reconnectAttempt = 0;
      currentConfig = await dependencies.getConfig();
      await connectWs({ waitConnect: true });
    },
    async ensureConnected() {
      if (!isRunning) isRunning = true;
      if (!currentConfig) currentConfig = await dependencies.getConfig();
      const openState = WebSocketClass?.OPEN ?? 1;
      if (currentConfig.enabled && (!ws || ws.readyState !== openState)) {
        await connectWs();
      }
    },
    getStatus,
    async handleConfigUpdated(newConfig: ExternalApiConfig) {
      const prevUrl = currentConfig?.relayWsUrl;
      const prevEnabled = currentConfig?.enabled;
      const prevToken = currentConfig?.extensionToken;
      currentConfig = newConfig;

      const openState = WebSocketClass?.OPEN ?? 1;
      const isConnected = ws !== null && ws.readyState === openState;

      if (!newConfig.enabled) {
        if (ws) {
          try {
            ws.close();
          } catch {}
          ws = null;
        }
        stopHeartbeat();
        emitStatusUpdate();
        return;
      }

      if (isConnected && prevUrl === newConfig.relayWsUrl && prevToken === newConfig.extensionToken) {
        // Sync updated authorized keys directly without dropping connection
        const activeKeys = getAuthorizedApiKeys(newConfig);
        sendToRelay({
          type: 'SYNC_API_KEYS',
          keys: activeKeys,
        });
        emitStatusUpdate();
        return;
      }

      if (prevUrl !== newConfig.relayWsUrl || prevEnabled !== newConfig.enabled || prevToken !== newConfig.extensionToken) {
        reconnectAttempt = 0;
        await connectWs();
      } else {
        emitStatusUpdate();
      }
    },
    getPendingInterceptions() {
      return Array.from(pendingInterceptions.values()).map((p) => ({
        id: p.request.id,
        timestamp: p.timestamp,
        request: p.request,
      }));
    },
    resolveInterception(id: string, action: 'approve' | 'reject', modified?: BridgeToExtensionChatRequest) {
      const item = pendingInterceptions.get(id);
      if (!item) return false;
      if (action === 'approve') {
        item.resolve(modified || item.request);
      } else {
        item.reject(new Error('Request rejected by developer'));
      }
      return true;
    },
  };
}
