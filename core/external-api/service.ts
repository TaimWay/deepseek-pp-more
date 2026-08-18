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
} from './contracts';
import { recordApiKeyUsage, recordExternalApiSession, removeExternalApiSessions } from './store';
import { isNativeHostAvailable, startRelayProcess } from './process';
import type { ToolCall, ToolDescriptor, ToolProviderIdentity, ToolResult } from '../tool/types';
import type { JsonValue } from '../tool/types';
import type { RuntimeToolCallOptions } from '../tool/runtime';
import { extractToolCalls, stripToolCalls } from '../interceptor/tool-parser';

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
      powHeaders: Record<string, string>;
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
}

export interface ResolvedCallPolicy {
  isProxyOnly: boolean;
  allowAgentTools: boolean;
  allowMultimodal: boolean;
  injectSystemInfo: boolean;
  enableMemory: boolean;
  effectiveModel: string;
  effectiveBackend: ExternalApiBackend;
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
    const active = config.apiKeys.filter((k) => k.enabled).map((k) => k.key);
    if (active.length > 0) return active;
    if (config.apiKey && config.apiKey.trim()) return [config.apiKey.trim()];
    return [];
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
          await startRelayProcess({ port, apiKey: currentConfig.apiKey });
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

  async function processChatCompletionRequest(request: BridgeToExtensionChatRequest) {
    const controller = new AbortController();
    activeControllers.set(request.id, controller);
    emitStatusUpdate();

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
      const effectiveBackend =
        matchedKey?.backend && matchedKey.backend !== 'auto' ? matchedKey.backend : config.preferredBackend;
      const effectiveModel =
        request.model || matchedKey?.overrideModel || config.defaultModel || 'deepseek-v4-flash';

      const callPolicy: ResolvedCallPolicy = {
        isProxyOnly,
        allowAgentTools,
        allowMultimodal,
        injectSystemInfo,
        enableMemory,
        effectiveModel,
        effectiveBackend,
      };

      const shouldUseOfficialApi =
        effectiveBackend === 'official-api' ||
        (effectiveBackend === 'auto' && Boolean(apiKey));

      if (shouldUseOfficialApi && apiKey) {
        await executeViaOfficialApi(request, apiKey, callPolicy, controller.signal);
      } else {
        await executeViaWebSession(request, callPolicy, controller.signal);
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        const errorMessage = err instanceof Error ? err.message : String(err);
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

  interface ExternalApiSessionRecord {
    chatSessionId: string;
    parentMessageId: number | null;
    lastUsedAt: number;
  }

  const sessionStore = new Map<string, ExternalApiSessionRecord>();
  const MAX_CHAT_TOOL_STEPS = 20;

  function getSessionKey(request: BridgeToExtensionChatRequest): string {
    if (request.session_id && request.session_id.trim()) {
      return request.session_id.trim();
    }
    return DEFAULT_EXTERNAL_API_SESSION_KEY;
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
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!match) return null;
    return { mimeType: match[1].toLowerCase(), base64: match[2] };
  }

  function dataUrlToBlob(dataUrl: string): { blob: Blob; filename: string } | null {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return null;
    try {
      const byteCharacters = atob(parsed.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const ext = parsed.mimeType.split('/')[1] || 'png';
      return {
        blob: new Blob([byteArray], { type: parsed.mimeType }),
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

  function collectMultimodalMediaInputs(messages: ExternalApiChatMessage[]): MultimodalMediaCollection {
    const media: MultimodalMediaInput[] = [];
    let hasUnroutableMedia = false;
    let imageIndex = 0;
    let fileIndex = 0;

    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (!part || typeof part !== 'object') continue;
        if (part.type === 'image_url') {
          const url = (part as ExternalApiImageUrlContentPart).image_url?.url;
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
            dataUrl: url,
          });
          if (!input) hasUnroutableMedia = true;
          else media.push(input);
        } else if (part.type === 'file' || part.type === 'input_file') {
          const file = (part as ExternalApiFileContentPart).file;
          if (!file || typeof file.data !== 'string' || !file.data) {
            hasUnroutableMedia = true;
            continue;
          }
          let mimeType = (file.mime_type || '').toLowerCase();
          let base64Body = file.data;
          let dataUrl: string | undefined;
          if (file.data.startsWith('data:')) {
            const parsed = parseDataUrl(file.data);
            if (!parsed) {
              hasUnroutableMedia = true;
              continue;
            }
            mimeType = parsed.mimeType;
            base64Body = parsed.base64;
            dataUrl = file.data;
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
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return Math.floor(value.length / 4) * 3 - padding;
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

  function serializeToolExecutions(executions: readonly ExternalApiToolExecutionRecord[]): string {
    return executions
      .map((execution) => {
        const detail =
          typeof execution.result.output === 'string'
            ? execution.result.output
            : JSON.stringify(execution.result.output ?? execution.result.detail ?? execution.result.summary);
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
              sendToRelay({
                type: 'CHAT_CHUNK',
                id: request.id,
                text_delta: chunk,
                phase: 'answer',
              });
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
            type: 'CHAT_CHUNK',
            id: request.id,
            reasoning_delta: `\n[Executing ${call.name}...]\n`,
            phase: 'reasoning',
          });

          let result: ToolResult;
          try {
            result = await dependencies.executeToolCall(call, {
              trustedCapabilityScopeId: `external_api:${request.id}`,
            });
          } catch (execErr) {
            const errMessage = execErr instanceof Error ? execErr.message : String(execErr);
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
        }

        const serialized = serializeToolExecutions(executions);
        const toolResultContent = dependencies.continueWithToolResults
          ? dependencies.continueWithToolResults(serialized)
          : `[Tool Results]:\n${serialized}`;
        messages = [...messages, { role: 'user', content: toolResultContent }];
      } else {
        // No executor available, finish as stop
        sendToRelay({
          type: 'CHAT_DONE',
          id: request.id,
          finish_reason: 'stop',
          full_text: stripToolCalls(rawAssistantText, { descriptors: availableDescriptors }),
          full_reasoning: turn.reasoningText || fullReasoning || undefined,
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
    let session = sessionStore.get(sessionKey);
    let chatSessionId: string;
    let parentMessageId: number | null = null;
    let isFirstTurn = false;

    if (session) {
      chatSessionId = session.chatSessionId;
      parentMessageId = session.parentMessageId;
      session.lastUsedAt = Date.now();
      void recordExternalApiSession({
        chatSessionId,
        sessionKey,
        createdAt: session.lastUsedAt,
        lastUsedAt: Date.now(),
        messageCount: 2,
        model: callPolicy.effectiveModel,
      });
    } else {
      chatSessionId = await dependencies.createChatSession(headers, signal);
      isFirstTurn = true;
      session = {
        chatSessionId,
        parentMessageId: null,
        lastUsedAt: Date.now(),
      };
      sessionStore.set(sessionKey, session);
      void recordExternalApiSession({
        chatSessionId,
        sessionKey,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        messageCount: 1,
        model: callPolicy.effectiveModel,
      });
    }

    const powHeaders = await dependencies.createPowHeaders(headers, signal);

    // Multimodal image attachments handling
    const refFileIds: string[] = [];
    let hasImages = false;

    if (callPolicy.allowMultimodal) {
      for (const msg of request.messages) {
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part && typeof part === 'object') {
              if (part.type === 'image_url' && (part as ExternalApiImageUrlContentPart).image_url?.url) {
                const url = (part as ExternalApiImageUrlContentPart).image_url.url;
                if (url.startsWith('data:')) {
                  const blobInfo = dataUrlToBlob(url);
                  if (blobInfo && dependencies.uploadFile) {
                    try {
                      const uploaded = await dependencies.uploadFile(
                        {
                          file: blobInfo.blob,
                          filename: blobInfo.filename,
                          modelType: 'vision',
                          clientHeaders: headers,
                          powHeaders,
                        },
                        signal,
                      );
                      if (uploaded?.id) {
                        refFileIds.push(uploaded.id);
                        hasImages = true;
                      }
                    } catch (err) {
                      dependencies.reportError?.('external_api_file_upload_failed', err);
                    }
                  }
                }
              } else if (part.type === 'file' || part.type === 'input_file') {
                const fileId = (part as ExternalApiFileContentPart).file?.file_id;
                if (fileId) {
                  refFileIds.push(fileId);
                  hasImages = true;
                }
              }
            }
          }
        }
      }
    }

    const effectiveModelType = hasImages && callPolicy.allowMultimodal ? 'vision' : webModelType;

    const clientDescriptors = convertClientToolsToDescriptors(request.tools);
    const builtInDescriptors =
      callPolicy.allowAgentTools && dependencies.getToolDescriptors
        ? await dependencies.getToolDescriptors().catch(() => [])
        : [];
    let availableDescriptors: ToolDescriptor[] = [...builtInDescriptors, ...clientDescriptors];

    // Prepare prompt and descriptors for this turn
    let initialPrompt = '';

    if (isFirstTurn) {
      const systemMessages = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => extractMessageText(m.content))
        .filter(Boolean)
        .join('\n\n');
      const firstUserMsg =
        extractMessageText(request.messages.find((m) => m.role === 'user')?.content) || '';

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
        const userContent = extractMessageText(lastMsg.content);
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
            powHeaders,
          },
          {
            onTextChunk: (chunk, acc) => {
              lastChunkTime = Date.now();
              fullText = acc;
              sendToRelay({
                type: 'CHAT_CHUNK',
                id: request.id,
                text_delta: chunk,
                phase: 'answer',
              });
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
      } catch (submitErr) {
        const errMsg = submitErr instanceof Error ? submitErr.message : String(submitErr);
        // If the session was deleted or not found on DeepSeek Web, recover by creating a fresh session
        if (!isFirstTurn && (errMsg.includes('not found') || errMsg.includes('session') || errMsg.includes('404') || errMsg.includes('400'))) {
          sessionStore.delete(sessionKey);
          chatSessionId = await dependencies.createChatSession(headers, signal);
          parentMessageId = null;
          session = {
            chatSessionId,
            parentMessageId: null,
            lastUsedAt: Date.now(),
          };
          sessionStore.set(sessionKey, session);
          void recordExternalApiSession({
            chatSessionId,
            sessionKey,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            messageCount: 1,
            model: request.model,
          });
          currentPrompt = formatMessagesForWebPrompt(request.messages);
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
              powHeaders,
            },
            {
              onTextChunk: (chunk, acc) => {
                lastChunkTime = Date.now();
                fullText = acc;
                sendToRelay({
                  type: 'CHAT_CHUNK',
                  id: request.id,
                  text_delta: chunk,
                  phase: 'answer',
                });
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
        } else {
          sessionStore.delete(sessionKey);
          throw submitErr;
        }
      } finally {
        clearInterval(stallChecker);
      }

      const responseMessageId = turn.responseMessageId ?? parentMessageId;
      parentMessageId = responseMessageId;
      session.parentMessageId = responseMessageId;
      session.lastUsedAt = Date.now();

      const rawAssistantText = turn.assistantText || fullText;

      // Parse tool calls from model output
      const toolCalls = extractToolCalls(rawAssistantText, {
        descriptors: availableDescriptors,
      });

      if (toolCalls.length === 0) {
        // Normal final completion
        const cleanFinalText = stripToolCalls(rawAssistantText, {
          descriptors: availableDescriptors,
        });

        sendToRelay({
          type: 'CHAT_DONE',
          id: request.id,
          finish_reason: turn.finished ? 'stop' : 'length',
          full_text: cleanFinalText,
          full_reasoning: fullReasoning || undefined,
          usage: {
            prompt_tokens: Math.ceil(currentPrompt.length / 4),
            completion_tokens: Math.ceil(cleanFinalText.length / 4),
            total_tokens: Math.ceil((currentPrompt.length + cleanFinalText.length) / 4),
          },
        });
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

        sendToRelay({
          type: 'CHAT_DONE',
          id: request.id,
          finish_reason: 'tool_calls',
          full_text: stripToolCalls(rawAssistantText, { descriptors: availableDescriptors }),
          full_reasoning: fullReasoning || undefined,
          tool_calls: openAiToolCalls,
          usage: {
            prompt_tokens: Math.ceil(currentPrompt.length / 4),
            completion_tokens: Math.ceil(rawAssistantText.length / 4),
            total_tokens: Math.ceil((currentPrompt.length + rawAssistantText.length) / 4),
          },
        });
        break;
      }

      // If built-in tools matched, agent tools allowed, and executor is provided, execute tool and continue loop
      if (callPolicy.allowAgentTools && dependencies.executeToolCall) {
        const executions: ExternalApiToolExecutionRecord[] = [];
        for (const call of toolCalls) {
          sendToRelay({
            type: 'CHAT_CHUNK',
            id: request.id,
            reasoning_delta: `\n[Executing ${call.name}...]\n`,
            phase: 'reasoning',
          });

          const result = await dependencies.executeToolCall(call, {
            trustedCapabilityScopeId: `external_api:${request.id}`,
          });
          executions.push({
            name: call.name,
            provider: call.provider,
            result,
          });
        }

        const serialized = serializeToolExecutions(executions);
        currentPrompt = dependencies.continueWithToolResults
          ? dependencies.continueWithToolResults(serialized)
          : `[Tool Results]:\n${serialized}`;
      } else {
        // No executor available, finish as stop
        sendToRelay({
          type: 'CHAT_DONE',
          id: request.id,
          finish_reason: 'stop',
          full_text: stripToolCalls(rawAssistantText, { descriptors: availableDescriptors }),
          full_reasoning: fullReasoning || undefined,
          usage: {
            prompt_tokens: Math.ceil(currentPrompt.length / 4),
            completion_tokens: Math.ceil(rawAssistantText.length / 4),
            total_tokens: Math.ceil((currentPrompt.length + rawAssistantText.length) / 4),
          },
        });
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
  };
}
