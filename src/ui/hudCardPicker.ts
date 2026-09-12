import { SkillCategoryRules, skillById, type SkillId } from '../game/skills';
import type { StatBonus } from '../data/types';
import { HUD_ICON_URLS } from './hudIcons';
import { SKILL_ICONS } from './skillIcons';
import { HudFrame } from './hudFrame';
import { currentItems } from './currentItems';
import type { ItemStripEntry } from './itemStrip';
import './hudCardPicker.css';

/**
 * 一张牌的内容，外加选中它之后**真的发生什么**。
 *
 * 加上 bonus / skill 这两样之前，这块界面是纯摆设：抽三张、点掉，一个数都不改。现在属性牌
 * 给一份本局有效的加成（Battle.addRunBonus），技能牌解锁一个这个角色还没有的主动技 —— 后者
 * 是"主动技能要在游戏里获得"这条规则唯一的落地点，另一条路是以后的商店。
 */
export interface HudCardOffer {
  /** 属性牌是 'attack' 这类词，技能牌是技能 id。用来避免一次抽到两张一样的。 */
  key: string;
  icon: string;
  name: string;
  detail: string;
  /** 属性牌：这一局加什么。跨局不保留。 */
  bonus?: StatBonus;
  /** 技能牌：这一张说的是哪一招。 */
  skill?: SkillId;
  /** 技能牌是"获取"（这一局还没有它）还是"升一级"。 */
  obtain?: boolean;
}

/** 属性牌可能出现的幅度，百分比。 */
const STAT_STEPS = [8, 12, 15, 20];

interface StatCard {
  key: keyof StatBonus;
  icon: string;
  name: string;
  /** 拿到本次抽中的幅度，拼成说明文案。 */
  detail: (step: number) => string;
}

/**
 * 属性牌的货架。key 直接就是 UnitStats 上的字段名 —— 这样一张牌要加什么是**写出来**的，
 * 不需要在别处再维护一张"卡名到属性"的对照表。
 */
const STAT_CARDS: StatCard[] = [
  { key: 'attack', icon: HUD_ICON_URLS.swords, name: '攻击力', detail: (s) => `所有伤害 +${s}%` },
  { key: 'attackSpeed', icon: HUD_ICON_URLS.fire, name: '攻击频率', detail: (s) => `所有出手频率 +${s}%` },
  { key: 'attackRange', icon: HUD_ICON_URLS.bow, name: '攻击范围', detail: (s) => `所有判定范围 +${s}%` },
  { key: 'pickupRange', icon: HUD_ICON_URLS.gem, name: '拾取范围', detail: (s) => `灵石与金币吸附范围 +${s}%` },
  { key: 'defense', icon: HUD_ICON_URLS.shield, name: '防御', detail: (s) => `受到的伤害减少（防御 +${s}%）` },
  { key: 'moveSpeed', icon: HUD_ICON_URLS.boots, name: '移动速度', detail: (s) => `走和跑都 +${s}%` },
  { key: 'maxHp', icon: HUD_ICON_URLS.heart, name: '生命上限', detail: (s) => `生命上限 +${s}%` },
  { key: 'mpRegen', icon: HUD_ICON_URLS.potion, name: '法力回复', detail: (s) => `每秒回蓝 +${s}%` },
];

/** 一轮摆几张牌。 */
const CARD_COUNT = 3;

/**
 * 出场动画时长。取的是最长的那条 —— 选中卡牌浮上去的 hud-card-taken；没选的两张
 * 140ms 就退完了。和 hudCardPicker.css 里的时长是一对，改一处要改两处。
 */
const EXIT_MS = 200;

/**
 * 从候选里抽 n 张，**三张之间既不重样、也不撞图**。
 *
 * 光靠"从池子里取走"是不够的：那只保证不抽到同一条记录，而不同的记录仍然可能共用一张图。
 * 玩家读牌先看图 —— 两张一样的图摆在一起，第一反应是"这一轮出重复了"，哪怕名字不同。所以
 * 这里额外按 icon 去一遍重。
 *
 * 去重之后可能凑不满三张（牌库快抽空的时候）。那就有多少给多少：少一张牌比摆一张重复的强。
 */
function pick(pool: HudCardOffer[], n: number): HudCardOffer[] {
  const rest = pool.slice();
  const out: HudCardOffer[] = [];
  const icons = new Set<string>();
  while (out.length < n && rest.length > 0) {
    const [offer] = rest.splice(Math.floor(Math.random() * rest.length), 1);
    if (icons.has(offer.icon)) continue;
    icons.add(offer.icon);
    out.push(offer);
  }
  return out;
}

/**
 * 灵石收满后弹出的三选一卡牌。
 *
 * **这一版只有界面**：抽牌、显示、点掉，选中不改任何数值。弹出期间世界是停住的
 * （main.ts 的 ticker 跳过 update），先把版式和信息量摆出来看效果，接玩法是下一步。
 */
/**
 * 这块界面要问外面一件事、告诉外面两件事：还能解锁哪些技能，以及玩家选了属性牌还是技能牌。
 *
 * 做成回调而不是让它直接拿着 Battle：这是一块 DOM，它不该认识战斗引擎，HUD 的其余部分也
 * 都不认识。
 */
export interface HudCardHooks {
  /**
   * 这一局还没拿到的招：主动技、发射技、这个角色的护身技。
   *
   * 一局是从"一个自动攻击技 + R 上的疾走"开始的，别的全在这张单子上。
   */
  obtainableSkills(): SkillId[];
  /** 这一局还能升级的技能：已经拿到了、而且没满级。 */
  upgradableSkills(): { id: SkillId; level: number; max: number }[];
  /** 玩家选了一张属性牌。 */
  onStatCard(bonus: StatBonus): void;
  /** 玩家选了一张"获取"牌。 */
  onObtainSkill(skill: SkillId): void;
  /** 玩家选了一张"升级"牌。 */
  onUpgradeSkill(skill: SkillId): void;
  /**
   * 手上有哪些药和符。摆在牌底下，图在上、字在下，排法和战场上的快捷栏一致。
   *
   * 为什么摆在这儿：抽牌是一局里**世界停住**的两个时刻之一（另一个是结算），而快捷栏上那几格
   * 只有图和数字，说不出按下去会发生什么。玩家正要决定"这一轮拿什么"，那他手上已经有什么就
   * 是这个决定的一半。
   */
  heldItems(): ItemStripEntry[];
}

export class HudCardPicker {
  readonly root = document.createElement('div');

  private hooks: HudCardHooks | null = null;

  private readonly frame = new HudFrame({ skin: 'frame1', className: 'hud-card-panel' });
  private readonly row = document.createElement('div');
  /** 牌底下那一行"我现在有什么"。 */
  private readonly cards: HTMLButtonElement[] = [];
  private offers: HudCardOffer[] = [];
  /** 出场动画跑完才真正藏起来；这期间不再接受选择。 */
  private closing = 0;

  /** 接上结算。不接也能弹、能点，只是不产生效果 —— 离线预览图就是这么用的。 */
  connect(hooks: HudCardHooks): void {
    this.hooks = hooks;
  }

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
    // 和结算那块共用同一个节点，所以两处的位置天然重合（见 currentItems.ts）。
    currentItems.show('cards', this.hooks?.heldItems() ?? []);
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
    currentItems.hide('cards');
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
    const offer = this.offers[index];
    if (offer.bonus) this.hooks?.onStatCard(offer.bonus);
    else if (offer.skill && offer.obtain) this.hooks?.onObtainSkill(offer.skill);
    else if (offer.skill) this.hooks?.onUpgradeSkill(offer.skill);
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
      currentItems.hide('cards');
    }, EXIT_MS) as unknown as number;
    return true;
  }

  private cancelClose(): void {
    if (!this.closing) return;
    clearTimeout(this.closing);
    this.closing = 0;
  }

  /**
   * 抽三张。
   *
   * 技能牌只出这个角色**还没拿到**的主动技 —— 抽到一张自己早就在用的招是最扫兴的一种结果，
   * 而且它和"技能要在游戏里获得"这件事直接矛盾。全拿到之后就只剩属性牌。
   */
  private roll(): HudCardOffer[] {
    const stats: HudCardOffer[] = STAT_CARDS.map((c) => {
      const step = STAT_STEPS[Math.floor(Math.random() * STAT_STEPS.length)];
      return {
        key: c.key,
        icon: c.icon,
        name: c.name,
        detail: c.detail(step),
        bonus: { [c.key]: step / 100 } as StatBonus,
      };
    });
    // 获取：这一局还没拿到的招。牌面上写清它是哪一类，那决定它会占哪一格。
    const obtain: HudCardOffer[] = (this.hooks?.obtainableSkills() ?? []).map((id) => {
      const skill = skillById(id);
      return {
        key: `get:${id}`,
        icon: SKILL_ICONS[id],
        name: skill.name,
        detail: `${skill.note}\n获得【${SkillCategoryRules[skill.category].name}】`,
        skill: id,
        obtain: true,
      };
    });
    // 升级：已经在用、还没满级的招。牌面上写清现在几级、升到几级。
    const upgrade: HudCardOffer[] = (this.hooks?.upgradableSkills() ?? []).map((entry) => {
      const skill = skillById(entry.id);
      return {
        key: `up:${entry.id}`,
        icon: SKILL_ICONS[entry.id],
        name: skill.name,
        detail: `${skill.note}\n${entry.level} 级 → ${entry.level + 1} 级（范围 +10%，耗蓝 -8%）`,
        skill: entry.id,
      };
    });
    return pick([...stats, ...obtain, ...upgrade], CARD_COUNT);
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
