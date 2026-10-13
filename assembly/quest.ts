// CQuest.as — each build button is unlocked by completing the quest in front of it.

/** Points needed, indexed by quest type - 1 (TOWERS1_1..5, TOWERS2_1..5, STRUCTURES_1..5). */
const POINT_CAPS: i32[] = [0, 1, 5, 40, 1, 0, 5, 1000, 1, 10, 5, 15, 3, 7, 2];
const COMPLETE_MSGS: string[] = [
  "MISSILE TURRET", "HOWITZER", "TESLA TOWER", "GUTLING LASER", "NULIFICATOR",
  "AA GUN", "GOO CANNON", "CHAIN GUN", "GAUSS CANNON", "OIL SPRAY",
  "NUCLEAR SILO", "WALL FACTORY", "RECYCLER", "RADAR DOME", "LABORATORY",
];

export class CQuest {
  boolActive: bool = false;
  numPointCap: f64;
  strCompleteMsg: string;
  private points: f64 = 0;

  /** @param type 1-based quest type */
  constructor(type: i32) {
    this.numPointCap = POINT_CAPS[type - 1];
    this.strCompleteMsg = COMPLETE_MSGS[type - 1];
  }

  get numPoints(): f64 { return this.points; }
  set numPoints(v: f64) {
    this.points = v < 0 ? 0 : v;
  }

  get boolComplete(): bool {
    return this.points >= this.numPointCap;
  }
}
