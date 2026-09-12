import { createItemStrip, fillItemStrip, type ItemStripEntry } from './itemStrip';
import './currentItems.css';

/**
 * 手上这几样药和符，**全工程只有这一条**。
 *
 * 结算画面和灵石三选一都调它，而它们拿到的是同一个 DOM 节点、同一个位置、同一份文案。玩家
 * 在两块界面之间切的时候，那一排东西一像素都不动 —— 这不是靠两边把数调准的，是因为它本来
 * 就没有第二份。
 *
 * 标题固定叫「当前物品」。原来两边各叫「药物与符咒」和「手上的药与符」，说的是同一件事却
 * 用了两个名字，玩家得读两遍才确认这是同一排东西。
 */
const TITLE = '当前物品';

/** 谁把它叫出来的。 */
export type CurrentItemsOwner = 'summary' | 'cards';

class CurrentItems {
  private readonly root = createItemStrip('current-items item-strip--center');
  private mounted = false;
  /**
   * 正要看它的有几家。
   *
   * 两块界面可以叠着：三选一开着的时候按 ESC 仍然能弹出临时结算。不记账的话，先关掉的
   * 那一家会把还开着的那一家的那排药一并收走。
   */
  private readonly owners = new Set<CurrentItemsOwner>();

  /** 摆出来。一件都没有时整条收起来，并把让位的那条带子收成 0。 */
  show(owner: CurrentItemsOwner, entries: readonly ItemStripEntry[]): void {
    if (!this.mounted) {
      document.body.appendChild(this.root);
      this.mounted = true;
    }
    this.owners.add(owner);
    fillItemStrip(this.root, entries, TITLE);
    this.syncBand();
  }

  hide(owner: CurrentItemsOwner): void {
    this.owners.delete(owner);
    if (this.owners.size > 0) return;
    this.root.hidden = true;
    this.syncBand();
  }

  /** 让位那条带子跟着开合。见 currentItems.css 的 --current-items-band。 */
  private syncBand(): void {
    document.documentElement.classList.toggle('has-current-items', !this.root.hidden);
  }
}

export const currentItems = new CurrentItems();
