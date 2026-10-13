// Const.as
export const MATRIX_CELL_WIDTH: i32 = 32;
export const MATRIX_CELL_HEIGHT: i32 = 32;
export const MATRIX_WIDTH: i32 = 14;
export const MATRIX_HEIGHT: i32 = 14;
export const DISABLE_QUESTS: bool = false;

export const SND_MAINLOOP: i32 = 0;
export const SND_QUEST: i32 = 1;
export const SND_ERROR: i32 = 2;
export const SND_NUCLEAREXPLOSION: i32 = 3;
export const SND_SWITCH: i32 = 4;
export const SND_POPDEAD: i32 = 5;
export const SND_NUCLEARLAUNCH: i32 = 6;
export const SND_TIMESTOP: i32 = 7;
export const SND_CONSTRUCTION: i32 = 8;
export const SND_SELL: i32 = 9;
export const SND_BIGEXPLOSION: i32 = 10;
export const SND_MEDIUMEXPLOSION: i32 = 11;
export const SND_SMALLEXPLOSION: i32 = 12;
export const SND_NULIFICATORSHOT: i32 = 13;
export const SND_TESLATOWERSHOT: i32 = 14;
export const SND_GAUSSCANNONSHOT: i32 = 15;
export const SND_GUTLINGLASERSHOT: i32 = 16;
export const SND_OILSPRAYSHOT: i32 = 17;
export const SND_CHAINGUNSHOT: i32 = 18;
export const SND_GOOCANNONSHOT: i32 = 19;
export const SND_MORTARSHOT: i32 = 20;
export const SND_AAGUNSHOT: i32 = 21;
export const SND_MISSILETURRETSHOT: i32 = 22;
export const SND_HIT: i32 = 23;

/** CSoundService.playSound(id, ifSoundStop = false, repeatCount = 1) */
import * as host from "./host";
export function playSound(id: i32, ifSoundStop: bool = false): void {
  host.sndPlay(id, ifSoundStop, 1);
}

/** AS2 number-to-string for the values the UI prints (integers print without a fraction). */
export function numStr(v: f64): string {
  if (v == Math.floor(v) && Math.abs(v) < 1e15) return (<i64>v).toString();
  return v.toString();
}
