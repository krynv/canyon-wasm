// CBuilding.as
import * as host from "./host";
import { Clip } from "./clip";
import { CVector } from "./vector";
import { CEnemy } from "./enemy";
import { BlastParams, TYPE_ROCKET, TYPE_BALL, TYPE_ELECTRICFIELD, TYPE_LASERBEAM, TYPE_NULIFYBALL, TYPE_AASHELL, TYPE_SLOWSHOT, TYPE_CHAINBLAST, TYPE_GAUSSRAIL, TYPE_CONFUSEBALL } from "./blast";
import { ALTITUDE_GROUND, ALTITUDE_AIR, ALTITUDE_BOTH } from "./map";
import * as C from "./consts";
import { game } from "./game";

export const TYPE_TOWER_1_1: i32 = 1;   // missile turret
export const TYPE_TOWER_1_2: i32 = 2;   // howitzer
export const TYPE_TOWER_1_3: i32 = 3;   // tesla tower
export const TYPE_TOWER_1_4: i32 = 4;   // gutling laser
export const TYPE_TOWER_1_5: i32 = 5;   // nulificator
export const TYPE_TOWER_2_1: i32 = 6;   // AA gun
export const TYPE_TOWER_2_2: i32 = 7;   // goo cannon
export const TYPE_TOWER_2_3: i32 = 8;   // chain gun
export const TYPE_TOWER_2_4: i32 = 9;   // gauss cannon
export const TYPE_TOWER_2_5: i32 = 10;  // oil spray
export const TYPE_BULIDING_1: i32 = 11; // nuclear silo
export const TYPE_BULIDING_2: i32 = 12; // wall factory
export const TYPE_BULIDING_3: i32 = 13; // recycler
export const TYPE_BULIDING_4: i32 = 14; // radar dome
export const TYPE_BULIDING_5: i32 = 15; // laboratory

export const PRICES: i32[] = [100, 200, 500, 800, 1000, 150, 200, 500, 800, 1000, 500, 800, 900, 1200, 1250];

export const CELL_VOID: i32 = 0;
export const CELL_OCCUPIED: i32 = 1;
export const STATE_UNDEFINED: i32 = 0;
export const STATE_PLACING: i32 = 1;
export const STATE_INSTALLED: i32 = 2;

const ENEMY_TURN_TOLERANCE: f64 = 0.1;

/** Range multiplier bonus from radar domes (reset at mission start). */
export let RANGE_BONUS: f64 = 0;
export function setRangeBonus(v: f64): void { RANGE_BONUS = v; }

/** Footprint of a building type, sampled once from its "<symbol>_matrix" clip. */
export class Footprint {
  cells: i32[] = [];
  constructor(public width: i32, public height: i32) {}
}

const MATRICES: Map<i32, Footprint> = new Map<i32, Footprint>();

export class CBuilding extends Clip {
  numType: i32 = 0;
  numState: i32 = STATE_UNDEFINED;
  numCellI: i32 = -1;
  numCellJ: i32 = -1;
  /** j is undefined in the original while the cursor is outside the map */
  cellOut: bool = false;
  numPrice: i32 = 0;
  boolTower: bool = false;
  boolMouseOver: bool = false;
  matrixPattern: Footprint | null = null;
  depth: i32 = 0;
  enemyTarget: CEnemy | null = null;
  numAimingAltitude: i32 = 0;
  baseRange: f64 = 0;

  private numTurnSpeed: f64 = 0;
  private numReloadTime: i32 = 0;
  private numReloadTimer: i32 = 0;
  private vectDirection: CVector = new CVector(0, -1);
  private mcObject: i32 = 0;
  private mcGun: i32 = 0;
  private gunX: f64 = 0;
  private gunY: f64 = 0;

  constructor(h: i32) {
    super();
    this.h = h;
  }

  private tower(range: f64, turnSpeed: f64, altitude: i32, reload: i32): void {
    this.boolTower = true;
    this.baseRange = range;
    this.numTurnSpeed = turnSpeed;
    this.numAimingAltitude = altitude;
    this.numReloadTime = reload;
    this.numReloadTimer = reload;
  }

  private setType(type: i32): void {
    this.numType = type;
    switch (type) {
      case TYPE_TOWER_1_1: this.tower(100, 0.1, ALTITUDE_GROUND, 36); break;
      case TYPE_TOWER_1_2: this.tower(200, 0.05, ALTITUDE_GROUND, 108); break;
      case TYPE_TOWER_1_3: this.tower(60, 0, ALTITUDE_GROUND, 48); break;
      case TYPE_TOWER_1_4: this.tower(70, 0.1, ALTITUDE_GROUND, 6); break;
      case TYPE_TOWER_1_5: this.tower(100, 0.1, ALTITUDE_BOTH, 250); break;
      case TYPE_TOWER_2_1: this.tower(110, 0.1, ALTITUDE_AIR, 6); break;
      case TYPE_TOWER_2_2: this.tower(90, 0.1, ALTITUDE_BOTH, 24); break;
      case TYPE_TOWER_2_3: this.tower(100, 0.1, ALTITUDE_GROUND, 24); break;
      case TYPE_TOWER_2_4: this.tower(90, 0.1, ALTITUDE_AIR, 24); break;
      case TYPE_TOWER_2_5: this.tower(120, 0.1, ALTITUDE_GROUND, 24); break;
      default: this.boolTower = false;
    }
    this.numPrice = PRICES[type - 1];
  }

  get numRange(): f64 {
    return this.baseRange * (1 + RANGE_BONUS);
  }

  /** Stage position of the gun pivot. */
  get gunGlobalX(): f64 { return host.globalX(this.h) + this.gunX; }
  get gunGlobalY(): f64 { return host.globalY(this.h) + this.gunY; }

  setState(state: i32): void {
    if (this.numState == state) return;
    this.numState = state;
    // installed buildings get onRollOver/onRollOut (tower range display)
    host.setRoll(this.h, state == STATE_INSTALLED);
  }

  initBuilding(type: i32): bool {
    this.setType(type);
    this.vectDirection = new CVector(0, -1);
    const symbol = "id_construction" + type.toString();
    if (!MATRICES.has(type)) {
      const mc = host.attach(this.h, symbol + "_matrix", "_mcMatrix", 0);
      if (mc == 0) return false;
      const w = <i32>Math.ceil(host.getWidth(mc) / C.MATRIX_CELL_WIDTH);
      const h = <i32>Math.ceil(host.getHeight(mc) / C.MATRIX_CELL_HEIGHT);
      const fp = new Footprint(w, h);
      const gx = host.globalX(mc), gy = host.globalY(mc);
      for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
          const hit = host.hitTestPoint(mc,
            gx + C.MATRIX_CELL_WIDTH / 2 + j * C.MATRIX_CELL_WIDTH,
            gy + C.MATRIX_CELL_HEIGHT / 2 + i * C.MATRIX_CELL_HEIGHT, true);
          fp.cells.push(hit ? CELL_OCCUPIED : CELL_VOID);
        }
      }
      host.remove(mc);
      MATRICES.set(type, fp);
    }
    this.matrixPattern = MATRICES.get(type);
    this.mcObject = host.attach(this.h, symbol, "_mcObject", 1);
    if (this.mcObject == 0) return false;
    this.mcGun = host.child(this.mcObject, "mcGun");
    if (this.mcGun != 0) {
      this.gunX = host.getX(this.mcObject) + host.getX(this.mcGun);
      this.gunY = host.getY(this.mcObject) + host.getY(this.mcGun);
    }
    return true;
  }

  /** Turn the placement cursor into an installed building on `this` (a fresh layer element). */
  copyFrom(source: CBuilding): bool {
    this.x = host.globalX(source.h);
    this.y = host.globalY(source.h);
    if (!this.initBuilding(source.numType)) return false;
    this.numCellI = source.numCellI;
    this.numCellJ = source.numCellJ;
    return true;
  }

  process(): void {
    if (!this.boolTower) return;
    if (this.numReloadTimer > 0) this.numReloadTimer--;

    let target = this.enemyTarget;
    if (target == null || !target.exists) {
      // MSG_TARGETLOST
      target = game().map.getNearestEnemy(this.gunGlobalX, this.gunGlobalY,
        Math.floor(this.baseRange * (1 + RANGE_BONUS)), this.numAimingAltitude, null);
      this.enemyTarget = target;
    }
    if (target == null) return;

    const gx = this.gunGlobalX, gy = this.gunGlobalY;
    const dist = target.getDistanceFrom(gx, gy);
    if (dist > this.numRange) {
      this.enemyTarget = null;
      return;
    }
    const dir = this.vectDirection;
    const to = new CVector(target.x - gx, target.y - gy);
    if (dir.getAngleWith(to) <= ENEMY_TURN_TOLERANCE) {
      if (this.numReloadTimer == 0) {
        const p = new BlastParams();
        p.x = gx;
        p.y = gy;
        p.direction = dir;
        p.altitude = target.numAltitude;
        p.targetsEnemy = true;
        p.target = target;
        switch (this.numType) {
          case TYPE_TOWER_1_1:
            p.type = TYPE_ROCKET; p.speed = 3;
            C.playSound(C.SND_MISSILETURRETSHOT);
            break;
          case TYPE_TOWER_1_2:
            // lobs at where the enemy is now, not at the enemy
            p.type = TYPE_BALL; p.targetsEnemy = false; p.targetX = target.x; p.targetY = target.y; p.speed = 3;
            C.playSound(C.SND_MORTARSHOT);
            break;
          case TYPE_TOWER_1_3:
            // detonates on top of the tower
            p.type = TYPE_ELECTRICFIELD; p.targetsEnemy = false; p.targetX = gx; p.targetY = gy; p.speed = 0;
            C.playSound(C.SND_TESLATOWERSHOT);
            break;
          case TYPE_TOWER_1_4:
            p.type = TYPE_LASERBEAM; p.speed = to.numLength;
            C.playSound(C.SND_GUTLINGLASERSHOT);
            break;
          case TYPE_TOWER_1_5:
            p.type = TYPE_NULIFYBALL; p.speed = 4;
            C.playSound(C.SND_NULIFICATORSHOT);
            break;
          case TYPE_TOWER_2_1:
            p.type = TYPE_AASHELL; p.speed = to.numLength;
            C.playSound(C.SND_AAGUNSHOT);
            break;
          case TYPE_TOWER_2_2:
            p.type = TYPE_SLOWSHOT; p.speed = 4;
            C.playSound(C.SND_GOOCANNONSHOT);
            break;
          case TYPE_TOWER_2_3:
            p.type = TYPE_CHAINBLAST; p.speed = 7;
            C.playSound(C.SND_CHAINGUNSHOT);
            break;
          case TYPE_TOWER_2_4:
            p.type = TYPE_GAUSSRAIL; p.speed = to.numLength;
            C.playSound(C.SND_GAUSSCANNONSHOT);
            break;
          case TYPE_TOWER_2_5:
            p.type = TYPE_CONFUSEBALL; p.speed = 5;
            C.playSound(C.SND_OILSPRAYSHOT);
            break;
        }
        game().map.addBlast(p); // MSG_READYTOSHOOT
        this.numReloadTimer = this.numReloadTime;
      }
    } else if (this.numTurnSpeed == 0) {
      dir.numX = to.numX;
      dir.numY = to.numY;
      dir.numLength = 1;
    } else {
      const cross = to.numX * dir.numY - dir.numX * to.numY;
      dir.rotate(cross > 0 ? this.numTurnSpeed : -this.numTurnSpeed);
    }
    host.setRotation(this.mcGun, dir.numRotation);
  }
}
