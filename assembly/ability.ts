// CAbility.as
import * as host from "./host";
import { CToggleButton } from "./toggle";

export const TYPE_SELL: i32 = 1;
export const TYPE_MISSILE: i32 = 2;
export const TYPE_WALL: i32 = 3;
export const TYPE_TIMEBOMB: i32 = 4;
export const TYPE_MONEYBONUS: i32 = 5;
export const TYPE_TOWERBONUS: i32 = 6;

const CLOCK_FRAMES: i32 = 7200;

export function getCursorSymbol(type: i32): string {
  switch (type) {
    case TYPE_SELL: return "id_cursor_sell";
    case TYPE_MISSILE: return "id_cursor_missile";
    case TYPE_WALL: return "id_cursor_wall";
    case TYPE_TIMEBOMB: return "id_cursor_timebomb";
  }
  return "";
}

/**
 * A player ability. `numSources` is the number of structures providing it; the cooldown
 * recovers by that many ticks per frame, so two silos halve the missile cooldown.
 */
export class CAbility {
  private numCooldown: f64;
  private sources: i32 = 0;
  private timer: f64 = NaN;
  private avaliable: bool = false;
  private mcClock: i32 = 0;

  constructor(public numType: i32, public tgbtnLink: CToggleButton | null, sources: i32) {
    this.numCooldown = numType == TYPE_MISSILE || numType == TYPE_WALL || numType == TYPE_TIMEBOMB ? 5400 : 0;
    if (tgbtnLink != null) {
      this.mcClock = host.child(tgbtnLink.h, "mcClock");
      host.gotoAndStop(this.mcClock, CLOCK_FRAMES + 1);
    }
    this.numSources = sources;
  }

  get numSources(): i32 { return this.sources; }
  set numSources(v: i32) {
    this.sources = v < 0 ? 0 : v;
    this.boolAvaliable = this.sources > 0;
  }

  get boolAvaliable(): bool { return this.avaliable; }
  set boolAvaliable(v: bool) {
    if (!this.avaliable && v) this.numTimer = 0;
    this.avaliable = v;
    const btn = this.tgbtnLink;
    if (btn != null) {
      btn.boolEnabled = v;
      btn.visible = v;
    }
  }

  get numTimer(): f64 { return this.timer; }
  set numTimer(v: f64) {
    this.timer = v < 0 ? 0 : v;
    this.updateClock();
  }

  tick(): void {
    if (!this.avaliable) return;
    if (this.timer == 0) {
      const btn = this.tgbtnLink;
      if (btn != null && !btn.boolEnabled) btn.boolEnabled = true;
    } else {
      this.numTimer = this.timer - this.sources;
    }
  }

  private updateClock(): void {
    if (this.mcClock == 0) return;
    // cooldown 0 gives NaN in the original, and gotoAndStop(NaN) is ignored
    const frame = CLOCK_FRAMES + 1 - Math.floor(CLOCK_FRAMES * this.timer / this.numCooldown);
    if (!isNaN(frame)) host.gotoAndStop(this.mcClock, <i32>frame);
  }

  /** Start the cooldown. Returns false for abilities without one (sell). */
  reset(): bool {
    this.numTimer = this.numCooldown;
    if (this.timer > 0) {
      const btn = this.tgbtnLink;
      if (btn != null) btn.boolEnabled = false;
      return true;
    }
    return false;
  }
}
