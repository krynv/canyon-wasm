// Options (music / effects volume and on-off, the mute switch, graphics mode), remembered per browser.
// The controls themselves are in-game (see add_options_ui in tools/build_assets.py and
// assembly/game.ts); this is only their storage. Channels: 0 = music, 1 = effects.

const STORAGE_KEY = 'canyon-defense-options';
// First-run values, used only when nothing has been saved yet.
const DEFAULTS = [{ volume: 25, on: true }, { volume: 70, on: true }];

export const GRAPHICS_ORIGINAL = 0; // each bitmap filtered the way the SWF flags it (mixed)
export const GRAPHICS_SMOOTH = 1;
export const GRAPHICS_PIXEL = 2;

export class SoundOptions {
  /** @param onChange called with (musicGain, effectsGain) in 0..1, now and after every change */
  constructor(onChange) {
    this.onChange = onChange;
    this.graphics = GRAPHICS_ORIGINAL;
    /** set by the host: called with the new mode when it changes */
    this.onGraphics = null;
    this.channels = DEFAULTS.map((d) => ({ ...d }));
    /** the game's own mute switch (speaker icon / M) */
    this.muted = false;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      this.channels.forEach((c, i) => Object.assign(c, saved.channels?.[i]));
      this.muted = !!saved.muted;
      if ([GRAPHICS_ORIGINAL, GRAPHICS_SMOOTH, GRAPHICS_PIXEL].includes(saved.graphics)) this.graphics = saved.graphics;
    } catch {
      // storage blocked or corrupt: keep the defaults
    }
    this.apply();
  }

  apply() {
    this.onChange(...this.channels.map((c) => (c.on ? c.volume / 100 : 0)));
  }

  commit() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ channels: this.channels, muted: this.muted, graphics: this.graphics }));
    } catch {
      // private window / storage disabled: options just won't persist
    }
    this.apply();
  }

  setMuted(muted) {
    this.muted = !!muted;
    this.commit();
  }

  setGraphics(mode) {
    this.graphics = mode;
    this.commit();
    this.onGraphics?.(mode);
  }

  volume(channel) { return this.channels[channel]?.volume ?? 0; }
  isOn(channel) { return !!this.channels[channel]?.on; }

  setVolume(channel, volume) {
    const c = this.channels[channel];
    if (!c) return;
    c.volume = Math.max(0, Math.min(100, Math.round(volume)));
    this.commit();
  }

  setOn(channel, on) {
    const c = this.channels[channel];
    if (!c) return;
    c.on = !!on;
    this.commit();
  }
}
