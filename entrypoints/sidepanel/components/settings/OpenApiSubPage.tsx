import { useState } from 'react';
import { useI18n } from '../../i18n';
import { SettingsSection, StatusBadge, StatusMessage, TextField, ToggleRow } from './primitives';
import type { SettingsState } from '../../controllers/useSettingsController';
import type { ExternalApiKey, ExternalApiKeyMode, ExternalApiBackend } from '../../../../core/external-api/contracts';
import { showSnackbar, showToast } from '../FeedbackSystem';

export default function OpenApiSubPage({ state }: { state: SettingsState }) {
  const { t } = useI18n();
  const [newKeyName, setNewKeyName] = useState('');
  const [customKeyInput, setCustomKeyInput] = useState('');
  const [newKeyMode, setNewKeyMode] = useState<ExternalApiKeyMode>('full_agent');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [codeTab, setCodeTab] = useState<'curl' | 'python' | 'node'>('curl');
  const [selectedKeyForSnippet, setSelectedKeyForSnippet] = useState<string>('');

  const activeKeyForCode =
    selectedKeyForSnippet ||
    state.externalApiConfig.apiKeys.find((k) => k.enabled)?.key ||
    state.externalApiConfig.apiKey ||
    'sk-your-api-key';

  const editingKey = state.externalApiConfig.apiKeys.find((k) => k.id === editingKeyId) || null;

  const handleCreateNewKey = async () => {
    const key = await state.handleCreateApiKey(newKeyName || 'API Key', customKeyInput || undefined, {
      saveFailed: t('sidepanel.settings.saveFailed'),
      saved: t('sidepanel.settings.externalApiSaved'),
    });
    if (key && newKeyMode !== 'full_agent') {
      await state.handleUpdateApiKey(key.id, { mode: newKeyMode }, {
        saveFailed: t('sidepanel.settings.saveFailed'),
        saved: t('sidepanel.settings.externalApiSaved'),
      });
    }
    showSnackbar(t('sidepanel.settings.apiKeyCreated'));
    setNewKeyName('');
    setCustomKeyInput('');
    setNewKeyMode('full_agent');
    setShowCreateModal(false);
  };

  const copyToClipboard = async (text: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (id) {
        setCopiedKeyId(id);
        setTimeout(() => setCopiedKeyId(null), 2000);
        showSnackbar(t('sidepanel.settings.apiKeyCopied'));
      } else {
        setCopiedSnippet(true);
        setTimeout(() => setCopiedSnippet(false), 2000);
        showSnackbar(t('sidepanel.settings.codeSnippetCopied'));
      }
    } catch {
      showToast(t('sidepanel.settings.copyFailed'), 'error');
    }
  };

  const PRESET_MODELS = [
    { value: 'deepseek-v4-flash', label: 'DeepSeek-V4 Flash' },
    { value: 'deepseek-v4-pro', label: 'DeepSeek-V4 Pro' },
    { value: 'deepseek-v4-vision', label: 'DeepSeek-V4 Vision' },
    { value: 'deepseek-chat', label: 'DeepSeek-V3 Chat' },
    { value: 'deepseek-reasoner', label: 'DeepSeek-R1 Reasoner' },
  ];

  const getEffectiveHost = () => {
    const host = state.externalApiConfig.relayHost;
    if (!host || host === '127.0.0.1' || host === '0.0.0.0') return 'localhost';
    return host;
  };

  const getCurlSnippet = () => {
    const host = getEffectiveHost();
    const port = state.externalApiConfig.relayPort || 3000;
    const model = state.externalApiConfig.defaultModel || 'deepseek-v4-flash';
    return `# 1. Set environment variable (or specify key directly)
export DEEPSEEKPP_API_KEY='${activeKeyForCode}'

# 2. Send Chat Completion request
curl http://${host}:${port}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $DEEPSEEKPP_API_KEY" \\
  -d '{
    "model": "${model}",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "thinking": {"type": "enabled"},
    "reasoning_effort": "high",
    "stream": false
  }'`;
  };

  const getPythonSnippet = () => {
    const host = getEffectiveHost();
    const port = state.externalApiConfig.relayPort || 3000;
    const model = state.externalApiConfig.defaultModel || 'deepseek-v4-flash';
    return `import os
from openai import OpenAI

# Note: make sure DEEPSEEKPP_API_KEY is exported or set in environment
client = OpenAI(
    base_url="http://${host}:${port}/v1",
    api_key=os.environ.get("DEEPSEEKPP_API_KEY", "${activeKeyForCode}"),
)

response = client.chat.completions.create(
    model="${model}",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ],
    stream=False,
    extra_body={
        "thinking": {"type": "enabled"},
        "reasoning_effort": "high"
    }
)

# Extract reasoning and answer content
if hasattr(response.choices[0].message, "reasoning_content") and response.choices[0].message.reasoning_content:
    print("Thinking:", response.choices[0].message.reasoning_content)
print("Answer:", response.choices[0].message.content)`;
  };

  const getNodeSnippet = () => {
    const host = getEffectiveHost();
    const port = state.externalApiConfig.relayPort || 3000;
    const model = state.externalApiConfig.defaultModel || 'deepseek-v4-flash';
    return `import OpenAI from 'openai';

// Note: make sure process.env.DEEPSEEKPP_API_KEY is set
const client = new OpenAI({
  baseURL: 'http://${host}:${port}/v1',
  apiKey: process.env.DEEPSEEKPP_API_KEY || '${activeKeyForCode}',
});

async function main() {
  const completion = await client.chat.completions.create({
    model: '${model}',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' }
    ],
  });

  console.log(completion.choices[0].message.content);
}

main();`;
  };

  return (
    <div className="space-y-5">
      {/* 1. Service execution and connection status */}
      <SettingsSection
        title={t('sidepanel.settings.openApiServiceControl')}
        description={t('sidepanel.settings.openApiServiceControlDesc')}
      >
        <div className="flex justify-between items-start gap-3">
          <div>
            <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
              OpenAI API Relay (ext/api-external-relay)
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
              {state.externalApiStatus.connected
                ? t('sidepanel.settings.externalApiConnected')
                : t('sidepanel.settings.externalApiDisconnected')}
              {state.externalApiStatus.latencyMs != null && ` (${state.externalApiStatus.latencyMs}ms)`}
            </div>
          </div>
          <StatusBadge
            configured={state.externalApiStatus.connected}
            configuredLabel={t('sidepanel.settings.externalApiConnected')}
            notConfiguredLabel={t('sidepanel.settings.externalApiDisconnected')}
          />
        </div>

        {/* Native Host Process Control */}
        <div className="p-3 rounded-lg border flex flex-col gap-2" style={{
          backgroundColor: 'var(--ds-surface-secondary)',
          borderColor: 'var(--ds-border)',
        }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold" style={{ color: 'var(--ds-text)' }}>
                {t('sidepanel.settings.relayProcessStatus')}:
              </span>
              <span
                className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: state.relayProcessStatus.running ? 'var(--ds-success-subtle, rgba(34, 197, 94, 0.15))' : 'var(--ds-neutral-subtle, rgba(148, 163, 184, 0.15))',
                  color: state.relayProcessStatus.running ? 'var(--ds-success, #16a34a)' : 'var(--ds-text-tertiary)',
                }}
              >
                {state.relayProcessStatus.running
                  ? `${t('sidepanel.settings.running')}${state.relayProcessStatus.pid ? ` (PID: ${state.relayProcessStatus.pid})` : ''}`
                  : t('sidepanel.settings.stopped')}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {state.relayProcessStatus.nativeHostAvailable ? (
                <>
                  {!state.relayProcessStatus.running ? (
                    <button
                      onClick={() => state.handleStartRelayProcess({
                        success: t('sidepanel.settings.startRelaySuccess'),
                        failed: t('sidepanel.settings.startRelayFailed'),
                      })}
                      disabled={state.externalApiSaveStatus === 'saving'}
                      className="ds-btn-primary px-3 py-1.5 text-[11px] font-medium rounded-md transition-all duration-150"
                    >
                      {t('sidepanel.settings.startServer')}
                    </button>
                  ) : (
                    <button
                      onClick={() => state.handleStopRelayProcess({
                        success: t('sidepanel.settings.stopRelaySuccess'),
                        failed: t('sidepanel.settings.stopRelayFailed'),
                      })}
                      disabled={state.externalApiSaveStatus === 'saving'}
                      className="ds-btn-secondary px-3 py-1.5 text-[11px] font-medium rounded-md transition-all duration-150"
                    >
                      {t('sidepanel.settings.stopServer')}
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={() => state.refreshProcessStatus()}
                  className="ds-btn-secondary px-2.5 py-1 text-[11px] font-medium rounded-md"
                >
                  {t('sidepanel.settings.refresh')}
                </button>
              )}
            </div>
          </div>

          {state.relayProcessStatus.nativeHostAvailable ? (
            <div className="text-[11px] pt-1 flex items-center gap-1.5" style={{
              color: state.relayProcessStatus.running ? 'var(--ds-success, #16a34a)' : 'var(--ds-text-secondary)',
            }}>
              <span style={{ color: state.relayProcessStatus.running ? 'var(--ds-success, #16a34a)' : 'var(--ds-primary, #0ea5e9)' }}>
                {state.relayProcessStatus.running ? '●' : 'ℹ'}
              </span>
              <span>{t('sidepanel.settings.nativeHostConnectedDesc')}</span>
            </div>          ) : (
            <div className="text-[11px] pt-1 flex flex-col gap-1.5" style={{ color: 'var(--ds-text-secondary)' }}>
              <div className="flex items-center gap-1.5" style={{ color: 'var(--ds-primary, #0ea5e9)' }}>
                <span>ℹ</span>
                <span>{t('sidepanel.settings.nativeHostMissingDesc')}</span>
              </div>
              
              {/* Native Host Install Guide */}
              <div className="mt-2 p-2.5 rounded-md" style={{ backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}>
                <div className="font-semibold text-[11px] mb-1.5" style={{ color: 'var(--ds-text)' }}>
                  ⚙️ 终端安装向导 (Mac / Linux / Windows)
                </div>
                <div className="text-[10px] mb-2 leading-relaxed" style={{ color: 'var(--ds-text-tertiary)' }}>
                  请在你的电脑终端中执行以下命令，完成 Native Host 的自动注册：
                </div>
                <div className="relative group">
                  <pre className="text-[10px] p-2 rounded bg-black/5 dark:bg-white/5 overflow-x-auto select-all font-mono" style={{ color: 'var(--ds-text)' }}>
                    {typeof chrome !== 'undefined' && chrome.runtime?.id
                      ? `npx deepseek-ppmore-ext-apirelay install --browser ${navigator.userAgent.toLowerCase().includes('firefox') ? 'firefox' : navigator.userAgent.toLowerCase().includes('edg/') ? 'edge' : 'chrome'} --extension-id ${chrome.runtime.id}`
                      : 'npx deepseek-ppmore-ext-apirelay install --browser chrome --extension-id <your-extension-id>'}
                  </pre>
                </div>
                <div className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--ds-text-tertiary)' }}>
                  安装成功后，请点击右上角的 [刷新] 按钮。
                </div>
              </div>

              <code className="block p-2 rounded text-[10px] select-all font-mono" style={{ backgroundColor: 'var(--ds-surface)' }}>
                {`node packages/shell-host/bin/deepseek-pp-shell-host.mjs install --browser chrome --extension-id ${typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.id : '<extension-id>'}`}
              </code>
              <div className="text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>
                {t('sidepanel.settings.standaloneModeNotice')}:
                <code className="block mt-1 p-2 rounded text-[10px] select-all font-mono" style={{ backgroundColor: 'var(--ds-surface)' }}>
                  {`./ext/api-external-relay/target/release/api-external-relay --host ${state.externalApiConfig.relayHost || '127.0.0.1'} --port ${state.externalApiConfig.relayPort || 3000}`}
                </code>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => state.handleReconnectExternalApi({
              failed: t('sidepanel.settings.reconnectFailed'),
              reconnected: t('sidepanel.settings.reconnected'),
            })}
            disabled={state.externalApiSaveStatus === 'saving'}
            className="ds-btn-secondary flex-1 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
          >
            {state.externalApiSaveStatus === 'saving' ? t('sidepanel.settings.reconnecting') : t('sidepanel.settings.reconnect')}
          </button>
        </div>

        {state.externalApiMessage && (
          <StatusMessage tone={state.externalApiSaveStatus === 'error' ? 'error' : 'success'}>
            {state.externalApiMessage}
          </StatusMessage>
        )}
      </SettingsSection>

      {/* 2. Core parameter configuration & Global Feature Toggles */}
      <SettingsSection
        title={t('sidepanel.settings.openApiConfigSection')}
        description={t('sidepanel.settings.openApiConfigDesc')}
      >
        <ToggleRow
          title={t('sidepanel.settings.enableExternalApi')}
          description={t('sidepanel.settings.enableExternalApiDescription')}
          enabled={state.externalApiConfig.enabled}
          onToggle={(enabled: boolean) => state.patchExternalApiConfig({ enabled })}
        />

        <ToggleRow
          title={t('sidepanel.settings.autoStartRelay')}
          description={t('sidepanel.settings.autoStartRelayDesc')}
          enabled={state.externalApiConfig.autoStartRelay !== false}
          onToggle={(autoStartRelay: boolean) => state.patchExternalApiConfig({ autoStartRelay })}
        />

        {/* Capability Toggles */}
        <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--ds-border)' }}>
          <ToggleRow
            title={t('sidepanel.settings.enableTools')}
            description={t('sidepanel.settings.enableToolsDesc')}
            enabled={state.externalApiConfig.allowAgentTools !== false}
            onToggle={(allowAgentTools: boolean) => state.patchExternalApiConfig({ allowAgentTools })}
          />

          <ToggleRow
            title={t('sidepanel.settings.enableMultimodal')}
            description={t('sidepanel.settings.enableMultimodalDesc')}
            enabled={state.externalApiConfig.allowMultimodal !== false}
            onToggle={(allowMultimodal: boolean) => state.patchExternalApiConfig({ allowMultimodal })}
          />

          <ToggleRow
            title={t('sidepanel.settings.injectSystemInfo')}
            description={t('sidepanel.settings.injectSystemInfoDesc')}
            enabled={state.externalApiConfig.injectSystemInfo !== false}
            onToggle={(injectSystemInfo: boolean) => state.patchExternalApiConfig({ injectSystemInfo })}
          />

          <ToggleRow
            title={t('sidepanel.settings.enableExternalMemory')}
            description={t('sidepanel.settings.enableExternalMemoryDesc')}
            enabled={state.externalApiConfig.enableMemory === true}
            onToggle={(enableMemory: boolean) => state.patchExternalApiConfig({ enableMemory })}
          />
        </div>

        {/* Network & Host Binding */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t" style={{ borderColor: 'var(--ds-border)' }}>
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ds-text-secondary)' }}>
              {t('sidepanel.settings.relayHost')}
            </label>
            <select
              className="w-full text-xs rounded-lg px-2.5 py-2 border transition-all duration-150 outline-none"
              style={{
                backgroundColor: 'var(--ds-surface-secondary)',
                borderColor: 'var(--ds-border)',
                color: 'var(--ds-text)',
              }}
              value={state.externalApiConfig.relayHost === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'}
              onChange={(e) => {
                const host = e.target.value;
                const port = state.externalApiConfig.relayPort || 3000;
                state.patchExternalApiConfig({
                  relayHost: host,
                  relayWsUrl: `ws://${host}:${port}/ws`,
                });
              }}
            >
              <option value="127.0.0.1">{t('sidepanel.settings.relayHostLocal')}</option>
              <option value="0.0.0.0">{t('sidepanel.settings.relayHostAll')}</option>
            </select>
          </div>

          <TextField
            label={t('sidepanel.settings.relayPort')}
            type="number"
            value={String(state.externalApiConfig.relayPort || 3000)}
            placeholder="3000"
            onChange={(val) => {
              const port = parseInt(val, 10) || 3000;
              const host = state.externalApiConfig.relayHost || '127.0.0.1';
              state.patchExternalApiConfig({
                relayPort: port,
                relayWsUrl: `ws://${host}:${port}/ws`,
              });
            }}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ds-text-secondary)' }}>
              {t('sidepanel.settings.externalApiBackend')}
            </label>
            <select
              className="w-full text-xs rounded-lg px-2.5 py-2 border transition-all duration-150 outline-none"
              style={{
                backgroundColor: 'var(--ds-surface-secondary)',
                borderColor: 'var(--ds-border)',
                color: 'var(--ds-text)',
              }}
              value={state.externalApiConfig.preferredBackend}
              onChange={(e) => state.patchExternalApiConfig({
                preferredBackend: e.target.value as 'auto' | 'web' | 'official-api',
              })}
            >
              <option value="auto">{t('sidepanel.settings.backendAuto')}</option>
              <option value="web">{t('sidepanel.settings.backendWeb')}</option>
              <option value="official-api">{t('sidepanel.settings.backendOfficialApi')}</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ds-text-secondary)' }}>
              {t('sidepanel.settings.externalApiDefaultModel')}
            </label>
            <select
              className="w-full text-xs rounded-lg px-2.5 py-2 border transition-all duration-150 outline-none"
              style={{
                backgroundColor: 'var(--ds-surface-secondary)',
                borderColor: 'var(--ds-border)',
                color: 'var(--ds-text)',
              }}
              value={PRESET_MODELS.some((m) => m.value === state.externalApiConfig.defaultModel) ? state.externalApiConfig.defaultModel : 'custom'}
              onChange={(e) => {
                const val = e.target.value;
                if (val !== 'custom') {
                  state.patchExternalApiConfig({ defaultModel: val });
                }
              }}
            >
              {PRESET_MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
              <option value="custom">{t('sidepanel.settings.customModel')}</option>
            </select>
            {!PRESET_MODELS.some((m) => m.value === state.externalApiConfig.defaultModel) && (
              <input
                type="text"
                className="w-full mt-1.5 text-xs rounded-lg px-2.5 py-1.5 border outline-none font-mono"
                style={{
                  backgroundColor: 'var(--ds-surface-secondary)',
                  borderColor: 'var(--ds-border)',
                  color: 'var(--ds-text)',
                }}
                value={state.externalApiConfig.defaultModel}
                placeholder="deepseek-v4-flash"
                onChange={(e) => state.patchExternalApiConfig({ defaultModel: e.target.value })}
              />
            )}
          </div>
        </div>

        <button
          onClick={() => state.handleSaveExternalApiConfig({
            saveFailed: t('sidepanel.settings.saveFailed'),
            saved: t('sidepanel.settings.externalApiSaved'),
          })}
          disabled={state.externalApiSaveStatus === 'saving'}
          className="ds-btn-primary w-full py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
        >
          {state.externalApiSaveStatus === 'saving' ? t('sidepanel.settings.saving') : t('sidepanel.settings.confirm')}
        </button>
      </SettingsSection>

      {/* 3. API key management */}
      <SettingsSection
        title={t('sidepanel.settings.apiKeyManagementTitle')}
        description={t('sidepanel.settings.apiKeyManagementDesc')}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold" style={{ color: 'var(--ds-text)' }}>
            {t('sidepanel.settings.managedKeysList')} ({state.externalApiConfig.apiKeys.length})
          </span>
          <button
            onClick={() => setShowCreateModal(true)}
            className="ds-btn-primary px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all duration-150"
          >
            + {t('sidepanel.settings.createApiKey')}
          </button>
        </div>

        {/* Modal / Create form inline */}
        {showCreateModal && (
          <div className="p-3 rounded-lg border flex flex-col gap-2" style={{
            backgroundColor: 'var(--ds-surface-secondary)',
            borderColor: 'var(--ds-border)',
          }}>
            <div className="text-xs font-semibold" style={{ color: 'var(--ds-text)' }}>
              {t('sidepanel.settings.createApiKey')}
            </div>
            <TextField
              label={t('sidepanel.settings.keyNameLabel')}
              value={newKeyName}
              placeholder="e.g. Cursor IDE, Cherry Studio, OpenWebUI"
              onChange={setNewKeyName}
            />
            <TextField
              label={t('sidepanel.settings.customKeyOptional')}
              value={customKeyInput}
              placeholder="sk-dspp-... (optional custom key)"
              onChange={setCustomKeyInput}
            />
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ds-text-secondary)' }}>
                {t('sidepanel.settings.apiKeyMode')}
              </label>
              <select
                className="w-full text-xs rounded-lg px-2.5 py-1.5 border transition-all duration-150 outline-none"
                style={{
                  backgroundColor: 'var(--ds-surface)',
                  borderColor: 'var(--ds-border)',
                  color: 'var(--ds-text)',
                }}
                value={newKeyMode}
                onChange={(e) => setNewKeyMode(e.target.value as ExternalApiKeyMode)}
              >
                <option value="full_agent">{t('sidepanel.settings.apiKeyModeFullAgent')}</option>
                <option value="proxy_only">{t('sidepanel.settings.apiKeyModeProxyOnly')}</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => setShowCreateModal(false)}
                className="ds-btn-secondary px-3 py-1.5 text-[11px] rounded-md"
              >
                {t('sidepanel.settings.cancel')}
              </button>
              <button
                onClick={handleCreateNewKey}
                className="ds-btn-primary px-3 py-1.5 text-[11px] rounded-md"
              >
                {t('sidepanel.settings.confirm')}
              </button>
            </div>
          </div>
        )}

        {/* Per-Key Granular Edit Modal */}
        {editingKey && (
          <div className="p-3.5 rounded-lg border flex flex-col gap-2.5" style={{
            backgroundColor: 'var(--ds-surface-secondary)',
            borderColor: 'var(--ds-primary, #0ea5e9)',
            borderWidth: 1.5,
          }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold" style={{ color: 'var(--ds-text)' }}>
                {t('sidepanel.settings.apiKeyConfigModal')}: {editingKey.name}
              </span>
              <button
                onClick={() => setEditingKeyId(null)}
                className="text-xs text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ds-text-secondary)' }}>
                {t('sidepanel.settings.apiKeyMode')}
              </label>
              <select
                className="w-full text-xs rounded-lg px-2.5 py-1.5 border outline-none"
                style={{
                  backgroundColor: 'var(--ds-surface)',
                  borderColor: 'var(--ds-border)',
                  color: 'var(--ds-text)',
                }}
                value={editingKey.mode || 'full_agent'}
                onChange={(e) => void state.handleUpdateApiKey(editingKey.id, { mode: e.target.value as ExternalApiKeyMode }, {
                  saveFailed: t('sidepanel.settings.saveFailed'),
                  saved: t('sidepanel.settings.externalApiSaved'),
                })}
              >
                <option value="full_agent">{t('sidepanel.settings.apiKeyModeFullAgent')}</option>
                <option value="proxy_only">{t('sidepanel.settings.apiKeyModeProxyOnly')}</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t" style={{ borderColor: 'var(--ds-border)' }}>
              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ds-text-secondary)' }}>
                  {t('sidepanel.settings.apiKeyOverrideModel')}
                </label>
                <select
                  className="w-full text-xs rounded-lg px-2.5 py-1.5 border outline-none"
                  style={{
                    backgroundColor: 'var(--ds-surface)',
                    borderColor: 'var(--ds-border)',
                    color: 'var(--ds-text)',
                  }}
                  value={editingKey.overrideModel || ''}
                  onChange={(e) => void state.handleUpdateApiKey(editingKey.id, { overrideModel: e.target.value || undefined }, {
                    saveFailed: t('sidepanel.settings.saveFailed'),
                    saved: t('sidepanel.settings.externalApiSaved'),
                  })}
                >
                  <option value="">{t('sidepanel.settings.apiKeyInheritGlobal')}</option>
                  {PRESET_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ds-text-secondary)' }}>
                  {t('sidepanel.settings.apiKeyBackend')}
                </label>
                <select
                  className="w-full text-xs rounded-lg px-2.5 py-1.5 border outline-none"
                  style={{
                    backgroundColor: 'var(--ds-surface)',
                    borderColor: 'var(--ds-border)',
                    color: 'var(--ds-text)',
                  }}
                  value={editingKey.backend || ''}
                  onChange={(e) => void state.handleUpdateApiKey(editingKey.id, { backend: (e.target.value || undefined) as ExternalApiBackend | undefined }, {
                    saveFailed: t('sidepanel.settings.saveFailed'),
                    saved: t('sidepanel.settings.externalApiSaved'),
                  })}
                >
                  <option value="">{t('sidepanel.settings.apiKeyInheritGlobal')}</option>
                  <option value="web">{t('sidepanel.settings.backendWeb')}</option>
                  <option value="official-api">{t('sidepanel.settings.backendOfficialApi')}</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5 pt-1 border-t" style={{ borderColor: 'var(--ds-border)' }}>
              <ToggleRow
                title={t('sidepanel.settings.apiKeyAllowAgentTools')}
                enabled={editingKey.mode !== 'proxy_only' && editingKey.allowAgentTools !== false}
                onToggle={(allowAgentTools) => void state.handleUpdateApiKey(editingKey.id, { allowAgentTools }, {
                  saveFailed: t('sidepanel.settings.saveFailed'),
                  saved: t('sidepanel.settings.externalApiSaved'),
                })}
              />
              <ToggleRow
                title={t('sidepanel.settings.apiKeyAllowMultimodal')}
                enabled={editingKey.allowMultimodal !== false}
                onToggle={(allowMultimodal) => void state.handleUpdateApiKey(editingKey.id, { allowMultimodal }, {
                  saveFailed: t('sidepanel.settings.saveFailed'),
                  saved: t('sidepanel.settings.externalApiSaved'),
                })}
              />
              <ToggleRow
                title={t('sidepanel.settings.apiKeyInjectSystemInfo')}
                enabled={editingKey.injectSystemInfo !== false}
                onToggle={(injectSystemInfo) => void state.handleUpdateApiKey(editingKey.id, { injectSystemInfo }, {
                  saveFailed: t('sidepanel.settings.saveFailed'),
                  saved: t('sidepanel.settings.externalApiSaved'),
                })}
              />
              <ToggleRow
                title={t('sidepanel.settings.apiKeyEnableMemory')}
                enabled={editingKey.enableMemory === true}
                onToggle={(enableMemory) => void state.handleUpdateApiKey(editingKey.id, { enableMemory }, {
                  saveFailed: t('sidepanel.settings.saveFailed'),
                  saved: t('sidepanel.settings.externalApiSaved'),
                })}
              />
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setEditingKeyId(null)}
                className="ds-btn-primary px-3 py-1.5 text-[11px] rounded-md"
              >
                {t('sidepanel.settings.confirm')}
              </button>
            </div>
          </div>
        )}

        {/* Keys List */}
        <div className="space-y-2">
          {state.externalApiConfig.apiKeys.length === 0 ? (
            <div className="text-center py-4 text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.settings.noApiKeysYet')}
            </div>
          ) : (
            state.externalApiConfig.apiKeys.map((item: ExternalApiKey) => (
              <div
                key={item.id}
                className="p-3 rounded-lg border flex flex-col gap-1.5 transition-all duration-150"
                style={{
                  backgroundColor: 'var(--ds-surface-secondary)',
                  borderColor: editingKeyId === item.id ? 'var(--ds-primary, #0ea5e9)' : 'var(--ds-border)',
                  opacity: item.enabled ? 1 : 0.6,
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: 'var(--ds-text)' }}>
                      {item.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{
                      backgroundColor: 'var(--ds-surface)',
                      color: 'var(--ds-text-secondary)',
                    }}>
                      {item.keyPrefix}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{
                      backgroundColor: item.mode === 'proxy_only' ? 'var(--ds-neutral-subtle, rgba(148, 163, 184, 0.15))' : 'var(--ds-primary-subtle, rgba(14, 165, 233, 0.15))',
                      color: item.mode === 'proxy_only' ? 'var(--ds-text-tertiary)' : 'var(--ds-primary, #0ea5e9)',
                    }}>
                      {item.mode === 'proxy_only' ? 'Proxy' : 'Agent'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setEditingKeyId(editingKeyId === item.id ? null : item.id)}
                      className="ds-btn-secondary px-2 py-1 text-[10px] rounded"
                      title={t('sidepanel.settings.apiKeyPerKeyConfig')}
                    >
                      ⚙️ {t('sidepanel.settings.apiKeyPerKeyConfig')}
                    </button>
                    <button
                      onClick={() => copyToClipboard(item.key, item.id)}
                      className="ds-btn-secondary px-2 py-1 text-[10px] rounded"
                      title={t('sidepanel.settings.copyFullKey')}
                    >
                      {copiedKeyId === item.id ? t('sidepanel.settings.copied') : t('sidepanel.settings.copy')}
                    </button>
                    <button
                      onClick={() => {
                        void state.handleToggleApiKey(item.id, !item.enabled, {
                          saveFailed: t('sidepanel.settings.saveFailed'),
                          saved: t('sidepanel.settings.externalApiSaved'),
                        });
                      }}
                      className="ds-btn-secondary px-2 py-1 text-[10px] rounded"
                    >
                      {item.enabled ? t('sidepanel.settings.disable') : t('sidepanel.settings.enable')}
                    </button>
                    <button
                      onClick={() => {
                        void state.handleDeleteApiKey(item.id, {
                          saveFailed: t('sidepanel.settings.saveFailed'),
                          saved: t('sidepanel.settings.externalApiSaved'),
                        });
                      }}
                      className="ds-btn-danger px-2 py-1 text-[10px] rounded"
                    >
                      {t('sidepanel.settings.delete')}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>
                  <span>{t('sidepanel.settings.usageCount')}: {item.usageCount}</span>
                  {item.lastUsedAt && (
                    <span>{t('sidepanel.settings.lastUsed')}: {new Date(item.lastUsedAt).toLocaleString()}</span>
                  )}
                  {item.overrideModel && (
                    <span className="font-mono text-[9px] px-1 bg-black/10 dark:bg-white/10 rounded">
                      model: {item.overrideModel}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </SettingsSection>

      {/* 4. Code usage example */}
      <SettingsSection
        title={t('sidepanel.settings.codeExampleSection')}
        description={t('sidepanel.settings.codeExampleDesc')}
      >
        {/* API Key Export helper box */}
        <div className="p-2.5 rounded-lg border mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2" style={{
          backgroundColor: 'var(--ds-surface-secondary)',
          borderColor: 'var(--ds-border)',
        }}>
          <div className="flex flex-col gap-0.5 overflow-hidden">
            <span className="text-[10px] font-medium" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.settings.apiKeyExportNotice')}
            </span>
            <code className="text-[11px] font-mono select-all truncate" style={{ color: 'var(--ds-primary, #0ea5e9)' }}>
              {`export DEEPSEEKPP_API_KEY='${activeKeyForCode}'`}
            </code>
          </div>
          <button
            onClick={() => void copyToClipboard(`export DEEPSEEKPP_API_KEY='${activeKeyForCode}'`)}
            className="ds-btn-secondary px-2 py-1 text-[10px] rounded shrink-0 self-start sm:self-auto"
          >
            {t('sidepanel.settings.copyExportCmd')}
          </button>
        </div>

        <div className="flex items-center justify-between mb-2">
          <div className="flex gap-1">
            {(['curl', 'python', 'node'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setCodeTab(tab)}
                className="px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150"
                style={{
                  backgroundColor: codeTab === tab ? 'var(--ds-primary, #0ea5e9)' : 'var(--ds-surface-secondary)',
                  color: codeTab === tab ? '#ffffff' : 'var(--ds-text-secondary)',
                }}
              >
                {tab === 'curl' ? 'cURL' : tab === 'python' ? 'Python (OpenAI)' : 'Node.js (OpenAI)'}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              const snippet = codeTab === 'curl' ? getCurlSnippet() : codeTab === 'python' ? getPythonSnippet() : getNodeSnippet();
              void copyToClipboard(snippet);
            }}
            className="ds-btn-secondary px-2.5 py-1 text-[11px] rounded-md"
          >
            {copiedSnippet ? t('sidepanel.settings.copied') : t('sidepanel.settings.copy')}
          </button>
        </div>

        <div className="rounded-lg p-3 text-[11px] font-mono leading-relaxed overflow-x-auto select-all" style={{
          backgroundColor: 'var(--ds-surface-secondary)',
          borderColor: 'var(--ds-border)',
          borderWidth: 1,
          borderStyle: 'solid',
          color: 'var(--ds-text-secondary)',
        }}>
          <pre style={{ margin: 0 }}>
            <code>
              {codeTab === 'curl' && getCurlSnippet()}
              {codeTab === 'python' && getPythonSnippet()}
              {codeTab === 'node' && getNodeSnippet()}
            </code>
          </pre>
        </div>
      </SettingsSection>
    </div>
  );
}
