// CBlast.as
import * as host from "./host";
import { Clip } from "./clip";
import { CVector } from "./vector";
import { CEffect, TYPE_DAMAGE, TYPE_SLOW, TYPE_CLEAR, TYPE_PIERCEDAMAGE, TYPE_CONFUSE } from "./effect";
import { CEnemy } from "./enemy";
import { ALTITUDE_AIR, ALTITUDE_GROUND } from "./map";
import { RANGE_BONUS } from "./building";
import { game } from "./game";

export const TYPE_ROCKET: i32 = 1;
export const TYPE_BALL: i32 = 2;
export const TYPE_SLOWSHOT: i32 = 3;
export const TYPE_ELECTRICFIELD: i32 = 4;
export const TYPE_NULIFYBALL: i32 = 5;
export const TYPE_LASERBEAM: i32 = 6;
export const TYPE_AASHELL: i32 = 7;
export const TYPE_MISSILE: i32 = 8;
export const TYPE_CHAINBLAST: i32 = 9;
export const TYPE_GAUSSRAIL: i32 = 10;
export const TYPE_CONFUSEBALL: i32 = 11;

const TARGET_HIT_TOLERANCE: f64 = 10;
const TARGET_TURN_TOLERANCE: f64 = 0.1;
const TTL: i32 = 100;

/** Damage multiplier bonus from radar domes. Never reset between missions (as in the original). */
export let DAMAGE_BONUS: f64 = 0;
export function addDamageBonus(v: f64): void { DAMAGE_BONUS += v; }

/** Parameters of MSG_READYTOSHOOT / CMap.addBlast. */
export class BlastParams {
  x: f64 = 0;
  y: f64 = 0;
  direction: CVector = new CVector(0, -1);
  altitude: i32 = 0;
  type: i32 = 0;
  targetsEnemy: bool = false;
  target: CEnemy | null = null;
  targetX: f64 = 0;
  targetY: f64 = 0;
  speed: f64 = 0;
}

export class CBlast extends Clip {
  mcTarget: CEnemy | null = null;
  private boolTargetsEnemy: bool = false;
  private numTargetX: f64 = 0;
  private numTargetY: f64 = 0;
  private numLiveTimer: i32 = TTL;
  private numType: i32 = 0;
  private numTurnSpeed: f64 = 0;
  private numDamage: f64 = NaN;
  private numSplashRadius: f64 = 0;
  private numTTL: f64 = 0;
  private strEffectSymbol: string = "";
  private vectSpeed: CVector;

  constructor(h: i32, p: BlastParams) {
    super();
    this.h = h;
    this.x = p.x;
    this.y = p.y;
    // attachMovie init object: numSpeed is assigned before vectSpeed, so the copy gets its length
    this.vectSpeed = p.direction.makeCopy();
    this.vectSpeed.numLength = p.speed;
    this.numAltitude = p.altitude;
  }

  numAltitude: i32;

  private beam(rgb: i32, coreAlpha: f64, sideAlpha: f64): void {
    const len = this.vectSpeed.numLength;
    host.addLine(this.h, 0, 0, 0, len, rgb, coreAlpha);
    host.addLine(this.h, 1, 0, 1, len, rgb == 0 ? 0 : 0xff0000, sideAlpha);
    host.addLine(this.h, -1, 0, -1, len, rgb == 0 ? 0 : 0xff0000, sideAlpha);
  }

  initBlast(type: i32): void {
    host.attach(this.h, "id_blast" + type.toString(), "_mcObject", 1);
    this.numType = type;
    const bonus = 1 + DAMAGE_BONUS;
    switch (type) {
      case TYPE_ROCKET:
        this.numTurnSpeed = 0.2; this.numDamage = 5 * bonus; this.numSplashRadius = 0;
        break;
      case TYPE_BALL:
        this.numTurnSpeed = 0.05; this.numDamage = 20 * bonus; this.numSplashRadius = 25;
        this.strEffectSymbol = "id_gfx_splash";
        break;
      case TYPE_SLOWSHOT:
        this.numTurnSpeed = 0.1; this.numDamage = 1 * bonus; this.numSplashRadius = 15;
        this.strEffectSymbol = "id_gfx_slowsplash";
        break;
      case TYPE_ELECTRICFIELD:
        this.numTurnSpeed = 0; this.numDamage = 10 * bonus; this.numSplashRadius = 60 * (1 + RANGE_BONUS);
        this.strEffectSymbol = "id_gfx_electricfield";
        break;
      case TYPE_NULIFYBALL:
        this.numTurnSpeed = 0.1; this.numSplashRadius = 0;
        break;
      case TYPE_LASERBEAM:
        this.numTurnSpeed = 0; this.numDamage = 2 * bonus; this.numSplashRadius = 0;
        this.beam(0xff5050, 1, 0.5);
        break;
      case TYPE_AASHELL:
        this.numTurnSpeed = 0; this.numDamage = 1 * bonus; this.numSplashRadius = 0;
        this.strEffectSymbol = "id_gfx_aablast";
        break;
      case TYPE_MISSILE:
        this.numTurnSpeed = 0.1; this.numDamage = 25 * bonus; this.numSplashRadius = 100;
        this.strEffectSymbol = "id_gfx_missileblast";
        break;
      case TYPE_CHAINBLAST:
        this.numTurnSpeed = 3.141592653589793; this.numDamage = 8 * bonus; this.numSplashRadius = 0;
        this.numTTL = 1;
        break;
      case TYPE_GAUSSRAIL:
        this.numTurnSpeed = 0; this.numDamage = 8 * bonus; this.numSplashRadius = 0;
        this.beam(0, 0.7, 0.4);
        break;
      case TYPE_CONFUSEBALL:
        this.numTurnSpeed = 0.5; this.numDamage = 3 * bonus; this.numSplashRadius = 0;
        break;
    }
  }

  setTargetEnemy(target: CEnemy | null): void {
    this.boolTargetsEnemy = true;
    this.mcTarget = target;
  }

  setTargetPoint(x: f64, y: f64): void {
    this.boolTargetsEnemy = false;
    this.numTargetX = x;
    this.numTargetY = y;
  }

  private targetAlive(): bool {
    const t = this.mcTarget;
    return t != null && t.exists;
  }

  private hitTarget(e: CEffect): void {
    const t = this.mcTarget;
    if (t != null && t.exists) t.applyEffect(e);
  }

  process(): void {
    const v = this.vectSpeed;
    if (this.boolTargetsEnemy && !this.targetAlive()) {
      // target gone: fly straight until the timer runs out
      this.numLiveTimer--;
      if (this.numLiveTimer == 0) {
        this.removeMovieClip();
        return;
      }
    } else {
      let tx: f64, ty: f64;
      if (this.boolTargetsEnemy) {
        const t = this.mcTarget!;
        tx = t.x;
        ty = t.y;
      } else {
        tx = this.numTargetX;
        ty = this.numTargetY;
      }
      const to = new CVector(tx - this.x, ty - this.y);
      if (to.numLength <= TARGET_HIT_TOLERANCE) {
        const g = game();
        switch (this.numType) {
          case TYPE_ROCKET:
          case TYPE_AASHELL:
            this.hitTarget(new CEffect(TYPE_DAMAGE, this.numDamage));
            break;
          case TYPE_CHAINBLAST:
            this.hitTarget(new CEffect(TYPE_DAMAGE, this.numDamage / this.numTTL));
            break;
          case TYPE_MISSILE:
            // the original falls through: piercing splash plus a normal splash
            g.map.applySplashEffect(new CEffect(TYPE_PIERCEDAMAGE, this.numDamage), tx, ty, this.numSplashRadius, this.numAltitude);
            g.map.applySplashEffect(new CEffect(TYPE_DAMAGE, this.numDamage), tx, ty, this.numSplashRadius, this.numAltitude);
            break;
          case TYPE_BALL:
          case TYPE_ELECTRICFIELD:
            g.map.applySplashEffect(new CEffect(TYPE_DAMAGE, this.numDamage), tx, ty, this.numSplashRadius, this.numAltitude);
            break;
          case TYPE_SLOWSHOT:
            this.hitTarget(new CEffect(TYPE_DAMAGE, this.numDamage));
            g.map.applySplashEffect(new CEffect(TYPE_SLOW, 0.25, 36), tx, ty, this.numSplashRadius, this.numAltitude);
            break;
          case TYPE_NULIFYBALL:
            this.hitTarget(new CEffect(TYPE_CLEAR));
            break;
          case TYPE_LASERBEAM:
          case TYPE_GAUSSRAIL:
            this.hitTarget(new CEffect(TYPE_PIERCEDAMAGE, this.numDamage));
            break;
          case TYPE_CONFUSEBALL:
            this.hitTarget(new CEffect(TYPE_DAMAGE, this.numDamage));
            this.hitTarget(new CEffect(TYPE_CONFUSE, 0.7, 60));
            break;
        }
        if (this.strEffectSymbol.length > 0) {
          if (this.numType == TYPE_ELECTRICFIELD) {
            g.map.addGFX(this.strEffectSymbol, this.x, this.y, ALTITUDE_AIR, this.numSplashRadius);
          } else {
            g.map.addGFX(this.strEffectSymbol, this.x, this.y, this.numAltitude, 0);
          }
        }
        if (this.numType == TYPE_CHAINBLAST && this.numTTL < 3) {
          // jump to the nearest other ground enemy within 50px
          this.numTTL++;
          const previous = this.mcTarget;
          this.mcTarget = g.map.getNearestEnemy(this.x, this.y, 50, ALTITUDE_GROUND, previous);
          if (!this.targetAlive()) {
            this.removeMovieClip();
            return;
          }
        } else {
          this.removeMovieClip();
          return;
        }
      }
      const angle = v.getAngleWith(to);
      if (angle > TARGET_TURN_TOLERANCE) {
        const cross = to.numX * v.numY - v.numX * to.numY;
        const step = this.numTurnSpeed <= angle ? this.numTurnSpeed : angle;
        v.rotate(cross > 0 ? step : -step);
      }
    }
    this.x += v.numX;
    this.y += v.numY;
    host.setRotation(this.h, v.numRotation);
  }
}
