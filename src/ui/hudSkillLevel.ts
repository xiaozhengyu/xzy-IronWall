import skillLevelActiveUrl from '../../assets/hud/icon/diamond-complete.png';
import skillLevelInactiveUrl from '../../assets/hud/icon/diamond-empty.png';
import './hudSkillLevel.css';

/**
 * 技能等级那一排菱形。
 *
 * **两个参数都没有默认值**，必须由调用方给。它们原来的默认是一对预览值（3 级 / 满 5 级），
 * 那是没接数据时摆着好看的，而"摆着好看的数"一旦当了默认值，接上真数据之后只要有一个调用点
 * 忘了传，屏幕上就会多出一个永远停在 3 级的技能，而且看不出来是假的。
 */
export function createHudSkillLevel(
  level: number,
  maximum: number,
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
