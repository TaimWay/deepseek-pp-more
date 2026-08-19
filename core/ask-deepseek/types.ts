import type { PetPosition } from '../types';

export type AskDeepSeekAction = 'free_ask' | 'explain' | 'summarize' | 'translate';
export type AskDeepSeekTrigger = 'floating_window' | 'sidepanel';

export interface AskDeepSeekSettings {
  enabled: boolean;
  quickSelectionAsk: boolean;
  defaultAction: AskDeepSeekAction;
  defaultModel: string;
  triggerMode: AskDeepSeekTrigger;
  whalePetEnabled: boolean;
  whalePetPosition: PetPosition;
  whalePetSize: number;
  whalePetOpacity: number;
  whalePetMotion: boolean;
}

export const DEFAULT_ASK_DEEPSEEK_SETTINGS: AskDeepSeekSettings = {
  enabled: true,
  quickSelectionAsk: true,
  defaultAction: 'free_ask',
  defaultModel: 'deepseek-v4-flash',
  triggerMode: 'floating_window',
  whalePetEnabled: true,
  whalePetPosition: 'bottom-right',
  whalePetSize: 120,
  whalePetOpacity: 1,
  whalePetMotion: true,
};

export const ASK_DEEPSEEK_STORAGE_KEY = 'deepseek_pp_ask_deepseek_settings';
