// CGame.as — screen state machine, mission rules, wave schedule, quests and message handling.
import * as host from "./host";
import { Layer } from "./clip";
import { CVector } from "./vector";
import { CEffect, TYPE_FAST, TYPE_REPAIR, TYPE_SHIELD, TYPE_TIMESTOP } from "./effect";
import { CMap, CellHit, ALTITUDE_AIR, ALTITUDE_BOTH } from "./map";
import { CEnemy, TYPE_BAGGI, TYPE_TRICYCLE, TYPE_CAR, TYPE_HOWERTANK, TYPE_PLANE, TYPE_INSECT, TYPE_SCORPIO } from "./enemy";
import * as B from "./building";
import { CBuilding } from "./building";
import { BlastParams, TYPE_MISSILE as BLAST_MISSILE, addDamageBonus } from "./blast";
import { CCursor, STATE_CLEAR, STATE_BUILDING, STATE_ABILITY } from "./cursor";
import * as A from "./ability";
import { CAbility } from "./ability";
import { CQuest } from "./quest";
import { CToggleButton } from "./toggle";
import { CMissionUIPanel, BB_STATE_QUEST, BB_STATE_SHOW, ACTION_ABILITY } from "./ui";
import { PROGRAMS, WAVE_FIELDS } from "./programs";
import * as C from "./consts";
import { numStr, playSound } from "./consts";

export const STATE_MAINSCREEN: i32 = 1;
export const STATE_OPTIONSSCREEN: i32 = 2;
export const STATE_RULESSCREEN: i32 = 3;
export const STATE_MISSION: i32 = 6;
/** Sound options screen — an addition; the original had no options beyond its mute switch. */
export const STATE_SOUNDOPTIONS: i32 = 7;

const SOUND_OPTION_STEP: i32 = 5;
const SOUND_CHANNEL_NAMES: string[] = ["Music", "Sfx"];

/** Show the stored volumes on a sound options strip (`id_soundOptions`). */
function refreshSoundOptions(strip: i32): void {
  for (let c = 0; c < SOUND_CHANNEL_NAMES.length; c++) {
    host.setText(host.child(strip, "text" + SOUND_CHANNEL_NAMES[c]), host.optVolume(c).toString() + "%");
    host.setText(host.child(strip, "text" + SOUND_CHANNEL_NAMES[c] + "On"), host.optOn(c) ? "ON" : "OFF");
  }
}

const INITIAL_FUNDS: f64 = 350;
const INITIAL_POPULATION: f64 = 10;
const MONEY_SCORE_MULT: f64 = 1;
const POP_SCORE_MULT: f64 = 10000;

const WAVE_ALT_GROUND: i32 = 1;
const WAVE_SIZE_TINY: i32 = 1;
const WAVE_SIZE_SMALL: i32 = 2;
const WAVE_SIZE_MEDIUM: i32 = 3;
const WAVE_SIZE_BIG: i32 = 4;
const WAVE_EFFECT_FAST: i32 = 1;
const WAVE_EFFECT_SHIELD: i32 = 2;
const WAVE_EFFECT_REPAIR: i32 = 3;

/** Frames between waves (24 fps) and score bonus, per difficulty. */
const WAVE_TIME: i32[] = [2880, 2160, 1440];
const SCORE_BONUS: f64[] = [0, 0.25, 0.5];

/** AS2 Math.round: halves round towards +infinity. */
function round(v: f64): f64 {
  return Math.floor(v + 0.5);
}

let instance: CGame | null = null;

export function game(): CGame {
  return instance!;
}

export function createGame(h: i32): CGame {
  const g = new CGame(h);
  instance = g;
  g.numState = STATE_MAINSCREEN;
  return g;
}

export class CGame {
  /** Selected map (1..3) and difficulty (0..2); 0 / -1 until chosen, like `undefined`. */
  numMap: i32 = 0;
  numProgram: i32 = -1;
  numScore: f64 = 0;

  map!: CMap;
  ui!: CMissionUIPanel;
  private cursor!: CCursor;
  private layerCanvas!: Layer;

  private state: i32 = 0;
  private paused: bool = false;
  private boolPausedBeforeQuit: bool = false;
  private boolInit: bool = false;
  /** onEnterFrame == oefProcessMission */
  private processing: bool = false;
  private mcGamePaused: i32 = 0;
  private mcQuitDialog: i32 = 0;
  private mcGameOverDialog: i32 = 0;
  /** sound options strip shown under the "Paused" dialog */
  private mcSoundOptions: i32 = 0;

  private funds: f64 = 0;
  private population: f64 = 0;
  private numMoneyEarned: f64 = 0;
  private numProgramPtr: i32 = 0;
  private numEnemiesPeriod: i32 = 0;
  private numEnemiesTimer: i32 = 0;

  private arrAbilities: CAbility[] = [];
  /** quest rows 1..3 (towers 1, towers 2, structures), five quests each */
  private quests: CQuest[][] = [];
  private questCurrent: i32[] = [-1, -1, -1];

  constructor(public h: i32) {}

  // ---- screens --------------------------------------------------------------------------------

  get numState(): i32 { return this.state; }
  set numState(value: i32) {
    if (this.state == value) return;
    this.state = value;
    // every screen, dialog and mission clip is a direct child of the game clip
    host.removeChildren(this.h);
    this.processing = false;
    this.mcGamePaused = this.mcQuitDialog = this.mcGameOverDialog = this.mcSoundOptions = 0;

    switch (value) {
      case STATE_MAINSCREEN: host.attach(this.h, "id_mcMainScreen", "_mcMainScreen", 1); break;
      case STATE_OPTIONSSCREEN: host.attach(this.h, "id_mcOptionsScreen", "_mcOptionsScreen", 1); break;
      case STATE_SOUNDOPTIONS:
        refreshSoundOptions(host.child(host.attach(this.h, "id_mcSoundScreen", "_mcSoundScreen", 1), "mcSoundOptions"));
        break;
      case STATE_RULESSCREEN: host.attach(this.h, "id_mcRulesScreen", "_mcRulesScreen", 1); break;
      case STATE_MISSION:
        this.startMission();
        break;
    }
    // The original dropped the music to 30% during a mission and back to 100% on menus; here
    // it stays at one level and the sound options decide how loud that is.
    host.sndVolume(C.SND_MAINLOOP, 100);
    host.sndLoop(C.SND_MAINLOOP);
  }

  private startMission(): void {
    this.map = new CMap(this.h);
    this.layerCanvas = new Layer(this.h, "_layerCanvas", 3);
    this.cursor = new CCursor(this.h, this.map);
    this.ui = new CMissionUIPanel(this.h);
    if (this.numMap == 0) this.numMap = 1;
    if (this.numProgram < 0) this.numProgram = 0;
    this.loadMission(this.numMap, this.numProgram);

    B.setRangeBonus(0); // the damage bonus is deliberately not reset: the original never does
    const ui = this.ui;
    this.arrAbilities = [
      new CAbility(A.TYPE_SELL, ui.abilityButtons[0], 1),
      new CAbility(A.TYPE_MISSILE, ui.abilityButtons[1], 0),
      new CAbility(A.TYPE_WALL, ui.abilityButtons[2], 0),
      new CAbility(A.TYPE_TIMEBOMB, ui.abilityButtons[3], 0),
      new CAbility(A.TYPE_MONEYBONUS, null, 0),
      new CAbility(A.TYPE_TOWERBONUS, null, 0),
    ];
    this.numFunds = INITIAL_FUNDS;
    this.numMoneyEarned = 0;
    this.numPopulation = INITIAL_POPULATION;
    this.numScore = 0;
    this.quests = [];
    for (let row = 0; row < 3; row++) {
      const list: CQuest[] = [];
      for (let q = 1; q <= 5; q++) list.push(new CQuest(row * 5 + q));
      this.quests.push(list);
      this.questCurrent[row] = -1;
    }
    this.paused = false;
    this.boolInit = true;
    this.processing = true;
  }

  // ---- resources ------------------------------------------------------------------------------

  /** Quest `index` (0-based) of row 1..3, or null outside a mission / past the row's end. */
  private quest(row: i32, index: i32): CQuest | null {
    if (row > this.quests.length || index < 0 || index >= 5) return null;
    return this.quests[row - 1][index];
  }

  /** Add points to a quest and refresh its counter if it is the one on display. */
  private questAdd(row: i32, index: i32, delta: f64): void {
    const q = this.quest(row, index);
    if (q == null) return;
    q.numPoints = q.numPoints + delta;
    if (q.boolActive) this.ui.updateQuest(row, index + 1, q);
  }

  get numFunds(): f64 { return this.funds; }
  set numFunds(v: f64) {
    this.funds = v < 0 ? 0 : v;
    this.ui.updatePriceColor(this.funds);
    // "CHAIN GUN" quest: have 1000 in the bank
    const q = this.quest(2, 2);
    if (q != null) {
      q.numPoints = this.funds;
      if (q.boolActive) this.ui.updateQuest(2, 3, q);
    }
    this.ui.setFunds(this.funds);
  }

  get numPopulation(): f64 { return this.population; }
  set numPopulation(v: f64) {
    this.population = v <= 0 ? 0 : v;
    this.ui.setPopulation(this.population);
  }

  get boolPaused(): bool { return this.paused; }
  set boolPaused(v: bool) {
    if (this.state != STATE_MISSION) return;
    this.paused = v;
    this.map.boolPaused = v;
    if (v) {
      this.mcGamePaused = host.attach(this.h, "mc_gamepaused", "_mcGamePaused", 100);
      host.setPos(this.mcGamePaused, 80, 140);
      this.mcQuitDialog = this.mcGameOverDialog = 0; // same depth: replaced
      this.mcSoundOptions = host.attach(this.h, "id_soundOptions", "_mcSoundOptions", 101);
      host.setPos(this.mcSoundOptions, 159, 288);
      refreshSoundOptions(this.mcSoundOptions);
      this.processing = false;
      this.layerCanvas.clear();
      this.cursor.clear();
    } else {
      host.remove(this.mcGamePaused);
      this.mcGamePaused = 0;
      this.hideSoundOptions();
      this.processing = true;
    }
    this.ui.boolEnabled = !v;
    if (!this.map.noEnemies) this.ui.setStartAttackVisible(false);
  }

  /** The quit and game-over dialogs pause the game too, but without the options strip. */
  private hideSoundOptions(): void {
    host.remove(this.mcSoundOptions);
    this.mcSoundOptions = 0;
  }

  // ---- messages (CEventMovieClip.processMessage) ----------------------------------------------

  /** MSG_TOGGLEPRESS for build and ability buttons (tabs are consumed by the panel). */
  onTogglePress(toggle: CToggleButton, action: i32, isHit: bool): void {
    const cursor = this.cursor;
    if (host.hitTestPoint(this.ui.h, host.mouseX(), host.mouseY(), true)) {
      toggle.boolPressed = isHit ? !toggle.boolPressed : false;
      cursor.clear();
    }
    cursor.x = Math.min(1000, Math.max(0, cursor.x));
    cursor.y = Math.min(1000, Math.max(0, cursor.y));
    if (!(isHit && toggle.boolPressed)) return;
    if (action > ACTION_ABILITY) cursor.attachAbility(action - ACTION_ABILITY);
    else if (action > 0) cursor.attachBuilding(action);
  }

  /** Quest bookkeeping shared by building (+1) and selling (-1) a structure. */
  private countBuilding(type: i32, delta: i32): void {
    switch (type) {
      case B.TYPE_TOWER_1_1: this.questAdd(3, 0, delta); break;
      case B.TYPE_TOWER_1_3: this.questAdd(3, 2, delta); break;
      case B.TYPE_TOWER_2_2: this.questAdd(1, 2, delta); break;
      case B.TYPE_TOWER_2_1: this.questAdd(3, 3, delta); break;
      case B.TYPE_TOWER_2_3: this.questAdd(3, 2, delta); break;
      case B.TYPE_BULIDING_1: // nuclear silo: missile ability
        this.arrAbilities[1].numSources += delta;
        break;
      case B.TYPE_BULIDING_2: // wall factory: wall ability
        this.arrAbilities[2].numSources += delta;
        this.questAdd(3, 4, delta);
        break;
      case B.TYPE_BULIDING_3: // recycler: +50% kill reward each
        this.arrAbilities[4].numSources += delta;
        break;
      case B.TYPE_BULIDING_4: // radar dome: +10% range and damage each
        this.arrAbilities[5].numSources += delta;
        B.setRangeBonus(B.RANGE_BONUS + 0.1 * delta);
        addDamageBonus(0.1 * delta);
        this.questAdd(2, 3, delta);
        break;
      case B.TYPE_BULIDING_5: // laboratory: time stop ability
        this.arrAbilities[3].numSources += delta;
        this.questAdd(1, 4, delta);
        break;
    }
    this.questAdd(3, 1, delta); // total structures
  }

  /** MSG_MOUSECLICK from the cursor. */
  onMouseClick(cell: CellHit): void {
    const cursor = this.cursor;
    const ui = this.ui;
    const usable = cell.free && !cell.out;
    if (cursor.numState != STATE_CLEAR && !cell.free && !cell.out) playSound(C.SND_ERROR);

    if (cursor.numState == STATE_BUILDING && usable) {
      const b = cursor.buildingCursor!;
      if (this.numFunds < <f64>b.numPrice) {
        ui.showMessage("NOT ENOUGH\nMONEY!", true);
      } else {
        this.map.addBuilding(b);
        this.numFunds -= b.numPrice;
        cursor.refresh();
        playSound(C.SND_CONSTRUCTION);
        this.countBuilding(b.numType, 1);
      }
    }

    if (cursor.numState == STATE_ABILITY && usable) {
      let applied = true;
      let index = 0;
      switch (cursor.numAbility) {
        case A.TYPE_SELL: {
          index = 0;
          const b = this.map.getBuildingAt(cell.i, cell.j);
          if (b != null) {
            this.numFunds += round(0.5 * b.numPrice);
            playSound(C.SND_SELL);
            this.countBuilding(b.numType, -1);
            this.map.deleteBuilding(b);
          }
          this.layerCanvas.clear();
          break;
        }
        case A.TYPE_MISSILE: {
          index = 1;
          const p = new BlastParams();
          p.x = 224;
          p.y = 500;
          p.direction = new CVector(0, -1);
          p.altitude = ALTITUDE_BOTH;
          p.type = BLAST_MISSILE;
          p.targetsEnemy = false;
          p.targetX = host.mouseX();
          p.targetY = host.mouseY();
          p.speed = 6;
          this.map.addBlast(p);
          playSound(C.SND_NUCLEARLAUNCH);
          // "HOWITZER" quest: only launches made while the quest is showing count
          const q = this.quest(1, 1);
          if (q != null && q.boolActive) this.questAdd(1, 1, 1);
          break;
        }
        case A.TYPE_WALL: {
          index = 2;
          const mc = cursor.mcCursor;
          if (mc != null && this.map.isHitWithGroundEnemy(mc.h)) {
            ui.showMessage("YOU CAN'T INSTALL WALL\nOVER THE ENEMY!", true);
            applied = false;
          } else if (!this.map.markCacheMatrix(cell.i, cell.j)) {
            ui.showMessage("YOU CAN'T\nBLOCK PATH!", true);
            applied = false;
          } else {
            this.map.addWall(cell.i, cell.j);
            this.map.toggleGrid(false);
            playSound(C.SND_CONSTRUCTION);
            this.questAdd(2, 4, 1);
          }
          break;
        }
        case A.TYPE_TIMEBOMB:
          index = 3;
          this.map.applySplashEffect(new CEffect(TYPE_TIMESTOP, 0, 120), host.mouseX(), host.mouseY(), 100, ALTITUDE_BOTH);
          playSound(C.SND_TIMESTOP);
          break;
      }
      if (applied && this.arrAbilities[index].reset()) cursor.clear();
    }
  }

  /** MSG_MOUSEOVER: show a tower's range ring. */
  onMouseOver(b: CBuilding, forceShow: bool): void {
    if (b.boolTower && (this.cursor.numState == STATE_CLEAR || forceShow) && !this.paused) {
      const ring = this.layerCanvas.addElement("id_tower_range");
      host.setPos(ring, b.gunGlobalX, b.gunGlobalY);
      const size = 2 * Math.floor(b.numRange);
      host.setWidth(ring, size);
      host.setHeight(ring, size);
    }
  }

  /** MSG_MOUSEOUT */
  onMouseOut(b: CBuilding, forceHide: bool): void {
    if (b.boolTower && (this.cursor.numState == STATE_CLEAR || forceHide)) this.layerCanvas.clear();
  }

  private checkWaveCleared(): void {
    if (!this.map.noEnemies) return;
    if (this.numProgramPtr >= this.waveCount) this.showGameOverDialog(true);
    else this.ui.setStartAttackVisible(true);
  }

  /** MSG_ENEMYDEAD */
  onEnemyDead(e: CEnemy, deathEffect: string, x: f64, y: f64): void {
    const reward = round(e.numReward * (1 + 0.5 * this.arrAbilities[4].numSources));
    this.numFunds += reward;
    this.numMoneyEarned += reward;
    this.map.addGFX(deathEffect, x, y, e.numAltitude, 0);
    if (e.numAltitude == ALTITUDE_AIR) {
      this.questAdd(2, 1, 1);
      this.questAdd(1, 3, 1);
    }
    e.remove();
    this.checkWaveCleared();
  }

  /** MSG_ENEMYPASSED */
  onEnemyPassed(e: CEnemy): void {
    this.numPopulation = this.numPopulation - 1;
    e.remove();
    playSound(C.SND_POPDEAD, true);
    if (this.numPopulation == 0) {
      this.showGameOverDialog(false);
      return;
    }
    this.checkWaveCleared();
  }

  /**
   * MSG_HURRYATTACK: launch the next wave now. Every ability cooldown is credited with a
   * full wave period (not just the time skipped), as in the original.
   */
  onHurryAttack(): void {
    this.numEnemiesTimer = this.numEnemiesPeriod;
    for (let n = this.arrAbilities.length - 1; n >= 0; n--) {
      this.arrAbilities[n].numTimer = this.arrAbilities[n].numTimer - this.numEnemiesTimer;
    }
  }

  /** MSG_QUITGAME */
  onQuitGame(): void {
    this.boolPausedBeforeQuit = this.paused;
    this.boolPaused = true;
    this.hideSoundOptions();
    this.ui.switchServiceButtonsVisibility(false);
    this.mcQuitDialog = host.attach(this.h, "mc_quitdialog", "_mcQuitDialog", 100);
    host.setPos(this.mcQuitDialog, 80, 140);
    this.mcGamePaused = 0;
  }

  // ---- waves ----------------------------------------------------------------------------------

  private get waveCount(): i32 {
    return PROGRAMS[this.numProgram].length / WAVE_FIELDS;
  }

  private waveField(wave: i32, field: i32): i32 {
    return PROGRAMS[this.numProgram][wave * WAVE_FIELDS + field];
  }

  private loadMission(mapID: i32, programID: i32): void {
    this.numProgramPtr = 0;
    this.numEnemiesPeriod = WAVE_TIME[programID];
    this.numEnemiesTimer = 0;
    this.map.loadMap(mapID);
    this.updateWaveScreen(true);
  }

  private createAttackWave(wave: i32): void {
    if (wave >= this.waveCount) return;
    const size = this.waveField(wave, 2);
    let type = 0;
    if (this.waveField(wave, 0) == WAVE_ALT_GROUND) {
      switch (size) {
        case WAVE_SIZE_TINY: type = TYPE_BAGGI; break;
        case WAVE_SIZE_SMALL: type = TYPE_TRICYCLE; break;
        case WAVE_SIZE_MEDIUM: type = TYPE_CAR; break;
        case WAVE_SIZE_BIG: type = TYPE_HOWERTANK; break;
      }
    } else {
      switch (size) {
        case WAVE_SIZE_TINY: type = TYPE_PLANE; break;
        case WAVE_SIZE_SMALL: type = TYPE_INSECT; break;
        case WAVE_SIZE_MEDIUM: type = TYPE_SCORPIO; break;
      }
    }
    let effect: CEffect | null = null;
    switch (this.waveField(wave, 4)) {
      case WAVE_EFFECT_FAST: effect = new CEffect(TYPE_FAST, 0.5, -1); break;
      case WAVE_EFFECT_REPAIR: effect = new CEffect(TYPE_REPAIR, 0.005, -1); break;
      case WAVE_EFFECT_SHIELD: effect = new CEffect(TYPE_SHIELD, 0.1, -1); break;
    }
    const qty = this.waveField(wave, 1);
    const level = this.waveField(wave, 3);
    for (let n = 0; n < qty; n++) {
      this.map.addEnemy(type, level, effect != null ? effect.makeCopy() : null, n);
    }
  }

  /** Refresh the countdown, and with `describeNext` also the "Next attack" text. */
  private updateWaveScreen(describeNext: bool): void {
    const wave = this.numProgramPtr;
    if (describeNext && wave < this.waveCount) {
      const qty = this.waveField(wave, 1);
      let s = "Next attack: #" + (wave + 1).toString() + "\n" + qty.toString() + " ";
      switch (this.waveField(wave, 2)) {
        case WAVE_SIZE_TINY: s += "TINY "; break;
        case WAVE_SIZE_SMALL: s += "SMALL "; break;
        case WAVE_SIZE_MEDIUM: s += "MEDIUM "; break;
        case WAVE_SIZE_BIG: s += "BIG "; break;
      }
      s += "unit";
      if (qty > 1) s += "s";
      s += " Lv[" + this.waveField(wave, 3).toString() + "]";
      s += this.waveField(wave, 0) == WAVE_ALT_GROUND ? "\nGROUND" : "\nAIR";
      switch (this.waveField(wave, 4)) {
        case WAVE_EFFECT_FAST: s += " / FAST"; break;
        case WAVE_EFFECT_REPAIR: s += " / AUTOREPAIR"; break;
        case WAVE_EFFECT_SHIELD: s += " / SHIELDED"; break;
      }
      this.ui.setWaveText(s);
    }
    if (wave >= this.waveCount) this.ui.hideWaveInfo();
    let seconds = (this.numEnemiesPeriod - this.numEnemiesTimer) / 24; // integer division == floor here
    if (this.numEnemiesPeriod - this.numEnemiesTimer < 0) seconds = 0;
    const minutes = seconds / 60;
    seconds -= minutes * 60;
    this.ui.setTimerText((minutes >= 10 ? "" : "0") + minutes.toString() + ":" + (seconds >= 10 ? "" : "0") + seconds.toString());
  }

  // ---- dialogs --------------------------------------------------------------------------------

  onQuitDialogClose(quit: bool): void {
    if (quit) {
      this.numState = STATE_MAINSCREEN;
    } else {
      host.remove(this.mcQuitDialog);
      this.mcQuitDialog = 0;
      this.boolPaused = this.boolPausedBeforeQuit;
      this.ui.switchServiceButtonsVisibility(true);
    }
    playSound(C.SND_SWITCH);
  }

  private showGameOverDialog(win: bool): void {
    this.boolPaused = true;
    this.hideSoundOptions();
    const d = host.attach(this.h, "mc_gameoverdialog", "_mcGameOverDialog", 100);
    this.mcGameOverDialog = d;
    this.mcGamePaused = 0;
    host.setPos(d, 40, 85);
    if (!win) host.gotoAndStop(host.child(d, "mcMessage"), 2);
    this.ui.switchServiceButtonsVisibility(false);
    const moneyScore = this.numMoneyEarned * MONEY_SCORE_MULT;
    const popScore = this.numPopulation * POP_SCORE_MULT;
    host.setText(host.child(d, "textMoneyQty"), numStr(this.numMoneyEarned));
    host.setText(host.child(d, "textMoneyMult"), "x" + numStr(MONEY_SCORE_MULT));
    host.setText(host.child(d, "textMoneyScore"), numStr(moneyScore));
    host.setText(host.child(d, "textPopQty"), numStr(this.numPopulation));
    host.setText(host.child(d, "textPopMult"), "x" + numStr(POP_SCORE_MULT));
    host.setText(host.child(d, "textPopScore"), numStr(popScore));
    host.setText(host.child(d, "textBonus"), "+" + numStr(SCORE_BONUS[this.numProgram] * 100) + " %");
    this.numScore = round((moneyScore + popScore) * (1 + SCORE_BONUS[this.numProgram]));
    host.setText(host.child(d, "textTotalScore"), numStr(this.numScore));
  }

  /**
   * The original went on to Miniclip's award and highscore screens; both services are gone,
   * so the dialog returns to the main menu.
   */
  onGameOverDialogClose(): void {
    this.numState = STATE_MAINSCREEN;
    playSound(C.SND_SWITCH);
  }

  // ---- per-frame ------------------------------------------------------------------------------

  private oefProcessMission(): void {
    const ui = this.ui;
    if (this.boolInit) {
      this.arrAbilities[1].boolAvaliable = false;
      this.arrAbilities[2].boolAvaliable = false;
      this.arrAbilities[3].boolAvaliable = false;
      this.boolInit = false;
    }
    if (this.numEnemiesTimer > this.numEnemiesPeriod) {
      this.numEnemiesTimer = 0;
      this.createAttackWave(this.numProgramPtr);
      this.numProgramPtr++;
      this.updateWaveScreen(true);
      ui.setStartAttackVisible(false);
    } else {
      this.numEnemiesTimer++;
      this.updateWaveScreen(false);
    }
    for (let n = this.arrAbilities.length - 1; n >= 0; n--) this.arrAbilities[n].tick();

    if (!C.DISABLE_QUESTS) {
      for (let row = 1; row <= 3; row++) {
        let current = this.questCurrent[row - 1];
        if (current == -1) {
          current = 0;
          this.questCurrent[row - 1] = 0;
          ui.changeBBState(row, 1, BB_STATE_QUEST);
          const first = this.quest(row, 0)!;
          first.boolActive = true;
          ui.updateQuest(row, 1, first);
        }
        const q = this.quest(row, current);
        if (q != null && q.boolComplete) {
          // unlock this button and put the next quest on display
          ui.changeBBState(row, current + 1, BB_STATE_SHOW);
          ui.changeBBState(row, current + 2, BB_STATE_QUEST);
          q.boolActive = false;
          const next = this.quest(row, current + 1);
          if (next != null) next.boolActive = true;
          ui.updateQuest(row, current + 2, next);
          ui.updatePriceColor(this.numFunds);
          if (q.numPointCap > 0) ui.showMessage("Quest complete!\n" + q.strCompleteMsg);
          this.questCurrent[row - 1] = current + 1;
        }
      }
    }
    this.map.process();
  }

  /**
   * One 24 fps frame. AVM1 runs onEnterFrame handlers newest clip first, hence:
   * toggle buttons, UI panel, cursor, then the game itself.
   */
  onEnterFrame(): void {
    if (this.state != STATE_MISSION) return;
    const toggles = this.ui.toggles;
    for (let n = 0; n < toggles.length; n++) toggles[n].onEnterFrame();
    this.ui.onEnterFrame();
    this.cursor.onEnterFrame();
    if (this.processing) this.oefProcessMission();
  }

  // ---- input ----------------------------------------------------------------------------------

  onMouseDown(): void {
    if (this.state != STATE_MISSION) return;
    const toggles = this.ui.toggles;
    for (let n = 0; n < toggles.length; n++) toggles[n].onMouseDown();
    this.cursor.onMouseDown();
  }

  onMouseMove(): void {
    if (this.state != STATE_MISSION) return;
    const toggles = this.ui.toggles;
    for (let n = 0; n < toggles.length; n++) toggles[n].onMouseMove();
    this.cursor.onMouseMove();
  }

  onKeyDown(code: i32): void {
    if (this.state == STATE_MISSION) this.ui.onKeyDown(code);
  }

  onRollOver(h: i32): void {
    if (this.state != STATE_MISSION) return;
    const toggle = this.ui.findToggle(h);
    if (toggle != null) {
      toggle.onRollOver();
      return;
    }
    const b = this.map.findBuildingByHandle(h);
    if (b != null && !b.boolMouseOver) {
      b.boolMouseOver = true;
      this.onMouseOver(b, false);
    }
  }

  onRollOut(h: i32): void {
    if (this.state != STATE_MISSION) return;
    const toggle = this.ui.findToggle(h);
    if (toggle != null) {
      toggle.onRollOut();
      return;
    }
    const b = this.map.findBuildingByHandle(h);
    if (b != null && b.boolMouseOver) {
      b.boolMouseOver = false;
      this.onMouseOut(b, false);
    }
  }

  /**
   * on(release) handlers of the SWF's Button symbols, keyed by button character id.
   * `parent` is the clip containing the button (`this` in the original button scripts).
   */
  onButtonRelease(button: i32, parent: i32): void {
    // sound options strip: 91c0 quieter, 91c1 louder, 91c2 on/off (c = channel)
    if (button >= 9100 && button < 9120) {
      const channel = (button - 9100) / 10;
      const action = button % 10;
      if (action == 2) host.optSetOn(channel, !host.optOn(channel));
      else host.optSetVolume(channel, host.optVolume(channel) + (action == 1 ? SOUND_OPTION_STEP : -SOUND_OPTION_STEP));
      refreshSoundOptions(parent);
      playSound(C.SND_SWITCH);
      return;
    }
    switch (button) {
      case 9010: playSound(C.SND_SWITCH); this.numState = STATE_SOUNDOPTIONS; break; // main menu "Options"
      // main screen
      case 15: playSound(C.SND_SWITCH); this.numState = STATE_OPTIONSSCREEN; break; // PLAY
      case 29: playSound(C.SND_SWITCH); this.numState = STATE_RULESSCREEN; break;
      // back buttons
      case 597: playSound(C.SND_SWITCH); this.numState = STATE_MAINSCREEN; break;
      // options: map 1..3 (inside mcMapSelector), then difficulty
      case 626:
      case 627:
      case 628:
        this.numMap = button - 625;
        playSound(C.SND_SWITCH);
        host.gotoAndStop(host.parentOf(parent), 2);
        break;
      case 631: playSound(C.SND_SWITCH); host.gotoAndStop(parent, 1); break;
      case 654:
      case 655:
      case 656:
        playSound(C.SND_SWITCH);
        this.numProgram = button - 654;
        this.numState = STATE_MISSION;
        break;
      // mission
      case 442: this.onGameOverDialogClose(); break;
      case 572: this.ui.onHurryRelease(); break;
      case 574: this.ui.onQuitRelease(); break;
      case 576: host.play(parent); this.ui.onPauseRelease(true); break;
      case 578: host.play(parent); this.ui.onPauseRelease(false); break;
      case 581: host.play(parent); host.sndOff(); break;
      case 583: host.play(parent); host.sndOn(); break;
      case 588: this.onQuitDialogClose(true); break;
      case 590: this.onQuitDialogClose(false); break;
    }
  }
}
