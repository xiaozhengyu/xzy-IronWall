import './setup.css';
import type { HeroDef } from '../game/roster';
import type { GameMapDef } from '../game/maps';
import { SkillCategoryRules, skillById, type SkillCategory, type SkillId } from '../game/skills';
import type { WeatherKind } from '../world/weather';
import { createHudIcon, type HudIconName } from './hudIcons';
import { HudText } from './text/hudText';

/**
 * 备战界面：一屏之内选人、选图、开打。
 *
 * 原来这里是两步（先选角色、再选地图，顶上一条步骤指示）。合成一屏之后，"我带谁、去哪儿、
 * 会遇到什么"三件事同时在眼前，改任何一样另外两样都不用重新走一遍。代价是每一栏都窄了，
 * 所以三块画布内容（人物、地图、敌人）都压到了各自栏里最省地方的位置。
 *
 * **doc/游戏流程.txt 写的仍然是两步流程**，和这里对不上 —— 合并是后来定的，那份文档还没跟上。
 *
 * 三栏各管一件事：
 *
 *   左  带谁去。列表在上，选中的那个人在下面的台子上自己走、跑、挥、放招（脚本，见
 *       main.ts 的 advancePreview），技能和属性做成小标签压在台子下面。
 *   中  去哪儿。上面是真实地图（可拖可缩，画在画布上），下面一条横向地图列表。
 *   右  会遇到什么。地图概况、天气、这张图上的敌人，最下面是开始。
 *
 * 界面只做三件事：把目录摆出来、记住选了谁、把"开始"喊回去。它不认识 Battle 也不认识
 * Field —— 角色最终变成 battle.setPreset 的一个下标、地图最终变成一份 Field 参数，那两件事
 * 都在 main.ts 里完成（见 SetupBridge）。
 *
 * 用 DOM 而不是画进画布，理由和暂停面板同一条：这里全是十几号字，而画布上的东西要先被量化
 * 到像素格子里再最近邻放大。画进画布的只有人、地图和敌人 —— 那些本来就该吃像素网格。
 */

/**
 * 每个技能类别配一个已有的 HUD 图标。
 *
 * 技能自己没有图 —— 与其为这一版画九张，不如借 HUD 上那套：玩家在战斗里见过它们，
 * 这里再见到时读的是同一套语汇。等真有技能图标了，换掉这一张表就行。
 */
const CATEGORY_ICONS: Record<SkillCategory, HudIconName> = {
  attack: 'swords',
  projectile: 'bow',
  guard: 'shield',
  active: 'fire',
};

/**
 * 地图上的一个点位。
 *
 * 坐标是**框内的比例**（0..1），不是像素。渲染那边算位置用的是缓冲像素，而 DOM 上一个像素
 * 是另一回事（画布被等比放大到窗口上），两者的数值差着一个缩放系数 —— 传比例就没有这笔账。
 */
export interface MapPin {
  u: number;
  v: number;
  /** 空串 = 只画一个点，不写字。缩小到点位挤在一起时就这么办。 */
  label: string;
  kind: 'start' | 'camp';
  /** 目标在视野之外：这一枚贴在框边上，画成一个指向它的箭头。 */
  edge: boolean;
  /** 贴边时箭头指向哪儿，弧度，屏幕坐标系（x 向右、y 向下）。 */
  angle: number;
  /** 名字摆在点的左边。贴着右半边框的时候要，否则字会顶出框外。 */
  flip: boolean;
}

export interface SetupBridge {
  readonly heroes: HeroDef[];
  readonly maps: GameMapDef[];
  /**
   * 角色头像。渲染归 Scene，这里只负责摆。
   * 每次调用给一张**新的**画布 —— 一张画布只能挂在 DOM 的一个地方。
   */
  portrait(hero: HeroDef): HTMLCanvasElement | null;
  /** 地图缩略图，底下那条列表用。同上，每次给一张新的。 */
  mapImage(map: GameMapDef): HTMLCanvasElement | null;
  /** 选中的角色变了 —— 主循环拿它换台子上那个人。 */
  onHeroChange(hero: HeroDef): void;
  /** 选中的地图变了 —— 主循环拿它换地图镜头和右边那排敌人。 */
  onMapChange(map: GameMapDef): void;
  /** 选中的天气变了。地图预览会跟着一片片重烘，开局时也用这一档。 */
  onWeatherChange(kind: WeatherKind): void;
  /** 开始游戏。界面这时候已经把自己锁住了，不会再来第二次。 */
  onStart(hero: HeroDef, map: GameMapDef, weather: WeatherKind): void;
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

/** 一块内容：一行小标题，下面是内容。**底色加在这一层上**，见 setup.css 顶上那段。 */
function block(parent: HTMLElement, title: string): HTMLElement {
  const box = el('section', 'setup-block');
  box.appendChild(el('h3', 'setup-block-k', title));
  const body = el('div', 'setup-block-v');
  box.appendChild(body);
  parent.appendChild(box);
  return body;
}

/** 一行「名称 —— 值」。没接上的数据一律给破折号。 */
function line(parent: HTMLElement, key: string, value: string): void {
  const row = el('div', 'setup-line');
  row.appendChild(el('span', 'setup-line-k', key));
  row.appendChild(el('span', 'setup-line-v', value));
  parent.appendChild(row);
}

/**
 * 把一个角色带的技能按类别分组。
 *
 * 分组名和顺序都取自 skills.ts 的 SkillCategoryRules —— 界面不自己起名字，也不自己排顺序，
 * 否则加一个新类别就要在两个地方各改一次，而两处迟早会不一致。
 */
function groupSkills(
  ids: readonly SkillId[],
): { group: string; icon: HudIconName; skills: { name: string; note: string }[] }[] {
  const order: SkillCategory[] = ['attack', 'active', 'projectile', 'guard'];
  const out = [];
  for (const category of order) {
    const skills = ids
      .map((id) => skillById(id))
      .filter((skill) => skill.category === category)
      .map((skill) => ({ name: skill.name, note: skill.note }));
    if (skills.length === 0) continue;
    out.push({ group: SkillCategoryRules[category].name, icon: CATEGORY_ICONS[category], skills });
  }
  return out;
}

/** 还没接上数值的字段统一显示这个。 */
const NOT_WIRED = '—';

const WEATHERS: { kind: WeatherKind; name: string }[] = [
  { kind: 'clear', name: '晴' },
  { kind: 'rain', name: '雨' },
  { kind: 'snow', name: '雪' },
];

export class SetupScreen {
  private readonly bridge: SetupBridge;
  readonly text: HudText;

  readonly root = el('div', 'setup');

  private heroIndex = 0;
  private mapIndex = 0;
  private weather: WeatherKind = 'clear';
  /** 已经按下开始，界面锁住。 */
  private entering = false;

  // ---- 左栏
  private readonly heroList = el('div', 'setup-list');
  /**
   * 人物台。**一个像素的底色都不能有** —— 人画在画布上，这块 div 盖在画布之上，给它任何
   * 底色或边框，看到的都是"人被一块颜色挡住了"。它在这里只负责占地方，好让渲染那边量出
   * 台子该画在哪儿。
   */
  readonly heroStage = el('div', 'setup-stage');
  private readonly heroTags = el('div', 'setup-tags');

  // ---- 中栏
  /**
   * 地图那个框。**建一次就一直用**，不跟着重建 —— 拖动和滚轮的监听挂在它身上。框里没有图：
   * 地图画在画布上（见 Scene.drawMapView），这个框只负责占位、描边和装点位。
   */
  readonly mapFrame = el('div', 'setup-map-frame');
  private readonly mapPins = el('div', 'setup-map-pins');
  private readonly mapStrip = el('div', 'setup-strip-track');
  /** 点位元素池。每帧都要摆位置，反复 new 是白扔。 */
  private readonly pinNodes: HTMLElement[] = [];

  // ---- 右栏
  private readonly mapInfo = el('div', 'setup-col-body');
  private readonly weatherButtons: { node: HTMLButtonElement; kind: WeatherKind }[] = [];
  /**
   * 右栏那几个敌人的空框，按 map.foes 的顺序。
   *
   * 公开出去是给渲染那边量位置的：框由 CSS 排版，画布按量出来的框画人。这样"框在哪儿"
   * 只有一份来源 —— 两边各写一套百分比的话，换个窗口尺寸就会错位。
   */
  readonly foeSlots: HTMLElement[] = [];
  private readonly foeBox = el('div', 'setup-foes');
  private readonly startButton = el('button', 'setup-main', '开始游戏');
  private readonly summary = el('div', 'setup-summary');

  /** 进入战场时盖住整屏的那一层。 */
  private readonly entryVeil = el('div', 'setup-veil');
  private readonly entryLines = el('div', 'setup-veil-box');

  /** 头像画一次就存着 —— 每次重建列表都去 extract 一遍是白扔。 */
  private readonly portraits = new Map<string, HTMLCanvasElement | null>();

  constructor(bridge: SetupBridge, text: HudText = new HudText()) {
    this.bridge = bridge;
    this.text = text;
    this.build();
    document.body.appendChild(this.root);
    this.root.hidden = true;
  }

  get currentHero(): HeroDef {
    return this.bridge.heroes[this.heroIndex];
  }

  get currentMap(): GameMapDef {
    return this.bridge.maps[this.mapIndex];
  }

  get currentWeather(): WeatherKind {
    return this.weather;
  }

  /** 要不要在画布上画那三块东西（人物台、地图、敌人）。进战场那一层盖上时就不画了。 */
  get showsStages(): boolean {
    return !this.entering && !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.entering = false;
    this.entryVeil.hidden = true;
    this.startButton.disabled = false;
    this.startButton.textContent = '开始游戏';
    this.buildHeroList();
    this.buildHeroDetail();
    this.buildMapStrip();
    this.buildMapDetail();
    this.refreshSummary();
    this.bridge.onHeroChange(this.currentHero);
    this.bridge.onMapChange(this.currentMap);
  }

  hide(): void {
    this.root.hidden = true;
  }

  // ---------------------------------------------------------------- 左栏：带谁去

  private buildHeroList(): void {
    this.heroList.replaceChildren();
    this.bridge.heroes.forEach((hero, index) => {
      const item = el('button', 'setup-item');
      item.classList.toggle('on', index === this.heroIndex);
      const face = el('div', 'setup-face');
      const portrait = this.portraitOf(hero);
      if (portrait) face.appendChild(portrait);
      else face.textContent = hero.name.slice(0, 1);
      item.appendChild(face);
      const box = el('div', 'setup-item-text');
      box.appendChild(el('span', 'setup-item-k', hero.name));
      box.appendChild(el('span', 'setup-item-v', hero.tagline));
      item.appendChild(box);
      item.addEventListener('click', () => this.selectHero(index));
      this.heroList.appendChild(item);
    });
  }

  private portraitOf(hero: HeroDef): HTMLCanvasElement | null {
    if (!this.portraits.has(hero.id)) this.portraits.set(hero.id, this.bridge.portrait(hero));
    const cached = this.portraits.get(hero.id) ?? null;
    if (!cached) return null;
    // 存的那张只是母版：一张画布挂不到两个地方，所以每次要用就拓一张。
    const copy = document.createElement('canvas');
    copy.width = cached.width;
    copy.height = cached.height;
    copy.getContext('2d')?.drawImage(cached, 0, 0);
    return copy;
  }

  private selectHero(index: number): void {
    if (this.entering || index === this.heroIndex) return;
    this.heroIndex = index;
    this.buildHeroList();
    this.buildHeroDetail();
    this.refreshSummary();
    this.bridge.onHeroChange(this.currentHero);
  }

  /**
   * 台子下面那排小标签：技能和属性。
   *
   * 做成标签而不是右栏那种成块的说明，是因为这一栏还要装列表和台子，纵向没有第三块的位置。
   * 一句话的技能说明挂在 title 上，想看的人停一下就有。
   */
  private buildHeroDetail(): void {
    const hero = this.currentHero;
    this.heroTags.replaceChildren();

    const head = el('div', 'setup-tags-head');
    head.appendChild(el('span', 'setup-tags-k', hero.name));
    head.appendChild(el('span', 'setup-tags-v', hero.blurb));
    this.heroTags.appendChild(head);

    const chips = el('div', 'setup-chips');
    for (const group of groupSkills(hero.skills)) {
      for (const skill of group.skills) {
        const chip = el('span', 'setup-chip');
        chip.appendChild(createHudIcon(group.icon, 'setup-chip-icon'));
        chip.appendChild(el('span', undefined, skill.name));
        chip.title = `${group.group} · ${skill.note}`;
        chips.appendChild(chip);
      }
    }
    this.heroTags.appendChild(chips);

    // 等级和属性：位置先留着，数值一个都没有 —— 摆一串假数比空着更容易被当真。
    const stats = el('div', 'setup-stats');
    for (const key of ['等级', '生命', '法力']) {
      const one = el('span', 'setup-stat');
      one.appendChild(el('span', 'setup-stat-k', key));
      one.appendChild(el('span', 'setup-stat-v', NOT_WIRED));
      stats.appendChild(one);
    }
    this.heroTags.appendChild(stats);
  }

  // ---------------------------------------------------------------- 中栏：去哪儿

  /**
   * 地图底下那条横向列表。
   *
   * 不给卡片描边：几张缩略图并排本来就分得开，再各套一个框，整条列表读起来是几个按钮而不是
   * 一排地方。选中的那张靠亮度和底下那条线区分。
   */
  private buildMapStrip(): void {
    this.mapStrip.replaceChildren();
    this.bridge.maps.forEach((map, index) => {
      const card = el('button', 'setup-strip-card');
      card.classList.toggle('on', index === this.mapIndex);
      const thumb = el('div', 'setup-strip-thumb');
      const image = this.bridge.mapImage(map);
      if (image) thumb.appendChild(image);
      card.appendChild(thumb);
      card.appendChild(el('span', 'setup-strip-k', map.name));
      card.addEventListener('click', () => this.selectMap(index));
      this.mapStrip.appendChild(card);
    });
  }

  private selectMap(index: number): void {
    const count = this.bridge.maps.length;
    // 两侧的箭头会走到头，绕回去比停在那儿不动清楚。
    const next = ((index % count) + count) % count;
    if (this.entering || next === this.mapIndex) return;
    this.mapIndex = next;
    this.buildMapStrip();
    this.buildMapDetail();
    this.refreshSummary();
    // buildMapDetail 已经把这张图的敌人框摆好了，渲染那边这时候才量得到位置。
    this.bridge.onMapChange(this.currentMap);
  }

  /**
   * 把这一帧的点位摆上去。
   *
   * 元素池按最大用量长，多出来的收起来不删 —— 拖动地图时这个函数每帧都跑一次，反复建删
   * DOM 是最容易在拖动里做出卡顿的地方。
   */
  setMapPins(pins: readonly MapPin[]): void {
    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      let node = this.pinNodes[i];
      if (!node) {
        node = el('span', 'setup-pin');
        node.appendChild(el('i', 'setup-pin-mark'));
        node.appendChild(el('span', 'setup-pin-k'));
        this.pinNodes.push(node);
        this.mapPins.appendChild(node);
      }
      node.hidden = false;
      node.className = `setup-pin ${pin.kind}${pin.edge ? ' edge' : ''}${pin.flip ? ' flip' : ''}`;
      node.style.left = `${pin.u * 100}%`;
      node.style.top = `${pin.v * 100}%`;
      const mark = node.firstElementChild as HTMLElement;
      // 贴边指引才转向；框里的点位是一个正方块，转了反而看不出是同一种东西。
      mark.style.transform = pin.edge ? `rotate(${pin.angle}rad)` : '';
      const label = node.lastElementChild as HTMLElement;
      label.textContent = pin.label;
      label.hidden = pin.label === '';
    }
    for (let i = pins.length; i < this.pinNodes.length; i++) this.pinNodes[i].hidden = true;
  }

  // ---------------------------------------------------------------- 右栏：会遇到什么

  private buildMapDetail(): void {
    const map = this.currentMap;
    this.mapInfo.replaceChildren();

    const head = el('div', 'setup-detail-head');
    head.appendChild(el('h2', 'setup-detail-k', map.name));
    head.appendChild(el('p', 'setup-detail-v', map.blurb));
    this.mapInfo.appendChild(head);

    const env = block(this.mapInfo, '战场环境');
    line(env, '地形', map.terrain);
    line(env, '视野', map.sight);
    const sky = el('div', 'setup-weather');
    this.weatherButtons.length = 0;
    for (const { kind, name } of WEATHERS) {
      const button = el('button', 'setup-weather-b', name);
      button.classList.toggle('on', kind === this.weather);
      button.addEventListener('click', () => this.selectWeather(kind));
      this.weatherButtons.push({ node: button, kind });
      sky.appendChild(button);
    }
    env.appendChild(sky);

    const goal = block(this.mapInfo, '本局目标');
    goal.appendChild(el('p', 'setup-goal', map.objective));

    // 出兵人物**不在**上面那块信息面板里，它是右栏里单独的一块。
    //
    // 因为面板有底色，而人是画在画布上、由这一层 DOM 盖着的 —— 摆进去就等于把他们埋在
    // 一块九成不透明的深色底下（这个坑第三次踩了：根、栏、面板，凡是有底色的祖先都会吃掉
    // 底下的画布）。框本身是空的：人和他脚下那块地都由画布画在框里。
    this.foeSlots.length = 0;
    this.foeBox.replaceChildren();
    for (const enemy of map.foes) {
      const card = el('div', `setup-foe${enemy.boss ? ' boss' : ''}`);
      const frame = el('div', 'setup-foe-frame');
      card.appendChild(frame);
      card.appendChild(el('span', 'setup-foe-k', enemy.boss ? `${enemy.name} · 首领` : enemy.name));
      this.foeBox.appendChild(card);
      this.foeSlots.push(frame);
    }
  }

  private selectWeather(kind: WeatherKind): void {
    if (this.entering || kind === this.weather) return;
    this.weather = kind;
    for (const button of this.weatherButtons) button.node.classList.toggle('on', button.kind === kind);
    this.bridge.onWeatherChange(kind);
  }

  private refreshSummary(): void {
    this.summary.textContent = `${this.currentHero.name} · ${this.currentMap.name}`;
  }

  // ---------------------------------------------------------------- 进入

  private start(): void {
    if (this.entering) return;
    // 不弹确认框：确认就是这一下。按钮当场锁住并改字，重复点击进不来第二次。
    this.entering = true;
    this.startButton.disabled = true;
    this.startButton.textContent = '正在进入…';
    this.entryLines.replaceChildren();
    this.entryLines.appendChild(el('div', 'setup-veil-k', `正在进入 · ${this.currentMap.name}`));
    this.entryLines.appendChild(el('div', 'setup-veil-v', `出战角色：${this.currentHero.name}`));
    this.entryLines.appendChild(el('div', 'setup-veil-w', '准备战场…'));
    this.entryVeil.hidden = false;
    this.bridge.onStart(this.currentHero, this.currentMap, this.weather);
  }

  // ---------------------------------------------------------------- 搭界面

  private build(): void {
    // ---- 顶栏
    const top = el('div', 'setup-top');
    const brand = el('span', 'setup-brand');
    this.text.bindText(brand, 'gameTitle');
    top.appendChild(brand);
    top.appendChild(el('span', 'setup-lead', '选择出战角色与地图'));
    this.root.appendChild(top);

    const body = el('div', 'setup-body');

    // ---- 左：带谁去
    const colLeft = el('div', 'setup-col l');
    colLeft.appendChild(this.heroList);
    colLeft.appendChild(this.heroStage);
    colLeft.appendChild(this.heroTags);
    body.appendChild(colLeft);

    // ---- 中：去哪儿
    const colMid = el('div', 'setup-col m');
    this.mapFrame.appendChild(this.mapPins);
    const mapBox = el('div', 'setup-map-box');
    mapBox.appendChild(this.mapFrame);
    colMid.appendChild(mapBox);

    const legend = el('div', 'setup-legend');
    legend.appendChild(el('span', 'setup-legend-i start'));
    legend.appendChild(el('span', undefined, '进入位置'));
    legend.appendChild(el('span', 'setup-legend-i camp'));
    legend.appendChild(el('span', undefined, '营地'));
    legend.appendChild(el('span', 'setup-legend-t', '左键拖动 · 滚轮缩放'));
    colMid.appendChild(legend);

    const strip = el('div', 'setup-strip');
    strip.appendChild(this.stripArrow('‹', -1));
    strip.appendChild(this.mapStrip);
    strip.appendChild(this.stripArrow('›', 1));
    colMid.appendChild(strip);
    body.appendChild(colMid);

    // ---- 右：会遇到什么
    const colRight = el('div', 'setup-col r');
    colRight.appendChild(this.mapInfo);
    const foeSection = el('div', 'setup-foe-section');
    foeSection.appendChild(el('h3', 'setup-block-k', '出兵人物'));
    foeSection.appendChild(this.foeBox);
    colRight.appendChild(foeSection);
    const foot = el('div', 'setup-foot');
    foot.appendChild(this.summary);
    this.startButton.addEventListener('click', () => this.start());
    foot.appendChild(this.startButton);
    colRight.appendChild(foot);
    body.appendChild(colRight);

    this.root.appendChild(body);

    // ---- 进入战场那一层
    this.entryVeil.hidden = true;
    this.entryVeil.appendChild(this.entryLines);
    this.root.appendChild(this.entryVeil);
  }

  private stripArrow(text: string, step: number): HTMLButtonElement {
    const button = el('button', 'setup-strip-arrow', text);
    button.addEventListener('click', () => this.selectMap(this.mapIndex + step));
    return button;
  }
}
