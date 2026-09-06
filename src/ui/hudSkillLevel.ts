import skillLevelActiveUrl from '../../assets/hud/icon/diamond-complete.png';
import skillLevelInactiveUrl from '../../assets/hud/icon/diamond-empty.png';
import './hudSkillLevel.css';

export const HUD_SKILL_LEVEL_PREVIEW = {
  level: 3,
  maximum: 5,
};

/** 技能等级的纯展示组件；当前使用预览值，后续接入数据时直接更新 level 即可。 */
export function createHudSkillLevel(
  level = HUD_SKILL_LEVEL_PREVIEW.level,
  maximum = HUD_SKILL_LEVEL_PREVIEW.maximum,
  className = '',
): HTMLElement {
  const root = document.createElement('span');
  root.className = ['hud-skill-levels', className].filter(Boolean).join(' ');
  root.setAttribute('aria-hidden', 'true');

  const safeMaximum = Math.max(1, Math.floor(maximum));
  const safeLevel = Math.max(0, Math.min(safeMaximum, Math.floor(level)));
  for (let index = 0; index < safeMaximum; index++) {
    const marker = document.createElement('img');
    marker.className = 'hud-skill-level-marker';
    marker.src = index < safeLevel ? skillLevelActiveUrl : skillLevelInactiveUrl;
    marker.alt = '';
    marker.draggable = false;
    root.appendChild(marker);
  }
  return root;
}
