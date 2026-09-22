import './summary.css';
import { createHudIcon } from './hudIcons';
import { HudText, type HudTextKey } from './text/hudText';
import type { HudLocale } from './text/hudText.types';
import { currentItems } from './currentItems';
import { Confetti } from './confetti';
import type { ItemStripEntry } from './itemStrip';
import type { CombatTextKind, CombatTextSettings } from '../game/profile';

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
 * 和暂停面板的分工：那一块是**调试菜单**（帧率、图元、波次跳转、天气开关），只由
 * F1 打开；这一块是**玩家看的流程页**，由 ESC 和游戏结束打开。两者都会把世界冻住，
 * 但它们回答的不是同一个问题。
 */

export type SummaryMode = 'interlude' | 'result';

/** 退场动画多长。和 summary.css 里那条对齐。 */
const SUMMARY_EXIT_MS = 200;

/** 这一局到目前为止的战果。全部由 main 从 Battle 上读一份交过来。 */
export interface SummaryStats {
  /** 角色名和地图名存 key 不存译文：这一屏上就有语言开关，换完要能原地重译。 */
  heroKey: HudTextKey;
  mapKey: HudTextKey;
  /** 这一局跑了多少秒。 */
  time: number;
  coins: number;
  gems: number;
  kills: number;
  deaths: number;
  /** 这一局一共挺了多少伤害（减免之后真正掉的血）。 */
  damageTaken: number;
  wave: number;
  waves: number;
  /** 已经打完的波数。 */
  cleared: number;
  /** 结束的原因是玩家被打倒，而不是自己按的"结束游戏"。 */
  defeated: boolean;
  /** 首领全清了。赢了和“打完了”不是同一件事。 */
  won: boolean;
  /** 这一局挣到的经验。 */
  exp: number;
  /** 结算之后这个角色是几级。 */
  level: number;
  /** 这一局升到了几级，0 表示没升。升了就单独写一行 —— 那是玩家最想看到的一条。 */
  levelUp: number;
  /**
   * 手上还有哪些药和符，以及各自几个。
   *
   * 摆在这里的理由：快捷栏上只有一张图和一个数字，**那两样说不出这东西是干什么的**。玩家
   * 捡到一张符，图案好看，然后呢？按下去会发生什么，一局打完都不知道。而结算是这一局里唯一
   * 一个玩家真的会停下来读字的画面。
   */
  items: ItemStripEntry[];
}

export interface SummaryHooks {
  /** 继续游戏（只有临时结算有）。 */
  onResume(): void;
  /** 结束这一局，直接回选人界面（只有临时结算有）。按钮上已经确认过一次了。 */
  onEnd(): void;
  /** 确认，回到选人画面（只有最终结算有）。 */
  onConfirm(): void;
  /** 设置那一行改了语言。存档由调用方去写 —— 这一屏不认识 Profile。 */
  onLocaleChange?(locale: HudLocale): void;
  /** 设置那一行开关了音效。同上，存档不归这一屏管。 */
  onSfxChange?(on: boolean): void;
  /** 设置那一行开关了音乐。同上。 */
  onMusicChange?(on: boolean): void;
  /** ESC 页上的战斗飘字开关。 */
  onCombatTextChange?(kind: CombatTextKind, on: boolean): void;
  /** ESC 页上的小地图显示开关。 */
  onMinimapChange?(on: boolean): void;
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
  /**
   * 胜负那一行大字。只在最终结算上出现。
   *
   * 右上角那行小字（summary-mode）一直在写同一件事，但它太小了 —— 玩家打完一局抬头，
   * 第一眼该落在"赢了还是输了"上，而不是去右上角找一行灰字。
   */
  private readonly verdict = el('div', 'summary-verdict');
  private readonly lead = el('div', 'summary-lead');
  private readonly coins = el('span', 'summary-loot-v', '0');
  private readonly gems = el('span', 'summary-loot-v', '0');
  private readonly stats: Record<string, HTMLElement> = {};
  private readonly note = el('div', 'summary-note');
  /** 手上的药和符那一块。图在上、字在下，排法和战场上的快捷栏一致。 */
  private readonly actions = el('div', 'summary-actions');
  private readonly resumeButton = el('button', 'summary-btn main');
  private readonly endButton = el('button', 'summary-btn');
  private readonly confirmButton = el('button', 'summary-btn main');
  /** 底下那一行设置：语言、音效、音乐各一行。 */
  private readonly settings = el('div', 'summary-settings');
  private localeButtons: HTMLButtonElement[] = [];
  private sfxButtons: HTMLButtonElement[] = [];
  private sfxOn = true;
  private musicButtons: HTMLButtonElement[] = [];
  private musicOn = true;
  private minimapButtons: HTMLButtonElement[] = [];
  private minimapOn = true;
  private readonly combatTextButtons: Record<CombatTextKind, HTMLButtonElement[]> = {
    damage: [], heal: [], mana: [], buff: [], level: [],
  };
  private combatTextOn: CombatTextSettings = {
    damage: true, heal: true, mana: true, buff: true, level: true,
  };
  /** “结束游戏”按过一下了、正等第二下。见 armEnd()。 */
  private endArmed = false;
  /** 赢了那一屏的礼花。输了不放 —— 见 confetti.ts。 */
  private readonly confetti = new Confetti();
  /** 正在跑退场动画的定时器。0 = 没在跑。 */
  private closing = 0;

  /**
   * 上一次 show 的两个参数。
   *
   * 标题、胜负、"角色 · 地图"、那段说明都是**按当时的数据拼出来的字符串**，不是绑定 ——
   * 而语言开关就在这一屏，换完必须当场重画。记住参数就能原样再拼一次。
   */
  private lastShow: { mode: SummaryMode; stats: SummaryStats } | null = null;

  constructor(hooks: SummaryHooks, text: HudText = new HudText()) {
    this.hooks = hooks;
    this.text = text;
    // 换语言：绑定的标签由 HudText 自己刷新，拼出来的那几行走 applyTexts 重来一遍。
    this.text.onChange(() => {
      // 语言可能是备战界面上那一组改的，所以这一屏的高亮也要重新标一次。
      this.markLocale();
      if (!this.root.hidden && this.lastShow) {
        this.applyTexts(this.lastShow.mode, this.lastShow.stats);
      }
    });
    // 这三个按钮的字绑在文案上：语言按钮就在这一屏，换完必须当场变。
    this.text.bindText(this.resumeButton, 'summaryResume');
    this.text.bindText(this.endButton, 'summaryEnd');
    this.text.bindText(this.confirmButton, 'confirm');
    this.build();
    document.body.appendChild(this.root);
    this.root.hidden = true;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /**
   * 这一屏里**按数据拼出来的**那几行字。
   *
   * 和标签不一样：标签是 bindText 绑上去的，换语言 HudText 自己会刷；这几行要把当时的
   * 数字和名字重新拼一遍，所以单独抽出来，show() 和换语言两条路都走它。
   *
   * 不要在换语言时直接再调一次 show()：那会重播入场动画、重新抢焦点、赢了还会再放一次
   * 礼花 —— 玩家只是点了一下语言按钮。
   */
  private applyTexts(mode: SummaryMode, stats: SummaryStats): void {
    const final = mode === 'result';
    // 三种收场写三句话：清完首领是赢，人倒了或者首领没清完是输，其余只是“打完了”。
    this.mode.textContent = this.text.value(final
      ? (stats.won ? 'summaryWonTitle' : stats.defeated ? 'summaryDefeatedTitle' : 'summaryOverTitle')
      : 'summaryPausedTitle');
    /*
     * 胜负那一行大字。
     *
     * 临时结算不写：那一屏还没分出胜负，摆一行大字会让玩家以为这一局已经完了。
     * 主动退出（既没赢也没输）也不写 —— 那不是一个结果，是一个决定。
     */
    const verdict = final && (stats.won || stats.defeated)
      ? this.text.value(stats.won ? 'summaryVerdictWon' : 'summaryVerdictLost')
      : '';
    this.verdict.textContent = verdict;
    this.verdict.hidden = verdict === '';
    this.verdict.classList.toggle('summary-verdict--won', verdict !== '' && stats.won);
    this.verdict.classList.toggle('summary-verdict--lost', verdict !== '' && !stats.won);
    // 角色名和地图名是**译过的字**（见 main.ts 的 summaryStats），换语言时跟着这里重来。
    this.lead.textContent = `${this.text.value(stats.heroKey)} · ${this.text.value(stats.mapKey)}`;
    this.stats.cleared.textContent = this.text.value('summaryWaves', { count: stats.cleared });
    // 升级是玩家最想看到的一条，所以它顶掉那两句常规说明。金币也在这句里点一下：那是
    // 唯一一样带得走的东西，而灵石打完就没了。
    this.note.textContent = final
      ? stats.levelUp > 0
        ? this.text.value('summaryNoteWon', { level: stats.level, coins: stats.coins })
        : this.text.value(stats.defeated ? 'summaryNoteDefeated' : 'summaryNoteEnded')
      : this.text.value('summaryNotePaused');
  }

  show(mode: SummaryMode, stats: SummaryStats): void {
    this.cancelClose();
    this.root.hidden = false;
    this.lastShow = { mode, stats };
    this.applyTexts(mode, stats);

    const final = mode === 'result';
    this.coins.textContent = String(stats.coins);
    this.gems.textContent = String(stats.gems);
    this.stats.kills.textContent = String(stats.kills);
    this.stats.deaths.textContent = String(stats.deaths);
    this.stats.damageTaken.textContent = String(stats.damageTaken);
    this.stats.time.textContent = clock(stats.time);
    this.stats.wave.textContent = `${stats.wave} / ${stats.waves}`;

    // 一局的"得分"还没有正经公式，所以照实写成它的来源：击杀加收集。摆一个凭空算出来的
    // 分数比不摆更糟 —— 玩家会去猜它怎么来的，而它并不来自任何地方。
    this.stats.loot.textContent = String(stats.coins + stats.gems);
    // 那一排药不在卡片里，它是钉在窗口底边、和三选一共用的同一个节点（见 currentItems.ts）。
    currentItems.show('summary', stats.items);
    this.stats.exp.textContent = `+${stats.exp}`;
    this.stats.level.textContent = stats.levelUp > 0 ? `Lv.${stats.level} ↑` : `Lv.${stats.level}`;

    this.actions.replaceChildren();
    if (final) {
      this.actions.appendChild(this.confirmButton);
      this.confirmButton.focus();
    } else {
      // 每次重新弹出都从未持状态开始：上一次按到一半改了主意，不该留到下一次。
      this.disarmEnd();
      this.actions.appendChild(this.resumeButton);
      this.actions.appendChild(this.endButton);
      this.resumeButton.focus();
    }

    /*
     * 入场动画。先清空再设回 'in'：值没变的话动画不会重播，而这一屏会反复弹
     * （按 ESC 看一眼、回去、再看一眼）。中间读一下 offsetWidth 是为了逼浏览器把清空这一步结算掉。
     */
    this.root.dataset.phase = '';
    void this.root.offsetWidth;
    this.root.dataset.phase = 'in';

    // 只有真赢了才撒纸屑。临时结算（ESC）不算 —— 那一屏说的是"打到哪了"，不是"结束了"。
    if (final && stats.won) this.confetti.burst();
    else this.confetti.stop();
  }

  /**
   * 收起来。**走退场动画**，跑完再真的藏。
   *
   * 调用方不用等：这一屏一旦开始退就不再吃点击（见 summary.css 里的 pointer-events），
   * 所以它在那两百毫秒里挂着不拦任何人。纸屑当场收掉 —— 它是这一屏的一部分，不该活到下一屏。
   */
  hide(): void {
    this.confetti.stop();
    currentItems.hide('summary');
    if (this.root.hidden) return;
    this.cancelClose();
    this.root.dataset.phase = 'out';
    this.closing = window.setTimeout(() => {
      this.closing = 0;
      this.root.hidden = true;
      this.root.dataset.phase = '';
    }, SUMMARY_EXIT_MS);
  }

  private cancelClose(): void {
    if (!this.closing) return;
    clearTimeout(this.closing);
    this.closing = 0;
  }

  private build(): void {
    // 纸屑在卡片**下面**：从字上盖过去会让人读不清这一局打了多少，而那才是这一屏要说的话。
    this.root.appendChild(this.confetti.root);
    const card = el('div', 'summary-card');
    this.root.appendChild(card);

    const head = el('div', 'summary-head');
    const title = el('span', 'summary-title');
    this.text.bindText(title, 'gameTitle');
    head.appendChild(title);
    head.appendChild(this.mode);
    card.appendChild(head);
    card.appendChild(el('div', 'summary-rule'));

    // 胜负大字摆在分割线下面、战况上面：读完它再往下看数据，顺序和玩家关心的顺序一致。
    card.appendChild(this.verdict);
    card.appendChild(this.lead);

    // ---- 收集物：这一屏的主角
    const loot = el('div', 'summary-loot');
    loot.appendChild(this.lootItem('coin', 'statGold', this.coins));
    loot.appendChild(this.lootItem('gem', 'statGems', this.gems));
    card.appendChild(loot);

    // ---- 其余战况
    const stats = el('div', 'summary-stats');
    this.stats.kills = this.stat(stats, 'statKills');
    this.stats.deaths = this.stat(stats, 'statDeaths');
    this.stats.damageTaken = this.stat(stats, 'statDamageTaken');
    this.stats.time = this.stat(stats, 'statTime');
    this.stats.wave = this.stat(stats, 'statWave');
    this.stats.cleared = this.stat(stats, 'statCleared');
    this.stats.loot = this.stat(stats, 'statLoot');
    this.stats.exp = this.stat(stats, 'statExp');
    this.stats.level = this.stat(stats, 'statLevel');
    card.appendChild(stats);

    card.appendChild(this.note);

    this.resumeButton.addEventListener('click', () => this.hooks.onResume());
    /*
     * “结束游戏”是两下，而两下都落在**同一个按钮**上。
     *
     * 原来是一下就直接跳到最终结算，而那一屏只剩一个“确认”—— 按错了就回不去了，
     * 一局打到一半就没了。现在第一下只把这个按钮本身换成“确认结束”，**旁边的“继续游戏”
     * 一动不动** —— 退路始终摆在原处、原尺寸、原位置，按错了不用找。两个按钮一直是两个，
     * 布局不跳，也就不会把鼠标底下的东西换成别的。
     *
     * 离焦就松掉：除了按“继续游戏”，随便点一下别处也能取消。持着的状态必须有一条
     * 不需要玩家先读懂它的退路。
     */
    this.endButton.addEventListener('click', () => {
      if (this.endArmed) {
        this.disarmEnd();
        this.hooks.onEnd();
        return;
      }
      this.armEnd();
    });
    this.endButton.addEventListener('blur', () => this.disarmEnd());
    this.confirmButton.addEventListener('click', () => this.hooks.onConfirm());
    card.appendChild(this.actions);
    card.appendChild(this.buildSettings());
  }

  /**
   * 按钮行下面那一排设置。
   *
   * 为什么落在这一屏上：ESC 是玩家在一局之内唯一会停下来的地方，而设置本来就该在"停下来"
   * 的时候改。为它另开一块面板要多按一下、多写一套进出场，而这一行现在只有一个开关。
   *
   * 语言按钮直接写各自语言里的写法（中文 / EN），不跟着当前语言翻译 —— 一个英文玩家在满屏
   * 中文里要找的就是"EN"这两个字母，把它翻成中文等于把出口藏起来。
   */
  private buildSettings(): HTMLElement {
    // 语言：按钮直接写各自语言里的写法，不跟着当前语言翻译。
    this.localeButtons = this.chipRow('language',
      [['zh-CN', '中文'], ['en', 'EN']],
      (locale) => {
        this.text.setLocale(locale as HudLocale);
        this.markLocale();
        this.hooks.onLocaleChange?.(locale as HudLocale);
      });

    // 音效：开 / 关两档。这两个字要跟着语言翻，所以走 bindText。
    this.sfxButtons = this.chipRow('sound', [['on', ''], ['off', '']], (value) => {
      this.sfxOn = value === 'on';
      this.markSfx();
      this.hooks.onSfxChange?.(this.sfxOn);
    }, ['on', 'off']);

    /*
     * 音乐：和音效分开两行，不合成一个"声音"开关。
     *
     * 这两样关掉的理由完全不同 —— 音乐是"我想听自己的歌"或者"听久了腻"，音效是"我在
     * 办公室"。合成一个的话，想留着打击声只关音乐的人只能连着音效一起关掉。
     */
    this.musicButtons = this.chipRow('music', [['on', ''], ['off', '']], (value) => {
      this.musicOn = value === 'on';
      this.markMusic();
      this.hooks.onMusicChange?.(this.musicOn);
    }, ['on', 'off']);
    this.minimapButtons = this.chipRow('minimapDisplay', [['on', ''], ['off', '']], (value) => {
      this.minimapOn = value === 'on';
      this.markMinimap();
      this.hooks.onMinimapChange?.(this.minimapOn);
    }, ['on', 'off']);
    this.buildCombatTextRow('combatTextDamage', 'damage');
    this.buildCombatTextRow('combatTextHeal', 'heal');
    this.buildCombatTextRow('combatTextMana', 'mana');
    this.buildCombatTextRow('combatTextBuff', 'buff');
    this.buildCombatTextRow('combatTextLevel', 'level');

    this.markLocale();
    this.markSfx();
    this.markMusic();
    this.markMinimap();
    return this.settings;
  }

  private buildCombatTextRow(labelKey: HudTextKey, kind: CombatTextKind): void {
    this.combatTextButtons[kind] = this.chipRow(labelKey, [['on', ''], ['off', '']], (value) => {
      this.combatTextOn[kind] = value === 'on';
      this.markCombatText(kind);
      this.hooks.onCombatTextChange?.(kind, this.combatTextOn[kind]);
    }, ['on', 'off']);
  }

  /**
   * 一行设置：左边一个标题，右边几个小方块。
   *
   * textKeys 传了就把每个方块的字也绑到文案表上（音效那行的"开/关"要跟着语言变），
   * 不传就用写死的 caption（语言那行的"中文/EN"故意不翻）。
   */
  private chipRow(
    labelKey: HudTextKey,
    values: Array<[string, string]>,
    onPick: (value: string) => void,
    textKeys?: Array<'on' | 'off'>,
  ): HTMLButtonElement[] {
    const label = el('span', 'summary-settings-label');
    this.text.bindText(label, labelKey);
    const group = el('div', 'summary-settings-group');
    values.forEach(([value, caption], index) => {
      const button = el('button', 'summary-chip', caption);
      button.dataset.value = value;
      const key = textKeys?.[index];
      if (key) this.text.bindText(button, key);
      button.addEventListener('click', () => onPick(value));
      group.appendChild(button);
    });
    const row = el('div', 'summary-settings-row');
    row.append(label, group);
    this.settings.appendChild(row);
    return [...group.children] as HTMLButtonElement[];
  }

  /** 外面（存档）先告诉这一屏音效当前是开是关。 */
  setSfxEnabled(on: boolean): void {
    this.sfxOn = on;
    this.markSfx();
  }

  private markSfx(): void {
    for (const button of this.sfxButtons) {
      button.classList.toggle('on', button.dataset.value === (this.sfxOn ? 'on' : 'off'));
    }
  }

  /** 外面（存档）先告诉这一屏音乐当前是开是关。 */
  setMusicEnabled(on: boolean): void {
    this.musicOn = on;
    this.markMusic();
  }

  private markMusic(): void {
    for (const button of this.musicButtons) {
      button.classList.toggle('on', button.dataset.value === (this.musicOn ? 'on' : 'off'));
    }
  }

  private markMinimap(): void {
    for (const button of this.minimapButtons) {
      button.classList.toggle('on', button.dataset.value === (this.minimapOn ? 'on' : 'off'));
    }
  }

  setMinimapVisible(on: boolean): void {
    this.minimapOn = on;
    this.markMinimap();
  }

  private markCombatText(kind: CombatTextKind): void {
    for (const button of this.combatTextButtons[kind]) {
      button.classList.toggle('on', button.dataset.value === (this.combatTextOn[kind] ? 'on' : 'off'));
    }
  }

  setCombatText(settings: CombatTextSettings): void {
    this.combatTextOn = { ...settings };
    for (const kind of Object.keys(this.combatTextButtons) as CombatTextKind[]) this.markCombatText(kind);
  }
  /** 当前这一档高亮。语言是从 HudText 问的，所以外面换了语言这里也跟得上。 */
  private markLocale(): void {
    for (const button of this.localeButtons) {
      button.classList.toggle('on', button.dataset.value === this.text.current);
    }
  }

  /** 拿焦点、换字、换成主色。宽高和位置不动（见 summary.css 里的 .armed）。 */
  private armEnd(): void {
    this.endArmed = true;
    this.endButton.textContent = this.text.value('summaryEndConfirm');
    this.endButton.classList.add('armed');
    this.endButton.focus();
  }

  private disarmEnd(): void {
    if (!this.endArmed) return;
    this.endArmed = false;
    this.endButton.textContent = this.text.value('summaryEnd');
    this.endButton.classList.remove('armed');
  }

  private lootItem(icon: 'coin' | 'gem', key: HudTextKey, value: HTMLElement): HTMLElement {
    const box = el('div', 'summary-loot-item');
    // 灵石原图是紫色，战斗 HUD 通过 hud-icon--gem 统一调成青蓝；结算页沿用同一修饰类，
    // 避免同一种收集物在两个界面里像两件不同的东西。
    box.appendChild(createHudIcon(icon, `summary-loot-icon hud-icon--${icon}`));
    const text = el('div', 'summary-loot-text');
    const label = el('span', 'summary-loot-k');
    this.text.bindText(label, key);
    text.appendChild(label);
    text.appendChild(value);
    box.appendChild(text);
    return box;
  }

  private stat(parent: HTMLElement, key: HudTextKey): HTMLElement {
    const box = el('div', 'summary-stat');
    // 绑定而不是写死：语言开关就在这一屏，换完这些标签必须当场跟着变。
    const label = el('span', 'summary-stat-k');
    this.text.bindText(label, key);
    box.appendChild(label);
    const value = el('span', 'summary-stat-v', '-');
    box.appendChild(value);
    parent.appendChild(box);
    return value;
  }
}
