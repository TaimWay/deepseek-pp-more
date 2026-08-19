import {
  DEFAULT_EXTERNAL_API_CONFIG,
  DEFAULT_EXTERNAL_API_PORT,
  EXTERNAL_API_SESSIONS_STORAGE_KEY,
  type ExternalApiBackend,
  type ExternalApiConfig,
  type ExternalApiKey,
  type ExternalApiSessionMeta,
} from './contracts';

export const EXTERNAL_API_CONFIG_STORAGE_KEY = 'deepseek_pp_external_api_config';

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '****';
  const prefix = key.slice(0, 7);
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}

export function generateRandomHex(length = 32): string {
  const chars = '0123456789abcdef';
  let result = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
  } else {
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return result;
}

export function createExternalApiKey(name: string, customKey?: string): ExternalApiKey {
  const key = customKey && customKey.trim().length > 0 ? customKey.trim() : `sk-dspp-${generateRandomHex(24)}`;
  const id = `key_${Date.now()}_${generateRandomHex(6)}`;
  return {
    id,
    name: name.trim() || 'Default Key',
    key,
    keyPrefix: maskApiKey(key),
    createdAt: Date.now(),
    lastUsedAt: null,
    usageCount: 0,
    enabled: true,
    mode: 'full_agent',
  };
}

export function normalizeExternalApiKey(raw: unknown): ExternalApiKey | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;

  const key = typeof item.key === 'string' ? item.key.trim() : '';
  if (!key) return null;

  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `key_${Date.now()}_${generateRandomHex(6)}`;
  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'API Key';
  const createdAt = typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now();
  const lastUsedAt = typeof item.lastUsedAt === 'number' && Number.isFinite(item.lastUsedAt) ? item.lastUsedAt : null;
  const usageCount = typeof item.usageCount === 'number' && Number.isFinite(item.usageCount) && item.usageCount >= 0 ? item.usageCount : 0;
  const enabled = typeof item.enabled === 'boolean' ? item.enabled : true;
  const keyPrefix = maskApiKey(key);
  const mode = item.mode === 'proxy_only' ? 'proxy_only' : 'full_agent';
  const allowAgentTools = typeof item.allowAgentTools === 'boolean' ? item.allowAgentTools : undefined;
  const allowMultimodal = typeof item.allowMultimodal === 'boolean' ? item.allowMultimodal : undefined;
  const injectSystemInfo = typeof item.injectSystemInfo === 'boolean' ? item.injectSystemInfo : undefined;
  const enableMemory = typeof item.enableMemory === 'boolean' ? item.enableMemory : undefined;
  const overrideModel = typeof item.overrideModel === 'string' && item.overrideModel.trim() ? item.overrideModel.trim() : undefined;
  const backend = item.backend === 'web' || item.backend === 'official-api' || item.backend === 'auto' ? item.backend : undefined;

  const res: ExternalApiKey = {
    id,
    name,
    key,
    keyPrefix,
    createdAt,
    lastUsedAt,
    usageCount,
    enabled,
    mode,
  };

  if (allowAgentTools !== undefined) res.allowAgentTools = allowAgentTools;
  if (allowMultimodal !== undefined) res.allowMultimodal = allowMultimodal;
  if (injectSystemInfo !== undefined) res.injectSystemInfo = injectSystemInfo;
  if (enableMemory !== undefined) res.enableMemory = enableMemory;
  if (overrideModel !== undefined) res.overrideModel = overrideModel;
  if (backend !== undefined) res.backend = backend;

  return res;
}

export async function getExternalApiConfig(): Promise<ExternalApiConfig> {
  const data = (await chrome.storage.local.get(EXTERNAL_API_CONFIG_STORAGE_KEY)) as Record<string, unknown>;
  return normalizeExternalApiConfig(data[EXTERNAL_API_CONFIG_STORAGE_KEY]);
}

export async function saveExternalApiConfig(value: unknown): Promise<ExternalApiConfig> {
  const config = normalizeExternalApiConfig(value);
  await chrome.storage.local.set({ [EXTERNAL_API_CONFIG_STORAGE_KEY]: config });
  return config;
}

export async function recordApiKeyUsage(keyString: string): Promise<ExternalApiConfig | null> {
  if (!keyString) return null;
  const config = await getExternalApiConfig();
  let matched = false;

  const updatedKeys = config.apiKeys.map((k) => {
    if (k.key === keyString || k.key === keyString.trim()) {
      matched = true;
      return {
        ...k,
        lastUsedAt: Date.now(),
        usageCount: k.usageCount + 1,
      };
    }
    return k;
  });

  if (matched) {
    const nextConfig = { ...config, apiKeys: updatedKeys };
    await chrome.storage.local.set({ [EXTERNAL_API_CONFIG_STORAGE_KEY]: nextConfig });
    return nextConfig;
  }

  return null;
}

export function normalizeExternalApiConfig(value: unknown): ExternalApiConfig {
  if (!value || typeof value !== 'object') return DEFAULT_EXTERNAL_API_CONFIG;

  const object = value as Partial<Record<keyof ExternalApiConfig, unknown>>;

  const enabled = typeof object.enabled === 'boolean' ? object.enabled : DEFAULT_EXTERNAL_API_CONFIG.enabled;
  const relayHost =
    typeof object.relayHost === 'string' && object.relayHost.trim()
      ? object.relayHost.trim()
      : DEFAULT_EXTERNAL_API_CONFIG.relayHost;
  const relayWsUrl =
    typeof object.relayWsUrl === 'string' && object.relayWsUrl.trim()
      ? object.relayWsUrl.trim()
      : DEFAULT_EXTERNAL_API_CONFIG.relayWsUrl;
  const apiKey = typeof object.apiKey === 'string' ? object.apiKey.trim() : DEFAULT_EXTERNAL_API_CONFIG.apiKey;
  const extensionToken =
    typeof object.extensionToken === 'string'
      ? object.extensionToken.trim()
      : DEFAULT_EXTERNAL_API_CONFIG.extensionToken;
  const preferredBackend = normalizeBackend(object.preferredBackend);
  const defaultModel =
    typeof object.defaultModel === 'string' && object.defaultModel.trim()
      ? object.defaultModel.trim()
      : DEFAULT_EXTERNAL_API_CONFIG.defaultModel;
  const corsEnabled = typeof object.corsEnabled === 'boolean' ? object.corsEnabled : DEFAULT_EXTERNAL_API_CONFIG.corsEnabled;
  const autoStartRelay = typeof object.autoStartRelay === 'boolean' ? object.autoStartRelay : DEFAULT_EXTERNAL_API_CONFIG.autoStartRelay;
  const relayPort =
    typeof object.relayPort === 'number' && Number.isSafeInteger(object.relayPort) && object.relayPort > 0 && object.relayPort < 65536
      ? object.relayPort
      : DEFAULT_EXTERNAL_API_PORT;
  const allowAgentTools = typeof object.allowAgentTools === 'boolean' ? object.allowAgentTools : DEFAULT_EXTERNAL_API_CONFIG.allowAgentTools;
  const allowMultimodal = typeof object.allowMultimodal === 'boolean' ? object.allowMultimodal : DEFAULT_EXTERNAL_API_CONFIG.allowMultimodal;
  const injectSystemInfo = typeof object.injectSystemInfo === 'boolean' ? object.injectSystemInfo : DEFAULT_EXTERNAL_API_CONFIG.injectSystemInfo;
  const enableMemory = typeof object.enableMemory === 'boolean' ? object.enableMemory : DEFAULT_EXTERNAL_API_CONFIG.enableMemory;

  let apiKeys: ExternalApiKey[] = [];
  if (Array.isArray(object.apiKeys)) {
    apiKeys = object.apiKeys
      .map(normalizeExternalApiKey)
      .filter((k): k is ExternalApiKey => k !== null);
  }

  // Backward-compatibility migration: if single apiKey is set but apiKeys is empty, create a default entry
  if (apiKey && apiKeys.length === 0) {
    apiKeys = [
      {
        id: `key_legacy_default`,
        name: 'Default Key',
        key: apiKey,
        keyPrefix: maskApiKey(apiKey),
        createdAt: Date.now(),
        lastUsedAt: null,
        usageCount: 0,
        enabled: true,
        mode: 'full_agent',
      },
    ];
  }

  const debugMode = typeof object.debugMode === 'boolean' ? object.debugMode : DEFAULT_EXTERNAL_API_CONFIG.debugMode;
  const interceptRequests = typeof object.interceptRequests === 'boolean' ? object.interceptRequests : DEFAULT_EXTERNAL_API_CONFIG.interceptRequests;
  const maxToolSteps = typeof object.maxToolSteps === 'number' && object.maxToolSteps > 0 && object.maxToolSteps <= 50
    ? object.maxToolSteps
    : DEFAULT_EXTERNAL_API_CONFIG.maxToolSteps;
  const toolTimeoutSeconds = typeof object.toolTimeoutSeconds === 'number' && object.toolTimeoutSeconds >= 5 && object.toolTimeoutSeconds <= 300
    ? object.toolTimeoutSeconds
    : DEFAULT_EXTERNAL_API_CONFIG.toolTimeoutSeconds;
  const toolGranularSettings: Record<string, boolean> =
    object.toolGranularSettings && typeof object.toolGranularSettings === 'object'
      ? { ...DEFAULT_EXTERNAL_API_CONFIG.toolGranularSettings, ...(object.toolGranularSettings as Record<string, boolean>) }
      : { ...DEFAULT_EXTERNAL_API_CONFIG.toolGranularSettings };
  const customCorsOrigins = typeof object.customCorsOrigins === 'string' && object.customCorsOrigins.trim()
    ? object.customCorsOrigins.trim()
    : DEFAULT_EXTERNAL_API_CONFIG.customCorsOrigins;
  const autoRefreshLogInterval = typeof object.autoRefreshLogInterval === 'number' && [0, 1000, 2000, 5000, 10000].includes(object.autoRefreshLogInterval)
    ? object.autoRefreshLogInterval
    : DEFAULT_EXTERNAL_API_CONFIG.autoRefreshLogInterval;

  return {
    enabled,
    relayHost,
    relayWsUrl,
    apiKey,
    apiKeys,
    extensionToken,
    preferredBackend,
    defaultModel,
    corsEnabled,
    autoStartRelay,
    relayPort,
    allowAgentTools,
    allowMultimodal,
    injectSystemInfo,
    enableMemory,
    debugMode,
    interceptRequests,
    maxToolSteps,
    toolTimeoutSeconds,
    toolGranularSettings,
    customCorsOrigins,
    autoRefreshLogInterval,
  };
}

function normalizeBackend(value: unknown): ExternalApiBackend {
  if (value === 'web' || value === 'official-api') return value;
  return 'auto';
}

export async function getExternalApiSessions(): Promise<ExternalApiSessionMeta[]> {
  try {
    const data = (await chrome.storage.local.get(EXTERNAL_API_SESSIONS_STORAGE_KEY)) as Record<string, unknown>;
    const raw = data[EXTERNAL_API_SESSIONS_STORAGE_KEY];
    if (Array.isArray(raw)) {
      return raw.filter((s) => s && typeof (s as any).chatSessionId === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

export async function loadActiveExternalApiSessions(): Promise<Map<string, ExternalApiSessionMeta>> {
  const map = new Map<string, ExternalApiSessionMeta>();
  try {
    const sessions = await getExternalApiSessions();
    for (const session of sessions) {
      if (session.sessionKey) {
        map.set(session.sessionKey, session);
      }
    }
  } catch {
    // Ignore load errors
  }
  return map;
}

export async function recordExternalApiSession(session: ExternalApiSessionMeta): Promise<void> {
  try {
    const sessions = await getExternalApiSessions();
    const existingIndex = sessions.findIndex((s) => s.chatSessionId === session.chatSessionId || s.sessionKey === session.sessionKey);
    let next: ExternalApiSessionMeta[];
    if (existingIndex >= 0) {
      next = [...sessions];
      next[existingIndex] = {
        ...next[existingIndex],
        ...session,
        lastUsedAt: Date.now(),
        messageCount: (next[existingIndex].messageCount || 1) + 1,
      };
    } else {
      next = [session, ...sessions].slice(0, 200);
    }
    await chrome.storage.local.set({ [EXTERNAL_API_SESSIONS_STORAGE_KEY]: next });
  } catch {
    // Ignore persistence failures
  }
}

export async function removeExternalApiSessions(chatSessionIds: string[]): Promise<void> {
  try {
    const ids = new Set(chatSessionIds);
    const sessions = await getExternalApiSessions();
    const next = sessions.filter((s) => !ids.has(s.chatSessionId) && !ids.has(s.sessionKey));
    await chrome.storage.local.set({ [EXTERNAL_API_SESSIONS_STORAGE_KEY]: next });
  } catch {
    // Ignore persistence failures
  }
}

export async function clearAllExternalApiSessions(): Promise<void> {
  try {
    await chrome.storage.local.set({ [EXTERNAL_API_SESSIONS_STORAGE_KEY]: [] });
  } catch {
    // Ignore persistence failures
  }
}
