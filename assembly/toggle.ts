// CToggleButton.as
import * as host from "./host";
import { SND_SWITCH, playSound } from "./consts";
import { game } from "./game";

const TOOLTIP_DELAY: i32 = 12;

export class CToggleButton {
  private mcHitArea: i32;
  private pressed: bool = false;
  private enabled: bool = true;
  private shown: bool = true;
  private mcToolTip: i32 = 0;
  private toolTipTimer: i32 = 0;
  /** true while the tooltip's onEnterFrame/onMouseMove handlers are installed (pointer over) */
  private hovering: bool = false;

  constructor(public h: i32) {
    const hit = host.child(h, "mcHitArea");
    this.mcHitArea = hit != 0 ? hit : h;
  }

  get boolPressed(): bool { return this.pressed; }
  set boolPressed(v: bool) {
    if (this.pressed == v) return;
    this.pressed = v;
    host.gotoLabel(this.h, v ? "frmPressed" : "frmReleased");
  }

  get boolEnabled(): bool { return this.enabled; }
  set boolEnabled(v: bool) {
    if (this.enabled == v) return;
    this.enabled = v;
    if (!v) this.boolPressed = false;
    else this.toolTipTimer = TOOLTIP_DELAY;
  }

  get visible(): bool { return this.shown; }
  set visible(v: bool) {
    this.shown = v;
    host.setVisible(this.h, v);
  }

  set strToolTip(text: string) {
    host.setRoll(this.h, true);
    this.mcToolTip = host.attach(this.h, "id_mcToolTip", "_mcToolTip", 1);
    const field = host.child(this.mcToolTip, "textToolTip");
    host.setAutoSize(field, true);
    host.setText(field, " " + text + " ");
    host.setVisible(this.mcToolTip, false);
  }

  onMouseDown(): void {
    if (this.enabled) {
      const hit = host.hitTestPoint(this.mcHitArea, host.mouseX(), host.mouseY(), false);
      game().ui.onTogglePress(this, hit);
      if (hit) playSound(SND_SWITCH);
    }
    if (this.mcToolTip != 0) {
      this.toggleToolTip(false);
      this.toolTipTimer = TOOLTIP_DELAY;
    }
  }

  private toggleToolTip(show: bool): void {
    if (!this.shown && show) return;
    host.setVisible(this.mcToolTip, show);
    if (show) {
      const w = host.getWidth(this.mcToolTip);
      host.setPos(this.mcToolTip, host.mouseX() - host.globalX(this.h) - w, host.mouseY() - host.globalY(this.h) + 22);
    }
  }

  onRollOver(): void {
    this.hovering = true;
    this.toolTipTimer = TOOLTIP_DELAY;
  }

  onRollOut(): void {
    this.toggleToolTip(false);
    this.hovering = false;
  }

  onMouseMove(): void {
    if (!this.hovering) return;
    this.toggleToolTip(false);
    this.toolTipTimer = TOOLTIP_DELAY;
  }

  onEnterFrame(): void {
    if (!this.hovering) return;
    this.toolTipTimer--;
    if (this.toolTipTimer == 0) this.toggleToolTip(true);
  }
}
