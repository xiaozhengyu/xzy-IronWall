export interface HudMessages {
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
  bossProgress: string;
  pause: string;
  settings: string;
  currencyInfo: string;
  gold: string;
  energy: string;
  gemProgress: string;
}

export type HudTextKey = keyof HudMessages;
export type HudTextParams = Readonly<Record<string, string | number>>;
