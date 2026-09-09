export interface HudMessages {
  gameTitle: string;
  playerInfo: string;
  playerName: string;
  playerLevel: string;
  health: string;
  mana: string;
  experience: string;
  experienceValue: string;
  wavePanel: string;
  waveTitle: string;
  nextWaveCountdown: string;
  waveProgress: string;
  pause: string;
  settings: string;
  currencyInfo: string;
  gold: string;
  energy: string;
  gemProgress: string;
  activeSkills: string;
  activeSkillSlot: string;
  emptyActiveSkillSlot: string;
  itemQuickbar: string;
  itemSlot: string;
  itemEffect: string;
  cooldownPanel: string;
  skillSweep: string;
  skillSpin: string;
  skillWave: string;
  skillHeavenSplit: string;
  skillSkyArrow: string;
  skillLunge: string;
  skillAegis: string;
  skillDharma: string;
}

export type HudTextKey = keyof HudMessages;
export type HudTextParams = Readonly<Record<string, string | number>>;
