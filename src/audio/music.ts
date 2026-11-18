// Background music: one looping track per screen, crossfaded with Web Audio.
// Browsers only start audio after the player interacts, so the first click or key
// press unlocks it. Volume and mute are remembered in localStorage.

export type Track =
  | 'title' | 'map-french' | 'map-haudenosaunee' | 'battle'
  | 'town-french' | 'town-haudenosaunee' | 'victory' | 'defeat';

const STINGS: Track[] = ['victory', 'defeat'];
const FADE = 1.6; // seconds of crossfade between tracks
const LOOP_OVERLAP = 3; // seconds: the next pass of a loop starts this long before the end

const url = (t: Track) => `${import.meta.env.BASE_URL}assets/music/${t}.mp3`;

class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<Track, Promise<AudioBuffer>>();
  private current: { track: Track; gain: GainNode; sources: AudioBufferSourceNode[]; timer?: number } | null = null;
  private wanted: Track | null = null;
  volume = 0.6;
  muted = false;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem('rc-music') ?? '{}');
      if (typeof saved.volume === 'number') this.volume = saved.volume;
      if (typeof saved.muted === 'boolean') this.muted = saved.muted;
    } catch { /* storage unavailable: use defaults */ }
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
      if (this.wanted && !this.current) this.play(this.wanted);
    };
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
  }

  private ensure() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
  }

  private load(t: Track): Promise<AudioBuffer> {
    if (!this.buffers.has(t)) {
      this.buffers.set(t, fetch(url(t)).then(r => r.arrayBuffer()).then(b => this.ctx!.decodeAudioData(b)));
    }
    return this.buffers.get(t)!;
  }

  /** Switch to a track (no-op if it is already playing). Stings play once, then the previous loop returns. */
  play(t: Track) {
    if (!STINGS.includes(t)) this.wanted = t;
    if (!this.ctx || this.ctx.state !== 'running') { if (STINGS.includes(t)) return; this.wanted = t; return; }
    if (this.current?.track === t) return;
    void this.load(t).then(buf => {
      if (!STINGS.includes(t) && this.wanted !== t) return; // superseded while loading
      const ctx = this.ctx!, now = ctx.currentTime;
      this.fadeOut(now);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + (STINGS.includes(t) ? 0.05 : FADE));
      gain.connect(this.master!);
      const cur: { track: Track; gain: GainNode; sources: AudioBufferSourceNode[]; timer?: number } = { track: t, gain, sources: [] };
      this.current = cur;
      if (STINGS.includes(t)) {
        const src = this.start(buf, gain, now);
        src.onended = () => { if (this.current === cur) { this.current = null; if (this.wanted) this.play(this.wanted); } };
      } else {
        this.loop(cur, buf, now);
      }
    }).catch(() => { /* a missing track just means silence */ });
  }

  private start(buf: AudioBuffer, gain: GainNode, at: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start(at);
    return src;
  }

  /** Overlapping passes with short fades, so loops don't click or stop dead. */
  private loop(cur: NonNullable<Music['current']>, buf: AudioBuffer, at: number) {
    if (this.current !== cur) return;
    const ctx = this.ctx!;
    const pass = ctx.createGain();
    pass.connect(cur.gain);
    const end = at + buf.duration;
    pass.gain.setValueAtTime(1, end - LOOP_OVERLAP);
    pass.gain.linearRampToValueAtTime(0, end);
    const src = this.start(buf, pass, at);
    cur.sources.push(src);
    src.onended = () => { cur.sources = cur.sources.filter(s => s !== src); pass.disconnect(); };
    const next = end - LOOP_OVERLAP;
    cur.timer = window.setTimeout(() => this.loop(cur, buf, next), Math.max(0, (next - ctx.currentTime - 1) * 1000));
  }

  private fadeOut(now: number) {
    const old = this.current;
    if (!old) return;
    clearTimeout(old.timer);
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    old.gain.gain.linearRampToValueAtTime(0, now + FADE);
    for (const s of old.sources) { try { s.stop(now + FADE + 0.05); } catch { /* already stopped */ } }
    this.current = null;
  }

  setVolume(v: number) { this.volume = v; this.apply(); }
  toggleMute() { this.muted = !this.muted; this.apply(); }

  private apply() {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    try { localStorage.setItem('rc-music', JSON.stringify({ volume: this.volume, muted: this.muted })); } catch { /* ignore */ }
  }
}

export const music = new Music();

/** A small floating music control: mute button plus a volume slider. */
export function mountMusicControl() {
  const el = document.createElement('div');
  el.className = 'musicctl';
  el.innerHTML = `<button type="button" class="btn" id="musicBtn" aria-label="Music on or off"></button>
    <input type="range" id="musicVol" min="0" max="1" step="0.05" aria-label="Music volume">`;
  document.body.appendChild(el);
  const btn = el.querySelector<HTMLButtonElement>('#musicBtn')!, vol = el.querySelector<HTMLInputElement>('#musicVol')!;
  const show = () => { btn.textContent = music.muted ? '♪ Off' : '♪ On'; vol.value = String(music.volume); vol.disabled = music.muted; };
  btn.onclick = () => { music.toggleMute(); show(); };
  vol.oninput = () => music.setVolume(Number(vol.value));
  show();
}
