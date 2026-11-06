// Colour maths shared by the data pipeline and the app.
// OKLab / OKLCH conversions, WCAG contrast, perceptual distance, and blending.

export type RGB = [number, number, number]; // 0..1 sRGB
export type Lab = [number, number, number]; // OKLab

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
}

export function rgbToHex([r, g, b]: RGB): string {
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function rgbToOklab([r, g, b]: RGB): Lab {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Returns linear-light RGB (may be out of gamut). */
function oklabToLinear([L, a, b]: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklabToRgb(lab: Lab): RGB {
  return oklabToLinear(lab).map(toGamma) as RGB;
}

export function oklch(L: number, C: number, hDeg: number): Lab {
  const h = (hDeg * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

export function inGamut(lab: Lab, eps = 1e-4): boolean {
  return oklabToLinear(lab).every((c) => c >= -eps && c <= 1 + eps);
}

/** Largest in-gamut chroma at or below C for the given L and hue. */
export function clampChroma(L: number, C: number, h: number): Lab {
  let lo = 0, hi = C;
  if (inGamut(oklch(L, C, h))) return oklch(L, C, h);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklch(L, mid, h))) lo = mid; else hi = mid;
  }
  return oklch(L, lo, h);
}

export function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a)), lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Perceptual distance in OKLab (Euclidean). ~0.02 is a just-noticeable difference. */
export function deltaOk(a: string, b: string): number {
  const p = rgbToOklab(hexToRgb(a)), q = rgbToOklab(hexToRgb(b));
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Blend two hex colours in OKLab; t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const p = rgbToOklab(hexToRgb(a)), q = rgbToOklab(hexToRgb(b));
  return rgbToHex(oklabToRgb([0, 1, 2].map((i) => p[i] + (q[i] - p[i]) * t) as Lab));
}

export const NEUTRAL = '#8A9692';
export const MAP_BG_LIGHT = '#EEF2F0';
export const MAP_BG_DARK = '#101614';
