// CSoundService.as, on top of Web Audio.
//
// The original queues play requests in a per-sound state slot and starts them once per frame;
// a slot holds ST_STOP (0), ST_PLAY (-1) or a pending repeat count (> 0).

const MUSIC_ID = 0; // Const.SND_MAINLOOP
const ST_PLAY = -1;
const ST_STOP = 0;

export class SoundService {
  /** @param buffers AudioBuffer per sound id (entries may be null if decoding failed) */
  constructor(ctx, buffers) {
    this.ctx = ctx;
    this.buffers = buffers;
    this.state = buffers.map(() => ST_STOP);
    this.playing = buffers.map(() => new Set());
    // Two mix buses so the options panel can balance music against effects. They sit after
    // the per-sound gains, so the game's own volume changes and mute switch keep working.
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(ctx.destination);
    this.sfxBus.connect(ctx.destination);
    this.gains = buffers.map((_, id) => {
      const g = ctx.createGain();
      g.connect(id === MUSIC_ID ? this.musicBus : this.sfxBus);
      return g;
    });
    this.soundOff = false;
    this.loopId = -1;
  }

  /** playSound(id, ifSoundStop, repeatCount) */
  play(id, ifStopped, repeat) {
    if (this.soundOff) return;
    if (ifStopped && this.state[id] !== ST_STOP) return;
    this.state[id] = repeat;
  }

  /** processSounds(): start everything queued during the frame. */
  process() {
    for (let id = 0; id < this.state.length; id++) {
      if (this.state[id] > 0) {
        this.start(id, this.state[id]);
        this.state[id] = ST_PLAY;
      }
    }
  }

  start(id, repeat) {
    const buffer = this.buffers[id];
    if (this.soundOff || !buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = repeat > 1;
    src.connect(this.gains[id]);
    src.onended = () => {
      this.playing[id].delete(src);
      this.state[id] = ST_STOP; // onSoundComplete
    };
    this.playing[id].add(src);
    src.start();
  }

  stop(id) {
    for (const src of this.playing[id]) {
      src.onended = null;
      try { src.stop(); } catch { /* not started */ }
    }
    this.playing[id].clear();
    this.state[id] = ST_STOP;
  }

  setVolume(id, volume) {
    this.gains[id].gain.value = volume / 100;
  }

  /** playLoopSound(id) */
  loop(id) {
    if (this.loopId >= 0 && this.loopId !== id) this.stop(this.loopId);
    this.loopId = id;
    if (this.state[id] === ST_STOP) this.play(id, true, 9999);
  }

  off() {
    for (let id = 0; id < this.state.length; id++) this.stop(id);
    this.soundOff = true;
  }

  on() {
    this.soundOff = false;
    if (this.loopId >= 0) this.play(this.loopId, true, 9999);
  }

  /** Mix levels (0..1) from the sound options. */
  setMix(music, effects) {
    this.musicBus.gain.value = music;
    this.sfxBus.gain.value = effects;
  }

  isOn() {
    return !this.soundOff;
  }
}
