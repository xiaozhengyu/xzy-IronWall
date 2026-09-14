import './shop.css';
import { createHudIcon, HUD_ICON_URLS } from './hudIcons';
import { createSkillIcon } from './skillIcons';
import { pickupById } from '../data/pickups';
import { pickupIcon } from '../items/pickupIcons';
import { skillById, type SkillId } from '../game/skills';
import {
  MASTERY_MAX, ROOT_MAX_RANK, Roots, SUPPLY_MAX, Supplies,
  masterySkills, masteryPrice, rootPrice, startLevelOf,
} from '../data/shop';

/**
 * 商店。三个货架，三种花钱的形状（见 data/shop.ts 顶上那段）。
 *
 * 为什么三档摆在同一屏而不是三个标签页：它们是**互相竞争**的。玩家手里的钱只有一笔，这一局
 * 打完的六百枚是买一张狂暴符、还是攒着凑根基的第一级，这个取舍才是商店真正在问的问题。分成
 * 三页之后每一页各自看起来都很便宜，而那个取舍就看不见了。
 *
 * 图标全部借现有的那几张（技能图、HUD 小图标）——先让它跑起来，之后统一换。
 */

export interface ShopView {
  coins: number;
  root(key: string): number;
  mastery(id: string): number;
  supply(id: string): number;
}

export interface ShopHooks {
  view(): ShopView;
  buyRoot(key: string, price: number): boolean;
  buyMastery(id: SkillId, price: number): boolean;
  buySupply(id: string, price: number): boolean;
  onClose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 六项根基各用一张图。
 *
 * 取的是三选一属性牌已经在用的那几张（见 hudCardPicker 的 STAT_CARDS）—— 剑是攻击、
 * 盾是防御、靴是速度。同一项属性在两处长同一个样子，玩家不用记两遍。
 */
const ROOT_ICONS: Record<string, string> = {
  maxHp: HUD_ICON_URLS.heart,
  attack: HUD_ICON_URLS.swords,
  defense: HUD_ICON_URLS.shield,
  moveSpeed: HUD_ICON_URLS.boots,
  attackSpeed: HUD_ICON_URLS.fire,
  attackRange: HUD_ICON_URLS.bow,
};

/** 一排小方块，买到第几级就点亮几个。比写"2 / 3"好读：级数是可以一眼数出来的。 */
function pips(owned: number, max: number): HTMLElement {
  const row = el('span', 'shop-pips');
  for (let i = 0; i < max; i++) {
    row.appendChild(el('i', `shop-pip${i < owned ? ' on' : ''}`));
  }
  return row;
}

export class ShopScreen {
  readonly root = el('div', 'shop');

  private readonly hooks: ShopHooks;
  private readonly purse = el('span', 'shop-purse');
  private readonly body = el('div', 'shop-body');

  constructor(hooks: ShopHooks) {
    this.hooks = hooks;
    this.build();
    document.body.appendChild(this.root);
    this.root.hidden = true;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.root.dataset.phase = '';
    void this.root.offsetWidth;
    this.root.dataset.phase = 'in';
    this.refresh();
  }

  hide(): void {
    this.root.hidden = true;
    this.root.dataset.phase = '';
  }

  private refresh(): void {
    const view = this.hooks.view();
    this.purse.textContent = String(view.coins);
    this.body.replaceChildren();

    // ---- 根基
    this.body.appendChild(this.shelf('根基', '永久属性，所有角色共享'));
    // 根基恰好六项，排成三列是两行整的；四列的话第二行会空出两格。
    const roots = el('div', 'shop-grid shop-grid--three');
    for (const def of Roots) {
      const owned = view.root(def.key);
      const price = rootPrice(def, owned);
      roots.appendChild(this.card({
        icon: ROOT_ICONS[def.key],
        name: def.name,
        note: owned > 0 ? `已 +${Math.round(def.perRank * owned * 100)}%` : `每级 +${Math.round(def.perRank * 100)}%`,
        owned,
        max: ROOT_MAX_RANK,
        price,
        coins: view.coins,
        buy: () => this.hooks.buyRoot(def.key, price ?? 0),
      }));
    }
    this.body.appendChild(roots);

    // ---- 师承
    this.body.appendChild(this.shelf('师承', '这一招到手时就已经是这一级'));
    const mastery = el('div', 'shop-grid');
    for (const id of masterySkills()) {
      const owned = view.mastery(id);
      const price = masteryPrice(owned);
      const skill = skillById(id);
      mastery.appendChild(this.card({
        iconNode: createSkillIcon(id, 'shop-icon'),
        name: skill.name,
        note: `起始 ${startLevelOf(owned)} 级`,
        owned,
        max: MASTERY_MAX,
        price,
        coins: view.coins,
        buy: () => this.hooks.buyMastery(id, price ?? 0),
      }));
    }
    this.body.appendChild(mastery);

    // ---- 补给
    this.body.appendChild(this.shelf('补给', '游戏里打不出来，买一次用一局，进图发到快捷栏'));
    const supplies = el('div', 'shop-grid');
    for (const def of Supplies) {
      const item = pickupById(def.id);
      if (!item) continue;
      const owned = view.supply(def.id);
      supplies.appendChild(this.card({
        icon: pickupIcon(def.id),
        name: item.name,
        note: item.note,
        owned,
        max: SUPPLY_MAX,
        price: owned >= SUPPLY_MAX ? null : def.price,
        coins: view.coins,
        // 补给是可以反复买的，所以格子上写"屯了几个"，不是"买到第几级"。
        stack: true,
        buy: () => this.hooks.buySupply(def.id, def.price),
      }));
    }
    this.body.appendChild(supplies);
  }

  private shelf(name: string, note: string): HTMLElement {
    const head = el('div', 'shop-shelf');
    head.appendChild(el('span', 'shop-shelf-k', name));
    head.appendChild(el('span', 'shop-shelf-v', note));
    return head;
  }

  private card(spec: {
    icon?: string;
    iconNode?: HTMLElement;
    name: string;
    note: string;
    owned: number;
    max: number;
    price: number | null;
    coins: number;
    stack?: boolean;
    buy(): boolean;
  }): HTMLElement {
    const full = spec.price === null;
    const afford = !full && spec.coins >= (spec.price ?? 0);
    const card = el('button', `shop-card${full ? ' shop-card--full' : ''}${afford || full ? '' : ' shop-card--poor'}`);
    card.type = 'button';
    // 买不起的也留着能点：点一下什么都不发生，但"这一格是什么"照样看得见。禁用掉的按钮在
    // 一排货架里读起来像是坏了。
    card.disabled = full;

    const top = el('div', 'shop-card-top');
    top.appendChild(spec.iconNode ?? createHudIcon('shield', 'shop-icon'));
    if (spec.icon && !spec.iconNode) {
      const img = top.firstElementChild as HTMLImageElement;
      img.src = spec.icon;
    }
    const text = el('div', 'shop-card-text');
    text.appendChild(el('span', 'shop-card-name', spec.name));
    text.appendChild(el('span', 'shop-card-note', spec.note));
    top.appendChild(text);
    card.appendChild(top);

    const foot = el('div', 'shop-card-foot');
    foot.appendChild(spec.stack
      ? el('span', 'shop-owned', `屯 ${spec.owned} / ${spec.max}`)
      : pips(spec.owned, spec.max));
    const price = el('span', 'shop-price');
    if (full) {
      price.textContent = spec.stack ? '已屯满' : '已满级';
    } else {
      price.appendChild(createHudIcon('coin', 'shop-coin'));
      price.appendChild(el('span', undefined, String(spec.price)));
    }
    foot.appendChild(price);
    card.appendChild(foot);

    card.addEventListener('click', () => {
      if (full || !afford) return;
      if (spec.buy()) this.refresh();
    });
    return card;
  }

  private build(): void {
    const card = el('div', 'shop-card-frame');
    this.root.appendChild(card);

    const head = el('div', 'shop-top');
    head.appendChild(el('span', 'shop-title', '商店'));
    const right = el('div', 'shop-top-right');
    right.appendChild(createHudIcon('coin', 'shop-coin'));
    right.appendChild(this.purse);
    const close = el('button', 'shop-close', '返回');
    close.type = 'button';
    close.addEventListener('click', () => this.hooks.onClose());
    right.appendChild(close);
    head.appendChild(right);
    card.appendChild(head);
    card.appendChild(el('div', 'shop-rule'));
    card.appendChild(this.body);
  }
}
