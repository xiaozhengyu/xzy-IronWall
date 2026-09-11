import skill01Url from '../../assets/hud/item/skill/skill-01.png';
import skill02Url from '../../assets/hud/item/skill/skill-02.png';
import skill03Url from '../../assets/hud/item/skill/skill-03.png';
import skill04Url from '../../assets/hud/item/skill/skill-04.png';
import skill05Url from '../../assets/hud/item/skill/skill-05.png';
import skill06Url from '../../assets/hud/item/skill/skill-06.png';
import skill07Url from '../../assets/hud/item/skill/skill-07.png';
import skill08Url from '../../assets/hud/item/skill/skill-08.png';
import skill09Url from '../../assets/hud/item/skill/skill-09.png';
import skill10Url from '../../assets/hud/item/skill/skill-10.png';
import bootsUrl from '../../assets/hud/icon/boots.png';
import type { SkillId } from '../game/skills';
import { HUD_ICON_URLS } from './hudIcons';

/**
 * 一招一张图，全工程只有这一份。
 *
 * 以前是三份：快捷栏一份、三选一的牌一份、选人界面按**类别**给一张 HUD 小图标。结果同一招
 * 在三个地方长着三个样子 —— 突进在快捷栏上是 skill-01、在牌上是 skill-10，而在选人界面上
 * 它和横扫、破空共用一张"火"。玩家要记的不是招的名字就是招的样子，而那样他记住的东西到了
 * 下一个界面就不认得了。
 *
 * 谁是对的以牌为准：牌那一份本来就是十招十张、互不重样的，另外两处跟着它改。
 *
 * 少数几招还没有自己的图（磨刃、疾风），先借 HUD 上那套通用图标顶着；疾走用的是一双靴子，
 * 那是有意的 —— 它本来也不是一招，是走位。
 */
export const SKILL_ICONS: Record<SkillId, string> = {
  sweep: skill01Url,
  spin: skill09Url,
  wave: skill03Url,
  lunge: skill10Url,
  aegis: skill05Url,
  dharma: skill08Url,
  heavenSplit: skill02Url,
  skyArrow: skill04Url,
  ironBody: skill06Url,
  bulwark: skill07Url,
  sprint: bootsUrl,
  keenEdge: HUD_ICON_URLS.swords,
  swiftStrike: HUD_ICON_URLS.fire,
};

/** 一个 `<img>`，图是这一招的。三处界面共用，省得各自去拼 img 的那几个属性。 */
export function createSkillIcon(id: SkillId, className?: string): HTMLImageElement {
  const image = document.createElement('img');
  image.className = ['skill-icon', className].filter(Boolean).join(' ');
  image.src = SKILL_ICONS[id];
  image.alt = '';
  image.draggable = false;
  return image;
}
