/** Scan feedback sounds generated with WebAudio — no audio files, works offline. */
let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}
function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', gain = 0.12) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime + at);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + dur);
  o.connect(g); g.connect(c.destination);
  o.start(c.currentTime + at); o.stop(c.currentTime + at + dur);
}
/** Classic POS confirmation: short high beep. */
export const beepSuccess = () => tone(1180, 0, 0.09);
/** Low double-buzz for unknown/blocked scans. */
export const beepError = () => { tone(220, 0, 0.14, 'square', 0.07); tone(196, 0.16, 0.18, 'square', 0.07); };
