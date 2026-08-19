import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_EXTERNAL_API_CONFIG,
  type ExternalApiConfig,
} from '../core/external-api/contracts';
import {
  EXTERNAL_API_CONFIG_STORAGE_KEY,
  createExternalApiKey,
  getExternalApiConfig,
  maskApiKey,
  normalizeExternalApiConfig,
  recordApiKeyUsage,
  saveExternalApiConfig,
} from '../core/external-api/store';

describe('External API Store and Contracts', () => {
  let mockStorage: Record<string, unknown> = {};

  beforeEach(() => {
    mockStorage = {};
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: mockStorage[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(mockStorage, items);
          }),
        },
      },
    } as unknown as typeof chrome;
  });

  it('normalizes undefined or null config to default config', () => {
    expect(normalizeExternalApiConfig(null)).toEqual(DEFAULT_EXTERNAL_API_CONFIG);
    expect(normalizeExternalApiConfig(undefined)).toEqual(DEFAULT_EXTERNAL_API_CONFIG);
    expect(normalizeExternalApiConfig('invalid')).toEqual(DEFAULT_EXTERNAL_API_CONFIG);
  });

  it('normalizes partial and customized configuration with apiKeys', () => {
    const customized = normalizeExternalApiConfig({
      enabled: false,
      relayWsUrl: 'ws://localhost:4000/ws',
      apiKey: 'sk-test-1234',
      extensionToken: 'ext-token-abc',
      preferredBackend: 'official-api',
      defaultModel: 'deepseek-v4-pro',
      relayPort: 4000,
    });

    expect(customized.enabled).toBe(false);
    expect(customized.relayWsUrl).toBe('ws://localhost:4000/ws');
    expect(customized.apiKey).toBe('sk-test-1234');
    expect(customized.preferredBackend).toBe('official-api');
    expect(customized.defaultModel).toBe('deepseek-v4-pro');
    expect(customized.relayPort).toBe(4000);
    expect(customized.apiKeys.length).toBe(1);
    expect(customized.apiKeys[0].key).toBe('sk-test-1234');
  });

  it('generates random api key and masks it properly', () => {
    const key = createExternalApiKey('Test Key');
    expect(key.name).toBe('Test Key');
    expect(key.key.startsWith('sk-dspp-')).toBe(true);
    expect(key.enabled).toBe(true);
    expect(key.usageCount).toBe(0);
    expect(key.keyPrefix.includes('...')).toBe(true);

    expect(maskApiKey('sk-dspp-abcdef1234567890')).toBe('sk-dspp...7890');
    expect(maskApiKey('short')).toBe('****');
  });

  it('records api key usage correctly', async () => {
    const key1 = createExternalApiKey('Key 1', 'sk-custom-1');
    const key2 = createExternalApiKey('Key 2', 'sk-custom-2');

    await saveExternalApiConfig({
      ...DEFAULT_EXTERNAL_API_CONFIG,
      apiKeys: [key1, key2],
    });

    const updated = await recordApiKeyUsage('sk-custom-1');
    expect(updated).not.toBeNull();
    expect(updated?.apiKeys[0].usageCount).toBe(1);
    expect(updated?.apiKeys[0].lastUsedAt).toBeGreaterThan(0);
    expect(updated?.apiKeys[1].usageCount).toBe(0);
  });

  it('reads default config when storage is empty', async () => {
    const config = await getExternalApiConfig();
    expect(config).toEqual(DEFAULT_EXTERNAL_API_CONFIG);
  });

  it('saves and reads updated config in chrome.storage.local', async () => {
    const saved = await saveExternalApiConfig({
      enabled: true,
      relayWsUrl: 'ws://127.0.0.1:3001/ws',
      relayHost: '0.0.0.0',
      apiKey: 'my-secret-key',
      apiKeys: [],
      extensionToken: '',
      preferredBackend: 'web',
      defaultModel: 'deepseek-v4-flash',
      corsEnabled: true,
      autoStartRelay: false,
      relayPort: 3001,
      allowAgentTools: false,
      allowMultimodal: true,
      injectSystemInfo: true,
      enableMemory: true,
    });

    expect(saved.relayWsUrl).toBe('ws://127.0.0.1:3001/ws');
    expect(saved.relayHost).toBe('0.0.0.0');
    expect(saved.allowAgentTools).toBe(false);
    expect(saved.enableMemory).toBe(true);
    expect(mockStorage[EXTERNAL_API_CONFIG_STORAGE_KEY]).toEqual(saved);

    const loaded = await getExternalApiConfig();
    expect(loaded).toEqual(saved);
  });

  it('normalizes per-key custom configurations correctly', () => {
    const key = createExternalApiKey('Proxy Key', 'sk-custom-proxy');
    const customized = normalizeExternalApiConfig({
      ...DEFAULT_EXTERNAL_API_CONFIG,
      apiKeys: [
        {
          ...key,
          mode: 'proxy_only',
          allowAgentTools: false,
          allowMultimodal: false,
          injectSystemInfo: false,
          enableMemory: false,
          overrideModel: 'deepseek-v4-pro',
          backend: 'official-api',
        },
      ],
    });

    expect(customized.apiKeys.length).toBe(1);
    const k = customized.apiKeys[0];
    expect(k.mode).toBe('proxy_only');
    expect(k.allowAgentTools).toBe(false);
    expect(k.allowMultimodal).toBe(false);
    expect(k.injectSystemInfo).toBe(false);
    expect(k.enableMemory).toBe(false);
    expect(k.overrideModel).toBe('deepseek-v4-pro');
    expect(k.backend).toBe('official-api');
  });
});
