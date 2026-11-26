// A colour from the instance's settings (NUXT_PUBLIC_COLOR_*), as it may be
// written into the app's stylesheet and the favicon's SVG: any way CSS writes
// a colour — `#7C3AED`, `rgb(124 58 237)`, `oklch(…)`, `rebeccapurple` — and
// nothing that could end the value it is written into. A quote, a semicolon, a
// brace or an angle bracket would let the setting add markup or styles of its
// own; such a value is not a colour and gives `null`.
export function cssColour(value: unknown): string | null {
  const colour = String(value ?? "").trim();
  return /^[#\w\s(),.%/+-]+$/.test(colour) ? colour : null;
}
