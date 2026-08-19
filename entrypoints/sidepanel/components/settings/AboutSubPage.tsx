import { useState, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { SettingsSection, Slider, ToggleRow } from './primitives';
import type { SettingsState } from '../../controllers/useSettingsController';
import { sidepanelRuntimeClient } from '../../runtime-client';
import {
  diagnosticLogBuffer,
  setDebugModeEnabled,
  type DiagnosticLogEntry,
  type DiagnosticLogLevel,
} from '../../../../core/diagnostics/log-buffer';
import {
  getExternalApiSessions,
  removeExternalApiSessions,
  clearAllExternalApiSessions,
  saveExternalApiConfig,
} from '../../../../core/external-api/store';
import type { ExternalApiSessionMeta, ExternalApiConfig } from '../../../../core/external-api/contracts';
import { showSnackbar, showToast } from '../FeedbackSystem';

interface PlaygroundState {
  endpoint: string;
  model: string;
  stream: boolean;
  thinking: boolean;
  tools: string[];
  userPrompt: string;
  loading: boolean;
  resultText: string;
  reasoningText: string;
  tokens: { prompt: number; completion: number; total: number } | null;
  latencyMs: number | null;
  error: string | null;
}

export default function AboutSubPage({ state }: { state: SettingsState }) {
  const { t } = useI18n();
  const [showDevOptions, setShowDevOptions] = useState(false);
  const [logs, setLogs] = useState<DiagnosticLogEntry[]>([]);
  const [logFilterModule, setLogFilterModule] = useState<string>('all');
  const [logFilterLevel, setLogFilterLevel] = useState<string>('all');
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0);
  const [activeSessions, setActiveSessions] = useState<ExternalApiSessionMeta[]>([]);
  const [probingRelay, setProbingRelay] = useState(false);
  const [relayProbeResult, setRelayProbeResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    health?: any;
    models?: string[];
    error?: string;
  } | null>(null);

  // Playground state
  const [playground, setPlayground] = useState<PlaygroundState>({
    endpoint: '/v1/chat/completions',
    model: 'deepseek-v4-flash',
    stream: true,
    thinking: true,
    tools: ['web_search', 'web_fetch'],
    userPrompt: 'Search for the latest features of DeepSeek',
    loading: false,
    resultText: '',
    reasoningText: '',
    tokens: null,
    latencyMs: null,
    error: null,
  });

  const availableToolOptions = [
    { key: 'web_search', label: 'web_search' },
    { key: 'web_fetch', label: 'web_fetch' },
    { key: 'fs_list', label: 'fs_list' },
    { key: 'fs_read', label: 'fs_read' },
    { key: 'fs_write', label: 'fs_write' },
    { key: 'cmd_run', label: 'cmd_run' },
    { key: 'browser_action', label: 'browser_action' },
    { key: 'page_content', label: 'page_content' },
  ];

  const fetchLogs = async () => {
    try {
      const res = await sidepanelRuntimeClient.request({ type: 'EXPORT_DIAGNOSTIC_LOGS' });
      if (res && Array.isArray(res.entries)) {
        setLogs([...res.entries]);
      } else {
        setLogs([...diagnosticLogBuffer.snapshot()]);
      }
    } catch {
      setLogs([...diagnosticLogBuffer.snapshot()]);
    }
  };

  const fetchSessions = async () => {
    try {
      const list = await getExternalApiSessions();
      setActiveSessions(list);
    } catch {
      setActiveSessions([]);
    }
  };

  useEffect(() => {
    if (showDevOptions) {
      fetchLogs();
      fetchSessions();
      const unsubscribe = diagnosticLogBuffer.subscribe(() => {
        fetchLogs();
      });
      return () => unsubscribe();
    }
  }, [showDevOptions]);

  // Auto-refresh timer
  useEffect(() => {
    if (!showDevOptions || autoRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      fetchLogs();
      fetchSessions();
    }, autoRefreshInterval);
    return () => clearInterval(timer);
  }, [showDevOptions, autoRefreshInterval]);

  const handleClearLogs = () => {
    diagnosticLogBuffer.clear();
    setLogs([]);
    showSnackbar(t('sidepanel.settings.logsCleared'));
  };

  const handleCopyLogs = async () => {
    const text = filteredLogs
      .map(
        (l) =>
          `[${new Date(l.ts).toLocaleTimeString()}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}${
            l.details ? ` - ${l.details}` : ''
          }`,
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showSnackbar(t('sidepanel.settings.logsCopied'));
    } catch {
      showToast(t('sidepanel.settings.copyFailed'), 'error');
    }
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `deepseek-pp-logs-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showSnackbar(t('sidepanel.settings.logsExported'));
  };

  const handleDeleteSession = async (chatSessionId: string) => {
    await removeExternalApiSessions([chatSessionId]);
    await fetchSessions();
    showSnackbar(t('sidepanel.settings.sessionDeleted'));
  };

  const handleClearAllSessions = async () => {
    await clearAllExternalApiSessions();
    await fetchSessions();
    showSnackbar(t('sidepanel.settings.allSessionsCleared'));
  };

  const handleProbeRelay = async () => {
    setProbingRelay(true);
    setRelayProbeResult(null);
    const startTime = Date.now();
    try {
      const port = state.externalApiConfig.relayPort || 3000;
      const host = state.externalApiConfig.relayHost || '127.0.0.1';
      const healthRes = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(4000) });
      const healthJson = await healthRes.json();
      const modelsRes = await fetch(`http://${host}:${port}/v1/models`, { signal: AbortSignal.timeout(4000) });
      const modelsJson = await modelsRes.json();
      const latency = Date.now() - startTime;
      const modelIds = Array.isArray(modelsJson?.data) ? modelsJson.data.map((m: any) => m.id) : [];
      setRelayProbeResult({
        ok: true,
        latencyMs: latency,
        health: healthJson,
        models: modelIds,
      });
      showToast(t('sidepanel.settings.probeLatency', { ms: latency }), 'success');
    } catch (err) {
      const latency = Date.now() - startTime;
      const errMsg = err instanceof Error ? err.message : String(err);
      setRelayProbeResult({
        ok: false,
        latencyMs: latency,
        error: errMsg,
      });
      showToast(t('sidepanel.settings.probeError', { error: errMsg }), 'error');
    } finally {
      setProbingRelay(false);
    }
  };

  // Toggle debug mode
  const handleDebugModeToggle = (enabled: boolean) => {
    setDebugModeEnabled(enabled);
    state.patchExternalApiConfig({ debugMode: enabled });
    showSnackbar(enabled ? t('sidepanel.settings.debugModeEnabled') : t('sidepanel.settings.debugModeDisabled'));
  };

  // Toggle request interception
  const handleInterceptToggle = (enabled: boolean) => {
    state.patchExternalApiConfig({ interceptRequests: enabled });
    showSnackbar(enabled ? t('sidepanel.settings.interceptEnabled') : t('sidepanel.settings.interceptDisabled'));
  };

  // Update granular tool switch
  const handleGranularToolToggle = (toolName: string, enabled: boolean) => {
    const current = state.externalApiConfig.toolGranularSettings || {};
    const nextTools = { ...current, [toolName]: enabled };
    state.patchExternalApiConfig({ toolGranularSettings: nextTools });
  };

  // Send Playground Request
  const handleSendPlaygroundRequest = async () => {
    setPlayground((prev) => ({
      ...prev,
      loading: true,
      resultText: '',
      reasoningText: '',
      error: null,
      tokens: null,
      latencyMs: null,
    }));
    const startTime = Date.now();
    const port = state.externalApiConfig.relayPort || 3000;
    const host = state.externalApiConfig.relayHost || '127.0.0.1';
    const apiKey = state.externalApiConfig.apiKeys.find((k) => k.enabled)?.key || state.externalApiConfig.apiKey || '';

    try {
      const body = {
        model: playground.model,
        stream: playground.stream,
        thinking: playground.thinking,
        messages: [{ role: 'user', content: playground.userPrompt }],
      };

      const res = await fetch(`http://${host}:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      if (playground.stream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;
        let accText = '';
        let accReasoning = '';

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const chunkStr = decoder.decode(value, { stream: true });
            const lines = chunkStr.split('\n').filter((l) => l.trim().startsWith('data:'));
            for (const line of lines) {
              const dataContent = line.slice(5).trim();
              if (dataContent === '[DONE]') break;
              try {
                const parsed = JSON.parse(dataContent);
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) {
                  accText += delta.content;
                  setPlayground((p) => ({ ...p, resultText: accText }));
                }
                if (delta?.reasoning_content) {
                  accReasoning += delta.reasoning_content;
                  setPlayground((p) => ({ ...p, reasoningText: accReasoning }));
                }
                if (parsed.usage) {
                  setPlayground((p) => ({ ...p, tokens: parsed.usage }));
                }
              } catch {}
            }
          }
        }
      } else {
        const json = await res.json();
        const choice = json.choices?.[0];
        setPlayground((p) => ({
          ...p,
          resultText: choice?.message?.content || '',
          reasoningText: choice?.message?.reasoning_content || '',
          tokens: json.usage || null,
        }));
      }

      setPlayground((prev) => ({
        ...prev,
        loading: false,
        latencyMs: Date.now() - startTime,
      }));
    } catch (err) {
      setPlayground((prev) => ({
        ...prev,
        loading: false,
        latencyMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  // Generate cURL command
  const handleGenerateCurl = async () => {
    const port = state.externalApiConfig.relayPort || 3000;
    const host = state.externalApiConfig.relayHost || '127.0.0.1';
    const apiKey = state.externalApiConfig.apiKeys.find((k) => k.enabled)?.key || 'YOUR_API_KEY';
    const curl = [
      `curl http://${host}:${port}/v1/chat/completions \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "Authorization: Bearer ${apiKey}" \\`,
      `  -d '{`,
      `    "model": "${playground.model}",`,
      `    "stream": ${playground.stream},`,
      `    "thinking": ${playground.thinking},`,
      `    "messages": [`,
      `      {"role": "user", "content": ${JSON.stringify(playground.userPrompt)}}`,
      `    ]`,
      `  }'`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(curl);
      showSnackbar(t('sidepanel.settings.curlCopied'));
    } catch {
      showToast(t('sidepanel.settings.copyFailed'), 'error');
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (logFilterLevel !== 'all' && log.level !== logFilterLevel) return false;
    if (logFilterModule !== 'all' && log.source !== logFilterModule) return false;
    if (logSearchQuery.trim()) {
      const q = logSearchQuery.toLowerCase();
      const text = `${log.source} ${log.message} ${log.details || ''}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  const availableModules = Array.from(new Set(logs.map((l) => l.source))).filter(Boolean);

  const getLevelBadgeClass = (level: DiagnosticLogLevel) => {
    switch (level) {
      case 'error':
        return 'bg-red-500/10 text-red-500 border-red-500/30';
      case 'warn':
        return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
      case 'info':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/30';
      case 'debug':
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Product Card */}
      <SettingsSection
        title={t('sidepanel.settings.aboutSection')}
        description={t('sidepanel.settings.aboutTagline')}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-[12px] font-bold shadow-sm"
              style={{ background: 'linear-gradient(135deg, var(--ds-blue), var(--ds-logo-gradient-end))' }}
            >
              D+
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--ds-text)' }}>
                DeepSeek++ More v{state.version}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
                {t('sidepanel.settings.aboutTagline')}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t mt-3 text-[11px]" style={{ borderColor: 'var(--ds-border)' }}>
          <a
            href="https://github.com/zhu1090093659/deepseek-pp"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:opacity-80"
            style={{ color: 'var(--ds-text-secondary)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            {t('sidepanel.settings.githubRepo')}
          </a>
        </div>
      </SettingsSection>

      {/* Developer Options Suite */}
      <div
        className="rounded-lg border p-4 transition-all"
        style={{
          borderColor: 'var(--ds-border)',
          background: 'var(--ds-card)',
        }}
      >
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setShowDevOptions(!showDevOptions)}
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-blue-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
              />
            </svg>
            <div className="text-sm font-semibold" style={{ color: 'var(--ds-text)' }}>
              {t('sidepanel.settings.devOptionsTitle')}
            </div>
          </div>
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded font-medium border"
            style={{
              borderColor: 'var(--ds-border)',
              background: 'var(--ds-surface)',
              color: 'var(--ds-text-secondary)',
            }}
          >
            {showDevOptions ? t('sidepanel.settings.collapse') : t('sidepanel.settings.expand')}
          </button>
        </div>

        {showDevOptions && (
          <div className="mt-4 space-y-6 pt-4 border-t" style={{ borderColor: 'var(--ds-border)' }}>
            {/* 1. Global Debug Mode & Interception */}
            <div className="space-y-3">
              <ToggleRow
                title={t('sidepanel.settings.debugModeTitle')}
                description={t('sidepanel.settings.debugModeDesc')}
                enabled={state.externalApiConfig.debugMode || false}
                onToggle={handleDebugModeToggle}
              />
              <ToggleRow
                title={t('sidepanel.settings.interceptRequestsTitle')}
                description={t('sidepanel.settings.interceptRequestsDesc')}
                enabled={state.externalApiConfig.interceptRequests || false}
                onToggle={handleInterceptToggle}
              />
            </div>

            {/* 2. Granular Agent Call Tools Configuration */}
            <div className="space-y-3 pt-3 border-t" style={{ borderColor: 'var(--ds-border)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t('sidepanel.settings.granularToolsTitle')}
              </div>
              <div className="text-[11px] text-slate-400">
                {t('sidepanel.settings.granularToolsDesc')}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {availableToolOptions.map((tool) => {
                  const isChecked = state.externalApiConfig.toolGranularSettings?.[tool.key] !== false;
                  return (
                    <label
                      key={tool.key}
                      className="flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors hover:bg-slate-500/5"
                      style={{ borderColor: 'var(--ds-border)', background: 'var(--ds-surface)' }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => handleGranularToolToggle(tool.key, e.target.checked)}
                        className="rounded border-slate-400 text-blue-600 focus:ring-0"
                      />
                      <span style={{ color: 'var(--ds-text)' }}>{tool.label}</span>
                    </label>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="text-[11px] font-medium text-slate-400 block mb-1">
                    {t('sidepanel.settings.maxToolStepsLabel')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={state.externalApiConfig.maxToolSteps || 20}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 20;
                      state.patchExternalApiConfig({ maxToolSteps: val });
                    }}
                    className="w-full px-2.5 py-1.5 text-xs rounded border outline-none"
                    style={{ background: 'var(--ds-bg)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-400 block mb-1">
                    {t('sidepanel.settings.toolTimeoutLabel')}
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={state.externalApiConfig.toolTimeoutSeconds || 30}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 30;
                      state.patchExternalApiConfig({ toolTimeoutSeconds: val });
                    }}
                    className="w-full px-2.5 py-1.5 text-xs rounded border outline-none"
                    style={{ background: 'var(--ds-bg)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                  />
                </div>
              </div>
            </div>

            {/* 3. API Playground / MDK */}
            <div className="space-y-3 pt-3 border-t" style={{ borderColor: 'var(--ds-border)' }}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('sidepanel.settings.apiPlaygroundTitle')}
                </div>
              </div>
              <div className="text-[11px] text-slate-400">
                {t('sidepanel.settings.apiPlaygroundDesc')}
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Model</label>
                    <select
                      value={playground.model}
                      onChange={(e) => setPlayground((p) => ({ ...p, model: e.target.value }))}
                      className="w-full px-2 py-1 text-xs rounded border"
                      style={{ background: 'var(--ds-bg)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                    >
                      <option value="deepseek-v4-flash">deepseek-v4-flash (Chat)</option>
                      <option value="deepseek-v4-pro">deepseek-v4-pro (Reasoner)</option>
                      <option value="deepseek-v4-vision">deepseek-v4-vision</option>
                      <option value="deepseek-chat">deepseek-chat</option>
                      <option value="deepseek-reasoner">deepseek-reasoner</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3 pt-4">
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={playground.stream}
                        onChange={(e) => setPlayground((p) => ({ ...p, stream: e.target.checked }))}
                      />
                      <span>Stream</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={playground.thinking}
                        onChange={(e) => setPlayground((p) => ({ ...p, thinking: e.target.checked }))}
                      />
                      <span>Thinking</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">User Prompt</label>
                  <textarea
                    rows={2}
                    value={playground.userPrompt}
                    onChange={(e) => setPlayground((p) => ({ ...p, userPrompt: e.target.value }))}
                    className="w-full p-2 text-xs rounded border resize-none"
                    style={{ background: 'var(--ds-bg)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSendPlaygroundRequest}
                    disabled={playground.loading || !playground.userPrompt.trim()}
                    className="flex-1 py-1.5 px-3 rounded text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                  >
                    {playground.loading ? t('sidepanel.settings.probing') : t('sidepanel.settings.sendRequestNow')}
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateCurl}
                    className="py-1.5 px-3 rounded text-xs font-medium border transition-colors hover:bg-slate-500/10"
                    style={{ borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                  >
                    {t('sidepanel.settings.generateCurl')}
                  </button>
                </div>

                {(playground.resultText || playground.reasoningText || playground.error) && (
                  <div
                    className="p-3 rounded-lg border text-xs space-y-2 mt-2"
                    style={{ background: 'var(--ds-surface)', borderColor: 'var(--ds-border)' }}
                  >
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                      <span>{t('sidepanel.settings.requestResultTitle')}</span>
                      {playground.latencyMs && <span>{playground.latencyMs}ms</span>}
                    </div>

                    {playground.reasoningText && (
                      <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px] whitespace-pre-wrap max-h-32 overflow-y-auto">
                        <div className="font-semibold text-[10px] uppercase mb-1">Thinking</div>
                        {playground.reasoningText}
                      </div>
                    )}

                    {playground.resultText && (
                      <div className="p-2 rounded bg-slate-500/10 text-[11px] whitespace-pre-wrap max-h-48 overflow-y-auto" style={{ color: 'var(--ds-text)' }}>
                        {playground.resultText}
                      </div>
                    )}

                    {playground.error && (
                      <div className="p-2 rounded bg-red-500/10 text-red-500 text-[11px]">
                        {playground.error}
                      </div>
                    )}

                    {playground.tokens && (
                      <div className="text-[10px] text-slate-400 pt-1 border-t" style={{ borderColor: 'var(--ds-border)' }}>
                        Tokens: {playground.tokens.prompt} prompt + {playground.tokens.completion} completion = {playground.tokens.total} total
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 4. Relay Health Probe */}
            <div className="space-y-2 pt-3 border-t" style={{ borderColor: 'var(--ds-border)' }}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('sidepanel.settings.relayProbeTitle')}
                </div>
                <button
                  type="button"
                  onClick={handleProbeRelay}
                  disabled={probingRelay}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                >
                  {probingRelay ? t('sidepanel.settings.probing') : t('sidepanel.settings.startTest')}
                </button>
              </div>

              {relayProbeResult && (
                <div
                  className={`p-3 rounded-lg border text-xs ${
                    relayProbeResult.ok
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
                  }`}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    {relayProbeResult.ok ? t('sidepanel.settings.probeSuccess') : t('sidepanel.settings.probeFailed')}
                    <span className="text-[10px] opacity-80 font-normal">
                      ({relayProbeResult.latencyMs}ms)
                    </span>
                  </div>
                  {relayProbeResult.models && (
                    <div className="mt-1 text-[11px] opacity-90">
                      {t('sidepanel.settings.availableModels', { models: relayProbeResult.models.join(', ') })}
                    </div>
                  )}
                  {relayProbeResult.error && (
                    <div className="mt-1 font-mono text-[10px] break-all">{relayProbeResult.error}</div>
                  )}
                </div>
              )}
            </div>

            {/* 5. Active External API Sessions */}
            <div className="space-y-2 pt-3 border-t" style={{ borderColor: 'var(--ds-border)' }}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('sidepanel.settings.externalSessionsTitle', { count: activeSessions.length })}
                </div>
                {activeSessions.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllSessions}
                    className="px-2 py-0.5 rounded text-[11px] text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    {t('sidepanel.settings.clearAllSessions')}
                  </button>
                )}
              </div>

              {activeSessions.length === 0 ? (
                <div className="text-xs py-2 text-center text-slate-400 italic">
                  {t('sidepanel.settings.noActiveSessions')}
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {activeSessions.map((sess) => (
                    <div
                      key={sess.chatSessionId}
                      className="p-3 rounded-lg border flex flex-col gap-1.5 transition-all text-xs"
                      style={{
                        borderColor: 'var(--ds-border)',
                        background: 'var(--ds-surface)',
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-semibold truncate max-w-[140px]"
                            title={sess.sessionKey}
                          >
                            {sess.sessionKey}
                          </span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/20"
                          >
                            {sess.model || 'deepseek-v4-flash'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteSession(sess.chatSessionId)}
                          className="text-red-400 hover:text-red-500 p-1 transition-colors"
                          title={t('sidepanel.settings.deleteSession')}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>

                      {sess.firstUserMessage && (
                        <div
                          className="text-[11px] italic line-clamp-2 px-1 py-0.5 rounded"
                          style={{
                            color: 'var(--ds-text)',
                            background: 'rgba(var(--ds-card-rgb), 0.5)',
                          }}
                        >
                          "{sess.firstUserMessage}"
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t" style={{ borderColor: 'var(--ds-border)' }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{t('sidepanel.settings.messagesCount', { count: sess.messageCount || 1 })}</span>
                          {typeof sess.totalTokens === 'number' && sess.totalTokens > 0 && (
                            <span className="text-emerald-500 font-medium">
                              {sess.totalTokens} Tokens
                            </span>
                          )}
                          {typeof sess.agentCallCount === 'number' && sess.agentCallCount > 0 && (
                            <span className="text-purple-500 font-medium">
                              {sess.agentCallCount} Agent Calls
                            </span>
                          )}
                          {sess.lastAgentTools && sess.lastAgentTools.length > 0 && (
                            <span className="text-blue-400">
                              Tools: {sess.lastAgentTools.join(', ')}
                            </span>
                          )}
                        </div>
                        <span>{new Date(sess.lastUsedAt).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 6. Diagnostic Logs with Auto-Refresh & Filters */}
            <div className="space-y-3 pt-3 border-t" style={{ borderColor: 'var(--ds-border)' }}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('sidepanel.settings.diagnosticLogsTitle', { count: filteredLogs.length })}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Auto refresh select */}
                  <select
                    value={autoRefreshInterval}
                    onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                    className="px-2 py-1 rounded text-xs border"
                    style={{ background: 'var(--ds-surface)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                  >
                    <option value={0}>{t('sidepanel.settings.manualRefresh')}</option>
                    <option value={1000}>{t('sidepanel.settings.refreshEvery1s')}</option>
                    <option value={2000}>{t('sidepanel.settings.refreshEvery2s')}</option>
                    <option value={5000}>{t('sidepanel.settings.refreshEvery5s')}</option>
                  </select>

                  <button
                    type="button"
                    onClick={fetchLogs}
                    className="px-2 py-1 rounded text-xs border font-medium hover:bg-slate-500/10 transition-colors"
                    style={{ borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                  >
                    {t('common.refresh')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLogs}
                    className="px-2 py-1 rounded text-xs border font-medium hover:bg-slate-500/10 transition-colors"
                    style={{ borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                  >
                    {t('sidepanel.settings.copyLogs')}
                  </button>
                  <button
                    type="button"
                    onClick={handleExportJson}
                    className="px-2 py-1 rounded text-xs border font-medium hover:bg-slate-500/10 transition-colors"
                    style={{ borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                  >
                    {t('sidepanel.settings.exportJson')}
                  </button>
                  <button
                    type="button"
                    onClick={handleClearLogs}
                    className="px-2 py-1 rounded text-xs text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    {t('sidepanel.settings.clearLogs')}
                  </button>
                </div>
              </div>

              {/* Log Filters */}
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder={t('sidepanel.settings.searchLogsPlaceholder')}
                  value={logSearchQuery}
                  onChange={(e) => setLogSearchQuery(e.target.value)}
                  className="px-2.5 py-1 text-xs rounded border outline-none"
                  style={{ background: 'var(--ds-surface)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                />
                <select
                  value={logFilterModule}
                  onChange={(e) => setLogFilterModule(e.target.value)}
                  className="px-2 py-1 text-xs rounded border outline-none"
                  style={{ background: 'var(--ds-surface)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                >
                  <option value="all">{t('sidepanel.settings.allModules')}</option>
                  {availableModules.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={logFilterLevel}
                  onChange={(e) => setLogFilterLevel(e.target.value)}
                  className="px-2 py-1 text-xs rounded border outline-none"
                  style={{ background: 'var(--ds-surface)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
                >
                  <option value="all">{t('sidepanel.settings.allLevels')}</option>
                  <option value="debug">DEBUG</option>
                  <option value="info">INFO</option>
                  <option value="warn">WARN</option>
                  <option value="error">ERROR</option>
                </select>
              </div>

              {/* Log Stream Viewer */}
              <div
                className="font-mono text-[11px] p-3 rounded-lg border max-h-72 overflow-y-auto space-y-1.5"
                style={{
                  background: 'var(--ds-bg)',
                  borderColor: 'var(--ds-border)',
                }}
              >
                {filteredLogs.length === 0 ? (
                  <div className="text-center py-4 text-slate-400 italic">
                    {t('sidepanel.settings.noLogsMatch')}
                  </div>
                ) : (
                  filteredLogs.map((entry, idx) => (
                    <div key={idx} className="leading-relaxed border-b pb-1 last:border-0" style={{ borderColor: 'var(--ds-border)' }}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-slate-400 text-[10px]">
                          {new Date(entry.ts).toLocaleTimeString()}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1 rounded border uppercase ${getLevelBadgeClass(
                            entry.level,
                          )}`}
                        >
                          {entry.level}
                        </span>
                        <span className="text-purple-400 font-semibold text-[10px]">
                          [{entry.source}]
                        </span>
                        <span style={{ color: 'var(--ds-text)' }}>{entry.message}</span>
                      </div>
                      {entry.details && (
                        <pre
                          className="mt-1 p-1.5 rounded text-[10px] overflow-x-auto whitespace-pre-wrap break-all"
                          style={{
                            background: 'var(--ds-surface)',
                            color: 'var(--ds-text-secondary)',
                          }}
                        >
                          {entry.details}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
