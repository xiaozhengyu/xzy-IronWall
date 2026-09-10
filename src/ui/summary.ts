import './summary.css';
import { createHudIcon } from './hudIcons';
import { HudText } from './text/hudText';

/**
 * 结算画面。一块面板，两种用法：
 *
 *   interlude —— 局中按 ESC 弹出来的**临时结算**：这一局到目前为止收了多少、杀了多少、
 *                打到第几波。两个出口：继续游戏，或者结束这一局。
 *   result    —— 这一局真的结束了（主动结束或者被打倒）。同一份数据，出口只剩一个：
 *                确认，回到选人画面。
 *
 * 做成一块而不是两块，理由和 Menu 把加载条和暂停合在一起是同一条：两者要显示的东西
 * 一模一样，差别只在标题和底下那排按钮。拆开会得到两份一样的布局，改一处就得改两遍。
 *
 * 和暂停面板的分工：那一块是**调试菜单**（帧率、图元、波次跳转、天气开关），只由 HUD 上的
 * 系统按钮打开；这一块是**玩家看的流程页**，由 ESC 和游戏结束打开。两者都会把世界冻住，
 * 但它们回答的不是同一个问题。
 */

export type SummaryMode = 'interlude' | 'result';

/** 这一局到目前为止的战果。全部由 main 从 Battle 上读一份交过来。 */
export interface SummaryStats {
  hero: string;
  map: string;
  /** 这一局跑了多少秒。 */
  time: number;
  coins: number;
  gems: number;
  kills: number;
  deaths: number;
  wave: number;
  waves: number;
  /** 已经打完的波数。 */
  cleared: number;
  /** 结束的原因是玩家被打倒，而不是自己按的"结束游戏"。 */
  defeated: boolean;
}

export interface SummaryHooks {
  /** 继续游戏（只有临时结算有）。 */
  onResume(): void;
  /** 结束这一局，转到最终结算（只有临时结算有）。 */
  onEnd(): void;
  /** 确认，回到选人画面（只有最终结算有）。 */
  onConfirm(): void;
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

/** 秒数写成 mm:ss。一局最长二十来分钟，不需要小时位。 */
function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export class SummaryScreen {
  readonly root = el('div', 'summary');
  readonly text: HudText;

  private readonly hooks: SummaryHooks;
  private readonly mode = el('span', 'summary-mode');
  private readonly lead = el('div', 'summary-lead');
  private readonly coins = el('span', 'summary-loot-v', '0');
  private readonly gems = el('span', 'summary-loot-v', '0');
  private readonly stats: Record<string, HTMLElement> = {};
  private readonly note = el('div', 'summary-note');
  private readonly actions = el('div', 'summary-actions');
  private readonly resumeButton = el('button', 'summary-btn main', '继续游戏');
  private readonly endButton = el('button', 'summary-btn', '结束游戏');
  private readonly confirmButton = el('button', 'summary-btn main', '确认');

  constructor(hooks: SummaryHooks, text: HudText = new HudText()) {
    this.hooks = hooks;
    this.text = text;
    this.build();
    document.body.appendChild(this.root);
    this.root.hidden = true;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(mode: SummaryMode, stats: SummaryStats): void {
    this.root.hidden = false;

    const final = mode === 'result';
    this.mode.textContent = final ? (stats.defeated ? '你被击倒了' : '本局结束') : '游戏暂停';
    this.lead.textContent = `${stats.hero} · ${stats.map}`;

    this.coins.textContent = String(stats.coins);
    this.gems.textContent = String(stats.gems);
    this.stats.kills.textContent = String(stats.kills);
    this.stats.deaths.textContent = String(stats.deaths);
    this.stats.time.textContent = clock(stats.time);
    this.stats.wave.textContent = `${stats.wave} / ${stats.waves}`;
    this.stats.cleared.textContent = `${stats.cleared} 波`;
    // 一局的"得分"还没有正经公式，所以照实写成它的来源：击杀加收集。摆一个凭空算出来的
    // 分数比不摆更糟 —— 玩家会去猜它怎么来的，而它并不来自任何地方。
    this.stats.loot.textContent = String(stats.coins + stats.gems);

    this.note.textContent = final
      ? stats.defeated
        ? '这一局到此为止。确认之后回到选人画面，可以换个角色或者换张地图再来。'
        : '这一局由你主动结束。确认之后回到选人画面。'
      : '继续游戏会回到刚才那一刻，场上的人和捡到的东西都还在。';

    this.actions.replaceChildren();
    if (final) {
      this.actions.appendChild(this.confirmButton);
      this.confirmButton.focus();
    } else {
      this.actions.appendChild(this.resumeButton);
      this.actions.appendChild(this.endButton);
      this.resumeButton.focus();
    }
  }

  hide(): void {
    this.root.hidden = true;
  }

  private build(): void {
    const card = el('div', 'summary-card');
    this.root.appendChild(card);

    const head = el('div', 'summary-head');
    const title = el('span', 'summary-title');
    this.text.bindText(title, 'gameTitle');
    head.appendChild(title);
    head.appendChild(this.mode);
    card.appendChild(head);
    card.appendChild(el('div', 'summary-rule'));

    card.appendChild(this.lead);

    // ---- 收集物：这一屏的主角
    const loot = el('div', 'summary-loot');
    loot.appendChild(this.lootItem('coin', '金币', this.coins));
    loot.appendChild(this.lootItem('gem', '灵石', this.gems));
    card.appendChild(loot);

    // ---- 其余战况
    const stats = el('div', 'summary-stats');
    this.stats.kills = this.stat(stats, '击杀');
    this.stats.deaths = this.stat(stats, '阵亡');
    this.stats.time = this.stat(stats, '用时');
    this.stats.wave = this.stat(stats, '波次');
    this.stats.cleared = this.stat(stats, '已清');
    this.stats.loot = this.stat(stats, '收集物');
    card.appendChild(stats);

    card.appendChild(this.note);

    this.resumeButton.addEventListener('click', () => this.hooks.onResume());
    this.endButton.addEventListener('click', () => this.hooks.onEnd());
    this.confirmButton.addEventListener('click', () => this.hooks.onConfirm());
    card.appendChild(this.actions);
  }

  private lootItem(icon: 'coin' | 'gem', label: string, value: HTMLElement): HTMLElement {
    const box = el('div', 'summary-loot-item');
    // 灵石原图是紫色，战斗 HUD 通过 hud-icon--gem 统一调成青蓝；结算页沿用同一修饰类，
    // 避免同一种收集物在两个界面里像两件不同的东西。
    box.appendChild(createHudIcon(icon, `summary-loot-icon hud-icon--${icon}`));
    const text = el('div', 'summary-loot-text');
    text.appendChild(el('span', 'summary-loot-k', label));
    text.appendChild(value);
    box.appendChild(text);
    return box;
  }

  private stat(parent: HTMLElement, label: string): HTMLElement {
    const box = el('div', 'summary-stat');
    box.appendChild(el('span', 'summary-stat-k', label));
    const value = el('span', 'summary-stat-v', '-');
    box.appendChild(value);
    parent.appendChild(box);
    return value;
  }
}
