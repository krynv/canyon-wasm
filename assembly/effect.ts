// CEffect.as
export const TYPE_DAMAGE: i32 = 1;
export const TYPE_FAST: i32 = 2;
export const TYPE_SLOW: i32 = 3;
export const TYPE_CLEAR: i32 = 4;
export const TYPE_REPAIR: i32 = 5;
export const TYPE_SHIELD: i32 = 6;
export const TYPE_PIERCEDAMAGE: i32 = 7;
export const TYPE_CONFUSE: i32 = 8;
export const TYPE_TIMESTOP: i32 = 9;

/**
 * A status effect on an enemy. `param` is the single value of the original objParams
 * (damage / percent / pass). `duration` is NaN when the original passed undefined (one tick),
 * and -1 for permanent effects (the timer never reaches 0).
 *
 * Splash effects push the *same* instance onto every enemy in range, exactly like the
 * original, so a shared timed effect (slow, time stop) is ticked once per affected enemy.
 */
export class CEffect {
  timer: f64;

  constructor(public numType: i32, public param: f64 = 0, public duration: f64 = NaN) {
    this.timer = isNaN(duration) ? 0 : duration;
  }

  /** Returns true when the effect has expired and must be removed. */
  tick(): bool {
    if (this.timer == 0) return true;
    this.timer -= 1;
    return false;
  }

  makeCopy(): CEffect {
    return new CEffect(this.numType, this.param, this.duration);
  }
}
