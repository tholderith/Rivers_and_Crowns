// Sound effects synthesized with Web Audio: no files to download.
// Shares the music control's mute setting and uses its own volume relative to it.

import { music } from './music';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
const SFX_VOLUME = 0.55;

function ensure(): AudioContext | null {
  if (music.muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      out = ctx.createGain();
      out.connect(ctx.destination);
    } catch { return null; }
  }
  if (ctx.state !== 'running') void ctx.resume();
  out!.gain.value = SFX_VOLUME * Math.max(0.15, music.volume);
  return ctx;
}

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
  }
  return noiseBuf;
}

/** A filtered noise burst with an envelope. */
function burst(c: AudioContext, at: number, opts: { dur: number; freq: number; q?: number; type?: BiquadFilterType; gain: number; attack?: number }) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = opts.type ?? 'bandpass';
  f.frequency.value = opts.freq;
  f.Q.value = opts.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(opts.gain, at + (opts.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.dur);
  src.connect(f).connect(g).connect(out!);
  src.start(at, Math.random() * 1.5);
  src.stop(at + opts.dur + 0.05);
}

function tone(c: AudioContext, at: number, opts: { from: number; to: number; dur: number; gain: number; type?: OscillatorType }) {
  const o = c.createOscillator();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(opts.from, at);
  o.frequency.exponentialRampToValueAtTime(opts.to, at + opts.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(opts.gain, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.dur);
  o.connect(g).connect(out!);
  o.start(at);
  o.stop(at + opts.dur + 0.05);
}

export const sfx = {
  /** A ragged volley: several cracks a few ms apart. */
  musket(shots = 4) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < shots; i++) {
      const at = t + i * 0.035 + Math.random() * 0.03;
      burst(c, at, { dur: 0.09, freq: 2400, q: 0.7, gain: 0.7 });
      burst(c, at, { dur: 0.35, freq: 500, q: 0.6, type: 'lowpass', gain: 0.35 });
    }
  },
  bow() {
    const c = ensure(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, { from: 420, to: 160, dur: 0.12, gain: 0.25, type: 'triangle' });
    burst(c, t + 0.02, { dur: 0.18, freq: 3500, q: 2, gain: 0.12 });
  },
  cannon() {
    const c = ensure(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, { from: 110, to: 32, dur: 0.9, gain: 0.9 });
    burst(c, t, { dur: 1.2, freq: 260, type: 'lowpass', gain: 0.8, attack: 0.002 });
    burst(c, t, { dur: 0.12, freq: 1800, q: 0.5, gain: 0.5 });
  },
  clash() {
    const c = ensure(); if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 3; i++) burst(c, t + i * 0.07, { dur: 0.12, freq: 900 + i * 300, q: 3, gain: 0.35 });
    tone(c, t, { from: 1900, to: 1500, dur: 0.25, gain: 0.08, type: 'square' });
  },
  hit() {
    const c = ensure(); if (!c) return;
    burst(c, c.currentTime, { dur: 0.16, freq: 300, type: 'lowpass', gain: 0.45 });
  },
  reload() {
    const c = ensure(); if (!c) return;
    const t = c.currentTime;
    burst(c, t, { dur: 0.05, freq: 3000, q: 4, gain: 0.2 });
    burst(c, t + 0.18, { dur: 0.06, freq: 2200, q: 4, gain: 0.22 });
    burst(c, t + 0.3, { dur: 0.08, freq: 1500, q: 3, gain: 0.25 });
  },
  drum() {
    const c = ensure(); if (!c) return;
    const t = c.currentTime;
    for (const [d, a] of [[0, 0.5], [0.12, 0.35], [0.24, 0.6]] as const) {
      tone(c, t + d, { from: 180, to: 90, dur: 0.18, gain: a });
      burst(c, t + d, { dur: 0.08, freq: 2500, q: 1, gain: 0.15 });
    }
  },
  step() {
    const c = ensure(); if (!c) return;
    burst(c, c.currentTime, { dur: 0.07, freq: 700, q: 1.5, type: 'bandpass', gain: 0.12 });
  },
  hoof() {
    const c = ensure(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, { from: 260, to: 120, dur: 0.07, gain: 0.18, type: 'triangle' });
    tone(c, t + 0.09, { from: 240, to: 110, dur: 0.07, gain: 0.14, type: 'triangle' });
  },
  coins() {
    const c = ensure(); if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 5; i++) tone(c, t + i * 0.055, { from: 2400 + i * 180, to: 2000 + i * 150, dur: 0.12, gain: 0.12, type: 'triangle' });
  },
  build() {
    const c = ensure(); if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 3; i++) { burst(c, t + i * 0.16, { dur: 0.1, freq: 800, q: 2, gain: 0.4 }); tone(c, t + i * 0.16, { from: 240, to: 160, dur: 0.1, gain: 0.25 }); }
  },
  click() {
    const c = ensure(); if (!c) return;
    tone(c, c.currentTime, { from: 900, to: 700, dur: 0.05, gain: 0.08, type: 'triangle' });
  },
  fanfare() {
    const c = ensure(); if (!c) return;
    const t = c.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => tone(c, t + i * 0.12, { from: f, to: f, dur: 0.35, gain: 0.18, type: 'sawtooth' }));
  },
};
