# Canyon Defense — WebAssembly rebuild

A rebuild of IriySoft's Flash tower-defence game *Canyon Defense* (2008, SWF v8 / ActionScript 2)
that runs in a modern browser with no Flash player.

- **Game core** — `assembly/*.ts`, AssemblyScript compiled to `web/game.wasm`. A class-for-class
  port of the decompiled ActionScript (`CGame`, `CMap`, `CEnemy`, `CBuilding`, `CBlast`, ...),
  including its quirks. All rules, pathfinding, waves, quests and UI state live here.
- **Host** — `web/flash.js` is a small Flash-style display-list player (timelines, labels, masks,
  buttons, dynamic text, `hitTest`) drawing to a canvas; `web/sound.js` is the original
  `CSoundService` on Web Audio; `web/main.js` wires them to the WASM imports.
- **Assets** — `web/assets/` holds the original art, text, sounds and fonts extracted from the SWF,
  plus `movie.json`, the display lists of every symbol.

## Run

```sh
npm install
npm start          # builds game.wasm, serves http://localhost:8080
```

Controls are the original's: mouse to build, **Space** send next wave, **P** pause, **M** mute, **Q** quit — plus **Esc**, which also pauses.

Sound options are an addition to the original: an **Options** button on the main menu, and the
same music / effects controls under the "Paused" dialog during a mission. They are assembled from
the game's own button art and font (`add_options_ui` in `tools/build_assets.py`), handled in
`assembly/game.ts`, and remembered in the browser (`web/options.js`).

Rendering runs at the display's refresh rate (capped at 140 fps) while the simulation stays on
the original's fixed 24 steps per second; frames in between blend clip positions
(`Stage.viewMatrix` in `web/flash.js`), so smoothness changes but game speed and physics do not.

## Rebuilding from the SWF

`re/` (decompiler output) is reproducible with JPEXS FFDec:

```sh
FFDEC="java -jar /Applications/FFDec.app/Contents/Resources/ffdec.jar -cli"
$FFDEC -swf2xml game.swf re/swf.xml
$FFDEC -onerror ignore -format script:as,shape:svg,sound:mp3_wav,font:ttf -export script,shape,sound,font re/export game.swf
$FFDEC -onerror ignore -format text:svg,morphshape:svg -export text,morphshape re/export2 game.swf
npm run assets                    # tools/build_assets.py -> web/assets
python3 tools/gen_programs.py     # wave tables -> assembly/programs.ts
```

## Fidelity notes

Ported as-is, on purpose: effects shared between enemies hit by one splash (so time-stop and
slow wear off faster the more enemies they catch), "send next wave" crediting ability cooldowns
with a full wave period, the radar-dome damage bonus surviving into the next mission, laser and
gauss shots that miss flying on forever.

Known differences from the Flash original:

- Music stays at one level; the original played it at 30% during missions and 100% on menus.
- The difficulty captions are black with a light outline instead of white with a drop shadow.

- Clip positions are quantised to twips by truncation (`assembly/clip.ts`). Flash quantises too,
  but the exact rounding mode was inferred, not measured.
- Bevel / drop-shadow filters on UI panels are not drawn; the cursor glow is approximated.
- Dynamic text is drawn with the embedded fonts via canvas, so line metrics can differ by a pixel.
- Miniclip and developer branding is removed (`STRIPPED_CHARS` / `DROPPED_EXPORTS` in
  `tools/build_assets.py`): logo and link buttons, the advert slot, the "Scores" button and the
  highscore / award screens. The game-over dialog returns to the main menu.
- `Math.sin/cos/atan2/acos` come from AssemblyScript's libm rather than Flash's, and enemy
  spawn randomness uses `Math.random`.

The game and its assets belong to IriySoft / Miniclip; this is for personal use with your own copy.
