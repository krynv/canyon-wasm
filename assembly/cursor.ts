// CCursor.as — the placement cursor: a building being placed or an ability being aimed.
import * as host from "./host";
import { Clip } from "./clip";
import { CMap, CellHit } from "./map";
import { CBuilding, STATE_PLACING } from "./building";
import { TYPE_SELL, TYPE_MISSILE, TYPE_WALL, TYPE_TIMEBOMB, getCursorSymbol } from "./ability";
import { game } from "./game";

export const STATE_CLEAR: i32 = 0;
export const STATE_BUILDING: i32 = 1;
export const STATE_ABILITY: i32 = 2;

const CURSOR_DEPTH: i32 = 1;
const FORBIDDEN_GLOW: i32 = 0xff0000;
const PERMISSION_GLOW: i32 = 0x00ff00;
const NO_GLOW: i32 = -1;
const UNDEFINED_CELL: i32 = -9999;

export class CCursor extends Clip {
  numState: i32 = STATE_CLEAR;
  numAbility: i32 = 0;
  buildingCursor: CBuilding | null = null;
  /** the attached cursor graphic (the building itself in building mode) */
  mcCursor: Clip | null = null;
  objCell: CellHit = new CellHit();
  private boolJustAttached: bool = false;
  private lastCellI: i32 = UNDEFINED_CELL;
  private lastCellJ: i32 = UNDEFINED_CELL;

  constructor(parent: i32, private mapReference: CMap) {
    super();
    this.h = host.attach(parent, "id_cursor", "_cursorCurrent", 4);
  }

  attachBuilding(type: i32): bool {
    this.clear();
    const b = new CBuilding(host.attach(this.h, "id_building", "mcCursor", CURSOR_DEPTH));
    this.mcCursor = b;
    this.buildingCursor = b;
    this.lastCellI = this.lastCellJ = UNDEFINED_CELL;
    if (!b.initBuilding(type)) return false;
    b.numState = STATE_PLACING;
    this.numState = STATE_BUILDING;
    this.boolJustAttached = true;
    return true;
  }

  attachAbility(type: i32): void {
    this.numAbility = type;
    const c = new Clip();
    c.h = host.attach(this.h, getCursorSymbol(type), "mcCursor", CURSOR_DEPTH);
    this.mcCursor = c;
    this.buildingCursor = null;
    this.lastCellI = this.lastCellJ = UNDEFINED_CELL;
    this.numState = STATE_ABILITY;
    this.boolJustAttached = true;
  }

  /** Drop whatever is attached — unless it was attached during this very frame's click. */
  clear(): void {
    if (this.boolJustAttached) return;
    const c = this.mcCursor;
    if (c != null) c.removeMovieClip();
    this.mcCursor = null;
    this.buildingCursor = null;
    this.numState = STATE_CLEAR;
    host.setGlow(this.h, NO_GLOW);
  }

  refresh(): void {
    if (this.numState == STATE_CLEAR) return;
    const map = this.mapReference;
    const cell = map.cellHitTest(host.mouseX(), host.mouseY());
    this.objCell = cell;
    const j = cell.out ? UNDEFINED_CELL : cell.j;
    const changed = this.lastCellI != cell.i || this.lastCellJ != j;
    this.lastCellI = cell.i;
    this.lastCellJ = j;
    const mc = this.mcCursor!;
    const building = this.buildingCursor;
    host.setVisible(this.h, true);

    if (this.numState == STATE_BUILDING && building != null) {
      building.numCellI = cell.i;
      building.numCellJ = cell.j;
      this.x = 0;
      this.y = 0;
      mc.x = cell.x; // NaN outside the map: the clip keeps its last x
      mc.y = cell.y;
      if (changed) {
        game().onMouseOut(building, true);
        if (!cell.out) game().onMouseOver(building, true);
        map.toggleGrid(!cell.out);
      }
      cell.free = map.checkPlacingSpace(cell, building.matrixPattern!);
      host.setGlow(this.h, cell.free ? PERMISSION_GLOW : FORBIDDEN_GLOW);
    } else if (this.numState == STATE_ABILITY && this.numAbility == TYPE_WALL) {
      this.x = 0;
      this.y = 0;
      mc.x = cell.x;
      mc.y = cell.y;
      cell.free = map.checkWallSpace(cell);
      host.setGlow(this.h, cell.free ? PERMISSION_GLOW : FORBIDDEN_GLOW);
      map.toggleGrid(!cell.out);
    } else {
      this.x = host.mouseX();
      this.y = host.mouseY();
      switch (this.numAbility) {
        case TYPE_SELL:
          cell.free = map.checkBuildingSpace(cell);
          host.setGlow(this.h, cell.free ? NO_GLOW : FORBIDDEN_GLOW);
          map.toggleGrid(!cell.out);
          break;
        case TYPE_MISSILE:
        case TYPE_TIMEBOMB:
          cell.free = true;
          host.setAlpha(this.h, 100);
          break;
      }
    }
  }

  onMouseMove(): void {
    this.refresh();
  }

  onMouseDown(): void {
    if (this.numState == STATE_BUILDING || this.numState == STATE_ABILITY) {
      this.refresh();
      game().onMouseClick(this.objCell);
    }
  }

  onEnterFrame(): void {
    this.boolJustAttached = false;
  }
}
