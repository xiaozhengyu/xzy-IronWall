import './menu.css';
import type { SkillId } from '../game/skills';
import type { WeatherKind } from '../world/weather';

/**
 * 加载条 + 开始 + 暂停，三样东西共用一块面板。
 *
 * 合成一块是因为它们本来就是同一件事的三个阶段：开局要先烘完地面（加载），再等玩家点一下
 * 才能拿到指针锁定（开始），而暂停正是锁定丢掉之后回到的那个状态（暂停）。三者的区别只是
 * 主按钮上写什么、以及下面那半屏数据要不要显示 —— 拆成三个面板会得到三份一模一样的布局。
 *
 * 顺带把原来钉在左上角的 HUD 收了进来。那行字在游戏里一直亮着，而它上面的东西 —— 帧率、
 * 图元数、键位表 —— 没有一样是玩家在挥锤子的时候需要读的。收进来之后游戏画面里一个字都没有。
 */

/** 面板要显示的全部内容。每次刷新时游戏算一份交过来。 */
export interface MenuState {
  kills: number;
  deaths: number;
  /** 场上活着的敌人数，以及其中真正画出来的（视野外的被裁掉）。 */
  alive: number;
  drawn: number;
  hp: number;
  maxHp: number;
  /** 生命顶到了"无敌"那一档，显示成文字而不是一串九。 */
  invincible: boolean;

  /** 一个出怪间隔放几个人。菜单里可调。 */
  spawnBatch: number;
  /** 这一局回收掉多少人（走出回收框、看不见了的）。用来看跑步机转得对不对。 */
  recycled: number;
  /** 其中有多少是玩家回头之后按预留位置放回去的。 */
  restored: number;

  fps: number;
  /** 逻辑和绘制各自花掉的毫秒。暂停时世界是冻住的，这里是暂停那一刻的值。 */
  simMs: number;
  buildMs: number;
  primitives: number;

  preset: number;
  /** 当前选中的攻击技能。 */
  skill: SkillId;
  autoAttack: boolean;
  /** 物品图鉴开着的时候面板要让开，见 showGallery。 */
  showItems: boolean;
  skeleton: boolean;
  maxEnemies: number;

  weather: WeatherKind;
  cloudy: boolean;
  windy: boolean;

  grain: number;
  magnify: number;
  /** 人在缓冲里有多少像素高，以及放大到屏幕上是多少。 */
  figurePixels: number;
  figureScreen: number;
}

export interface MenuBridge {
  /** 七个角色预设的名字。面板搭起来的时候就要，所以不走 read()。 */
  readonly presets: string[];
  /** 攻击技能的名字和小字说明。和 presets 一样，搭面板时就要，不走 read()。 */
  readonly skills: { id: SkillId; name: string; note: string }[];
  /**
   * 点菜单里的一项 = 按对应的那个键。
   *
   * 菜单不自己实现任何一个功能，只把点击翻译成键码丢回去走 onKeyPressed。于是键盘和鼠标
   * 走的是同一段代码，不会分叉成"菜单里的自动攻击开着、但按 F 又是另一套状态"，以后加
   * 功能也只用改一处。
   */
  press(code: string): void;
  /** 天气是唯一直接选而不是循环切的：三档并排摆着，让人点三次绕回去很蠢。 */
  setWeather(kind: WeatherKind): void;
  /** 技能同理：四个形状并排摆着，直接点哪个是哪个。 */
  setSkill(index: number): void;
  read(): MenuState;
  /**
   * 试着夺回指针锁定。resolve 表示锁上了，reject 表示浏览器还在冷却期。
   * 面板不自己碰画布 —— 它连画布是哪个都不知道。
   */
  requestLock(): Promise<void>;
}

/**
 * 按过 ESC 之后 Chrome 有大约一秒二的冷却期，这期间 requestPointerLock 直接 reject。
 * 玩家点了"继续游戏"却什么都没发生是最糟的观感，所以自己按这个节奏重试到冷却结束。
 */
const RETRY_INTERVAL = 250;
const RETRY_DEADLINE = 2200;

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

/** 一格数据：上面一行小标签，下面一行大数字。返回那个大数字，留着后面改。 */
function stat(parent: HTMLElement, label: string): HTMLElement {
  const box = el('div', 'menu-stat');
  box.appendChild(el('span', 'menu-stat-k', label));
  const value = el('span', 'menu-stat-v', '-');
  box.appendChild(value);
  parent.appendChild(box);
  return value;
}

/** 一行开关：左边一个窄标签，右边一排控件。 */
function row(parent: HTMLElement, label: string): HTMLElement {
  const line = el('div', 'menu-row');
  line.appendChild(el('span', 'menu-row-k', label));
  const slot = el('div', 'menu-row-v');
  line.appendChild(slot);
  parent.appendChild(line);
  return slot;
}

export class Menu {
  private readonly bridge: MenuBridge;

  readonly root = el('div', 'menu');
  private readonly mode = el('span', 'menu-mode');

  private readonly loading = el('div');
  private readonly loadLabel = el('span');
  private readonly loadPercent = el('span');
  private readonly barFill = el('div', 'menu-bar-fill');

  /**
   * 图鉴状态下顶上那条窄栏。挂在 root 上而不是卡片里 —— 卡片这时候是收起来的。
   */
  private readonly peek = el('div', 'menu-peek');
  private readonly peekLabel = el('span', 'menu-peek-k');

  private readonly startBox = el('div');
  private readonly startButton = el('button', 'menu-start');
  private readonly hint = el('div', 'menu-hint');

  /** 数据和开关：只有暂停时才有意义，开始画面上是收起来的。 */
  private readonly detail = el('div');
  private readonly stats: Record<string, HTMLElement> = {};
  /** 每个可切换按钮的"当前是否生效"判据，刷新时统一跑一遍。 */
  private readonly toggles: { node: HTMLElement; on: (s: MenuState) => boolean }[] = [];
  private readonly presetButtons: HTMLButtonElement[] = [];
  private readonly spins: Record<string, HTMLElement> = {};
  /** 技能那一行下面的说明，跟着当前选中的技能变。 */
  private skillNote = el('div');

  private locking = false;

  constructor(bridge: MenuBridge) {
    this.bridge = bridge;
    this.build();
    document.body.appendChild(this.root);
  }

  // ---------------------------------------------------------------- 三个状态

  /** @param progress 0..1。 */
  showLoading(label: string, progress: number): void {
    this.root.hidden = false;
    this.setPeek(false);
    this.mode.textContent = '载入中';
    this.loading.hidden = false;
    this.startBox.hidden = true;
    this.detail.hidden = true;
    this.loadLabel.textContent = label;
    const pct = Math.round(progress * 100);
    this.loadPercent.textContent = `${pct}%`;
    this.barFill.style.width = `${pct}%`;
  }

  showTitle(): void {
    this.root.hidden = false;
    this.setPeek(false);
    this.mode.textContent = '准备开始';
    this.loading.hidden = true;
    this.startBox.hidden = false;
    // 开始画面上不摆数据：一局还没打，击杀和帧时间全是零，摆出来只是噪声。键位表留着 ——
    // 那是这个时候唯一真正有用的东西。
    this.detail.hidden = true;
    this.startButton.textContent = '开始游戏';
    this.setHint('');
    this.startButton.disabled = false;
  }

  showPause(): void {
    this.root.hidden = false;
    this.setPeek(false);
    this.mode.textContent = '已暂停';
    this.loading.hidden = true;
    this.startBox.hidden = false;
    this.detail.hidden = false;
    this.startButton.textContent = '继续游戏';
    this.setHint('');
    this.startButton.disabled = false;
    this.refresh();
  }

  hide(): void {
    this.root.hidden = true;
    this.setPeek(false);
    this.locking = false;
  }

  /**
   * 物品图鉴：面板让开，让画布上那张图露出来。
   *
   * 不做成第四个"模式"，因为它和载入/开始/暂停不是一个维度的东西 —— 那三个是游戏所处的
   * 阶段，图鉴只是暂停时临时把面板挪走看一眼。回来还是暂停。
   */
  showGallery(count: number): void {
    this.root.hidden = false;
    this.setPeek(true);
    // 一件都画不出来时，窄栏就是唯一能说清楚"为什么是空的"的地方 —— 画布上写不了字，
    // 那是像素缓冲，十三号字过一遍就没法看了（见这个文件顶上那段）。
    this.peekLabel.textContent =
      count > 0
        ? `物品图鉴 · ${count} 件`
        : '物品图鉴 · 空 —— 把精灵表放到 public/items.png，再到 src/items/catalog.ts 登记帧矩形';
  }

  private setPeek(on: boolean): void {
    this.root.classList.toggle('peek', on);
    this.peek.hidden = !on;
  }

  // ---------------------------------------------------------------- 刷新

  /**
   * 把当前状态刷进面板。
   *
   * 暂停时世界是冻住的，所以不需要定时刷 —— 打开面板时刷一次、之后每次点击再刷一次就够了。
   */
  refresh(): void {
    if (this.detail.hidden) return;
    const s = this.bridge.read();

    this.stats.kills.textContent = String(s.kills);
    this.stats.alive.textContent = `${s.alive} 画 ${s.drawn}`;
    this.stats.recycled.textContent = `${s.recycled} 回 ${s.restored}`;
    this.stats.deaths.textContent = String(s.deaths);
    this.stats.hp.textContent = s.invincible
      ? '无敌'
      : `${Math.max(0, Math.ceil(s.hp))} / ${s.maxHp}`;

    this.stats.fps.textContent = String(Math.round(s.fps));
    this.stats.sim.textContent = `${s.simMs.toFixed(1)} ms`;
    this.stats.build.textContent = `${s.buildMs.toFixed(1)} ms`;
    this.stats.primitives.textContent = String(s.primitives);

    for (let i = 0; i < this.presetButtons.length; i++) {
      this.presetButtons[i].classList.toggle('on', i === s.preset);
    }
    for (const t of this.toggles) t.node.classList.toggle('on', t.on(s));

    this.spins.grain.textContent = `颗粒度 ${s.grain.toFixed(1)} · 人高 ${s.figurePixels} px`;
    this.spins.magnify.textContent = `放大 ${s.magnify}x · 屏幕 ${s.figureScreen} px`;
    this.spins.hp.textContent = s.invincible ? '生命 无敌' : `生命 ${s.maxHp}`;
    this.spins.spawn.textContent = `出兵 x${s.spawnBatch}`;
    this.spins.enemies.textContent = `人数上限 ${s.maxEnemies}`;

    const skill = this.bridge.skills.find((k) => k.id === s.skill);
    this.skillNote.textContent = skill ? `${skill.name} —— ${skill.note}` : '';
  }

  private setHint(text: string): void {
    this.hint.textContent = text;
  }

  // ---------------------------------------------------------------- 搭面板

  private build(): void {
    const card = el('div', 'menu-card');
    this.root.appendChild(card);

    const head = el('div', 'menu-head');
    head.appendChild(el('span', 'menu-title', 'IRONWALL'));
    head.appendChild(this.mode);
    card.appendChild(head);
    card.appendChild(el('div', 'menu-rule'));

    // ---- 加载条

    const label = el('div', 'menu-load-label');
    label.appendChild(this.loadLabel);
    label.appendChild(this.loadPercent);
    this.loading.appendChild(label);
    const bar = el('div', 'menu-bar');
    bar.appendChild(this.barFill);
    this.loading.appendChild(bar);
    card.appendChild(this.loading);

    // ---- 主按钮

    this.startButton.addEventListener('click', () => void this.acquire());
    this.startBox.appendChild(this.startButton);
    this.startBox.appendChild(this.hint);
    card.appendChild(this.startBox);

    // ---- 数据和开关

    this.detail.appendChild(el('div', 'menu-rule'));

    // 三列三行，一行一组：战况 / 场面 / 性能。
    const stats = el('div', 'menu-stats');
    this.stats.kills = stat(stats, '击杀');
    this.stats.deaths = stat(stats, '阵亡');
    this.stats.hp = stat(stats, '生命');
    this.stats.alive = stat(stats, '场上');
    this.stats.recycled = stat(stats, '回收');
    this.stats.primitives = stat(stats, '图元');
    this.stats.fps = stat(stats, '帧率');
    this.stats.sim = stat(stats, '逻辑');
    this.stats.build = stat(stats, '绘制');
    this.detail.appendChild(stats);

    this.detail.appendChild(el('div', 'menu-rule'));
    this.buildControls(this.detail);
    card.appendChild(this.detail);

    card.appendChild(el('div', 'menu-rule'));

    // ---- 图鉴那条窄栏
    //
    // 挂在 root 上而不是卡片里：图鉴状态下卡片整个是收起来的，挂在里面就跟着一起没了。
    this.peek.hidden = true;
    this.peek.appendChild(this.peekLabel);
    this.peek.appendChild(this.button('返回菜单', 'I', 'KeyI'));
    this.root.appendChild(this.peek);

    const keys = el('div', 'menu-keys');
    keys.innerHTML =
      '<b>按住左键</b> 移动 · <b>Shift</b> 跑 · <b>空格</b> 挥击 · ' +
      '<b>滚轮</b> 缩放 · <b>J</b> 换技能 · <b>I</b> 物品图鉴 · <b>ESC</b> 暂停 · 点空白处也能继续';
    card.appendChild(keys);
  }

  private buildControls(parent: HTMLElement): void {
    // ---- 角色

    const roles = row(parent, '角色');
    // 预设名里的英文只是内部代号，菜单上留中文那半截就够了。
    const names = this.bridge.presets.map((n) => n.replace(/^[a-z]+\s*/, ''));
    for (let i = 0; i < names.length; i++) {
      const b = this.button(`${i + 1} ${names[i]}`, '', `Digit${i + 1}`);
      this.presetButtons.push(b);
      roles.appendChild(b);
    }

    // ---- 战斗

    const fight = row(parent, '战斗');
    fight.appendChild(this.toggle('自动攻击', 'F', 'KeyF', (s) => s.autoAttack));
    fight.appendChild(this.toggle('骨架', 'K', 'KeyK', (s) => s.skeleton));
    fight.appendChild(this.button('清场重来', 'R', 'KeyR'));
    // 两个独立的旋钮：出兵管**涌得多快**，同屏上限管**场上能挤多少**。
    fight.appendChild(this.spin('hp', 'KeyN', 'KeyM'));
    fight.appendChild(this.spin('spawn', 'Semicolon', 'Quote'));
    fight.appendChild(this.spin('enemies', 'Comma', 'Period'));

    // ---- 技能
    //
    // 摆在"战斗"和"天气"之间：它是战斗的一部分，但不是一个开关而是一组单选，和天气那行
    // 的形状一样，所以挨着放。下面那行小字写的是形状不是强度 —— 现在四招都是碰到就死，
    // 唯一的区别就是形状。
    const skills = row(parent, '技能');
    this.bridge.skills.forEach((s, i) => {
      const b = this.button(s.name, '');
      b.title = s.note;
      b.addEventListener('click', () => {
        this.bridge.setSkill(i);
        this.refresh();
      });
      this.toggles.push({ node: b, on: (state) => state.skill === s.id });
      skills.appendChild(b);
    });
    skills.appendChild(this.button('切换', 'J', 'KeyJ'));
    this.skillNote = el('div', 'menu-note');
    parent.appendChild(this.skillNote);

    // ---- 天气

    const sky = row(parent, '天气');
    const kinds: { kind: WeatherKind; name: string }[] = [
      { kind: 'clear', name: '晴' },
      { kind: 'rain', name: '雨' },
      { kind: 'snow', name: '雪' },
    ];
    for (const { kind, name } of kinds) {
      const b = this.button(name, '');
      b.addEventListener('click', () => {
        this.bridge.setWeather(kind);
        this.refresh();
      });
      this.toggles.push({ node: b, on: (s) => s.weather === kind });
      sky.appendChild(b);
    }
    sky.appendChild(this.toggle('云', 'C', 'KeyC', (s) => s.cloudy));
    sky.appendChild(this.toggle('风', 'G', 'KeyG', (s) => s.windy));

    // ---- 画面

    const view = row(parent, '画面');
    view.appendChild(this.spin('grain', 'Minus', 'Equal'));
    view.appendChild(this.button('复位', '0', 'Digit0'));
    view.appendChild(this.spin('magnify', 'BracketLeft', 'BracketRight'));
    // 图鉴归"画面"而不是"战斗"：它看的是东西画成什么样，和场上打得怎么样无关。
    view.appendChild(this.toggle('物品图鉴', 'I', 'KeyI', (s) => s.showItems));
  }

  /** 一个普通按钮。给了 code 就等于按下那个键。 */
  private button(text: string, key: string, code?: string): HTMLButtonElement {
    const b = el('button', 'menu-btn');
    b.appendChild(document.createTextNode(text));
    if (key) b.appendChild(el('span', 'menu-key', key));
    if (code) {
      b.addEventListener('click', () => {
        this.bridge.press(code);
        this.refresh();
      });
    }
    return b;
  }

  /** 一个开关按钮：亮起来表示当前是开的。 */
  private toggle(text: string, key: string, code: string, on: (s: MenuState) => boolean): HTMLButtonElement {
    const b = this.button(text, key, code);
    this.toggles.push({ node: b, on });
    return b;
  }

  /** 一个 [− 值 +] 控件。两个键码分别是减和加。 */
  private spin(name: string, downCode: string, upCode: string): HTMLElement {
    const box = el('div', 'menu-spin');
    const down = el('button', undefined, '−');
    const value = el('span');
    const up = el('button', undefined, '+');
    down.addEventListener('click', () => {
      this.bridge.press(downCode);
      this.refresh();
    });
    up.addEventListener('click', () => {
      this.bridge.press(upCode);
      this.refresh();
    });
    box.appendChild(down);
    box.appendChild(value);
    box.appendChild(up);
    this.spins[name] = value;
    return box;
  }

  // ---------------------------------------------------------------- 夺回指针

  /**
   * 反复试到锁上、或者试到超时为止。
   *
   * 面板**不**在这里收起来 —— 收面板的唯一依据是 pointerlockchange 真的报告锁上了。点一下
   * 就把面板撤掉的话，撞上冷却期就会变成"菜单没了、鼠标还在外面、人也不动"，最难受的一种。
   */
  private async acquire(): Promise<void> {
    if (this.locking) return;
    this.locking = true;
    this.startButton.disabled = true;
    this.setHint('');

    const deadline = performance.now() + RETRY_DEADLINE;
    while (this.locking) {
      try {
        await this.bridge.requestLock();
        return; // 锁上了。面板由 pointerlockchange 收起。
      } catch {
        if (performance.now() >= deadline) break;
        await new Promise((r) => setTimeout(r, RETRY_INTERVAL));
      }
    }

    if (!this.locking) return; // 中途已经从别的路子锁上了。
    this.locking = false;
    this.startButton.disabled = false;
    this.setHint('浏览器暂时不肯交出鼠标（刚按过 ESC 会有约一秒的冷却），再点一次。');
  }
}
