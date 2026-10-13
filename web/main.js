// Browser host: loads the extracted assets, instantiates the WASM game core and runs the
// 24 fps frame loop. The core drives the display list through the `host` imports below.
import { Stage, STAGE_W } from './flash.js';
import { SoundService } from './sound.js';
import { SoundOptions } from './options.js';

const FRAME_MS = 1000 / 24;   // simulation step: the original's 24 fps, never changes
const MAX_RENDER_FPS = 140;   // drawing runs at the display's refresh rate, up to this
const ASSETS = 'assets/';
const KEY_CODES = { Space: 32, KeyP: 80, KeyM: 77, KeyQ: 81, Escape: 27 };

const canvas = document.getElementById('stage');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { console.warn('missing image', url); resolve(null); };
    img.src = url;
  });
}

async function loadAssets(movie, onProgress) {
  const keys = [];
  for (const [id, c] of Object.entries(movie.chars)) {
    if (!c.img) continue;
    if (c.t === 'shape') keys.push(`shapes/${id}`);
    else if (c.t === 'text') keys.push(`texts/${id}`);
    else if (c.t === 'morph') for (const r of c.ratios) keys.push(`morphs/${id}_${r}`);
  }
  let done = 0;
  const total = keys.length + movie.sounds.length;
  const step = () => onProgress(++done / total);

  const images = new Map();
  const imageJobs = keys.map(async (key) => {
    images.set(key, await loadImage(`${ASSETS}${key}.svg`));
    step();
  });

  const audio = new (window.AudioContext || window.webkitAudioContext)();
  const soundJobs = movie.sounds.map(async (file) => {
    try {
      const data = await (await fetch(`${ASSETS}sounds/${file}`)).arrayBuffer();
      return await audio.decodeAudioData(data);
    } catch (e) {
      console.warn('sound failed to decode', file, e);
      return null;
    } finally {
      step();
    }
  });

  const fontJobs = Object.entries(movie.fonts).map(async ([id, file]) => {
    try {
      const face = new FontFace(`swf${id}`, `url(${ASSETS}fonts/${file})`);
      document.fonts.add(await face.load());
    } catch (e) {
      console.warn('font failed to load', file, e);
    }
  });

  await Promise.all([...imageJobs, ...fontJobs]);
  const buffers = await Promise.all(soundJobs);
  return { images, audio, buffers };
}

async function boot() {
  const movie = await (await fetch(`${ASSETS}movie.json`)).json();
  const { images, audio, buffers } = await loadAssets(movie, (p) => {
    statusEl.textContent = `Loading… ${Math.round(p * 100)}%`;
  });
  const sounds = new SoundService(audio, buffers);
  const options = new SoundOptions((music, effects) => sounds.setMix(music, effects));
  if (options.muted) sounds.off(); // restore the mute switch before the game starts its music
  const stage = new Stage(movie, images, canvas, {
    playSound: (id, ifStopped, repeat) => sounds.play(id, ifStopped, repeat),
    soundIsOn: () => sounds.isOn(),
  });

  let memory;
  /** Read an AssemblyScript string (UTF-16, byte length stored 4 bytes before the pointer). */
  const str = (ptr) => {
    const len = new Uint32Array(memory.buffer, ptr - 4, 1)[0] >>> 1;
    return String.fromCharCode(...new Uint16Array(memory.buffer, ptr, len));
  };
  const node = (h) => stage.get(h);
  const hex = (rgb) => '#' + (rgb >>> 0).toString(16).padStart(6, '0');

  const host = {
    attach: (p, symbol, name, depth) => stage.attach(node(p), str(symbol), str(name), depth)?.id ?? 0,
    attachNext: (p, symbol, name) => {
      const parent = node(p);
      return parent ? stage.attach(parent, str(symbol), str(name), stage.nextDepth(parent))?.id ?? 0 : 0;
    },
    remove: (h) => node(h)?.destroy(),
    removeChildren: (h) => { for (const c of node(h)?.children.slice() ?? []) c.destroy(); },
    child: (h, path) => node(h)?.child(str(path))?.id ?? 0,
    parentOf: (h) => node(h)?.parent?.id ?? 0,
    getDepth: (h) => node(h)?.depth ?? 0,

    setPos: (h, x, y) => { const n = node(h); if (n) { n.m[4] = x; n.m[5] = y; } },
    getX: (h) => node(h)?.m[4] ?? 0,
    getY: (h) => node(h)?.m[5] ?? 0,
    globalX: (h) => node(h)?.worldMatrix()[4] ?? 0,
    globalY: (h) => node(h)?.worldMatrix()[5] ?? 0,
    setRotation: (h, deg) => { if (!Number.isNaN(deg)) node(h)?.setRotation(deg); },
    setVisible: (h, v) => { const n = node(h); if (n) n.visible = !!v; },
    getVisible: (h) => (node(h)?.visible ? 1 : 0),
    setAlpha: (h, pct) => { const n = node(h); if (n) n.alpha = pct / 100; },
    setWidth: (h, w) => node(h)?.setScaleTo(w, null),
    setHeight: (h, v) => node(h)?.setScaleTo(null, v),
    getWidth: (h) => { const b = node(h)?.parentBounds(); return b ? b[2] - b[0] : 0; },
    getHeight: (h) => { const b = node(h)?.parentBounds(); return b ? b[3] - b[1] : 0; },

    gotoAndStop: (h, frame) => node(h)?.goto(frame, false),
    gotoLabel: (h, label) => { const n = node(h); const f = n?.char?.labels?.[str(label)]; if (f) n.goto(f, false); },
    play: (h) => { const n = node(h); if (n) n.playing = true; },
    currentFrame: (h) => node(h)?.frame ?? 0,
    pauseLayer: (h, paused) => { const n = node(h); if (n) stage.pauseLayer(n, !!paused); },

    setText: (h, text) => { const n = node(h); if (n) n.text = str(text); },
    setTextColor: (h, rgb) => { const n = node(h); if (n) n.color = hex(rgb); },
    setAutoSize: (h, on) => { const n = node(h); if (n) n.autoSize = !!on; },
    addLine: (h, x1, y1, x2, y2, rgb, alpha) => {
      const n = node(h);
      if (n) (n.lines ??= []).push({ x1, y1, x2, y2, color: hex(rgb), alpha });
    },
    setGlow: (h, rgb) => { const n = node(h); if (n) n.glow = rgb < 0 ? null : hex(rgb); },

    hitTestPoint: (h, x, y, shape) => { const n = node(h); return n && stage.hitTestPoint(n, x, y, !!shape) ? 1 : 0; },
    hitTestClips: (a, b) => { const x = node(a), y = node(b); return x && y && stage.hitTestNodes(x, y) ? 1 : 0; },
    setRoll: (h, on) => { const n = node(h); if (n) n.roll = !!on; },
    mouseX: () => stage.mouseX,
    mouseY: () => stage.mouseY,

    sndPlay: (id, ifStopped, repeat) => sounds.play(id, !!ifStopped, repeat),
    sndLoop: (id) => sounds.loop(id),
    sndVolume: (id, volume) => sounds.setVolume(id, volume),
    sndOff: () => { sounds.off(); options.setMuted(true); },
    sndOn: () => { sounds.on(); options.setMuted(false); },

    optVolume: (channel) => options.volume(channel),
    optSetVolume: (channel, volume) => options.setVolume(channel, volume),
    optOn: (channel) => (options.isOn(channel) ? 1 : 0),
    optSetOn: (channel, on) => options.setOn(channel, on),

    random: (n) => Math.floor(Math.random() * n),
    trace: (msg) => console.log(str(msg)),
  };

  const env = {
    abort: (msg, file, line, col) => { throw new Error(`wasm abort: ${str(msg)} at ${str(file)}:${line}:${col}`); },
  };
  const { instance } = await WebAssembly.instantiateStreaming(fetch('game.wasm'), { host, env });
  const game = instance.exports;
  memory = game.memory;
  stage.events = { rollOver: game.rollOver, rollOut: game.rollOut, buttonRelease: game.buttonRelease };

  // Main timeline frame 3: background, then the game clip (`mcGame`).
  const TIMELINE_DEPTH = -16384;
  stage.root.createChild(24, 1 + TIMELINE_DEPTH);
  const mcGame = stage.root.createChild(movie.exports.id_mcGame, 3 + TIMELINE_DEPTH);
  mcGame.name = 'mcGame';

  // ---- input --------------------------------------------------------------------------------
  const toStage = (e) => {
    const r = canvas.getBoundingClientRect();
    const k = STAGE_W / r.width;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  };
  canvas.addEventListener('pointermove', (e) => {
    stage.pointerMove(...toStage(e));
    game.mouseMove();
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    stage.pointerDown(...toStage(e));
    game.mouseDown();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 0) stage.pointerUp(...toStage(e));
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    const code = KEY_CODES[e.code];
    if (!code) return;
    e.preventDefault();
    game.keyDown(code);
  });
  window.addEventListener('resize', () => stage.resize());

  // ---- frame loop ---------------------------------------------------------------------------
  // The simulation always advances in fixed 24 fps steps, so game speed and physics do not
  // depend on the display. Drawing happens every display frame and blends between steps.
  const step = () => {
    stage.beginStep();
    stage.tick();
    game.frame();
    stage.endStep();
    sounds.process();
  };
  const minRenderGap = 1000 / MAX_RENDER_FPS - 0.5; // tolerance for timer jitter
  let last = performance.now();
  let lastRender = 0;
  let acc = 0;
  const loop = (now) => {
    acc += Math.min(now - last, 250);
    last = now;
    while (acc >= FRAME_MS) {
      step();
      acc -= FRAME_MS;
    }
    if (now - lastRender >= minRenderGap) {
      lastRender = now;
      stage.render(acc / FRAME_MS);
      stats.frames++;
    }
    requestAnimationFrame(loop);
  };
  const stats = { frames: 0 };

  // Browsers only allow audio after a user gesture, so the game starts on a click.
  statusEl.textContent = 'Click to start';
  overlay.classList.add('ready');
  overlay.addEventListener('click', async () => {
    overlay.remove();
    await audio.resume();
    game.start(mcGame.id);
    last = performance.now();
    requestAnimationFrame(loop);
  }, { once: true });

  window.__canyon = { stage, game, sounds, options, step, stats }; // handy for debugging from the console
}

boot().catch((e) => {
  console.error(e);
  statusEl.textContent = `Failed to start: ${e.message}`;
});
