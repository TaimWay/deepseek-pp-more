import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type {
  ExternalApiConfig,
  ExternalApiSessionMeta,
  ExternalApiStatus,
} from '../../core/external-api/contracts';
import { defineBackgroundPayloadRuntimeCommandHandler } from './runtime-handler';

export interface ExternalApiRuntimeHandlerDependencies {
  getConfig(): Promise<ExternalApiConfig>;
  saveConfig(config: ExternalApiConfig): Promise<ExternalApiConfig>;
  reconnect(): Promise<void>;
  getStatus(): ExternalApiStatus;
  notifyStatusChanged(status: ExternalApiStatus): void;
  getSessions(): Promise<ExternalApiSessionMeta[]>;
}

export function createExternalApiRuntimeHandlers(
  dependencies: ExternalApiRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_EXTERNAL_API_STATE', async () => {
      const config = await dependencies.getConfig();
      const status = dependencies.getStatus();
      return { config, status };
    }),
    defineBackgroundPayloadRuntimeCommandHandler('SAVE_EXTERNAL_API_CONFIG', async (config) => {
      const savedConfig = await dependencies.saveConfig(config);
      const status = dependencies.getStatus();
      dependencies.notifyStatusChanged(status);
      return { ok: true as const, config: savedConfig, status };
    }),
    definePayloadlessRuntimeCommandHandler('RECONNECT_EXTERNAL_API', async () => {
      await dependencies.reconnect();
      const status = dependencies.getStatus();
      dependencies.notifyStatusChanged(status);
      return { ok: true as const, status };
    }),
    definePayloadlessRuntimeCommandHandler('GET_EXTERNAL_API_SESSIONS', async () => {
      return dependencies.getSessions();
    }),
  ]);
}
