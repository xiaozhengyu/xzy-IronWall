/**
  * 支持的语言。
  *
  * 放在这个文件而不是 hudText.ts，因为存档（game/profile.ts）要存玩家选的语言，而
  * hudText.ts 第一行就 import 了一张 css —— 那会把一张样式表拖进纯数据那一侧，连带
  * 把离线跑数的那几个脚本弄坏（esbuild 打 node 包时没有 css 的 loader）。这个文件只有类型。
  */
export type HudLocale = 'zh-CN' | 'en';

export interface HudMessages {
  gameTitle: string;
  playerLevel: string;
  health: string;
  mana: string;
  experience: string;
  experienceValue: string;
  wavePanel: string;
  waveTitle: string;
  finalStandTitle: string;
  nextWaveCountdown: string;
  waveProgress: string;
  /** 左上角那行淡字：告诉玩家 ESC 能暂停。按钮没了，这是唯一还说这件事的地方。 */
  pauseHint: string;
  language: string;
  sound: string;
  music: string;
  on: string;
  off: string;
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
  skillHeavenGuard: string;
  skillSprint: string;
  skillIronBody: string;
  skillBulwark: string;
  skillMend: string;
  skillBerserk: string;
  skillBloodthirst: string;
}

export type HudTextKey = keyof HudMessages;
export type HudTextParams = Readonly<Record<string, string | number>>;
