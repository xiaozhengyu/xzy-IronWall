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
import { Skills, type SkillId } from '../game/skills';
import { HudFrame } from './hudFrame';
import './hudCardPicker.css';

/** 一张牌的内容。这一版只用来显示，选中不产生任何效果。 */
export interface HudCardOffer {
  /** 属性牌是 'attack' 这类词，技能牌是技能 id。用来避免一次抽到两张一样的。 */
  key: string;
  icon: string;
  name: string;
  detail: string;
}

/** 属性牌可能出现的幅度。数值是占位的，等接玩法时再谈平衡。 */
const STAT_STEPS = [8, 12, 15, 20];

interface StatCard {
  key: string;
  icon: string;
  name: string;
  /** 拿到本次抽中的幅度，拼成说明文案。 */
  detail: (step: number) => string;
}

const STAT_CARDS: StatCard[] = [
  { key: 'attack', icon: skill02Url, name: '攻击力', detail: (s) => `攻击力 +${s}%` },
  { key: 'attackSpeed', icon: skill04Url, name: '攻击速度', detail: (s) => `出手间隔 -${s}%` },
  { key: 'attackRange', icon: skill06Url, name: '攻击范围', detail: (s) => `攻击判定范围 +${s}%` },
  { key: 'pickupRange', icon: skill07Url, name: '拾取范围', detail: (s) => `灵石与金币吸附范围 +${s}%` },
];

/**
 * 技能牌用哪张图。技能自己没带图标字段，冷却面板也是在自己那边硬配的一张表；
 * 这里保持一致，等技能表补上 icon 字段再合并成一处。
 */
const SKILL_ICONS: Record<SkillId, string> = {
  sweep: skill01Url,
  spin: skill09Url,
  wave: skill03Url,
  lunge: skill10Url,
  aegis: skill05Url,
  dharma: skill08Url,
  heavenSplit: skill05Url,
  skyArrow: skill08Url,
  ironBody: skill06Url,
};

const CARD_COUNT = 3;

/**
 * 出场动画时长。取的是最长的那条 —— 选中卡牌浮上去的 hud-card-taken；没选的两张
 * 140ms 就退完了。和 hudCardPicker.css 里的时长是一对，改一处要改两处。
 */
const EXIT_MS = 200;

/** 从候选里不重复地抽 n 张。候选不够就有多少给多少。 */
function pick<T>(pool: T[], n: number): T[] {
  const rest = pool.slice();
  const out: T[] = [];
  while (out.length < n && rest.length > 0) {
    out.push(...rest.splice(Math.floor(Math.random() * rest.length), 1));
  }
  return out;
}

/**
 * 灵石收满后弹出的三选一卡牌。
 *
 * **这一版只有界面**：抽牌、显示、点掉，选中不改任何数值。弹出期间世界是停住的
 * （main.ts 的 ticker 跳过 update），先把版式和信息量摆出来看效果，接玩法是下一步。
 */
export class HudCardPicker {
  readonly root = document.createElement('div');

  private readonly frame = new HudFrame({ skin: 'frame1', className: 'hud-card-panel' });
  private readonly row = document.createElement('div');
  private readonly cards: HTMLButtonElement[] = [];
  private offers: HudCardOffer[] = [];
  /** 出场动画跑完才真正藏起来；这期间不再接受选择。 */
  private closing = 0;

  constructor() {
    this.root.className = 'hud-card-picker';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', '升级卡牌');

    this.row.className = 'hud-card-row';
    for (let i = 0; i < CARD_COUNT; i++) {
      const card = this.createCard(i);
      this.cards.push(card);
      this.row.appendChild(card);
    }

    this.frame.content.appendChild(this.row);
    this.root.appendChild(this.frame.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** 抽三张并弹出。已经开着就不再抽，免得后一次收满把玩家正在看的牌换掉。 */
  show(): void {
    if (this.open) return;
    this.cancelClose();
    this.offers = this.roll();
    for (let i = 0; i < this.cards.length; i++) this.fill(this.cards[i], this.offers[i]);
    this.root.hidden = false;
    // 先清空再设回 'in'：菜单里直接关掉时不会经过 'out'，值没变的话入场动画不会重播。
    // 中间那下读 offsetWidth 是为了逼浏览器把清空这一步结算掉。
    this.root.dataset.phase = '';
    void this.root.offsetWidth;
    this.root.dataset.phase = 'in';
  }

  /** 立刻收起，不走动画。菜单里关掉开关走这条。 */
  hide(): void {
    this.cancelClose();
    this.blurCards();
    this.root.hidden = true;
    this.root.dataset.phase = '';
  }

  /**
   * 点过的那张牌会一直带着焦点，:focus-visible 的高亮就赖在上面不走 —— 鼠标明明已经
   * 移开了，牌看起来还是选中的。收场时把焦点交还给 body。
   */
  private blurCards(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
  }

  /**
   * 数字键选牌，从左到右对应 1/2/3。牌面上不画编号（画了反而像在标稀有度），
   * 但键还是留着——鼠标已经在画面中间了，顺手按个数字比挪过去点更快。
   *
   * 返回是否吃掉了这一下按键，调用方据此决定要不要继续走原来的逻辑。
   */
  choose(index: number): boolean {
    if (!this.open || this.closing || index < 0 || index >= this.offers.length) return false;
    // 这一版没有效果可以结算，选中就只剩下收场。选中那张单独标一下，出场时的动作和
    // 另外两张不一样。
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i].classList.toggle('hud-card--taken', i === index);
    }
    this.root.dataset.phase = 'out';
    // 动画跑完再藏。open 在这期间仍然是 true，所以世界会多停这 200ms —— 正好让牌浮出去。
    this.closing = setTimeout(() => {
      this.closing = 0;
      this.blurCards();
      this.root.hidden = true;
      this.root.dataset.phase = '';
    }, EXIT_MS) as unknown as number;
    return true;
  }

  private cancelClose(): void {
    if (!this.closing) return;
    clearTimeout(this.closing);
    this.closing = 0;
  }

  private roll(): HudCardOffer[] {
    const stats: HudCardOffer[] = STAT_CARDS.map((c) => {
      const step = STAT_STEPS[Math.floor(Math.random() * STAT_STEPS.length)];
      return { key: c.key, icon: c.icon, name: c.name, detail: c.detail(step) };
    });
    const skills: HudCardOffer[] = Skills.map((s) => ({
      key: s.id,
      icon: SKILL_ICONS[s.id],
      name: s.name,
      detail: `${s.note}\n等级 +1`,
    }));
    return pick([...stats, ...skills], CARD_COUNT);
  }

  private createCard(index: number): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'hud-card';

    const icon = document.createElement('img');
    icon.className = 'hud-card-icon';
    icon.alt = '';
    icon.draggable = false;
    const name = document.createElement('span');
    name.className = 'hud-text hud-text--pixel hud-card-name';
    const detail = document.createElement('span');
    detail.className = 'hud-text hud-text--pixel hud-card-detail';

    card.append(icon, name, detail);
    card.addEventListener('click', () => this.choose(index));
    return card;
  }

  private fill(card: HTMLButtonElement, offer: HudCardOffer | undefined): void {
    card.hidden = !offer;
    if (!offer) return;
    (card.querySelector('.hud-card-icon') as HTMLImageElement).src = offer.icon;
    (card.querySelector('.hud-card-name') as HTMLElement).textContent = offer.name;
    // 说明里的换行是内容自己带的（技能牌是"招式说明 + 等级 +1"两行）。
    const detail = card.querySelector('.hud-card-detail') as HTMLElement;
    detail.textContent = '';
    offer.detail.split('\n').forEach((line, i) => {
      if (i > 0) detail.appendChild(document.createElement('br'));
      detail.appendChild(document.createTextNode(line));
    });
    card.setAttribute('aria-label', `${offer.name}：${offer.detail.replace('\n', '，')}`);
  }
}
