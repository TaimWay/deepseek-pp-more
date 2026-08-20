import { readFileSync } from 'node:fs';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsNewPanel from '../entrypoints/sidepanel/components/WhatsNewPanel';

const LAST_SEEN_VERSION_KEY = 'deepseek_pp_whats_new_dismissed_version';
const PENDING_UPDATE_VERSION_KEY = 'deepseek_pp_whats_new_pending_version';

let container: HTMLDivElement;
let root: Root | null;
let storage: Record<string, unknown>;
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  storage = {};
  sendMessage = vi.fn(async () => ({ ok: true }));

  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: vi.fn(() => ({ version: '0.7.2' })),
      sendMessage,
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | Record<string, unknown>) => {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          }
          if (typeof keys === 'string') {
            return { [keys]: storage[keys] };
          }
          return Object.fromEntries(
            Object.entries(keys).map(([key, defaultValue]) => [
              key,
              storage[key] ?? defaultValue,
            ]),
          );
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
        remove: vi.fn(async (key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key]) {
            delete storage[item];
          }
        }),
      },
    },
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

describe('WhatsNewPanel', () => {
  it('shows current release notes and dismisses the current version', async () => {
    storage[PENDING_UPDATE_VERSION_KEY] = '0.7.2';

    await renderPanel();

    expect(container.textContent).toContain('版本更新内容');
    expect(container.textContent).toContain('v0.7.2');
    expect(container.textContent).toContain('内联智能体升级');
    expect(container.textContent).toContain('开放 API 与中转升级');

    const button = container.querySelector('button');
    expect(button?.textContent).toBe('知道了');

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('版本更新内容');
    expect(storage[LAST_SEEN_VERSION_KEY]).toBe('0.7.2');
    expect(storage[PENDING_UPDATE_VERSION_KEY]).toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'WHATS_NEW_DISMISSED' });
  });

  it('does not use a fixed overlay that can cover the side navigation', () => {
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const match = css.match(/\.ds-whats-new-popover\s*\{(?<body>[^}]*)\}/);

    expect(match?.groups?.body).toBeTruthy();
    expect(match!.groups!.body).not.toContain('position: fixed');
  });
});

async function renderPanel() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(WhatsNewPanel));
  });

  await act(async () => {
    await Promise.resolve();
  });
}
