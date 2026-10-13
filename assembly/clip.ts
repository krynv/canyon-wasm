import * as host from "./host";

/**
 * Flash stores clip positions in twips (1/20 px), so reading _x back after `_x += v` yields a
 * quantised value. The simulation depends on that feedback, so positions are quantised here.
 */
export function twips(v: f64): f64 {
  return Math.trunc(v * 20) / 20;
}

/** A MovieClip owned by the game core: host handle plus mirrored, twip-quantised position. */
export class Clip {
  h: i32 = 0;
  private px: f64 = 0;
  private py: f64 = 0;

  get x(): f64 { return this.px; }
  set x(v: f64) {
    if (isNaN(v)) return; // AVM1 ignores NaN/undefined assignments to _x
    this.px = twips(v);
    host.setPos(this.h, this.px, this.py);
  }

  get y(): f64 { return this.py; }
  set y(v: f64) {
    if (isNaN(v)) return;
    this.py = twips(v);
    host.setPos(this.h, this.px, this.py);
  }

  /** False once removeMovieClip() ran: a dangling reference behaves like undefined. */
  get exists(): bool { return this.h != 0; }

  removeMovieClip(): void {
    if (this.h != 0) {
      host.remove(this.h);
      this.h = 0;
    }
  }
}

/** CLayer.as: a container whose elements get sequential names and the next free depth. */
export class Layer extends Clip {
  private counter: i32 = 0;

  constructor(parent: i32, name: string, depth: i32) {
    super();
    this.h = host.attach(parent, "id_layer", name, depth);
  }

  addElement(symbol: string): i32 {
    this.counter++;
    return host.attachNext(this.h, symbol, "_mcElement" + this.counter.toString());
  }

  clear(): void {
    host.removeChildren(this.h);
    this.counter = 0;
  }

  set boolPaused(v: bool) {
    host.pauseLayer(this.h, v);
  }
}
