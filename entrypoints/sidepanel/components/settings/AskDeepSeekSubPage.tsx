import { useEffect, useState } from 'react';
import type { PetPosition } from '../../../../core/types';
import { useI18n } from '../../i18n';
import { SettingsSection, Slider, StatusMessage, ToggleRow } from './primitives';
import type { SettingsState } from '../../controllers/useSettingsController';
import {
  getAskDeepSeekSettings,
  setAskDeepSeekSettings,
} from '../../../../core/ask-deepseek/store';
import {
  type AskDeepSeekAction,
  type AskDeepSeekSettings,
  type AskDeepSeekTrigger,
  DEFAULT_ASK_DEEPSEEK_SETTINGS,
} from '../../../../core/ask-deepseek/types';

export default function AskDeepSeekSubPage({
  state,
  onNavigateToAppearance,
}: {
  state: SettingsState;
  onNavigateToAppearance?: () => void;
}) {
  const { t } = useI18n();
  const [askSettings, setAskSettingsState] = useState<AskDeepSeekSettings>(DEFAULT_ASK_DEEPSEEK_SETTINGS);

  useEffect(() => {
    getAskDeepSeekSettings().then((s) => {
      setAskSettingsState(s);
    });
  }, []);

  const updateSetting = <K extends keyof AskDeepSeekSettings>(key: K, value: AskDeepSeekSettings[K]) => {
    setAskSettingsState((prev) => {
      const next = { ...prev, [key]: value };
      void setAskDeepSeekSettings(next);
      return next;
    });
  };

  const availableModels = [
    { key: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (DeepSeek Chat)' },
    { key: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (DeepSeek Reasoner)' },
    { key: 'deepseek-v4-vision', label: 'DeepSeek V4 Vision' },
    { key: 'deepseek-chat', label: 'DeepSeek Chat (V3 / Web)' },
    { key: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1 / Web)' },
  ];

  return (
    <div className="space-y-5">
      {/* 1. Feature Toggle */}
      <SettingsSection
        title={t('sidepanel.settings.askDeepSeekSection')}
        description={t('sidepanel.settings.askDeepSeekSectionDesc')}
      >
        <ToggleRow
          title={t('sidepanel.settings.askDeepSeekEnable')}
          description={t('sidepanel.settings.askDeepSeekEnableDesc')}
          enabled={askSettings.enabled}
          onToggle={(val) => updateSetting('enabled', val)}
        />
      </SettingsSection>

      {/* 2. DeepSeek Whale Pet Integration */}
      <SettingsSection
        title={t('sidepanel.settings.whalePetIntegrationSection')}
        description={t('sidepanel.settings.whalePetIntegrationDesc')}
      >
        <ToggleRow
          title={t('sidepanel.settings.petWhale')}
          description={t('sidepanel.settings.petWhaleDescription')}
          enabled={state.petEnabled}
          onToggle={state.handlePetToggle}
        />

        {state.petEnabled && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg border flex items-center justify-between" style={{ borderColor: 'var(--ds-border)', background: 'var(--ds-surface)' }}>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center border shadow-sm"
                  style={{ borderColor: 'var(--ds-border)', background: 'var(--ds-card)' }}
                >
                  <img
                    src="/pet/deepseek-whale-pet-states.png"
                    alt="Whale"
                    className="w-8 h-8 object-cover object-top"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold" style={{ color: 'var(--ds-text)' }}>
                    {t('sidepanel.settings.petWhale')}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {t('sidepanel.settings.whalePetBubbleFeedbackDesc')}
                  </div>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
                Active
              </span>
            </div>

            {/* Jump to Appearance Tab */}
            <button
              type="button"
              onClick={onNavigateToAppearance}
              className="w-full py-2.5 px-3 text-xs font-medium rounded-lg border transition-all flex items-center justify-between hover:border-[var(--ds-blue)] group"
              style={{ background: 'var(--ds-bg)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-[var(--ds-blue)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
                <span>{t('sidepanel.settings.customizeAppearanceInAppearanceTab')}</span>
              </div>
              <svg className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </SettingsSection>

      {/* 3. Quick Selection Ask */}
      <SettingsSection
        title={t('sidepanel.settings.quickSelectionSection')}
        description={t('sidepanel.settings.quickSelectionSectionDesc')}
      >
        <ToggleRow
          title={t('sidepanel.settings.quickSelectionEnable')}
          description={t('sidepanel.settings.quickSelectionEnableDesc')}
          enabled={askSettings.quickSelectionAsk}
          onToggle={(val) => updateSetting('quickSelectionAsk', val)}
        />

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.settings.defaultActionLabel')}
          </label>
          <select
            value={askSettings.defaultAction}
            onChange={(e) => updateSetting('defaultAction', e.target.value as AskDeepSeekAction)}
            className="w-full px-3 py-2 text-xs rounded-lg border outline-none transition-colors focus:border-[var(--ds-blue)]"
            style={{ background: 'var(--ds-bg)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
          >
            <option value="free_ask">{t('sidepanel.settings.defaultActionFreeAsk')}</option>
            <option value="explain">{t('sidepanel.settings.defaultActionExplain')}</option>
            <option value="summarize">{t('sidepanel.settings.defaultActionSummarize')}</option>
            <option value="translate">{t('sidepanel.settings.defaultActionTranslate')}</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.settings.defaultModelLabel')}
          </label>
          <select
            value={askSettings.defaultModel}
            onChange={(e) => updateSetting('defaultModel', e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg border outline-none transition-colors focus:border-[var(--ds-blue)]"
            style={{ background: 'var(--ds-bg)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
          >
            {availableModels.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.settings.triggerModeLabel')}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'floating_window' as AskDeepSeekTrigger, label: t('sidepanel.settings.triggerModeFloating') },
              { key: 'sidepanel' as AskDeepSeekTrigger, label: t('sidepanel.settings.triggerModeSidepanel') },
            ].map((item) => {
              const active = askSettings.triggerMode === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => updateSetting('triggerMode', item.key)}
                  className="py-2 text-[11px] font-medium rounded-lg border transition-all duration-150"
                  style={{
                    background: active ? 'var(--ds-blue-light)' : 'var(--ds-bg)',
                    color: active ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
                    borderColor: active ? 'var(--ds-selected-border)' : 'var(--ds-border)',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </SettingsSection>

      {/* 4. Global Floating Ball */}
      <SettingsSection
        title={t('sidepanel.settings.floatingChatSection')}
        description={t('sidepanel.settings.floatingChatDescription')}
      >
        <ToggleRow
          title={t('sidepanel.settings.floatingChat')}
          description={t('sidepanel.settings.floatingChatDescription')}
          enabled={state.floatingChatEnabled}
          disabled={state.floatingChatRuntimeState?.kind === 'invalidated'}
          onToggle={state.handleFloatingChatToggle}
        />
        {state.floatingChatRuntimeState?.kind === 'missing-permission' && (
          <StatusMessage tone="warning">
            {t('sidepanel.settings.floatingChatPermissionMissing')}
          </StatusMessage>
        )}
        {state.floatingChatRuntimeState?.kind === 'invalidated' && (
          <StatusMessage tone="error">
            {t('sidepanel.settings.floatingChatContextInvalidated')}
          </StatusMessage>
        )}
        {state.floatingChatMessage && (
          <StatusMessage tone="error">{state.floatingChatMessage}</StatusMessage>
        )}
      </SettingsSection>
    </div>
  );
}
