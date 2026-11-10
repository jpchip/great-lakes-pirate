/**
 * What the humanoid GLBs hold (plan 08 §13, §20 piece B; plan 14 §9). Shared by the asset
 * pipeline (tools/assets/build-characters.ts) and the game's character code, so both
 * agree on piece and clip names. No three.js here.
 */

export type BodyId = 'male' | 'female';
export const BODY_IDS: readonly BodyId[] = ['male', 'female'];

/** Mesh pieces, each stored at LOD_COUNT levels as `<piece>.lod<n>`. */
export const PIECE_NAMES = [
  'head',
  'hands',
  'shirt',
  'jacket',
  'legs',
  'boots',
  'hair.short',
  'hair.cropped',
  'hair.long',
  'hair.buns',
  'beard.full',
] as const;
export type PieceName = (typeof PIECE_NAMES)[number];

export const LOD_COUNT = 3;

/**
 * The clip set: game name → clip in Quaternius's Universal Animation Library 1 or 2
 * (CC0). Plan 14 §9's list, minus what the libraries don't have yet (ladder, row,
 * tie-up, knife, rifle): those stay on the list for custom clips.
 */
export const CLIPS = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  run: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  sneak: 'Crouch_Fwd_Loop',
  sneakIdle: 'Crouch_Idle_Loop',
  carry: 'Walk_Carry_Loop',
  climb: 'ClimbUp_1m',
  swim: 'Swim_Fwd_Loop',
  swimIdle: 'Swim_Idle_Loop',
  hop: 'Jump_Start',
  fall: 'Jump_Loop',
  land: 'Jump_Land',
  pick: 'Interact',
  kneelWork: 'Fixing_Kneeling',
  pickUp: 'PickUp_Table',
  openChest: 'Chest_Open',
  cosh: 'Melee_Hook',
  punch: 'Punch_Cross',
  hit: 'Hit_Chest',
  knockedDown: 'Death01',
  getUp: 'LayToIdle',
  search: 'Idle_No_Loop',
  alarmed: 'Idle_Rail_Call',
  lanternIdle: 'Idle_Lantern_Loop',
  talk: 'Idle_Talking_Loop',
  armsFolded: 'Idle_FoldArms_Loop',
  drink: 'Consume',
  sitDown: 'Sitting_Enter',
  sit: 'Sitting_Idle_Loop',
  standUp: 'Sitting_Exit',
  throw: 'OverhandThrow',
  pistolIdle: 'Pistol_Idle_Loop',
  pistolAim: 'Pistol_Aim_Neutral',
  pistolShoot: 'Pistol_Shoot',
  push: 'Push_Loop',
  helm: 'Driving_Loop',
} as const;
export type ClipName = keyof typeof CLIPS;

/** Clips that loop; the rest play once and hold (or hand back to a loop). */
export const LOOPING_CLIPS: ReadonlySet<ClipName> = new Set(
  (Object.entries(CLIPS) as [ClipName, string][])
    .filter(([, source]) => source.endsWith('_Loop'))
    .map(([name]) => name),
);

/** public/assets/characters/<body>.glb */
export function bodyUrl(body: BodyId): string {
  return `assets/characters/${body}.glb`;
}
