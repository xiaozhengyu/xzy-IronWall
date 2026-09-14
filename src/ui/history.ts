import './history.css';
import type { HeroRecord } from '../game/profile';

/**
 * 战绩：每个角色最近一场，以及这个角色的全部累计。
 *
 * 为什么按角色分而不是一张总表：玩家在选人界面上问的是**"我拿这个人打得怎么样"**。一张
 * 混在一起的总表回答不了它 —— 用双锤打出来的胜率和用骑士打出来的胜率混成一个数之后，那个数
 * 就不说明任何事了。所以这一屏的结构和选人界面本身是同一个：左边挑人，右边看那个人。
 *
 * 只存总数和最近一局，不存每一局（见 profile.ts 的 HeroRecord）。一份存档要活很久，按局
 * 追加的话它会一直长，而"我第七局打得怎么样"没有人会问。
 */

export interface HistoryHero {
  id: string;
  name: string;
  record: HeroRecord;
}

export interface HistoryHooks {
  heroes(): HistoryHero[];
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

/** 秒数写成 mm:ss；超过一小时才写 h:mm:ss —— 累计时长很容易上小时。 */
function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 写成"几分钟前"这种。
 *
 * 不写绝对时间：玩家关心的是"这是刚才那一局还是上礼拜的"，而一个 2026-09-14 20:31 要他自己
 * 去和今天比一遍。超过一周才退回日期 —— 那时候"七天前"已经不比日期更好读了。
 */
function ago(at: number): string {
  const delta = Date.now() - at;
  if (!Number.isFinite(delta) || delta < 0) return '';
  const min = Math.floor(delta / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(at).toLocaleDateString();
}

export class HistoryScreen {
  readonly root = el('div', 'history');

  private readonly hooks: HistoryHooks;
  private readonly heroList = el('div', 'history-list');
  private readonly body = el('div', 'history-body');
  private heroIndex = 0;

  constructor(hooks: HistoryHooks) {
    this.hooks = hooks;
    this.build();
    document.body.appendChild(this.root);
    this.root.hidden = true;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(heroId?: string): void {
    const heroes = this.hooks.heroes();
    const at = heroes.findIndex((h) => h.id === heroId);
    this.heroIndex = at >= 0 ? at : 0;
    this.root.hidden = false;
    // 和结算、选人同一套：先清空再设回 'in'，不然值没变时入场动画不会重播。
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
    const heroes = this.hooks.heroes();
    this.heroList.replaceChildren();
    heroes.forEach((hero, index) => {
      const item = el('button', 'history-item');
      item.type = 'button';
      item.classList.toggle('on', index === this.heroIndex);
      item.appendChild(el('span', 'history-item-name', hero.name));
      // 列表上只写一件事：打了几局。别的都在右边，列表是用来挑人的，不是第二张表。
      item.appendChild(el('span', 'history-item-runs', hero.record.runs > 0 ? `${hero.record.runs} 局` : '未出战'));
      item.addEventListener('click', () => {
        this.heroIndex = index;
        this.refresh();
      });
      this.heroList.appendChild(item);
    });

    const hero = heroes[this.heroIndex];
    this.body.replaceChildren();
    if (!hero) return;
    const r = hero.record;

    this.body.appendChild(el('div', 'history-who', hero.name));

    /*
     * 没打过的角色也把两块格子原样摆出来，只是里面写破折号。
     *
     * 先写成"没数据就只摆一句话"，换掉了：那样卡片的高度跟着选中的人变，左边一栏一点，
     * 整张表就跳一下 —— 而那一栏本来就是用来来回点的。两块都是九个格子正好三行，
     * 总是画出来之后高度就是一个定数，不用去猜一个 min-height。
     */
    const played = r.runs > 0;
    const num = (value: number) => (played ? `${value}` : '—');

    const cell = (parent: HTMLElement, key: string, value: string, wide = false) => {
      const box = el('div', `history-cell${wide ? ' history-cell--wide' : ''}`);
      box.appendChild(el('span', 'history-k', key));
      box.appendChild(el('span', `history-v${played ? '' : ' history-v--none'}`, value));
      parent.appendChild(box);
    };

    // ---- 累计
    this.body.appendChild(el('div', 'history-head', '累计'));
    const total = el('div', 'history-grid');
    // 胜率摆第一个、占两格：这一屏所有的数里只有它是一个**评价**，别的都是计数。
    // 它自己带着"几胜几局"，所以不再单开一格写战斗次数 —— 九个格子正好三行。
    cell(total, '胜率',
      played ? `${Math.round((r.wins / r.runs) * 100)}%（${r.wins} 胜 / ${r.runs} 局）` : '—', true);
    cell(total, '总击杀', num(r.kills));
    cell(total, '斩首领', num(r.bosses));
    cell(total, '承受伤害', num(r.damageTaken));
    cell(total, '总时长', played ? clock(r.time) : '—');
    cell(total, '最远波次', num(r.bestWave));
    cell(total, '金币', num(r.coins));
    cell(total, '灵石', num(r.gems));
    this.body.appendChild(total);

    // ---- 最近一场
    const last = r.last;
    const head = el('div', 'history-head');
    head.appendChild(el('span', undefined, '最近一场'));
    head.appendChild(el('span', 'history-when',
      last ? `${last.map} · ${ago(last.at)}` : '还没有用这个角色打过'));
    this.body.appendChild(head);

    const one = el('div', 'history-grid');
    const verdict = el('div',
      `history-cell history-cell--wide${last ? ` history-verdict--${last.won ? 'won' : 'lost'}` : ''}`);
    verdict.appendChild(el('span', 'history-k', '结果'));
    verdict.appendChild(el('span', `history-v${last ? '' : ' history-v--none'}`,
      last ? (last.won ? '通关' : '战败') : '—'));
    one.appendChild(verdict);
    cell(one, '击杀', last ? `${last.kills}` : '—');
    cell(one, '斩首领', last ? `${last.bosses}` : '—');
    cell(one, '承受伤害', last ? `${last.damageTaken}` : '—');
    cell(one, '用时', last ? clock(last.time) : '—');
    cell(one, '波次', last ? `${last.wave} / ${last.waves}` : '—');
    cell(one, '金币', last ? `${last.coins}` : '—');
    cell(one, '灵石', last ? `${last.gems}` : '—');
    this.body.appendChild(one);
  }

  private build(): void {
    const card = el('div', 'history-card');
    this.root.appendChild(card);

    const head = el('div', 'history-top');
    head.appendChild(el('span', 'history-title', '战绩'));
    const close = el('button', 'history-close', '返回');
    close.type = 'button';
    close.addEventListener('click', () => this.hooks.onClose());
    head.appendChild(close);
    card.appendChild(head);
    card.appendChild(el('div', 'history-rule'));

    const split = el('div', 'history-split');
    split.append(this.heroList, this.body);
    card.appendChild(split);
  }
}
