/*
  audio.js — synthesized SFX via Web Audio. No asset files: every effect
  is a tiny oscillator/noise recipe. Safe to import from the Node sim
  (no-ops without AudioContext). The context unlocks on the first call
  after a user gesture — the Start button click covers that.
*/

const AC = typeof window !== 'undefined' &&
  (window.AudioContext || window.webkitAudioContext);
let ctx = null;

function ac() {
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// One enveloped oscillator: pitch glides f0 -> f1 over dur, gain decays to 0.
function tone(type, f0, f1, dur, vol, delay = 0) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Short band-passed noise burst with a fading envelope (slashes, roars).
function noise(dur, vol, freq = 800, delay = 0) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

export const Sfx = {
  shoot()     { tone('square', 660, 180, 0.09, 0.04); },
  slash()     { noise(0.12, 0.10, 2400); },
  kill()      { tone('triangle', 300, 60, 0.15, 0.08); },
  xp()        { tone('sine', 880, 1320, 0.07, 0.03); },
  hurt()      { tone('sawtooth', 160, 60, 0.25, 0.12); noise(0.15, 0.06, 400); },
  levelup()   { [523, 659, 784].forEach((f, i) => tone('square', f, f, 0.12, 0.06, i * 0.09)); },
  nova()      { tone('sine', 200, 800, 0.4, 0.08); },
  bolt()      { tone('sawtooth', 1600, 120, 0.18, 0.07); noise(0.1, 0.05, 3000); },
  boomerang() { tone('square', 440, 880, 0.12, 0.04); },
  roar()      { noise(0.8, 0.2, 150); tone('sawtooth', 90, 40, 0.8, 0.15); },
  victory()   { [523, 659, 784, 1046].forEach((f, i) => tone('square', f, f, 0.18, 0.07, i * 0.12)); },
  defeat()    { [400, 300, 200, 120].forEach((f, i) => tone('sawtooth', f, f * 0.8, 0.25, 0.08, i * 0.15)); },
};
