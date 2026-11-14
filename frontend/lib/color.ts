export type RGB = [number, number, number];

export function interpolateHex(from: RGB, to: RGB, t: number): string {
  const clamp = Math.min(1, Math.max(0, t));
  const mix = (a: number, b: number) =>
    Math.round(a + (b - a) * clamp)
      .toString(16)
      .padStart(2, "0");
  return `#${mix(from[0], to[0])}${mix(from[1], to[1])}${mix(from[2], to[2])}`;
}