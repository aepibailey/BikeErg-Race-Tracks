/*
 * capture.js — turn a PM5 packet recording into the downloadable capture
 * file: the raw packets, what the app decoded at the end, and what the rider
 * read off the PM5 screen. These files become parser test fixtures.
 */

/**
 * @param {{startedAt: string, device: string|null, packets: object[]}} recording
 * @param {object} parsedAtEnd  the app's metrics when recording stopped
 * @param {Record<string,string>} screen  values typed from the PM5 display
 */
export function buildCapture(recording, parsedAtEnd, screen) {
  const typed = Object.fromEntries(
    Object.entries(screen || {})
      .map(([k, v]) => [k, String(v ?? '').trim()])
      .filter(([, v]) => v !== ''),
  );
  return {
    ...recording,
    parsedAtEnd: { ...parsedAtEnd },
    pm5Screen: Object.keys(typed).length ? typed : null,
  };
}

export function captureFilename(recording) {
  return `pm5-capture-${recording.startedAt.replace(/[:.]/g, '-')}.json`;
}
