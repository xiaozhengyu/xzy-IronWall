import skullUrl from '../../assets/hud/icon/skull.png';
import coinUrl from '../../assets/hud/icon/coin.png';
import gemUrl from '../../assets/hud/icon/gem.png';
import heartUrl from '../../assets/hud/icon/heart.png';
import potionUrl from '../../assets/hud/icon/potion.png';
import meatUrl from '../../assets/hud/icon/meat.png';
import shieldUrl from '../../assets/hud/icon/shield.png';
import swordsUrl from '../../assets/hud/icon/swords.png';
import bowUrl from '../../assets/hud/icon/bow.png';
import fireUrl from '../../assets/hud/icon/fire.png';
import bootsUrl from '../../assets/hud/icon/boots.png';
import chestUrl from '../../assets/hud/icon/chest.png';
import scrollUrl from '../../assets/hud/icon/scroll.png';
import pauseUrl from '../../assets/hud/icon/pause.png';
import settingsUrl from '../../assets/hud/icon/settings.png';
import statsUrl from '../../assets/hud/icon/stats.png';

export const HUD_ICON_URLS = {
  skull: skullUrl,
  coin: coinUrl,
  gem: gemUrl,
  heart: heartUrl,
  potion: potionUrl,
  meat: meatUrl,
  shield: shieldUrl,
  swords: swordsUrl,
  bow: bowUrl,
  fire: fireUrl,
  boots: bootsUrl,
  chest: chestUrl,
  scroll: scrollUrl,
  pause: pauseUrl,
  settings: settingsUrl,
  stats: statsUrl,
} as const;

export type HudIconName = keyof typeof HUD_ICON_URLS;

export function createHudIcon(name: HudIconName, className?: string): HTMLImageElement {
  const image = document.createElement('img');
  image.className = ['hud-icon', className].filter(Boolean).join(' ');
  image.src = HUD_ICON_URLS[name];
  image.alt = '';
  image.draggable = false;
  return image;
}
