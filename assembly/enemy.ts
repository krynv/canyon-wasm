// CEnemy.as
import * as host from "./host";
import { Clip } from "./clip";
import { CVector } from "./vector";
import { CEffect, TYPE_DAMAGE, TYPE_FAST, TYPE_SLOW, TYPE_CLEAR, TYPE_REPAIR, TYPE_SHIELD, TYPE_PIERCEDAMAGE, TYPE_CONFUSE, TYPE_TIMESTOP } from "./effect";
import { CMap, ALTITUDE_AIR, CELL_VOID } from "./map";
import { MATRIX_CELL_WIDTH, MATRIX_CELL_HEIGHT, MATRIX_WIDTH, MATRIX_HEIGHT, SND_HIT, playSound } from "./consts";
import { game } from "./game";

export const TYPE_BAGGI: i32 = 1;
export const TYPE_TRICYCLE: i32 = 2;
export const TYPE_CAR: i32 = 3;
export const TYPE_HOWERTANK: i32 = 4;
export const TYPE_PLANE: i32 = 5;
export const TYPE_INSECT: i32 = 6;
export const TYPE_SCORPIO: i32 = 7;

const REWARDS: f64[] = [20, 50, 85, 120, 30, 75, 100];
const WAYPOINT_TURN_TOLERANCE: f64 = 0.1;
const MIN_SPEED: f64 = 0.35;

/** Optional overlay clip (fast / slow / repair / shield), attached while the effect is active. */
class EffectOverlay {
  h: i32 = 0;
  constructor(public symbol: string, public name: string) {}
}

export class CEnemy extends Clip {
  numAltitude: i32 = 0;
  numType: i32 = 0;
  numLevel: i32 = 0;
  numCellI: i32;
  numCellJ: i32;
  numOldCellI: i32 = 0;
  numOldCellJ: i32 = 0;
  numWaypointX: f64 = NaN;
  numWaypointY: f64 = NaN;
  numReward: f64 = 0;
  boolNearExit: bool = false;

  private mcObject: i32 = 0;
  private healthBar: Clip = new Clip();
  private healthBarInner: i32 = 0;
  private arrEffects: CEffect[] = [];
  private numMaxSpeed: f64 = 0;
  private numTurnSpeed: f64 = 0;
  private numMaxHealth: f64 = 0;
  private health: f64 = 0;
  private strDeathEffect: string = "";
  private vectSpeed: CVector = new CVector(0, 0);
  private fast: EffectOverlay = new EffectOverlay("id_effect_fast", "_mcFastEffect");
  private slow: EffectOverlay = new EffectOverlay("id_effect_slow", "_mcSlowEffect");
  private repair: EffectOverlay = new EffectOverlay("id_effect_repair", "_mcRepairEffect");
  private shield: EffectOverlay = new EffectOverlay("id_effect_shield", "_mcShieldEffect");

  constructor(h: i32, public mapReference: CMap, cellI: i32, cellJ: i32) {
    super();
    this.h = h;
    this.numCellI = cellI;
    this.numCellJ = cellJ;
  }

  private setType(type: i32): void {
    this.numType = type;
    let vx: f64 = 1, vy: f64 = 1;
    switch (type) {
      case TYPE_BAGGI:
        this.numMaxSpeed = 2; this.numTurnSpeed = 0.11; this.numMaxHealth = 15;
        this.strDeathEffect = "id_gfx_explosion_small";
        break;
      case TYPE_TRICYCLE:
        this.numMaxSpeed = 1.7; this.numTurnSpeed = 0.1; this.numMaxHealth = 35;
        this.strDeathEffect = "id_gfx_explosion_medium";
        break;
      case TYPE_CAR:
        this.numMaxSpeed = 1.5; this.numTurnSpeed = 0.08; this.numMaxHealth = 70;
        this.strDeathEffect = "id_gfx_explosion_medium";
        break;
      case TYPE_HOWERTANK:
        this.numMaxSpeed = 1.1; this.numTurnSpeed = 0.06; this.numMaxHealth = 120;
        this.strDeathEffect = "id_gfx_explosion_big";
        break;
      case TYPE_PLANE:
        vx = 0;
        this.numMaxSpeed = 1.8; this.numTurnSpeed = 0.11; this.numMaxHealth = 8;
        this.strDeathEffect = "id_gfx_explosion_small";
        break;
      case TYPE_INSECT:
        vx = 0;
        this.numMaxSpeed = 1.5; this.numTurnSpeed = 0.16; this.numMaxHealth = 20;
        this.strDeathEffect = "id_gfx_explosion_medium";
        break;
      case TYPE_SCORPIO:
        vx = 0;
        this.numMaxSpeed = 1.2; this.numTurnSpeed = 0.06; this.numMaxHealth = 40;
        this.strDeathEffect = "id_gfx_explosion_big";
        break;
    }
    // Ground units start heading diagonally (1,1), air units straight down (0,1).
    this.vectSpeed = new CVector(vx, vy);
    this.vectSpeed.numLength = this.numMaxSpeed;
    this.numMaxHealth += Math.round(1.2 * (this.numLevel - 1) * this.numMaxHealth);
    const barWidth = this.numMaxHealth >= 100 ? 100 : this.numMaxHealth;
    this.health = this.numMaxHealth;
    host.setWidth(this.healthBar.h, barWidth / 2);
    this.numReward = REWARDS[type - 1] * (1 + 0.5 * (this.numLevel - 1));
  }

  get numHealth(): f64 { return this.health; }
  set numHealth(v: f64) {
    this.health = v;
    if (this.health < 0) this.health = 0;
    if (this.health > this.numMaxHealth) this.health = this.numMaxHealth;
    host.setWidth(this.healthBarInner, 100 * this.health / this.numMaxHealth);
    if (this.health == 0) game().onEnemyDead(this, this.strDeathEffect, this.x, this.y);
  }

  initEnemy(type: i32, level: i32, layerInfo: i32): void {
    this.mcObject = host.attach(this.h, "id_enemy" + type.toString(), "_mcObject", 1);
    const bar = this.healthBar;
    bar.h = host.attachNext(layerInfo, "id_healthbar", "_mcElement");
    this.healthBarInner = host.child(bar.h, "mcBar");
    // localToGlobal of a point above the (still unrotated) body
    bar.x = this.x + host.getX(this.mcObject);
    bar.y = this.y + host.getY(this.mcObject) - host.getHeight(this.mcObject) / 2 - 5;
    this.numLevel = level;
    this.setType(type);
    this.arrEffects = [];
  }

  /** Aim at the edge shared with the next cell on the flow field. */
  updateWaypoint(): bool {
    const next = this.mapReference.getNextCell(this.numCellI, this.numCellJ);
    if (next < 0) return false;
    const ni = next / MATRIX_WIDTH, nj = next % MATRIX_WIDTH;
    const i = <f64>this.numCellI, j = <f64>this.numCellJ;
    if (this.numCellJ == nj) {
      this.numWaypointX = (j + 0.5) * MATRIX_CELL_WIDTH;
      this.numWaypointY = (this.numCellI < ni ? i + 1 : i) * MATRIX_CELL_HEIGHT;
    }
    if (this.numCellI == ni) {
      this.numWaypointX = (this.numCellJ < nj ? j + 1 : j) * MATRIX_CELL_WIDTH;
      this.numWaypointY = (i + 0.5) * MATRIX_CELL_HEIGHT;
    }
    return true;
  }

  private syncOverlay(o: EffectOverlay, active: bool): void {
    if (active && o.h == 0) {
      o.h = host.attachNext(this.h, o.symbol, o.name);
      host.setWidth(o.h, 1.3 * host.getWidth(this.mcObject));
      host.setHeight(o.h, 1.3 * host.getHeight(this.mcObject));
    }
    if (!active && o.h != 0) {
      host.remove(o.h);
      o.h = 0;
    }
  }

  process(): void {
    const v = this.vectSpeed;
    if (v.numLength < this.numMaxSpeed) v.numLength += this.numMaxSpeed;
    if (v.numLength > this.numMaxSpeed) v.numLength = this.numMaxSpeed;

    let damaged = false, isFast = false, isSlow = false, clear = false;
    let isRepair = false, isShield = false, timeStop = false;
    let speedUp: f64 = 0, slowDown: f64 = 0, damage: f64 = 0, repair: f64 = 0, pierce: f64 = 0;
    let shieldPass: f64 = 1, confuse: f64 = 0;

    const effects = this.arrEffects;
    for (let n = 0; n < effects.length; n++) {
      const e = effects[n];
      switch (e.numType) {
        case TYPE_DAMAGE: damaged = true; damage += e.param; break;
        case TYPE_FAST: isFast = true; speedUp += v.numLength * e.param; break;
        case TYPE_SLOW: isSlow = true; slowDown += v.numLength * e.param; break;
        case TYPE_CLEAR: clear = true; break;
        case TYPE_REPAIR: isRepair = true; repair += this.numMaxHealth * e.param; break;
        case TYPE_SHIELD: isShield = true; shieldPass = Math.min(shieldPass, e.param); break;
        case TYPE_PIERCEDAMAGE: pierce += e.param; break;
        case TYPE_CONFUSE:
          confuse += this.numTurnSpeed * e.param;
          if (confuse >= this.numTurnSpeed) confuse = this.numTurnSpeed;
          break;
        case TYPE_TIMESTOP: isSlow = true; timeStop = true; break;
      }
      if (e.tick()) {
        effects.splice(n, 1);
        n--;
      }
    }

    v.numLength += speedUp - slowDown;
    if (v.numLength < MIN_SPEED) v.numLength = MIN_SPEED;
    let turnSpeed = this.numTurnSpeed - confuse;
    if (timeStop) {
      v.numLength = 0;
      turnSpeed = 0;
    }

    // May dispatch MSG_ENEMYDEAD, which removes this clip; the rest then runs on a dead clip.
    this.numHealth = this.health + repair - pierce - shieldPass * damage;
    if (!this.exists) return;

    if (clear) this.arrEffects = [];
    this.syncOverlay(this.fast, isFast);
    this.syncOverlay(this.slow, isSlow);
    this.syncOverlay(this.repair, isRepair);
    this.syncOverlay(this.shield, isShield);
    if (damaged) playSound(SND_HIT);

    const to = new CVector(0, 0);
    if (this.boolNearExit) {
      if (this.x - host.getWidth(this.h) / 2 > <f64>(MATRIX_WIDTH * MATRIX_CELL_WIDTH) ||
          this.y - host.getHeight(this.h) / 2 > <f64>(MATRIX_HEIGHT * MATRIX_CELL_HEIGHT)) {
        game().onEnemyPassed(this);
        if (!this.exists) return;
      }
      if (this.numCellI == MATRIX_HEIGHT - 1) to.numY = 1;
      if (this.numCellJ == MATRIX_WIDTH - 1) to.numX = 1;
    } else {
      to.numX = this.numWaypointX - this.x;
      to.numY = this.numWaypointY - this.y;
    }

    if (this.numAltitude != ALTITUDE_AIR) {
      const angle = v.getAngleWith(to);
      if (angle > WAYPOINT_TURN_TOLERANCE) {
        const cross = to.numX * v.numY - v.numX * to.numY;
        const step = turnSpeed <= angle ? turnSpeed : angle;
        v.rotate(cross > 0 ? step : -step);
      }
    }

    const oldX = this.x, oldY = this.y;
    this.x += v.numX;
    this.y += v.numY;
    host.setRotation(this.h, v.numRotation);

    let cellJ = <i32>Math.floor(this.x / MATRIX_CELL_WIDTH);
    let cellI = <i32>Math.floor(this.y / MATRIX_CELL_HEIGHT);
    if (this.numAltitude != ALTITUDE_AIR && cellI >= 0 && cellI < MATRIX_HEIGHT && cellJ >= 0 && cellJ < MATRIX_WIDTH &&
        this.mapReference.matrixPattern[cellI * MATRIX_WIDTH + cellJ] > CELL_VOID) {
      // bumped into rock / wall / building: back off and crawl
      v.numLength = 0.1;
      this.x = oldX;
      this.y = oldY;
      cellI = -1;
      cellJ = -1;
    } else {
      this.healthBar.x += v.numX;
      this.healthBar.y += v.numY;
    }

    if (cellI >= 0 && cellJ >= 0 && (this.numCellI != cellI || this.numCellJ != cellJ)) {
      this.numOldCellI = this.numCellI;
      this.numOldCellJ = this.numCellJ;
      this.numCellJ = cellJ;
      this.numCellI = cellI;
      if (this.numAltitude == ALTITUDE_AIR || !this.updateWaypoint()) this.boolNearExit = true;
    }
  }

  remove(): void {
    this.healthBar.removeMovieClip();
    this.removeMovieClip();
  }

  getDistanceFrom(x: f64, y: f64): f64 {
    return Math.sqrt((this.x - x) * (this.x - x) + (this.y - y) * (this.y - y));
  }

  applyEffect(e: CEffect): void {
    this.arrEffects.push(e);
  }
}
