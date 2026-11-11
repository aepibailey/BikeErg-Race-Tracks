/*
 * format.js — pure display helpers (no DOM).
 */

/* Seconds to cover `meters` at `speedMps`; null when stopped. */
export function paceSecPer(speedMps, meters = 1000) {
  return speedMps > 0 ? meters / speedMps : null;
}

/* Pace as m:ss.t (tenths). A dash for no pace. */
export function fmtPace(sec) {
  if (!sec) return '–';
  const tenths = Math.round(sec * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/* Elapsed time as m:ss (whole seconds, truncated like the PM5 clock). */
export function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
