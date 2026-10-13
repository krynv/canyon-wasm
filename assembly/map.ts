// CMap.as
import * as host from "./host";
import { Clip, Layer } from "./clip";
import { CEnemy, TYPE_PLANE, TYPE_INSECT, TYPE_SCORPIO } from "./enemy";
import { CBuilding, Footprint, STATE_INSTALLED, CELL_OCCUPIED, CELL_VOID as BUILDING_CELL_VOID } from "./building";
import { CBlast, BlastParams } from "./blast";
import { CEffect } from "./effect";
import { MATRIX_CELL_WIDTH as CW, MATRIX_CELL_HEIGHT as CH, MATRIX_WIDTH as W, MATRIX_HEIGHT as H } from "./consts";

// Matrix cell values. Values <= 0 are walkable: after markCacheMatrix() a walkable cell holds
// minus its distance (in steps, +1) to the nearest exit, so enemies walk towards value + 1.
export const CELL_VOID: i32 = 0;
export const CELL_ROCK: i32 = 1;
export const CELL_WALL: i32 = 2;
export const CELL_BUILDING: i32 = 10; // + depth of the building clip

export const ALTITUDE_GROUND: i32 = 1;
export const ALTITUDE_AIR: i32 = 2;
export const ALTITUDE_BOTH: i32 = 3;

/** Result of CMap.cellHitTest (plus the `free` flag the cursor adds). */
export class CellHit {
  out: bool = false;
  i: i32 = 0;
  j: i32 = 0;
  x: f64 = 0;
  y: f64 = 0;
  free: bool = false;
}

export class CMap extends Clip {
  matrixPattern: i32[] = new Array<i32>(W * H).fill(0);
  private matrixCache: i32[] = new Array<i32>(W * H).fill(0);

  private layerEnemies1: Layer;
  private layerWallShadows: Layer;
  private layerWalls: Layer;
  private layerEffects1: Layer;
  private layerBuildings: Layer;
  private layerBlasts1: Layer;
  private layerEffects2: Layer;
  private layerEnemies2: Layer;
  private layerInfo: Layer;
  private mcGrid: i32 = 0;

  // creation-ordered mirrors of the layers' children (AVM1 for..in walks them newest first)
  private groundEnemies: CEnemy[] = [];
  private airEnemies: CEnemy[] = [];
  private buildings: CBuilding[] = [];
  private blasts: CBlast[] = [];

  constructor(parent: i32) {
    super();
    const h = host.attach(parent, "id_map", "_mapCurrent", 1);
    this.h = h;
    this.layerEnemies1 = new Layer(h, "_layerEnemies1", 2);
    this.layerWallShadows = new Layer(h, "_layerWallShadows", 3);
    this.layerWalls = new Layer(h, "_layerWalls", 4);
    this.layerEffects1 = new Layer(h, "_layerEffects1", 5);
    this.layerBuildings = new Layer(h, "_layerBuildings", 8);
    this.layerBlasts1 = new Layer(h, "_layerBlasts1", 9);
    this.layerEffects2 = new Layer(h, "_layerEffects2", 10);
    this.layerEnemies2 = new Layer(h, "_layerEnemies2", 11);
    this.layerInfo = new Layer(h, "_layerInfo", 12);
  }

  get noEnemies(): bool {
    for (let n = 0; n < this.groundEnemies.length; n++) if (this.groundEnemies[n].exists) return false;
    for (let n = 0; n < this.airEnemies.length; n++) if (this.airEnemies[n].exists) return false;
    return true;
  }

  set boolPaused(v: bool) {
    this.layerEffects1.boolPaused = v;
    this.layerEffects2.boolPaused = v;
    this.layerBlasts1.boolPaused = v;
    this.layerEnemies1.boolPaused = v;
    this.layerEnemies2.boolPaused = v;
  }

  /** Sample the map's "<symbol>_matrix" clip at every cell centre: covered cells are rock. */
  loadMap(index: i32): bool {
    const base = "id_map" + index.toString();
    const mc = host.attach(this.h, base + "_matrix", "_mcMatrix", 1);
    if (mc == 0) return false;
    const gx = host.globalX(this.h), gy = host.globalY(this.h);
    for (let i = 0; i < H; i++) {
      for (let j = 0; j < W; j++) {
        const hit = host.hitTestPoint(mc, gx + CW / 2 + j * CW, gy + CH / 2 + i * CH, true);
        this.matrixPattern[i * W + j] = hit ? CELL_ROCK : CELL_VOID;
      }
    }
    host.remove(mc);
    host.attach(this.h, base + "_sand", "_mcSand", 1);
    host.attach(this.h, base + "_landscape", "_mcLandscape", 6);
    this.mcGrid = host.attach(this.h, "id_grid", "_mcGrid", 7);
    host.setVisible(this.mcGrid, false);
    this.markCacheMatrix(-1, -1);
    this.writeMatrixFromCache();
    return true;
  }

  /**
   * Recompute the distance-to-exit field into the cache matrix, optionally with a new wall at
   * (wallI, wallJ) (pass -1 for none). Returns false if some walkable cell can no longer reach
   * an exit, in which case the caller must not commit the cache.
   *
   * With a new wall only cells farther from the exit than the walled cell are re-flooded,
   * starting from the cells at the same distance.
   */
  markCacheMatrix(wallI: i32, wallJ: i32): bool {
    const cache = this.matrixCache;
    for (let n = 0; n < cache.length; n++) cache[n] = this.matrixPattern[n];

    let front: i32[] = [];
    let level: i32 = CELL_VOID;
    if (wallI >= 0 && wallJ >= 0) {
      const at = wallI * W + wallJ;
      if (cache[at] > CELL_VOID) return false; // unreachable: the cursor only offers walkable cells
      level = CELL_VOID - cache[at];
      cache[at] = CELL_WALL;
    }
    for (let n = 0; n < cache.length; n++) {
      if (cache[n] < CELL_VOID) {
        if (cache[n] == CELL_VOID - level) front.push(n);
        else if (cache[n] < CELL_VOID - level) cache[n] = CELL_VOID;
      }
    }
    if (level == CELL_VOID) {
      level = 1;
      front = this.getExitCells();
      for (let n = 0; n < front.length; n++) cache[front[n]] = CELL_VOID - level;
    }
    level++;
    let done = false;
    while (!done) {
      const next: i32[] = [];
      done = true;
      for (let n = front.length - 1; n >= 0; n--) {
        const ci = front[n] / W, cj = front[n] % W;
        for (let i = max(ci - 1, 0); i <= min(ci + 1, H - 1); i++) {
          for (let j = max(cj - 1, 0); j <= min(cj + 1, W - 1); j++) {
            if ((i != ci) == (j != cj)) continue; // 4-neighbourhood only
            if (cache[i * W + j] == CELL_VOID) {
              cache[i * W + j] = CELL_VOID - level;
              next.push(i * W + j);
              done = false;
            }
          }
        }
      }
      level++;
      front = next;
    }
    for (let n = 0; n < cache.length; n++) if (cache[n] == CELL_VOID) return false;
    return true;
  }

  writeMatrixFromCache(): void {
    for (let n = 0; n < this.matrixPattern.length; n++) this.matrixPattern[n] = this.matrixCache[n];
  }

  addWall(cellI: i32, cellJ: i32): void {
    host.setPos(this.layerWalls.addElement("id_cursor_wall"), cellJ * CW, cellI * CH);
    host.setPos(this.layerWallShadows.addElement("id_wall_shadow"), cellJ * CW, cellI * CH);
    this.writeMatrixFromCache();
    for (let n = this.groundEnemies.length - 1; n >= 0; n--) {
      if (this.groundEnemies[n].exists) this.groundEnemies[n].updateWaypoint();
    }
  }

  cellHitTest(x: f64, y: f64): CellHit {
    const r = new CellHit();
    const gx = host.globalX(this.h), gy = host.globalY(this.h);
    r.j = <i32>Math.floor((x - gx) / CW);
    r.i = <i32>Math.floor((y - gy) / CH);
    if (r.i < 0 || r.j < 0 || r.j >= W || r.i >= H) r.out = true;
    // the original sets j (and with it x) to undefined when outside the map
    r.x = r.out ? NaN : gx + r.j * CW;
    r.y = gy + r.i * CH;
    return r;
  }

  /** Buildings go on rock or walls only. */
  checkPlacingSpace(cell: CellHit, fp: Footprint): bool {
    if (cell.out) return false;
    if (cell.i + fp.height > H || cell.j + fp.width > W) return false;
    for (let i = 0; i < fp.height; i++) {
      for (let j = 0; j < fp.width; j++) {
        const m = this.matrixPattern[(i + cell.i) * W + j + cell.j];
        if (fp.cells[i * fp.width + j] != BUILDING_CELL_VOID && m != CELL_ROCK && m != CELL_WALL) return false;
      }
    }
    return true;
  }

  checkBuildingSpace(cell: CellHit): bool {
    if (cell.out) return false;
    return this.matrixPattern[cell.i * W + cell.j] >= CELL_BUILDING;
  }

  /** Walls go on walkable cells that are not on the map border. */
  checkWallSpace(cell: CellHit): bool {
    // outside the map j is undefined, so only the row tests of the original can fail
    if (cell.out) return !(cell.i == 0 || cell.i == H - 1);
    if (this.matrixPattern[cell.i * W + cell.j] > CELL_VOID || cell.i == 0 || cell.j == 0 || cell.i == H - 1 || cell.j == W - 1) return false;
    return true;
  }

  isHitWithGroundEnemy(target: i32): bool {
    for (let n = this.groundEnemies.length - 1; n >= 0; n--) {
      const e = this.groundEnemies[n];
      if (e.exists && host.hitTestClips(e.h, target)) return true;
    }
    return false;
  }

  addBuilding(source: CBuilding): bool {
    const b = new CBuilding(this.layerBuildings.addElement("id_building"));
    if (!b.copyFrom(source)) return false;
    b.setState(STATE_INSTALLED);
    b.depth = host.getDepth(b.h);
    const fp = b.matrixPattern!;
    for (let i = 0; i < fp.height; i++) {
      for (let j = 0; j < fp.width; j++) {
        if (fp.cells[i * fp.width + j] == CELL_OCCUPIED) {
          this.matrixPattern[(i + b.numCellI) * W + j + b.numCellJ] = CELL_BUILDING + b.depth;
        }
      }
    }
    this.buildings.push(b);
    return true;
  }

  getBuildingAt(i: i32, j: i32): CBuilding | null {
    const depth = this.matrixPattern[i * W + j] - CELL_BUILDING;
    for (let n = 0; n < this.buildings.length; n++) {
      const b = this.buildings[n];
      if (b.exists && b.depth == depth) return b;
    }
    return null;
  }

  findBuildingByHandle(h: i32): CBuilding | null {
    for (let n = 0; n < this.buildings.length; n++) if (this.buildings[n].h == h) return this.buildings[n];
    return null;
  }

  /** Sold buildings always leave rock behind, even where they stood on a wall. */
  deleteBuilding(b: CBuilding): void {
    const fp = b.matrixPattern!;
    for (let i = 0; i < fp.height; i++) {
      for (let j = 0; j < fp.width; j++) {
        if (fp.cells[i * fp.width + j] == CELL_OCCUPIED) {
          this.matrixPattern[(i + b.numCellI) * W + j + b.numCellJ] = CELL_ROCK;
        }
      }
    }
    b.removeMovieClip();
    const at = this.buildings.indexOf(b);
    if (at >= 0) this.buildings.splice(at, 1);
  }

  addEnemy(type: i32, level: i32, effect: CEffect | null, waveIndex: i32): void {
    const flying = type == TYPE_PLANE || type == TYPE_INSECT || type == TYPE_SCORPIO;
    let ci: i32, cj: i32;
    if (flying) {
      ci = 0;
      cj = 4 + host.random(6);
    } else {
      const entries = this.getEntryCells();
      const pick = entries[host.random(entries.length)];
      ci = pick / W;
      cj = pick % W;
    }
    const layer = flying ? this.layerEnemies2 : this.layerEnemies1;
    const e = new CEnemy(layer.addElement("id_enemy"), this, ci, cj);
    e.numAltitude = flying ? ALTITUDE_AIR : ALTITUDE_GROUND;
    e.x = cj * CW + CW / 2;
    e.y = ci * CH + CH / 2;
    // queue the wave up outside the map, 35px apart
    if (ci == 0) {
      e.y -= CH;
      e.y -= 35 * waveIndex;
    } else if (cj == 0) {
      e.x -= CW;
      e.y += host.random(16) - 8;
      e.x -= 35 * waveIndex;
    }
    if (flying) {
      e.numWaypointX = e.x;
      e.numWaypointY = H * CH + CH / 2;
    } else {
      e.updateWaypoint();
    }
    e.initEnemy(type, level, this.layerInfo.h);
    if (effect != null) e.applyEffect(effect);
    (flying ? this.airEnemies : this.groundEnemies).push(e);
  }

  addBlast(p: BlastParams): void {
    const b = new CBlast(this.layerBlasts1.addElement("id_blast"), p);
    b.initBlast(p.type);
    if (p.targetsEnemy) b.setTargetEnemy(p.target);
    else b.setTargetPoint(p.targetX, p.targetY);
    this.blasts.push(b);
  }

  addGFX(symbol: string, x: f64, y: f64, altitude: i32, radius: f64): void {
    const layer = altitude == ALTITUDE_AIR || altitude == ALTITUDE_BOTH ? this.layerEffects2 : this.layerEffects1;
    const h = layer.addElement(symbol);
    host.setPos(h, x, y);
    if (radius != 0) {
      host.setWidth(h, 2 * radius);
      host.setHeight(h, 2 * radius);
    }
  }

  /** Walkable cells on the top row and left column, as flat indices. */
  getEntryCells(): i32[] {
    const out: i32[] = [];
    for (let j = 0; j < W; j++) if (this.matrixPattern[j] <= CELL_VOID) out.push(j);
    for (let i = 0; i < H; i++) if (this.matrixPattern[i * W] <= CELL_VOID) out.push(i * W);
    return out;
  }

  /** Walkable cells on the bottom row and right column, as flat indices. */
  getExitCells(): i32[] {
    const out: i32[] = [];
    for (let j = 0; j < W; j++) if (this.matrixPattern[(H - 1) * W + j] <= CELL_VOID) out.push((H - 1) * W + j);
    for (let i = 0; i < H; i++) if (this.matrixPattern[(i + 1) * W - 1] <= CELL_VOID) out.push((i + 1) * W - 1);
    return out;
  }

  /** First 4-neighbour (up, left, right, down) one step closer to an exit; -1 if none. */
  getNextCell(cellI: i32, cellJ: i32): i32 {
    if (cellI < 0 || cellI >= H || cellJ < 0 || cellJ >= W) return -1;
    const here = this.matrixPattern[cellI * W + cellJ];
    for (let i = max(cellI - 1, 0); i <= min(cellI + 1, H - 1); i++) {
      for (let j = max(cellJ - 1, 0); j <= min(cellJ + 1, W - 1); j++) {
        if ((i != cellI) == (j != cellJ)) continue;
        const v = this.matrixPattern[i * W + j];
        if (v == here + 1 && v <= CELL_VOID) return i * W + j;
      }
    }
    return -1;
  }

  private nearestIn(list: CEnemy[], x: f64, y: f64, range: f64, forbidden: CEnemy | null, best: CEnemy | null, bestDist: f64): CEnemy | null {
    for (let n = list.length - 1; n >= 0; n--) {
      const e = list[n];
      if (e.exists && e != forbidden && e.x > 0 && e.y > 0) {
        const d = e.getDistanceFrom(x, y);
        if (d <= range && d < bestDist) {
          bestDist = d;
          best = e;
        }
      }
    }
    this.scanDist = bestDist;
    return best;
  }
  private scanDist: f64 = 0;

  /** Closest enemy of the given altitude class that has entered the map. */
  getNearestEnemy(x: f64, y: f64, range: f64, altitude: i32, forbidden: CEnemy | null): CEnemy | null {
    let best: CEnemy | null = null;
    this.scanDist = 999999;
    if (altitude == ALTITUDE_GROUND || altitude == ALTITUDE_BOTH) {
      best = this.nearestIn(this.groundEnemies, x, y, range, forbidden, best, this.scanDist);
    }
    if (altitude == ALTITUDE_AIR || altitude == ALTITUDE_BOTH) {
      best = this.nearestIn(this.airEnemies, x, y, range, forbidden, best, this.scanDist);
    }
    return best;
  }

  /** Push the same effect instance onto every enemy within the radius. */
  applySplashEffect(effect: CEffect, cx: f64, cy: f64, radius: f64, altitude: i32): void {
    if (altitude == ALTITUDE_GROUND || altitude == ALTITUDE_BOTH) {
      for (let n = this.groundEnemies.length - 1; n >= 0; n--) {
        const e = this.groundEnemies[n];
        if (e.exists && e.getDistanceFrom(cx, cy) <= radius) e.applyEffect(effect);
      }
    }
    if (altitude == ALTITUDE_AIR || altitude == ALTITUDE_BOTH) {
      for (let n = this.airEnemies.length - 1; n >= 0; n--) {
        const e = this.airEnemies[n];
        if (e.exists && e.getDistanceFrom(cx, cy) <= radius) e.applyEffect(effect);
      }
    }
  }

  toggleGrid(visible: bool): void {
    host.setVisible(this.mcGrid, visible);
  }

  private static compactEnemies(list: CEnemy[]): CEnemy[] {
    const out: CEnemy[] = [];
    for (let n = 0; n < list.length; n++) if (list[n].exists) out.push(list[n]);
    return out;
  }

  process(): void {
    // Each layer is walked newest-first over a snapshot, like `for (name in layer)`.
    let enemies = this.groundEnemies.slice();
    for (let n = enemies.length - 1; n >= 0; n--) if (enemies[n].exists) enemies[n].process();
    enemies = this.airEnemies.slice();
    for (let n = enemies.length - 1; n >= 0; n--) if (enemies[n].exists) enemies[n].process();
    const buildings = this.buildings.slice();
    for (let n = buildings.length - 1; n >= 0; n--) if (buildings[n].exists) buildings[n].process();
    const blasts = this.blasts.slice();
    for (let n = blasts.length - 1; n >= 0; n--) if (blasts[n].exists) blasts[n].process();

    this.groundEnemies = CMap.compactEnemies(this.groundEnemies);
    this.airEnemies = CMap.compactEnemies(this.airEnemies);
    const live: CBlast[] = [];
    for (let n = 0; n < this.blasts.length; n++) if (this.blasts[n].exists) live.push(this.blasts[n]);
    this.blasts = live;
  }
}
