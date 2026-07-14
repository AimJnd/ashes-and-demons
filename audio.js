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
// dest routes the note somewhere other than the speakers (the music bus).
function tone(type, f0, f1, dur, vol, delay = 0, dest = null) {
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
  o.connect(g).connect(dest || c.destination);
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

// Music: two synthesized loops, one per stage — no audio assets. Each
// bar's notes are scheduled ~a second ahead on a timer; everything runs
// through one bus gain so stop() can fade the lot instantly.
const BARS = {
  // Stage 1 — the crypt: a slow A-minor organ line over a deep drone.
  1: {
    step: 0.7,
    melody: [220, 261.63, 329.63, 261.63, 293.66, 261.63, 246.94, 196],
    melodyVoice: ['triangle', 0.65, 0.035],
    bass: [[110, 0], [87.31, 4]], // [freq, step index]
    bassVoice: ['sawtooth', 2.7, 0.014],
  },
  // Stage 2 — the dark forest: airy pentatonic plucks over a soft pad.
  2: {
    step: 0.42,
    melody: [164.81, 0, 196, 220, 0, 246.94, 220, 0, 293.66, 246.94, 0, 220, 196, 0, 164.81, 0],
    melodyVoice: ['sine', 0.5, 0.04],
    bass: [[82.41, 0], [123.47, 8]],
    bassVoice: ['sine', 3.2, 0.02],
  },
};

export const Music = {
  _timer: null,
  _bus: null,
  _next: 0, // absolute ctx time of the next unscheduled bar

  _busNode() {
    const c = ac();
    if (!c) return null;
    if (!this._bus) {
      this._bus = c.createGain();
      this._bus.connect(c.destination);
    }
    return this._bus;
  },

  start(stage) {
    this.stop();
    const c = ac();
    const bus = this._busNode();
    if (!c || !bus) return;
    bus.gain.cancelScheduledValues(c.currentTime);
    bus.gain.setValueAtTime(1, c.currentTime);
    const bar = BARS[stage] || BARS[1];
    const barLen = bar.step * bar.melody.length;
    this._next = c.currentTime + 0.15;
    const tick = () => {
      // Keep about a second of music queued; timers may fire late.
      while (this._next < c.currentTime + 1.2) {
        const base = this._next - c.currentTime;
        const [mtype, mdur, mvol] = bar.melodyVoice;
        bar.melody.forEach((f, i) => {
          if (f) tone(mtype, f, f, mdur, mvol, base + i * bar.step, bus);
        });
        const [btype, bdur, bvol] = bar.bassVoice;
        for (const [f, at] of bar.bass) {
          tone(btype, f, f, bdur, bvol, base + at * bar.step, bus);
        }
        this._next += barLen;
      }
      this._timer = setTimeout(tick, 250);
    };
    tick();
  },

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const c = ctx; // don't create a context just to silence it
    if (c && this._bus) {
      // Fade the bus fast — already-scheduled notes die with it.
      this._bus.gain.cancelScheduledValues(c.currentTime);
      this._bus.gain.setValueAtTime(this._bus.gain.value, c.currentTime);
      this._bus.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.25);
    }
  },
};

export const Sfx = {
  shoot()     { tone('square', 200, 500, 0.09, 0.02); },
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
