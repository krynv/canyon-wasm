// CMissionUIPanel.as — the side panel: three build tabs, ability buttons, wave info, switches.
import * as host from "./host";
import { CToggleButton } from "./toggle";
import { CQuest } from "./quest";
import { PRICES } from "./building";
import { DISABLE_QUESTS, SND_SWITCH, SND_ERROR, SND_QUEST, playSound, numStr } from "./consts";
import { game } from "./game";

export const BB_STATE_HIDE: i32 = 1;
export const BB_STATE_QUEST: i32 = 2;
export const BB_STATE_SHOW: i32 = 3;

const TABS: i32 = 3;
const BUTTONS: i32 = 5;
const MESSAGE_DELAY: i32 = 48;

const OEF_NONE: i32 = 0;
const OEF_INIT: i32 = 1;
const OEF_WAIT_MESSAGE: i32 = 2;

/** Toggle actions: 1..15 select that building type, 101..104 select ability 1..4, 0 is a tab. */
export const ACTION_ABILITY: i32 = 100;

export class CMissionUIPanel {
  h: i32;
  tabButtons: CToggleButton[] = [];
  buildingButtons: CToggleButton[] = []; // (tab - 1) * 5 + (button - 1)
  abilityButtons: CToggleButton[] = [];
  toggles: CToggleButton[] = [];
  actions: Map<i32, i32> = new Map<i32, i32>(); // toggle handle -> action

  startAttackVisible: bool = true;
  private pauseSwitchVisible: bool = true;
  private quitVisible: bool = true;
  private enabled: bool = false;
  private numCurrentTab: i32 = 0;
  private numMessageTimer: i32 = 0;
  private oef: i32 = OEF_INIT;
  private descFrames: i32[] = new Array<i32>(TABS * BUTTONS).fill(1);

  private tabPages: i32[] = [];
  private descriptions: i32[] = [];
  private btnStartAttack: i32;
  private btnQuit: i32;
  private mcPauseSwitch: i32;
  private mcSoundSwitch: i32;
  private mcErrorBlink: i32;
  private textScreen: i32;
  private textTimer: i32;
  private textMessage: i32;
  private textFunds: i32;
  private textPopulation: i32;

  constructor(parent: i32) {
    const h = host.attach(parent, "id_missionUI", "_mcMissionUI", 5);
    this.h = h;
    host.setPos(h, 448, 0);
    for (let t = 1; t <= TABS; t++) {
      const page = host.child(h, "_mcTabPage" + t.toString());
      this.tabPages.push(page);
      const tab = new CToggleButton(host.child(h, "_mcTabButton" + t.toString()));
      this.tabButtons.push(tab);
      this.register(tab, 0);
      for (let b = 1; b <= BUTTONS; b++) {
        const btn = new CToggleButton(host.child(page, "_mcBtnBuilding" + b.toString()));
        this.buildingButtons.push(btn);
        this.register(btn, (t - 1) * BUTTONS + b);
        this.descriptions.push(host.child(page, "_mcDescription" + b.toString()));
      }
    }
    for (let a = 1; a <= 4; a++) {
      const btn = new CToggleButton(host.child(h, "_mcBtnAbility" + a.toString()));
      this.abilityButtons.push(btn);
      this.register(btn, ACTION_ABILITY + a);
    }
    this.btnStartAttack = host.child(h, "_btnStartAttack");
    this.btnQuit = host.child(h, "_btnQuit");
    this.mcPauseSwitch = host.child(h, "_mcPauseSwitch");
    this.mcSoundSwitch = host.child(h, "_mcSoundSwitch");
    this.mcErrorBlink = host.child(h, "_mcErrorBlink");
    this.textScreen = host.child(h, "textScreen");
    this.textTimer = host.child(h, "textTimer");
    this.textMessage = host.child(h, "textMessage");
    this.textFunds = host.child(h, "textFunds");
    this.textPopulation = host.child(h, "textPopulation");
  }

  private register(btn: CToggleButton, action: i32): void {
    this.toggles.push(btn);
    this.actions.set(btn.h, action);
  }

  findToggle(h: i32): CToggleButton | null {
    for (let n = 0; n < this.toggles.length; n++) if (this.toggles[n].h == h) return this.toggles[n];
    return null;
  }

  get boolEnabled(): bool { return this.enabled; }
  set boolEnabled(v: bool) {
    this.enabled = v;
    this.setStartAttackVisible(v);
  }

  setStartAttackVisible(v: bool): void {
    this.startAttackVisible = v;
    host.setVisible(this.btnStartAttack, v);
  }

  setFunds(v: f64): void { host.setText(this.textFunds, numStr(v)); }
  setPopulation(v: f64): void { host.setText(this.textPopulation, numStr(v)); }
  setWaveText(s: string): void { host.setText(this.textScreen, s); }
  setTimerText(s: string): void { host.setText(this.textTimer, s); }
  hideWaveInfo(): void {
    host.setVisible(this.textScreen, false);
    host.setVisible(this.textTimer, false);
  }

  private oefInit(): void {
    for (let t = 1; t <= TABS; t++) {
      for (let b = 1; b <= BUTTONS; b++) {
        this.changeBBState(t, b, DISABLE_QUESTS ? BB_STATE_SHOW : BB_STATE_HIDE);
      }
    }
    this.abilityButtons[0].strToolTip = "SELL";
    this.abilityButtons[1].strToolTip = "LAUNCH MISSILE";
    this.abilityButtons[2].strToolTip = "CONSTRUCT WALL";
    this.abilityButtons[3].strToolTip = "STOP TIME";
    this.onTabChange(1);
    host.setVisible(this.h, true);
    host.setVisible(this.textMessage, false);
    this.boolEnabled = true;
    this.oef = OEF_NONE;
  }

  private infoField(tab: i32, button: i32): i32 {
    return host.child(this.descriptions[(tab - 1) * BUTTONS + button - 1], "textInfo");
  }

  /** Build-button state: hidden, showing its unlock quest, or available with its price. */
  changeBBState(tab: i32, button: i32, state: i32): void {
    if (button > BUTTONS) return; // row finished: the original pokes at undefined clips here
    const at = (tab - 1) * BUTTONS + button - 1;
    const btn = this.buildingButtons[at];
    const desc = this.descriptions[at];
    switch (state) {
      case BB_STATE_HIDE:
      case BB_STATE_QUEST:
        btn.visible = false;
        btn.boolEnabled = false;
        this.descFrames[at] = state == BB_STATE_HIDE ? 3 : 2;
        host.gotoAndStop(desc, this.descFrames[at]);
        break;
      case BB_STATE_SHOW:
        if (this.numCurrentTab == tab) {
          btn.visible = true;
          btn.boolEnabled = true;
        }
        this.descFrames[at] = 1;
        host.gotoAndStop(desc, 1);
        host.setText(this.infoField(tab, button), "PRICE: " + PRICES[at].toString());
        break;
    }
  }

  updateQuest(tab: i32, button: i32, quest: CQuest | null): void {
    if (button > BUTTONS || quest == null) return;
    host.setText(this.infoField(tab, button), numStr(quest.numPoints) + " / " + numStr(quest.numPointCap));
  }

  onTabChange(tabIndex: i32): void {
    this.numCurrentTab = tabIndex;
    for (let t = 1; t <= TABS; t++) {
      const current = t == tabIndex;
      this.tabButtons[t - 1].boolPressed = current;
      host.setVisible(this.tabPages[t - 1], current);
      for (let b = 1; b <= BUTTONS; b++) {
        const at = (t - 1) * BUTTONS + b - 1;
        if (this.descFrames[at] == 1) {
          this.buildingButtons[at].boolEnabled = current;
          this.buildingButtons[at].visible = current;
        }
      }
    }
  }

  /** Prices the player cannot afford are shown in red. */
  updatePriceColor(funds: f64): void {
    for (let t = 1; t <= TABS; t++) {
      for (let b = 1; b <= BUTTONS; b++) {
        const at = (t - 1) * BUTTONS + b - 1;
        if (this.descFrames[at] == 1) {
          host.setTextColor(this.infoField(t, b), funds >= <f64>PRICES[at] ? 0x000000 : 0xff0000);
        }
      }
    }
  }

  onHurryRelease(): void {
    game().onHurryAttack();
    playSound(SND_SWITCH);
  }

  onQuitRelease(): void {
    game().onQuitGame();
    playSound(SND_SWITCH);
  }

  onPauseRelease(pause: bool): void {
    game().boolPaused = pause;
    playSound(SND_SWITCH);
  }

  switchServiceButtonsVisibility(visible: bool): void {
    this.pauseSwitchVisible = visible;
    this.quitVisible = visible;
    host.setVisible(this.mcPauseSwitch, visible);
    host.setVisible(this.btnQuit, visible);
  }

  showMessage(message: string, error: bool = false): void {
    host.setVisible(this.textTimer, false);
    host.setVisible(this.textScreen, false);
    host.setText(this.textMessage, message);
    host.setVisible(this.textMessage, true);
    host.play(this.mcErrorBlink);
    playSound(error ? SND_ERROR : SND_QUEST);
    this.numMessageTimer = MESSAGE_DELAY;
    this.oef = OEF_WAIT_MESSAGE;
  }

  /** Space: send next wave. P or Esc (Esc is an addition): pause. M: mute. Q: quit. */
  onKeyDown(code: i32): void {
    if (code == 32 && this.startAttackVisible) this.onHurryRelease();
    if ((code == 80 || code == 27) && this.pauseSwitchVisible) {
      this.onPauseRelease(host.currentFrame(this.mcPauseSwitch) == 1);
      host.play(this.mcPauseSwitch);
    }
    if (code == 77) {
      if (host.currentFrame(this.mcSoundSwitch) == 1) host.sndOff();
      else host.sndOn();
      host.play(this.mcSoundSwitch);
    }
    if (code == 81 && this.quitVisible) this.onQuitRelease();
  }

  onEnterFrame(): void {
    if (this.oef == OEF_INIT) {
      this.oefInit();
    } else if (this.oef == OEF_WAIT_MESSAGE) {
      this.numMessageTimer--;
      if (this.numMessageTimer == 0) {
        host.setVisible(this.textTimer, true);
        host.setVisible(this.textScreen, true);
        host.setVisible(this.textMessage, false);
        this.oef = OEF_NONE;
      }
    }
  }

  /** MSG_TOGGLEPRESS: tabs are handled here, everything else bubbles up to the game. */
  onTogglePress(toggle: CToggleButton, isHit: bool): void {
    let handled = false;
    if (!this.enabled) {
      handled = true;
    } else {
      const tab = this.tabButtons.indexOf(toggle);
      if (tab >= 0) handled = true;
      if (isHit && !toggle.boolPressed && tab >= 0) {
        this.onTabChange(tab + 1);
        for (let t = 0; t < TABS; t++) if (t != tab) this.tabButtons[t].boolPressed = false;
      }
    }
    if (!handled) game().onTogglePress(toggle, this.actions.get(toggle.h), isHit);
  }
}
