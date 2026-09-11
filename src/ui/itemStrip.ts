import { pickupIcon } from '../items/pickupIcons';
import './itemStrip.css';

/**
 * 手上那几件药和符，横着排一行：图在上、字在下。
 *
 * 两个地方用同一份：结算画面和灵石三选一那块幕布。两处要回答的是同一个问题 —— **我手上这几
 * 样是干什么的**。快捷栏上只有一张图和一个数字，说不出按下去会发生什么；而这两块是一局里仅有
 * 的两次"世界停住、玩家会读字"的时刻。
 *
 * 排法照抄快捷栏：横向、按格位顺序、图标在上。玩家在战场上记住的是"左起第二格是那个蓝色的
 * 药"，这里换成竖排或者换个顺序，他就得重新认一遍。信息写在图下面而不是旁边，也是为了让那
 * 一行图标和快捷栏在视觉上对得上。
 */

export interface ItemStripEntry {
  /** 掉落表里的 id，图按它取。 */
  id: string;
  name: string;
  note: string;
  count: number;
}

export function createItemStrip(className = ''): HTMLElement {
  const root = document.createElement('div');
  root.className = ['item-strip', className].filter(Boolean).join(' ');
  return root;
}

/**
 * 把一行重画成 entries。空的时候整块收起来 —— 留一个空标题只是在告诉玩家"这儿本来该有东西"，
 * 而一局开始时本来就一件都没有。
 *
 * @param title 上面那行小标题。不给就不画。
 */
export function fillItemStrip(root: HTMLElement, entries: readonly ItemStripEntry[], title?: string): void {
  root.replaceChildren();
  root.hidden = entries.length === 0;
  if (entries.length === 0) return;

  if (title) {
    const head = document.createElement('div');
    head.className = 'item-strip-k';
    head.textContent = title;
    root.appendChild(head);
  }

  const row = document.createElement('div');
  row.className = 'item-strip-row';
  for (const entry of entries) {
    const cell = document.createElement('div');
    cell.className = 'item-strip-cell';
    // 说明也挂在 title 上：一行字被截断时鼠标停一下仍然看得全。
    cell.title = `${entry.name} · ${entry.note}`;

    const frame = document.createElement('div');
    frame.className = 'item-strip-frame';
    const icon = document.createElement('img');
    icon.className = 'item-strip-icon';
    icon.src = pickupIcon(entry.id);
    icon.alt = '';
    icon.draggable = false;
    frame.appendChild(icon);
    const count = document.createElement('span');
    count.className = 'item-strip-count';
    count.textContent = `×${entry.count}`;
    frame.appendChild(count);
    cell.appendChild(frame);

    const name = document.createElement('span');
    name.className = 'item-strip-n';
    name.textContent = entry.name;
    cell.appendChild(name);

    const note = document.createElement('span');
    note.className = 'item-strip-note';
    note.textContent = entry.note;
    cell.appendChild(note);

    row.appendChild(cell);
  }
  root.appendChild(row);
}
