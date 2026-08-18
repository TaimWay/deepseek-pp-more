import { SHELL_MCP_NATIVE_HOST } from '../shell';
import {
  DEFAULT_EXTERNAL_API_PORT,
  EXTERNAL_API_RELAY_AUTH_GATE_MESSAGE,
  hasEnabledExternalApiKeys,
  isLoopbackHost,
  type ExternalApiProcessStatus,
} from './contracts';

interface NativePendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export async function isNativeHostAvailable(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.connectNative) {
    return false;
  }
  try {
    const port = chrome.runtime.connectNative(SHELL_MCP_NATIVE_HOST);
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try {
            port.disconnect();
          } catch {}
          resolve(false);
        }
      }, 1500);

      port.onDisconnect.addListener(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(false);
        }
      });

      port.onMessage.addListener(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          try {
            port.disconnect();
          } catch {}
          resolve(true);
        }
      });

      // Send standard ping/initialize envelope
      try {
        port.postMessage({
          protocol: 'deepseek-pp-mcp-native',
          version: 1,
          message: {
            jsonrpc: '2.0',
            id: 'probe-1',
            method: 'initialize',
            params: {},
          },
        });
      } catch {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(false);
        }
      }
    });
  } catch {
    return false;
  }
}

async function sendNativeShellCommand(command: string): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.connectNative) {
    throw new Error('Native messaging is not supported in this browser.');
  }

  const port = chrome.runtime.connectNative(SHELL_MCP_NATIVE_HOST);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        port.disconnect();
      } catch {}
      reject(new Error('Native shell execution timed out (10s).'));
    }, 10000);

    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      const err = chrome.runtime.lastError?.message || 'Native host disconnected.';
      reject(new Error(err));
    });

    port.onMessage.addListener((response: any) => {
      clearTimeout(timer);
      try {
        port.disconnect();
      } catch {}
      resolve(response?.result ?? response);
    });

    port.postMessage({
      protocol: 'deepseek-pp-mcp-native',
      version: 1,
      message: {
        jsonrpc: '2.0',
        id: `shell-${Date.now()}`,
        method: 'tools/call',
        params: {
          name: 'shell_exec',
          arguments: { command },
        },
      },
    });
  });
}

export async function getRelayProcessStatus(port = DEFAULT_EXTERNAL_API_PORT): Promise<ExternalApiProcessStatus> {
  const nativeAvailable = await isNativeHostAvailable();
  const now = Date.now();

  if (!nativeAvailable) {
    // Probe HTTP health endpoint directly from browser fetch
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`, { method: 'GET', cache: 'no-store' });
      if (resp.ok) {
        return {
          running: true,
          pid: null,
          port,
          nativeHostAvailable: false,
          lastCheckedAt: now,
          errorMessage: null,
        };
      }
    } catch {}

    return {
      running: false,
      pid: null,
      port,
      nativeHostAvailable: false,
      lastCheckedAt: now,
      errorMessage: null,
    };
  }

  // With Native Host: check process with lsof / pgrep / ss
  try {
    const cmd = `lsof -i :${port} -sTCP:LISTEN -t || pgrep -f api-external-relay || ss -tulpn | grep :${port}`;
    const result: any = await sendNativeShellCommand(cmd);
    const stdout = (
      result?.structuredContent?.data?.stdout ||
      result?.stdout ||
      result?.content?.[0]?.text ||
      ''
    ).trim();
    const pidMatch = stdout.match(/^(\d+)/m);
    const pid = pidMatch ? parseInt(pidMatch[1], 10) : null;
    const running = Boolean(pid || stdout.length > 0);

    return {
      running,
      pid,
      port,
      nativeHostAvailable: true,
      lastCheckedAt: now,
      errorMessage: null,
    };
  } catch (err) {
    return {
      running: false,
      pid: null,
      port,
      nativeHostAvailable: true,
      lastCheckedAt: now,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function startRelayProcess(options: {
  host?: string;
  port?: number;
  apiKey?: string;
  extensionToken?: string;
  tls?: boolean;
}): Promise<{ ok: boolean; pid?: number; message?: string }> {
  const port = options.port || DEFAULT_EXTERNAL_API_PORT;
  const host = options.host || '127.0.0.1';

  if (!isLoopbackHost(host) && !hasEnabledExternalApiKeys({ apiKeys: [], apiKey: options.apiKey })) {
    return { ok: false, message: EXTERNAL_API_RELAY_AUTH_GATE_MESSAGE };
  }

  const nativeAvailable = await isNativeHostAvailable();

  if (!nativeAvailable) {
    return {
      ok: false,
      message: 'Native Host (deepseek-pp-shell-host) is not connected. Please register your extension ID with the Native Host installer or run the relay binary in terminal.',
    };
  }

  try {
    const status = await getRelayProcessStatus(port);
    if (status.running) {
      return { ok: true, pid: status.pid ?? undefined, message: `Relay is already running on port ${port}.` };
    }

    const startCmd = `
if [ -x "$HOME/dev/TaimWay/deepseek-pp-more/ext/api-external-relay/target/release/api-external-relay" ]; then
  RELAY_BIN="$HOME/dev/TaimWay/deepseek-pp-more/ext/api-external-relay/target/release/api-external-relay"
elif command -v api-external-relay >/dev/null 2>&1; then
  RELAY_BIN=$(command -v api-external-relay)
else
  RELAY_BIN=$(find "$HOME/dev" "$HOME/.local/bin" "$HOME/.cargo/bin" /usr/local/bin "$HOME" -maxdepth 5 -name "api-external-relay" -type f -perm /111 2>/dev/null | head -n 1)
fi

if [ -n "$RELAY_BIN" ] && [ -x "$RELAY_BIN" ]; then
  nohup "$RELAY_BIN" --host "${host}" --port ${port} ${options.apiKey ? `--api-key "${options.apiKey.replace(/"/g, '\\"')}"` : ''} ${options.extensionToken ? `--extension-token "${options.extensionToken.replace(/"/g, '\\"')}"` : ''} ${options.tls ? '--tls' : ''} > /tmp/deepseek-pp-relay.log 2>&1 &
  echo $!
else
  echo "RELAY_NOT_FOUND"
fi
`.trim();

    const result: any = await sendNativeShellCommand(startCmd);
    const stdout = (
      result?.structuredContent?.data?.stdout ||
      result?.stdout ||
      result?.content?.[0]?.text ||
      ''
    ).trim();

    if (stdout.includes('RELAY_NOT_FOUND')) {
      return {
        ok: false,
        message: 'api-external-relay binary not found. Please compile via "cargo build --release --manifest-path ext/api-external-relay/Cargo.toml".',
      };
    }

    const pidMatch = stdout.match(/^(\d+)/m);
    const pid = pidMatch ? parseInt(pidMatch[1], 10) : null;

    return {
      ok: true,
      pid: Number.isSafeInteger(pid) ? pid! : undefined,
      message: `Relay process started on port ${port}.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function stopRelayProcess(port = DEFAULT_EXTERNAL_API_PORT): Promise<{ ok: boolean; message?: string }> {
  const nativeAvailable = await isNativeHostAvailable();

  if (!nativeAvailable) {
    return {
      ok: false,
      message: 'Native Host is unavailable. Please stop the process manually via terminal (kill / pkill).',
    };
  }

  try {
    const killCmd = `pkill -f "api-external-relay.*--port ${port}" || kill $(lsof -t -i:${port}) 2>/dev/null || pkill -f "api-external-relay"`;
    await sendNativeShellCommand(killCmd);
    return { ok: true, message: `Relay process on port ${port} stopped.` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
