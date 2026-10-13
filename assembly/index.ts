// WebAssembly entry points called by the browser host.
import { createGame, game } from "./game";

/** Create the game on its root clip (the `mcGame` instance on the SWF's main timeline). */
export function start(gameClip: i32): void {
  createGame(gameClip);
}

/** Advance the simulation by one 24 fps frame. */
export function frame(): void {
  game().onEnterFrame();
}

export function mouseDown(): void {
  game().onMouseDown();
}

export function mouseMove(): void {
  game().onMouseMove();
}

export function keyDown(code: i32): void {
  game().onKeyDown(code);
}

/** A Button symbol was released; `parent` is the clip that contains it. */
export function buttonRelease(buttonId: i32, parent: i32): void {
  game().onButtonRelease(buttonId, parent);
}

export function rollOver(h: i32): void {
  game().onRollOver(h);
}

export function rollOut(h: i32): void {
  game().onRollOut(h);
}
