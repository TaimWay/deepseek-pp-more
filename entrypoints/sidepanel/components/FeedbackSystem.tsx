import { useEffect, useState, type ReactNode } from 'react';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  durationMs: number;
}

export interface SnackbarItem {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs: number;
}

const TOAST_EVENT = 'deepseek_pp_show_toast';
const SNACKBAR_EVENT = 'deepseek_pp_show_snackbar';

export function showToast(
  message: string,
  tone: ToastTone = 'info',
  durationMs = 3500,
): void {
  if (typeof window === 'undefined') return;
  const detail: ToastItem = {
    id: `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    message,
    tone,
    durationMs,
  };
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }));
}

export function showSnackbar(
  message: string,
  actionLabel?: string,
  onAction?: () => void,
  durationMs = 3000,
): void {
  if (typeof window === 'undefined') return;
  const detail: SnackbarItem = {
    id: `snack_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    message,
    actionLabel,
    onAction,
    durationMs,
  };
  window.dispatchEvent(new CustomEvent(SNACKBAR_EVENT, { detail }));
}

export function FeedbackProvider({ children }: { children?: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [activeSnackbar, setActiveSnackbar] = useState<SnackbarItem | null>(null);

  useEffect(() => {
    const onToast = (event: Event) => {
      const custom = event as CustomEvent<ToastItem>;
      if (!custom.detail) return;
      const toast = custom.detail;
      setToasts((prev) => [...prev.slice(-3), toast]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, toast.durationMs);
    };

    const onSnackbar = (event: Event) => {
      const custom = event as CustomEvent<SnackbarItem>;
      if (!custom.detail) return;
      const snack = custom.detail;
      setActiveSnackbar(snack);

      setTimeout(() => {
        setActiveSnackbar((cur) => (cur?.id === snack.id ? null : cur));
      }, snack.durationMs);
    };

    window.addEventListener(TOAST_EVENT, onToast);
    window.addEventListener(SNACKBAR_EVENT, onSnackbar);

    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      window.removeEventListener(SNACKBAR_EVENT, onSnackbar);
    };
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const getToneStyles = (tone: ToastTone) => {
    switch (tone) {
      case 'success':
        return {
          border: '1px solid var(--ds-success-border, #10b981)',
          background: 'var(--ds-success-bg, #ecfdf5)',
          color: 'var(--ds-success, #059669)',
          icon: (
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ),
        };
      case 'warning':
        return {
          border: '1px solid var(--ds-warning-border, #f59e0b)',
          background: 'var(--ds-warning-bg, #fffbeb)',
          color: 'var(--ds-warning, #d97706)',
          icon: (
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
        };
      case 'error':
        return {
          border: '1px solid var(--ds-danger-border, #ef4444)',
          background: 'var(--ds-danger-bg, #fef2f2)',
          color: 'var(--ds-danger, #dc2626)',
          icon: (
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ),
        };
      case 'info':
      default:
        return {
          border: '1px solid var(--ds-info-border, #3b82f6)',
          background: 'var(--ds-info-bg, #eff6ff)',
          color: 'var(--ds-info, #2563eb)',
          icon: (
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
        };
    }
  };

  return (
    <>
      {children}

      {/* Top Toasts Container */}
      <div
        className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-sm"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const style = getToneStyles(toast.tone);
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg shadow-lg backdrop-blur-sm text-xs font-medium w-full animate-in fade-in slide-in-from-top-2 duration-200"
              style={{
                border: style.border,
                background: style.background,
                color: style.color,
              }}
            >
              {style.icon}
              <span className="flex-1 leading-snug break-words">{toast.message}</span>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="shrink-0 p-0.5 opacity-60 hover:opacity-100 transition-opacity font-bold text-sm"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Bottom Snackbar Container */}
      {activeSnackbar && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9998] pointer-events-none px-4 w-full max-w-sm"
          aria-live="polite"
        >
          <div
            className="pointer-events-auto flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg shadow-xl text-xs font-medium text-white bg-slate-900/95 dark:bg-slate-800/95 border border-slate-700/50 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <span className="leading-snug break-words flex-1">{activeSnackbar.message}</span>
            {activeSnackbar.actionLabel && (
              <button
                type="button"
                onClick={() => {
                  activeSnackbar.onAction?.();
                  setActiveSnackbar(null);
                }}
                className="shrink-0 font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-wider text-[11px]"
              >
                {activeSnackbar.actionLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
