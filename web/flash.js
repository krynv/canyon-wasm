// Minimal Flash-style display-list runtime.
//
// Plays the timelines extracted from the SWF (assets/movie.json) and exposes the small
// subset of the MovieClip API the game core needs (attachMovie, _x/_y/_rotation, gotoAndStop,
// hitTest, dynamic text ...). Nodes are addressed by integer handles so the WASM core can
// drive them; a handle to a removed node is simply ignored, like a dead clip in AVM1.

const TIMELINE_DEPTH = -16384; // AVM1 depth of SWF depth 0
const STAGE_W = 650;
const STAGE_H = 450;
const BACKGROUND = '#666666';

// Render interpolation: the simulation runs at a fixed 24 steps per second, and frames drawn
// between two steps blend each clip's transform from its pre-step to its post-step value.
// Jumps larger than these in a single step are teleports (laser shots, cursors) and are not blended.
const MAX_BLEND_DISTANCE = 20;        // px
const MIN_BLEND_ROTATION_COS = 0.8;   // ~37 degrees

// Timeline scripts that are more than stop()/removeMovieClip()/playSound() ("custom" in movie.json).
// Keyed by sprite id, then frame. Preloader / advert / award sprites are never instantiated.
const FRAME_SCRIPTS = {
  // options screen map selector: desynchronise the three static-noise loops
  629: { 1: (n) => { n.child('mcNoise2')?.goto(9, true); n.child('mcNoise3')?.goto(43, true); n.playing = false; } },
  // sound switch shows its "off" frame when sound is already muted
  584: { 1: (n) => { if (!n.stage.host.soundIsOn()) n.goto(2, false); n.playing = false; } },
};

class Node {
  constructor(stage, cid, parent, depth) {
    this.stage = stage;
    this.id = stage.nextId++;
    this.cid = cid;
    this.char = cid ? stage.chars[cid] : null;
    this.kind = this.char ? this.char.t : 'empty';
    this.parent = parent;
    this.depth = depth;
    this.name = '';
    this.m = [1, 0, 0, 1, 0, 0];
    this.alpha = 1;
    this.visible = true;
    this.children = [];        // kept sorted by depth
    this.fromTimeline = false;
    this.clipDepth = 0;        // >0: this node masks siblings up to that depth
    this.ratio = 0;            // morph position
    this.frame = 0;
    this.total = this.kind === 'sprite' ? this.char.frames.length : 1;
    this.playing = true;
    this.lines = null;         // drawing-API hairlines
    this.glow = null;          // css colour
    this.roll = false;         // receives rollOver/rollOut
    this.alive = true;
    if (this.kind === 'edit') {
      this.text = (this.char.text || '').replace(/\\r/g, '\n');
      this.color = this.char.color ? rgb(this.char.color) : '#000';
      this.autoSize = false;
    }
    if (this.kind === 'button') this.state = 'up';
    stage.nodes.set(this.id, this);
  }

  // ---- tree -------------------------------------------------------------------------------

  child(name) {
    let node = this;
    for (const part of name.split('.')) {
      let found = null;
      for (const c of node.children) if (c.name === part) found = c;
      if (!found) return null;
      node = found;
    }
    return node;
  }

  childAt(depth) {
    for (const c of this.children) if (c.depth === depth) return c;
    return null;
  }

  insert(node) {
    const old = this.childAt(node.depth);
    if (old) old.destroy();
    let i = this.children.length;
    while (i > 0 && this.children[i - 1].depth > node.depth) i--;
    this.children.splice(i, 0, node);
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    for (const c of this.children.slice()) c.destroy();
    this.stage.nodes.delete(this.id);
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
    }
    this.stage.onRemoved(this);
  }

  // ---- timeline ---------------------------------------------------------------------------

  createChild(cid, depth) {
    const node = new Node(this.stage, cid, this, depth);
    this.insert(node);
    node.init();
    return node;
  }

  init() {
    if (this.kind === 'sprite') this.enterFrame(1, true);
    else if (this.kind === 'button') this.buildButton();
  }

  buildButton() {
    for (const c of this.children.slice()) c.destroy();
    for (const r of this.char.recs) {
      if (!r[this.state]) continue;
      const n = new Node(this.stage, r.id, this, r.depth);
      n.fromTimeline = true;
      if (r.m) n.m = r.m.slice();
      this.insert(n);
      n.init();
    }
  }

  setButtonState(state) {
    if (this.state === state) return;
    this.state = state;
    this.buildButton();
  }

  /** Apply one frame's display-list tags. */
  applyOps(frameIndex) {
    for (const op of this.char.frames[frameIndex]) {
      if (op.op === 'remove') {
        const c = this.childAt(op.depth + TIMELINE_DEPTH);
        if (c && c.fromTimeline) c.destroy();
      } else if (op.op === 'place') {
        const depth = op.depth + TIMELINE_DEPTH;
        let c = this.childAt(depth);
        if (op.id !== undefined && !(c && c.fromTimeline && c.cid === op.id && op.move)) {
          const prev = c && op.move ? c : null;
          const n = new Node(this.stage, op.id, this, depth);
          n.fromTimeline = true;
          if (prev) { n.m = prev.m.slice(); n.alpha = prev.alpha; n.name = prev.name; }
          applyPlace(n, op);
          this.insert(n); // replaces whatever was at this depth
          n.init();
        } else if (c) {
          applyPlace(c, op);
        }
      } else if (op.op === 'sound') {
        // timeline StartSound tags only occur in the unused preloader / sound-holder clips
      }
    }
  }

  /** Display list a timeline describes at `frame`, as depth -> merged place op. */
  describe(frame) {
    const want = new Map();
    for (let i = 0; i < frame; i++) {
      for (const op of this.char.frames[i]) {
        if (op.op === 'remove') want.delete(op.depth);
        else if (op.op === 'place') {
          const prev = op.move ? want.get(op.depth) : null;
          want.set(op.depth, { ...(prev || {}), ...op });
        }
      }
    }
    return want;
  }

  /** Go to a frame; instances that exist in both frames are kept (as Flash does on rewind). */
  goto(frame, play) {
    if (this.kind !== 'sprite' || !this.alive) return;
    frame = Math.max(1, Math.min(this.total, frame | 0));
    this.playing = play;
    if (frame === this.frame) return;
    this.enterFrame(frame, false);
  }

  enterFrame(frame, first) {
    if (first || frame === this.frame + 1) {
      this.frame = frame;
      this.applyOps(frame - 1);
    } else if (frame > this.frame) {
      for (let f = this.frame; f < frame; f++) this.applyOps(f);
      this.frame = frame;
    } else {
      const want = this.describe(frame);
      for (const c of this.children.slice()) {
        if (!c.fromTimeline) continue;
        const w = want.get(c.depth - TIMELINE_DEPTH);
        if (!w || w.id !== c.cid) c.destroy();
      }
      for (const [d, w] of want) {
        let c = this.childAt(d + TIMELINE_DEPTH);
        if (c && c.fromTimeline) { applyPlace(c, w); continue; }
        c = new Node(this.stage, w.id, this, d + TIMELINE_DEPTH);
        c.fromTimeline = true;
        applyPlace(c, w);
        this.insert(c);
        c.init();
      }
      this.frame = frame;
    }
    this.runActions(frame);
  }

  runActions(frame) {
    const ops = this.stage.actions[this.cid]?.[frame];
    if (!ops) return;
    for (const op of ops) {
      if (!this.alive) return;
      if (op === 'stop') this.playing = false;
      else if (op === 'remove') this.destroy();
      else if (op === 'hide') this.visible = false;
      else if (op.startsWith('snd:')) this.stage.host.playSound(+op.slice(4), false, 1);
      else if (op === 'custom') FRAME_SCRIPTS[this.cid]?.[frame]?.(this);
    }
  }

  // ---- geometry ---------------------------------------------------------------------------

  /** Bounds in this node's own coordinate space, or null when empty. */
  localBounds() {
    const c = this.char;
    let b = null;
    if (this.kind === 'shape' || this.kind === 'text' || this.kind === 'morph') b = c.b.slice();
    else if (this.kind === 'edit') {
      b = c.b.slice();
      if (this.autoSize) b[2] = b[0] + this.stage.measureEdit(this) + 4;
    }
    for (const ch of this.children) {
      const cb = ch.localBounds();
      if (cb) b = union(b, transformBounds(cb, ch.m));
    }
    if (this.lines) for (const l of this.lines) b = union(b, [Math.min(l.x1, l.x2), Math.min(l.y1, l.y2), Math.max(l.x1, l.x2), Math.max(l.y1, l.y2)]);
    return b;
  }

  /** Bounds in the parent's coordinate space (what _width/_height report). */
  parentBounds() {
    const b = this.localBounds();
    return b ? transformBounds(b, this.m) : [0, 0, 0, 0];
  }

  worldMatrix() {
    let m = this.m;
    for (let p = this.parent; p; p = p.parent) m = mul(p.m, m);
    return m;
  }

  worldBounds() {
    const b = this.localBounds();
    return b ? transformBounds(b, this.worldMatrix()) : null;
  }

  setScaleTo(w, h) {
    const b = this.localBounds();
    if (!b) return;
    const [sx, sy, rot] = decompose(this.m);
    const nx = w === null ? sx : (b[2] - b[0] ? w / (b[2] - b[0]) : sx);
    const ny = h === null ? sy : (b[3] - b[1] ? h / (b[3] - b[1]) : sy);
    compose(this.m, nx, ny, rot);
  }

  setRotation(deg) {
    const [sx, sy] = decompose(this.m);
    compose(this.m, sx, sy, deg * Math.PI / 180);
  }

  isShown() {
    for (let n = this; n; n = n.parent) if (!n.visible) return false;
    return true;
  }
}

function applyPlace(n, op) {
  if (op.m) n.m = op.m.slice();
  if (op.cx) n.alpha = op.cx[3] / 256;
  if (op.name) n.name = op.name;
  if (op.clip) n.clipDepth = op.clip + TIMELINE_DEPTH;
  if (op.ratio !== undefined) n.ratio = op.ratio;
}

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

function mul(p, m) {
  return [
    p[0] * m[0] + p[2] * m[1], p[1] * m[0] + p[3] * m[1],
    p[0] * m[2] + p[2] * m[3], p[1] * m[2] + p[3] * m[3],
    p[0] * m[4] + p[2] * m[5] + p[4], p[1] * m[4] + p[3] * m[5] + p[5],
  ];
}

function transformBounds(b, m) {
  const xs = [], ys = [];
  for (const [x, y] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function union(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function decompose(m) {
  const sx = Math.hypot(m[0], m[1]);
  const det = m[0] * m[3] - m[1] * m[2];
  const sy = Math.hypot(m[2], m[3]) * (det < 0 ? -1 : 1);
  return [sx, sy, Math.atan2(m[1], m[0])];
}

function compose(m, sx, sy, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  m[0] = sx * c; m[1] = sx * s; m[2] = -sy * s; m[3] = sy * c;
}

export class Stage {
  /**
   * @param movie   parsed assets/movie.json
   * @param images  Map of image key ("shapes/12", "morphs/237_0", ...) -> HTMLImageElement
   * @param canvas  target canvas
   * @param host    { playSound(id, ifStopped, repeat), soundIsOn() }
   */
  constructor(movie, images, canvas, host) {
    this.chars = movie.chars;
    this.exports = movie.exports;
    this.actions = movie.actions;
    this.fonts = movie.fonts;
    this.images = images;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.host = host;
    this.nodes = new Map();
    this.nextId = 1;
    this.bitmaps = new Map();
    this.root = new Node(this, 0, null, 0);
    this.mouseX = 0;
    this.mouseY = 0;
    this.pixelScale = 1;
    this.over = null;      // interactive node under the pointer
    this.pressed = null;   // button the mouse went down on
    this.events = null;    // { rollOver(h), rollOut(h), buttonRelease(cid, parentHandle) }
    this.blend = 1;                     // position within the current simulation step
    this.blendScratch = [1, 0, 0, 1, 0, 0];
    this.probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    this.probe.canvas.width = this.probe.canvas.height = 1;
    this.scratch = [0, 1].map(() => document.createElement('canvas').getContext('2d'));
    this.resize();
  }

  get(h) { return this.nodes.get(h) || null; }

  onRemoved(node) {
    if (this.over === node) this.over = null;
    if (this.pressed === node) this.pressed = null;
  }

  // ---- MovieClip-style API (used through handles by the WASM core) -------------------------

  attach(parent, symbol, name, depth) {
    const cid = this.exports[symbol];
    if (!parent || cid === undefined) return null;
    const node = new Node(this, cid, parent, depth);
    node.name = name;
    parent.insert(node); // like attachMovie, replaces whatever occupies that depth
    node.init();
    return node.alive ? node : null;
  }

  /** MovieClip.getNextHighestDepth() */
  nextDepth(parent) {
    let d = 0;
    for (const c of parent.children) if (c.depth >= d) d = c.depth + 1;
    return d;
  }

  /** CLayer.boolPaused: stop()/play() each element, its children and its _mcObject's children. */
  pauseLayer(layer, paused) {
    const set = (n) => { if (n.kind === 'sprite') n.playing = !paused; };
    for (const el of layer.children) {
      set(el);
      for (const c of el.children) set(c);
      const obj = el.child('_mcObject');
      if (obj) for (const c of obj.children) set(c);
    }
  }

  hitTestPoint(node, x, y, shape) {
    const b = node.worldBounds();
    if (!b || x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    if (!shape) return true;
    const p = this.probe;
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.clearRect(0, 0, 1, 1);
    p.setTransform(1, 0, 0, 1, -x, -y);
    if (node.parent) p.transform(...node.parent.worldMatrix());
    this.draw(p, node, true, 1);
    try {
      return p.getImageData(0, 0, 1, 1).data[3] > 0;
    } catch {
      return true; // canvas tainted (should not happen for same-origin SVG): fall back to bounds
    }
  }

  hitTestNodes(a, b) {
    const x = a.worldBounds(), y = b.worldBounds();
    return !!x && !!y && x[0] <= y[2] && x[2] >= y[0] && x[1] <= y[3] && x[3] >= y[1];
  }

  // ---- render interpolation ----------------------------------------------------------------

  /** Call before a simulation step: remember where every clip is. */
  beginStep() {
    const walk = (n) => { n.m0 = n.m.slice(); n.m1 = null; for (const c of n.children) walk(c); };
    walk(this.root);
  }

  /** Call after a simulation step: remember where every surviving clip ended up. */
  endStep() {
    const walk = (n) => { if (n.m0) n.m1 = n.m.slice(); for (const c of n.children) walk(c); };
    walk(this.root);
  }

  /**
   * Transform to draw a clip with, `this.blend` (0..1) of the way through the current step.
   * Falls back to the real transform for new clips, teleports, and anything moved outside a
   * step (mouse-driven cursors), so only simulation motion is smoothed.
   */
  viewMatrix(n) {
    const a = n.m0, b = n.m1, m = n.m;
    if (!a || !b || this.blend >= 1) return m;
    for (let i = 0; i < 6; i++) if (m[i] !== b[i]) return m;
    if (Math.hypot(b[4] - a[4], b[5] - a[5]) > MAX_BLEND_DISTANCE) return m;
    const la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
    if (la && lb && (a[0] * b[0] + a[1] * b[1]) / (la * lb) < MIN_BLEND_ROTATION_COS) return m;
    const t = this.blend, out = this.blendScratch;
    for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * t;
    return out;
  }

  // ---- frame advance ----------------------------------------------------------------------

  /** Advance every playing timeline by one frame (clips created during the pass wait a frame). */
  tick() {
    const list = [];
    const walk = (n) => { if (n.kind === 'sprite' && n.total > 1) list.push(n); for (const c of n.children) walk(c); };
    walk(this.root);
    for (const n of list) {
      if (n.alive && n.playing) n.enterFrame(n.frame >= n.total ? 1 : n.frame + 1, false);
    }
  }

  // ---- input ------------------------------------------------------------------------------

  /** Topmost button or roll-enabled clip under the pointer. */
  pick() {
    const x = this.mouseX, y = this.mouseY;
    const visit = (n) => {
      if (!n.visible) return null;
      for (let i = n.children.length - 1; i >= 0; i--) {
        const hit = visit(n.children[i]);
        if (hit) return hit;
      }
      if (n.kind === 'button' && this.buttonHit(n, x, y)) return n;
      if (n.roll && this.hitTestPoint(n, x, y, true)) return n;
      return null;
    };
    return visit(this.root);
  }

  buttonHit(btn, x, y) {
    const wm = btn.worldMatrix();
    for (const r of btn.char.recs) {
      if (!r.hit) continue;
      const c = this.chars[r.id];
      const b = c.b || (c.t === 'sprite' ? spriteStaticBounds(this.chars, c) : null);
      if (!b) continue;
      const wb = transformBounds(b, r.m ? mul(wm, r.m) : wm);
      if (x >= wb[0] && x <= wb[2] && y >= wb[1] && y <= wb[3]) return true;
    }
    return false;
  }

  pointerMove(x, y) {
    this.mouseX = x; this.mouseY = y;
    const hit = this.pick();
    if (hit !== this.over) {
      const prev = this.over;
      this.over = hit;
      if (prev && prev.alive) {
        if (prev.kind === 'button') prev.setButtonState('up');
        else this.events.rollOut(prev.id);
      }
      if (hit && hit.alive) {
        if (hit.kind === 'button') hit.setButtonState(this.pressed === hit ? 'down' : 'over');
        else this.events.rollOver(hit.id);
      }
    }
    this.canvas.style.cursor = this.over && this.over.kind === 'button' ? 'pointer' : 'default';
  }

  pointerDown(x, y) {
    this.pointerMove(x, y);
    if (this.over && this.over.kind === 'button') {
      this.pressed = this.over;
      this.pressed.setButtonState('down');
    }
  }

  pointerUp(x, y) {
    this.pointerMove(x, y);
    const btn = this.pressed;
    this.pressed = null;
    if (btn && btn.alive && this.over === btn) {
      btn.setButtonState('over');
      this.events.buttonRelease(btn.cid, btn.parent.id);
    }
    // the release may have rebuilt the screen under a stationary pointer
    this.pointerMove(x, y);
  }

  // ---- rendering --------------------------------------------------------------------------

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const scale = (rect.width || STAGE_W) / STAGE_W * dpr;
    this.pixelScale = scale;
    this.canvas.width = Math.round(STAGE_W * scale);
    this.canvas.height = Math.round(STAGE_H * scale);
    for (const s of this.scratch) { s.canvas.width = this.canvas.width; s.canvas.height = this.canvas.height; }
    this.rasterScale = Math.max(2, Math.ceil(scale));
    this.bitmaps.clear();
  }

  /** @param blend how far (0..1) the wall clock is through the current simulation step */
  render(blend = 1) {
    this.blend = blend;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.pixelScale, 0, 0, this.pixelScale, 0, 0);
    this.draw(ctx, this.root, false, 1);
    this.blend = 1; // hit tests between frames use real positions
  }

  bitmap(key, box) {
    let bmp = this.bitmaps.get(key);
    if (bmp === undefined) {
      const img = this.images.get(key);
      bmp = null;
      if (img) {
        const s = this.rasterScale;
        bmp = document.createElement('canvas');
        bmp.width = Math.max(1, Math.ceil(box[2] * s));
        bmp.height = Math.max(1, Math.ceil(box[3] * s));
        bmp.getContext('2d').drawImage(img, 0, 0, bmp.width, bmp.height);
      }
      this.bitmaps.set(key, bmp);
    }
    return bmp;
  }

  /**
   * Draw a node and its subtree. In probe mode (hit testing) visibility of the root and all
   * alpha are ignored so that only coverage matters, as with MovieClip.hitTest(x, y, true).
   */
  draw(ctx, node, probe, alpha, isRoot = true) {
    if (!node.visible && !(probe && isRoot)) return;
    ctx.save();
    ctx.transform(...(probe ? node.m : this.viewMatrix(node)));
    const a = probe ? 1 : alpha * node.alpha;
    ctx.globalAlpha = a;
    if (node.glow && !probe) {
      ctx.shadowColor = node.glow;
      ctx.shadowBlur = 7 * this.pixelScale;
    }
    const c = node.char;
    if (node.kind === 'shape' || node.kind === 'text') {
      const bmp = this.bitmap((node.kind === 'shape' ? 'shapes/' : 'texts/') + node.cid, c.img);
      if (bmp) ctx.drawImage(bmp, c.img[0], c.img[1], c.img[2], c.img[3]);
    } else if (node.kind === 'morph') {
      const r = nearest(c.ratios, node.ratio);
      const bmp = this.bitmap(`morphs/${node.cid}_${r}`, c.img);
      if (bmp) ctx.drawImage(bmp, c.img[0], c.img[1], c.img[2], c.img[3]);
    } else if (node.kind === 'edit') {
      if (!probe) this.drawEdit(ctx, node);
    }
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.clipDepth) {
        let j = i + 1;
        while (j < kids.length && kids[j].depth <= k.clipDepth) j++;
        if (!probe && k.visible) this.drawMasked(ctx, k, kids.slice(i + 1, j), a);
        else if (probe) for (let t = i + 1; t < j; t++) this.draw(ctx, kids[t], probe, a, false);
        i = j - 1;
      } else {
        this.draw(ctx, k, probe, a, false);
      }
    }
    if (node.lines && !probe) {
      for (const l of node.lines) {
        ctx.globalAlpha = a * l.alpha;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 1 / this.pixelScale; // Flash hairline
        ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawMasked(ctx, mask, content, alpha) {
    if (!content.length) return;
    const [ma, co] = this.scratch;
    const t = ctx.getTransform();
    for (const s of [ma, co]) {
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.globalCompositeOperation = 'source-over';
      s.globalAlpha = 1;
      s.clearRect(0, 0, s.canvas.width, s.canvas.height);
      s.setTransform(t);
    }
    this.draw(ma, mask, true, 1);
    for (const n of content) this.draw(co, n, false, 1, false);
    co.setTransform(1, 0, 0, 1, 0, 0);
    co.globalCompositeOperation = 'destination-in';
    co.drawImage(ma.canvas, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(co.canvas, 0, 0);
    ctx.restore();
  }

  editFont(node) {
    return `${node.char.size}px "swf${node.char.font}", Arial, sans-serif`;
  }

  measureEdit(node) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = this.editFont(node);
    let w = 0;
    for (const line of node.text.split('\n')) w = Math.max(w, ctx.measureText(line).width);
    ctx.restore();
    return w;
  }

  drawEdit(ctx, node) {
    const c = node.char;
    const b = node.localBounds();
    const left = b[0] + 2, width = b[2] - b[0] - 4;
    ctx.font = this.editFont(node);
    if (c.border) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(b[0] + 0.5, b[1] + 0.5, b[2] - b[0] - 1, b[3] - b[1] - 1);
    }
    const probe = ctx.measureText('Mg');
    const ascent = probe.fontBoundingBoxAscent ?? c.size * 0.9;
    const descent = probe.fontBoundingBoxDescent ?? c.size * 0.25;
    const lineHeight = ascent + descent + c.leading;
    let lines = node.text.split('\n');
    if (c.wordWrap) lines = lines.flatMap((l) => wrap(ctx, l, width));
    ctx.fillStyle = node.color;
    ctx.textBaseline = 'alphabetic';
    let y = b[1] + 2 + ascent;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      const x = c.align === 1 ? left + width - w : c.align === 2 ? left + (width - w) / 2 : left;
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
  }
}

function wrap(ctx, line, width) {
  const out = [];
  let cur = '';
  for (const word of line.split(' ')) {
    const next = cur ? cur + ' ' + word : word;
    if (cur && ctx.measureText(next).width > width) { out.push(cur); cur = word; }
    else cur = next;
  }
  out.push(cur);
  return out;
}

function nearest(list, v) {
  let best = list[0];
  for (const r of list) if (Math.abs(r - v) < Math.abs(best - v)) best = r;
  return best;
}

/** Bounds of a sprite's first frame (used for button hit records that are sprites). */
function spriteStaticBounds(chars, sprite) {
  let b = null;
  for (const op of sprite.frames[0]) {
    if (op.op !== 'place' || op.id === undefined) continue;
    const c = chars[op.id];
    const cb = c.b || (c.t === 'sprite' ? spriteStaticBounds(chars, c) : null);
    if (cb) b = union(b, op.m ? transformBounds(cb, op.m) : cb);
  }
  return b;
}

export { STAGE_W, STAGE_H };
