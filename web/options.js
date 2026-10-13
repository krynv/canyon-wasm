// Sound options (music / effects volume and on-off, plus the mute switch), remembered per browser.
// The controls themselves are in-game (see add_options_ui in tools/build_assets.py and
// assembly/game.ts); this is only their storage. Channels: 0 = music, 1 = effects.

const STORAGE_KEY = 'canyon-defense-options';
// First-run values, used only when nothing has been saved yet.
const DEFAULTS = [{ volume: 25, on: true }, { volume: 70, on: true }];

export class SoundOptions {
  /** @param onChange called with (musicGain, effectsGain) in 0..1, now and after every change */
  constructor(onChange) {
    this.onChange = onChange;
    this.channels = DEFAULTS.map((d) => ({ ...d }));
    /** the game's own mute switch (speaker icon / M) */
    this.muted = false;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      this.channels.forEach((c, i) => Object.assign(c, saved.channels?.[i]));
      this.muted = !!saved.muted;
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ channels: this.channels, muted: this.muted }));
    } catch {
      // private window / storage disabled: options just won't persist
    }
    this.apply();
  }

  setMuted(muted) {
    this.muted = !!muted;
    this.commit();
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
