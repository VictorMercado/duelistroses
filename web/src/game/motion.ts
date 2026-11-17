/** Eases `obj[key]` towards `target`, the same speed at any frame rate. Returns whether it is still moving. */
export function ease(obj: { [k: string]: number; }, key: string, target: number, rate: number, delta: number): boolean {
  const gap = target - obj[key];
  if (Math.abs(gap) < 1e-4) { obj[key] = target; return false; }
  // `rate` is the share of the gap closed per frame at 60 fps.
  obj[key] += gap * (1 - Math.pow(1 - rate, Math.min(delta, 0.1) * 60));
  return true;
}
