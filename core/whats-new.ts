import { getExtensionVersion } from './version';
import type { LocaleMessageKey } from './i18n';

export interface WhatsNewItem {
  id: string;
  titleKey: LocaleMessageKey;
}

export interface WhatsNewState {
  version: string;
  visible: boolean;
  pendingUpdate: boolean;
}

export const WHATS_NEW_ITEMS: WhatsNewItem[] = [
  { id: 'inline-agent', titleKey: 'sidepanel.whatsNew.items.inlineAgent' },
  { id: 'api-relay', titleKey: 'sidepanel.whatsNew.items.apiRelay' },
  { id: 'quick-ask', titleKey: 'sidepanel.whatsNew.items.quickAsk' },
  { id: 'ui-ux', titleKey: 'sidepanel.whatsNew.items.uiUx' },
];

const LAST_SEEN_VERSION_KEY = 'deepseek_pp_whats_new_dismissed_version';
const PENDING_UPDATE_VERSION_KEY = 'deepseek_pp_whats_new_pending_version';

export async function shouldShowWhatsNew(): Promise<boolean> {
  return (await getWhatsNewState()).visible;
}

export async function getWhatsNewState(): Promise<WhatsNewState> {
  const version = getExtensionVersion();
  const data = await chrome.storage.local.get([
    LAST_SEEN_VERSION_KEY,
    PENDING_UPDATE_VERSION_KEY,
  ]) as Record<string, unknown>;
  const pendingUpdate = data[PENDING_UPDATE_VERSION_KEY] === version;

  return {
    version,
    pendingUpdate,
    visible: pendingUpdate || data[LAST_SEEN_VERSION_KEY] !== version,
  };
}

export async function markWhatsNewPending(previousVersion?: string | null): Promise<void> {
  const version = getExtensionVersion();
  if (previousVersion === version) return;
  await chrome.storage.local.set({ [PENDING_UPDATE_VERSION_KEY]: version });
}

export async function hasPendingWhatsNew(): Promise<boolean> {
  return (await getWhatsNewState()).pendingUpdate;
}

export async function dismissWhatsNew(): Promise<void> {
  await chrome.storage.local.set({ [LAST_SEEN_VERSION_KEY]: getExtensionVersion() });
  await chrome.storage.local.remove(PENDING_UPDATE_VERSION_KEY);
}
