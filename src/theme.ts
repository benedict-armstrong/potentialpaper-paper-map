/**
 * The page's colours for WebGL: deck.gl takes RGB(A) arrays, the SDK gives CSS (`pp.context.theme.tokens`). Any CSS
 * colour is turned into RGB by painting it on a 1px canvas, so `oklch(…)` works as well as `#hex`.
 */
import { hexRgb, type Rgb } from './map';

export interface MapTheme {
  dark: boolean;
  ink: Rgb;
  bg: Rgb;
  accent: Rgb;
  /** A label the search names. */
  lit: Rgb;
}

const LIGHT = { ink: '#1d1d1d', bg: '#fbfaf7', accent: '#b31b1b' };
const DARK = { ink: '#e8e6e1', bg: '#1b1a18', accent: '#e06060' };

let canvas: CanvasRenderingContext2D | null | undefined;

/** A CSS colour as RGB; `fallback` when it can't be read. */
export function cssRgb(css: string | undefined, fallback: string): Rgb {
  const value = css?.trim();
  if (!value) return hexRgb(fallback);
  if (/^#[0-9a-f]{6}$/i.test(value)) return hexRgb(value);
  if (/^#[0-9a-f]{3}$/i.test(value)) return hexRgb(`#${[...value.slice(1)].map((c) => c + c).join('')}`);
  try {
    canvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  } catch {
    canvas = null;
  }
  if (!canvas) return hexRgb(fallback);
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = fallback;
  canvas.fillStyle = value;
  canvas.fillRect(0, 0, 1, 1);
  const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

export function mapTheme(theme: PP.Theme | null | undefined): MapTheme {
  const dark = theme?.mode === 'dark';
  const base = dark ? DARK : LIGHT;
  const t = theme?.tokens ?? {};
  return {
    dark,
    ink: cssRgb(t.ink, base.ink),
    bg: cssRgb(t.bg, base.bg),
    accent: cssRgb(t.accent, base.accent),
    // A vivid blue, more saturated than every dot colour; lighter on a dark page.
    lit: dark ? [120, 160, 255] : [21, 52, 178],
  };
}
