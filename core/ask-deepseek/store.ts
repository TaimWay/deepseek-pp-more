import { ASK_DEEPSEEK_STORAGE_KEY, DEFAULT_ASK_DEEPSEEK_SETTINGS, type AskDeepSeekSettings } from './types';

export async function getAskDeepSeekSettings(): Promise<AskDeepSeekSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return { ...DEFAULT_ASK_DEEPSEEK_SETTINGS };
  }
  try {
    const data = await chrome.storage.local.get(ASK_DEEPSEEK_STORAGE_KEY);
    const raw = data[ASK_DEEPSEEK_STORAGE_KEY];
    if (raw && typeof raw === 'object') {
      return { ...DEFAULT_ASK_DEEPSEEK_SETTINGS, ...raw };
    }
  } catch {
    // Ignore error
  }
  return { ...DEFAULT_ASK_DEEPSEEK_SETTINGS };
}

export async function setAskDeepSeekSettings(settings: Partial<AskDeepSeekSettings>): Promise<AskDeepSeekSettings> {
  const current = await getAskDeepSeekSettings();
  const next: AskDeepSeekSettings = { ...current, ...settings };
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [ASK_DEEPSEEK_STORAGE_KEY]: next });
  }
  return next;
}
