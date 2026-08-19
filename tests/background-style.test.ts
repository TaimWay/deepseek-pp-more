import { describe, expect, it } from 'vitest';
import {
  buildBackgroundStyleSheet,
  computeBackgroundTokens,
} from '../core/background/styles';
import { DEFAULT_BACKGROUND_OPACITY } from '../core/background/config';

describe('background surface + stylesheet (issue #565)', () => {
  it('computes default-opacity tokens that keep text readable (not fully transparent)', () => {
    const tokens = computeBackgroundTokens(DEFAULT_BACKGROUND_OPACITY);
    // Overlay wash preserves the previous relative strength at the default: (1 - 0.3).
    expect(tokens.overlayLight).toBe('rgba(255, 255, 255, 0.700)');
    expect(tokens.overlayDark).toBe('rgba(13, 17, 23, 0.700)');
    // Surface stays a readable near-opaque translucent ground across the whole range.
    expect(tokens.surfaceLight).toMatch(/0\.7\d\d|\.8\d\d/);
    expect(tokens.surfaceDark).toMatch(/0\.7\d\d|\.8\d\d/);
    expect(tokens.blur).toMatch(/^blur\(/);
  });

  it('keeps surfaces readable (alpha between 0.72 and 0.88) across the opacity range', () => {
    const alphaOf = (rgba: string) => Number(rgba.match(/rgba\([^,]+,\s*[^,]+,\s*[^,]+,\s*([0-9.]+)\)/)?.[1]);
    for (const opacity of [0.05, 0.3, 0.5, 0.75, 1]) {
      const { surfaceLight, surfaceDark } = computeBackgroundTokens(opacity);
      const light = alphaOf(surfaceLight);
      const dark = alphaOf(surfaceDark);
      expect(light).toBeGreaterThanOrEqual(0.72);
      expect(light).toBeLessThanOrEqual(0.89);
      expect(dark).toBeGreaterThanOrEqual(0.72);
      expect(dark).toBeLessThanOrEqual(0.89);
    }
  });

  it('no longer force-transparents deep app containers two levels down', () => {
    const css = buildBackgroundStyleSheet();
    expect(css).not.toMatch(/#root\s*>\s*div/);
    expect(css).not.toMatch(/#__next\s*>\s*div/);
    expect(css).not.toMatch(/\[data-dpp-transparent\][^}]*transparent !important/);
  });

  it('only keeps the app root shells transparent and gives tagged surfaces a theme surface', () => {
    const css = buildBackgroundStyleSheet();
    // Root shells transparent so the fixed backdrop can paint below them.
    expect(css).toMatch(/body\.dpp-bg-active,\s*body\.dpp-bg-active #root,\s*body\.dpp-bg-active #__next[^]*\{[^]*background: transparent !important/);
    // Tagged surfaces reuse the theme-linked translucent surface, never full transparency.
    expect(css).toMatch(/\[data-dpp-transparent\][^]*\{[^]*background: var\(--dpp-surface-light\) !important/);
    expect(css).toMatch(/html\.dark body\.dpp-bg-active \[data-dpp-transparent\][^]*\{[^]*background: var\(--dpp-surface-dark\) !important/);
  });

  it('keeps the overlay and surfaces theme-aware (dark class + prefers-color-scheme)', () => {
    const css = buildBackgroundStyleSheet();
    expect(css).toContain('html.dark body.dpp-bg-active #dpp-bg::after');
    expect(css).toContain('html:not(.dark) body.dpp-bg-active #dpp-bg::after');
  });
});
