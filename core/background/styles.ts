// Background-feature surface + injected stylesheet generation (issue #565).
//
// Kept pure (no DOM / browser imports) so the exact styles a user sees can be asserted in
// tests, mirroring core/ui/injected-theme.ts. The body CSS variables are computed from the
// configured opacity and the injected <style id="dpp-bg-style"> selects the active light or
// dark value through the same body theme class / prefers-color-scheme rules used elsewhere,
// so a theme switch while the background is enabled stays coherent.

export interface BackgroundSurfaceTokens {
  readonly overlayLight: string;
  readonly overlayDark: string;
  readonly surfaceLight: string;
  readonly surfaceDark: string;
  readonly blur: string;
}

export function computeBackgroundTokens(opacity: number): BackgroundSurfaceTokens {
  const overlayAlpha = (1 - opacity).toFixed(3);
  const surfaceAlpha = Math.min(0.88, 0.72 + opacity * 0.16).toFixed(3);
  const blurPx = ((1 - opacity) * 10).toFixed(1);
  return {
    overlayLight: `rgba(255, 255, 255, ${overlayAlpha})`,
    overlayDark: `rgba(13, 17, 23, ${overlayAlpha})`,
    surfaceLight: `rgba(255, 255, 255, ${surfaceAlpha})`,
    surfaceDark: `rgba(22, 27, 34, ${surfaceAlpha})`,
    blur: `blur(${blurPx}px)`,
  };
}

export function buildBackgroundStyleSheet(): string {
  return `
    #dpp-bg {
      position: fixed;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
    }

    #dpp-bg::after {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--dpp-overlay-light);
      backdrop-filter: var(--dpp-blur);
      -webkit-backdrop-filter: var(--dpp-blur);
      pointer-events: none;
    }

    body.dpp-bg-active,
    body.dpp-bg-active #root,
    body.dpp-bg-active #__next,
    body.dpp-bg-active main,
    body.dpp-bg-active [role="main"],
    body.dpp-bg-active [class*="layout_"],
    body.dpp-bg-active [class*="chat-"] {
      background: transparent !important;
    }

    body.dpp-bg-active [data-dpp-transparent],
    body.dpp-bg-active header,
    body.dpp-bg-active aside,
    body.dpp-bg-active [class*="sidebar_"],
    body.dpp-bg-active [class*="header_"],
    body.dpp-bg-active [class*="bottom_"],
    body.dpp-bg-active [class*="footer_"] {
      background: var(--dpp-surface-light) !important;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }

    /* Light mode */
    html:not(.dark) body.dpp-bg-active #dpp-bg::after {
      background: var(--dpp-overlay-light);
    }
    
    html:not(.dark) body.dpp-bg-active [data-dpp-transparent],
    html:not(.dark) body.dpp-bg-active header,
    html:not(.dark) body.dpp-bg-active aside,
    html:not(.dark) body.dpp-bg-active [class*="sidebar_"],
    html:not(.dark) body.dpp-bg-active [class*="header_"],
    html:not(.dark) body.dpp-bg-active [class*="bottom_"],
    html:not(.dark) body.dpp-bg-active [class*="footer_"] {
      background: var(--dpp-surface-light) !important;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }

    html:not(.dark) body.dpp-bg-active [class*="think"],
    html:not(.dark) body.dpp-bg-active [class*="reason"],
    html:not(.dark) body.dpp-bg-active .ds-markdown pre {
      background: rgba(255, 255, 255, 0.72) !important;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    /* Light mode text contrast */
    html:not(.dark) body.dpp-bg-active {
      color: #0f172a !important;
    }
    html:not(.dark) body.dpp-bg-active .ds-markdown,
    html:not(.dark) body.dpp-bg-active [class*="message"],
    html:not(.dark) body.dpp-bg-active [class*="title"],
    html:not(.dark) body.dpp-bg-active [class*="text-"] {
      color: #0f172a !important;
    }

    /* Dark mode */
    html.dark body.dpp-bg-active #dpp-bg::after {
      background: var(--dpp-overlay-dark);
    }

    html.dark body.dpp-bg-active [data-dpp-transparent],
    html.dark body.dpp-bg-active header,
    html.dark body.dpp-bg-active aside,
    html.dark body.dpp-bg-active [class*="sidebar_"],
    html.dark body.dpp-bg-active [class*="header_"],
    html.dark body.dpp-bg-active [class*="bottom_"],
    html.dark body.dpp-bg-active [class*="footer_"] {
      background: var(--dpp-surface-dark) !important;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }

    html.dark body.dpp-bg-active [class*="think"],
    html.dark body.dpp-bg-active [class*="reason"],
    html.dark body.dpp-bg-active .ds-markdown pre {
      background: rgba(22, 27, 34, 0.75) !important;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
  `;
}
