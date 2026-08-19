/**
 * Bounded in-memory diagnostic log buffer.
 *
 * The extension keeps no durable log store by design; this buffer retains the
 * most recent operational events (tool starts, authorization denials, tool
 * results, transport failures) so the user can export a compact diagnostic
 * payload without exposing secrets. Entries are never written to disk and are
 * cleared when the worker restarts.
 */

export type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticLogEntry {
  ts: number;
  level: DiagnosticLogLevel;
  source: string;
  message: string;
  /** Short context (never raw payloads or credentials). */
  details?: string;
}

export type DiagnosticLogListener = (entry: DiagnosticLogEntry) => void;

export interface DiagnosticLogBuffer {
  record(entry: Omit<DiagnosticLogEntry, 'ts'>): void;
  snapshot(): readonly DiagnosticLogEntry[];
  clear(): void;
  subscribe(listener: DiagnosticLogListener): () => void;
}

const DEFAULT_MAX_ENTRIES = 1500;
const DEFAULT_MAX_BYTES = 1024 * 1024;

export function createDiagnosticLogBuffer(
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
): DiagnosticLogBuffer {
  let entries: DiagnosticLogEntry[] = [];
  let totalBytes = 0;
  const listeners = new Set<DiagnosticLogListener>();

  const entrySize = (entry: DiagnosticLogEntry): number =>
    JSON.stringify(entry).length;

  const evict = (): void => {
    while (entries.length > 0 && (
      entries.length > maxEntries || totalBytes > maxBytes
    )) {
      const removed = entries.shift();
      if (removed) totalBytes -= entrySize(removed);
    }
  };

  return {
    record(entry) {
      const stamped: DiagnosticLogEntry = { ...entry, ts: Date.now() };
      entries.push(stamped);
      totalBytes += entrySize(stamped);
      evict();
      for (const listener of listeners) {
        try {
          listener(stamped);
        } catch {
          // Ignore listener errors
        }
      }
    },
    snapshot() {
      return [...entries];
    },
    clear() {
      entries = [];
      totalBytes = 0;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Process-wide buffer used by the background tool runtime and external API. */
export const diagnosticLogBuffer = createDiagnosticLogBuffer();

export function logDebug(source: string, message: string, details?: string): void {
  diagnosticLogBuffer.record({ level: 'debug', source, message, details });
}

export function logInfo(source: string, message: string, details?: string): void {
  diagnosticLogBuffer.record({ level: 'info', source, message, details });
}

export function logWarn(source: string, message: string, details?: string): void {
  diagnosticLogBuffer.record({ level: 'warn', source, message, details });
}

export function logError(source: string, message: string, details?: string): void {
  diagnosticLogBuffer.record({ level: 'error', source, message, details });
}

let debugModeEnabled = false;

export function isDebugModeEnabled(): boolean {
  return debugModeEnabled;
}

export function setDebugModeEnabled(enabled: boolean): void {
  debugModeEnabled = enabled;
}
