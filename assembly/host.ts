// Imports provided by the browser host (web/main.js).
//
// Display objects are addressed by integer handles; 0 means "no clip" and every call on a
// stale handle is a no-op, mirroring how AVM1 treats references to removed MovieClips.

// ---- display list -----------------------------------------------------------------------------

/** attachMovie(symbol, name, depth) */
// @ts-ignore: decorator
@external("host", "attach")
export declare function attach(parent: i32, symbol: string, name: string, depth: i32): i32;
/** attachMovie(symbol, name, getNextHighestDepth()) */
// @ts-ignore: decorator
@external("host", "attachNext")
export declare function attachNext(parent: i32, symbol: string, name: string): i32;
// @ts-ignore: decorator
@external("host", "remove")
export declare function remove(h: i32): void;
/** Remove every child of a clip (CLayer.clear). */
// @ts-ignore: decorator
@external("host", "removeChildren")
export declare function removeChildren(h: i32): void;
/** Named child lookup; `path` may be dotted ("_mcTabPage1._mcBtnBuilding2"). */
// @ts-ignore: decorator
@external("host", "child")
export declare function child(h: i32, path: string): i32;
// @ts-ignore: decorator
@external("host", "parentOf")
export declare function parentOf(h: i32): i32;
// @ts-ignore: decorator
@external("host", "getDepth")
export declare function getDepth(h: i32): i32;

// @ts-ignore: decorator
@external("host", "setPos")
export declare function setPos(h: i32, x: f64, y: f64): void;
// @ts-ignore: decorator
@external("host", "getX")
export declare function getX(h: i32): f64;
// @ts-ignore: decorator
@external("host", "getY")
export declare function getY(h: i32): f64;
/** Stage-space position of the clip's origin (localToGlobal of 0,0). */
// @ts-ignore: decorator
@external("host", "globalX")
export declare function globalX(h: i32): f64;
// @ts-ignore: decorator
@external("host", "globalY")
export declare function globalY(h: i32): f64;
// @ts-ignore: decorator
@external("host", "setRotation")
export declare function setRotation(h: i32, degrees: f64): void;
// @ts-ignore: decorator
@external("host", "setVisible")
export declare function setVisible(h: i32, visible: bool): void;
// @ts-ignore: decorator
@external("host", "getVisible")
export declare function getVisible(h: i32): bool;
// @ts-ignore: decorator
@external("host", "setAlpha")
export declare function setAlpha(h: i32, percent: f64): void;
// @ts-ignore: decorator
@external("host", "setWidth")
export declare function setWidth(h: i32, w: f64): void;
// @ts-ignore: decorator
@external("host", "setHeight")
export declare function setHeight(h: i32, w: f64): void;
// @ts-ignore: decorator
@external("host", "getWidth")
export declare function getWidth(h: i32): f64;
// @ts-ignore: decorator
@external("host", "getHeight")
export declare function getHeight(h: i32): f64;

// ---- timelines --------------------------------------------------------------------------------

// @ts-ignore: decorator
@external("host", "gotoAndStop")
export declare function gotoAndStop(h: i32, frame: i32): void;
// @ts-ignore: decorator
@external("host", "gotoLabel")
export declare function gotoLabel(h: i32, label: string): void;
// @ts-ignore: decorator
@external("host", "play")
export declare function play(h: i32): void;
// @ts-ignore: decorator
@external("host", "currentFrame")
export declare function currentFrame(h: i32): i32;
/** CLayer.boolPaused: stop()/play() the layer's elements and their nested clips. */
// @ts-ignore: decorator
@external("host", "pauseLayer")
export declare function pauseLayer(h: i32, paused: bool): void;

// ---- text, drawing, filters -------------------------------------------------------------------

// @ts-ignore: decorator
@external("host", "setText")
export declare function setText(h: i32, text: string): void;
// @ts-ignore: decorator
@external("host", "setTextColor")
export declare function setTextColor(h: i32, rgb: i32): void;
// @ts-ignore: decorator
@external("host", "setAutoSize")
export declare function setAutoSize(h: i32, on: bool): void;
/** lineStyle(0, rgb, alpha) + moveTo + lineTo in the clip's own coordinate space. */
// @ts-ignore: decorator
@external("host", "addLine")
export declare function addLine(h: i32, x1: f64, y1: f64, x2: f64, y2: f64, rgb: i32, alpha: f64): void;
/** filters = [GlowFilter(rgb)], or none when rgb < 0. */
// @ts-ignore: decorator
@external("host", "setGlow")
export declare function setGlow(h: i32, rgb: i32): void;

// ---- hit testing and input --------------------------------------------------------------------

// @ts-ignore: decorator
@external("host", "hitTestPoint")
export declare function hitTestPoint(h: i32, x: f64, y: f64, shapeFlag: bool): bool;
// @ts-ignore: decorator
@external("host", "hitTestClips")
export declare function hitTestClips(a: i32, b: i32): bool;
/** Enable onRollOver/onRollOut callbacks for a clip (exports rollOver/rollOut). */
// @ts-ignore: decorator
@external("host", "setRoll")
export declare function setRoll(h: i32, on: bool): void;
// @ts-ignore: decorator
@external("host", "mouseX")
export declare function mouseX(): f64;
// @ts-ignore: decorator
@external("host", "mouseY")
export declare function mouseY(): f64;

// ---- sound (CSoundService lives in the host) --------------------------------------------------

// @ts-ignore: decorator
@external("host", "sndPlay")
export declare function sndPlay(id: i32, ifStopped: bool, repeat: i32): void;
// @ts-ignore: decorator
@external("host", "sndLoop")
export declare function sndLoop(id: i32): void;
// @ts-ignore: decorator
@external("host", "sndVolume")
export declare function sndVolume(id: i32, volume: i32): void;
// @ts-ignore: decorator
@external("host", "sndOff")
export declare function sndOff(): void;
// @ts-ignore: decorator
@external("host", "sndOn")
export declare function sndOn(): void;

// ---- sound options (stored by the host; channel 0 = music, 1 = effects) ------------------------

// @ts-ignore: decorator
@external("host", "optVolume")
export declare function optVolume(channel: i32): i32;
// @ts-ignore: decorator
@external("host", "optSetVolume")
export declare function optSetVolume(channel: i32, percent: i32): void;
// @ts-ignore: decorator
@external("host", "optOn")
export declare function optOn(channel: i32): bool;
// @ts-ignore: decorator
@external("host", "optSetOn")
export declare function optSetOn(channel: i32, on: bool): void;

/** Bitmap filtering: 0 = as authored (mixed), 1 = smooth everything, 2 = hard pixels. */
// @ts-ignore: decorator
@external("host", "optGraphics")
export declare function optGraphics(): i32;
// @ts-ignore: decorator
@external("host", "optSetGraphics")
export declare function optSetGraphics(mode: i32): void;

// ---- misc -------------------------------------------------------------------------------------

/** AS2 random(n): integer in [0, n). */
// @ts-ignore: decorator
@external("host", "random")
export declare function random(n: i32): i32;
// @ts-ignore: decorator
@external("host", "trace")
export declare function trace(msg: string): void;
