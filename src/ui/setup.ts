import './setup.css';
import type { HeroDef, UnitStats } from '../data/types';
import type { GameMapDef } from '../data/maps';
import { SkillCategoryRules, skillById, type SkillCategory, type SkillId } from '../game/skills';
import { ARCHETYPE_LABEL } from '../data/heroes';
import type { WeatherKind } from '../world/weather';
import { createHudIcon } from './hudIcons';
import { createSkillIcon } from './skillIcons';
import { StatHex, type StatAxis } from './statHex';
import { HudText, type HudLocale, type HudTextKey } from './text/hudText';

/**
 * 备战界面分两步：先选战场与天气，再选将领并开局。
 *
 * 地图页给地图预览和任务信息留出主要空间；将领页用横向名单、人物舞台和属性区展示当前选择。
 * 选择状态由这个 DOM 界面持有，游戏数据和状态切换仍通过 SetupBridge 交给 main.ts。
 *
 * DOM 负责排版与文字；人物、地图和敌军预览仍由 Pixi 绘制，并按 DOM 实际边界定位。DOM 与画布
 * 不能各自维护一份尺寸，否则窗口变化时预览会和面板错位。
 */

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
  /** Persisted map id; invalid ids fall back to the first registered map. */
  readonly initialMapId?: string;
  /**
   * 存档里的那一份：金币、每个角色的等级和经验、已经解锁的技能。
   *
   * 界面只读不写 —— 花钱和升级都发生在别处，这里只负责把数摆出来。做成回调而不是让界面
   * 拿着 Profile，理由和别处一样：这是一块 DOM，它不该认识存档。
   */
  readonly progress: SetupProgress;
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
  /**
   * 顶栏那个"商店"按钮。
   *
   * 留的是一个口子：商店模块还没有，按下去现在只弹一行字。做成回调而不是在这里写死一个
   * 提示，是因为商店接上之后这一行就是它唯一的入口，界面这一侧不用再改。
   */
  onShop(): void;
  /** 点了战绩。带上当前选中的角色 —— 打开就停在他身上，少一次点击。 */
  onHistory(heroId: string): void;
  /**
   * 顶栏那三个开关：语言、音效、音乐。和结算屏（ESC 页）上那三个是**同一组设置**，
   * 两边改的都是存档里那一份，所以 main.ts 在接线时要把另一屏也同步一下。
   */
  onLocaleChange?(locale: HudLocale): void;
  onSfxChange?(on: boolean): void;
  onMusicChange?(on: boolean): void;
}

/** 备战界面要从存档里读的东西。 */
export interface SetupProgress {
  /** 跨局的金币总数。灵石不在这里 —— 那是一局之内的东西，打完就清零。 */
  coins(): number;
  /** 这个角色现在几级。每个角色各记各的。 */
  level(hero: HeroDef): number;
  /** 这一级已经攒了多少经验、这一级一共要多少。满级时给 (1, 1)。 */
  exp(hero: HeroDef): { have: number; need: number };
  /** 这个角色此刻的最终属性：基础值摊上等级成长，再乘被动。 */
  stats(hero: HeroDef): UnitStats;
  /** 这个角色已经解锁的主动技，外加被动和自动攻击技。技能条按它画。 */
  skills(hero: HeroDef): SkillId[];
  /** 这一局会带进去的补给（商店买的）。空数组就是一件都没买。 */
  supplies(): { id: string; name: string; note: string; icon: string; count: number }[];
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
): { groupKey: HudTextKey; skills: { id: SkillId; nameKey: HudTextKey; noteKey: HudTextKey }[] }[] {
  const order: SkillCategory[] = ['attack', 'active', 'projectile', 'guard'];
  const out = [];
  for (const category of order) {
    const skills = ids
      .map((id) => skillById(id))
      .filter((skill) => skill.category === category)
      .map((skill) => ({ id: skill.id, nameKey: skill.nameKey, noteKey: skill.noteKey }));
    if (skills.length === 0) continue;
    out.push({ groupKey: SkillCategoryRules[category].nameKey, skills });
  }
  return out;
}

/** 还没接上数值的字段统一显示这个。 */
const WEATHERS: { kind: WeatherKind; nameKey: HudTextKey }[] = [
  { kind: 'clear', nameKey: 'weatherClear' },
  { kind: 'rain', nameKey: 'weatherRain' },
  { kind: 'snow', nameKey: 'weatherSnow' },
];

export class SetupScreen {
  private readonly bridge: SetupBridge;
  readonly text: HudText;

  readonly root = el('div', 'setup');

  private heroIndex = 0;
  private mapIndex = 0;
  private weather: WeatherKind = 'clear';
  private step: 'battlefield' | 'hero' = 'battlefield';
  /** 已经按下开始，界面锁住。 */
  private entering = false;

  // ---- 两步备战页
  private readonly battlefieldPage = el('section', 'setup-page setup-page--battlefield');
  private readonly heroPage = el('section', 'setup-page setup-page--hero');
  private readonly battlefieldStepLabel = el('span', 'setup-route-step');
  private readonly heroStepLabel = el('span', 'setup-route-step');
  private readonly mapSummaryThumb = el('div', 'setup-map-summary-thumb');
  private readonly mapSummaryName = el('span', 'setup-map-summary-name');
  private readonly mapSummaryWeather = el('span', 'setup-map-summary-weather');
  private readonly mapSummaryObjective = el('span', 'setup-map-summary-objective');
  private readonly mapNextButton = el('button', 'setup-main');
  private readonly heroBackButton = el('button', 'setup-back');

  // ---- 角色选择
  private readonly heroList = el('div', 'setup-list');
  /** 人物台由画布绘制；布局盒保持透明，渲染循环按 DOM 实际尺寸定位。 */
  readonly heroStage = el('div', 'setup-stage');
  private readonly heroTags = el('div', 'setup-tags');

  // ---- 地图选择
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
   * 右栏那几个敌人的空框，按 map.presentation.foes 的顺序。
   *
   * 公开出去是给渲染那边量位置的：框由 CSS 排版，画布按量出来的框画人。这样"框在哪儿"
   * 只有一份来源 —— 两边各写一套百分比的话，换个窗口尺寸就会错位。
   */
  readonly foeSlots: HTMLElement[] = [];
  private readonly foeBox = el('div', 'setup-foes');
  private readonly foeTitle = el('h3', 'setup-block-k');
  private readonly startButton = el('button', 'setup-main');
  /**
   * 开始按钮底下那一排：这一局会带进去的补给。
   *
   * 摆在这儿是因为它回答的是"按下去会发生什么"。玩家在商店里买了两张符，回到这一屏
   * 如果看不见它们，他就得进去之后看快捷栏才知道买没买成。
   */
  private readonly carryBox = el('div', 'setup-carry');
  private readonly summary = el('div', 'setup-summary');
  /**
   * 金币。摆在开始按钮旁边而不是塞进角色那一栏：它是**跨局**的家底，不属于任何一个角色，
   * 以后的商店花的就是它。灵石不在这里 —— 那是一局之内的东西，打完就清零。
   */
  private readonly purse = el('span', 'setup-purse');
  private readonly shopButton = el('button', 'setup-shop');
  /** 商店右边那一个。摆在这儿而不是角色栏里：它记的是**所有**角色的事。 */
  private readonly historyButton = el('button', 'setup-shop');
  /** 顶栏那三个开关。当前这一档靠 on 这个类高亮，值记在 dataset 上。 */
  private localeButtons: HTMLButtonElement[] = [];
  private sfxButtons: HTMLButtonElement[] = [];
  private musicButtons: HTMLButtonElement[] = [];
  private sfxOn = true;
  private musicOn = true;
  /** 顶栏底下那行会自己消失的提示。 */

  /** 进入战场时盖住整屏的那一层。 */
  private readonly entryVeil = el('div', 'setup-veil');
  /** 六项基础属性的六边形。见 statHex.ts。 */
  private readonly statHex = new StatHex();
  private readonly entryLines = el('div', 'setup-veil-box');

  /** 头像画一次就存着 —— 每次重建列表都去 extract 一遍是白扔。 */
  private readonly portraits = new Map<string, HTMLCanvasElement | null>();

  constructor(bridge: SetupBridge, text: HudText = new HudText()) {
    this.bridge = bridge;
    this.text = text;
    const initialMap = bridge.initialMapId
      ? bridge.maps.findIndex((map) => map.id === bridge.initialMapId)
      : -1;
    if (initialMap >= 0) this.mapIndex = initialMap;
    // 换语言：静态那几处是绑定的、HudText 自己会刷；角色卡、地图详情、出兵列表这些是
    // 按当时的数据拼出来的，得重画一遍。关着就不画 —— 下次 show() 本来就会重画。
    this.text.onChange(() => {
      this.markLocale();
      if (!this.root.hidden) this.rebuild();
    });
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

  get heroStepActive(): boolean {
    return this.step === 'hero';
  }

  /** 是否显示备战页的画布预览；进入战场遮罩盖上时停止绘制。 */
  get showsStages(): boolean {
    return !this.entering && !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    // 入场动画。先清空再设回 'in'：值没变的话动画不会重播，而这一屏每打完一局就回来一次。
    this.root.dataset.phase = '';
    void this.root.offsetWidth;
    this.root.dataset.phase = 'in';
    this.step = 'battlefield';
    this.entering = false;
    this.entryVeil.hidden = true;
    this.startButton.disabled = false;
    this.startButton.textContent = this.text.value('setupStart');
    // 每次回到这一屏都从当前地图自己的天气重新起步 —— 上一局打完回来，右栏不该还亮着
    // 上一局在别的图上点过的那一档。
    this.weather = this.currentMap.weather;
    this.rebuild();
    this.bridge.onHeroChange(this.currentHero);
    this.bridge.onMapChange(this.currentMap);
  }

  /** 商店关闭后刷新存档派生的显示数据，但保留当前步骤和地图/天气/将领选择。 */
  refreshAfterShop(): void {
    if (!this.root.hidden) this.rebuild();
  }

  /** 语言变化或选择变化时刷新两个步骤里的动态内容，不重置当前步骤和用户选择。 */
  /**
   * 顶栏右侧那三个开关：语言、音效、音乐。
   *
   * 和结算屏上那三个是同一组设置，长相也一样（两排小方块，当前那一档亮着）。**没有做成
   * 一个共用组件**：那边是一屏停下来的设置行、竖着排，这边是顶栏、横着挤在商店按钮旁边，
   * 共用的只是这十几行拼装代码，而抽出来之后两边都得为对方让一次步。
   *
   * 语言按钮写死"中文 / EN"，不跟着当前语言翻 —— 一个英文玩家在满屏中文里要找的就是
   * "EN"这两个字母，把它翻成中文等于把出口藏起来。开/关两个字要翻，所以走 bindText。
   */
  private buildSettings(parent: HTMLElement): void {
    this.localeButtons = this.chipRow(parent, 'language',
      [['zh-CN', '中文'], ['en', 'EN']],
      (value) => {
        // 直接换共用的那一份 HudText：整个程序只有这一份，全屏当场跟着变。
        this.text.setLocale(value as HudLocale);
        this.markLocale();
        this.bridge.onLocaleChange?.(value as HudLocale);
      });
    this.sfxButtons = this.chipRow(parent, 'sound', [['on', ''], ['off', '']], (value) => {
      this.sfxOn = value === 'on';
      this.markSfx();
      this.bridge.onSfxChange?.(this.sfxOn);
    }, ['on', 'off']);
    this.musicButtons = this.chipRow(parent, 'music', [['on', ''], ['off', '']], (value) => {
      this.musicOn = value === 'on';
      this.markMusic();
      this.bridge.onMusicChange?.(this.musicOn);
    }, ['on', 'off']);
    this.markLocale();
    this.markSfx();
    this.markMusic();
  }

  /** 一组开关：一个标题加几个小方块。textKeys 传了就把方块上的字也绑到文案表上。 */
  private chipRow(
    parent: HTMLElement,
    labelKey: 'language' | 'sound' | 'music',
    values: Array<[string, string]>,
    onPick: (value: string) => void,
    textKeys?: Array<'on' | 'off'>,
  ): HTMLButtonElement[] {
    const box = el('div', 'setup-set');
    const label = el('span', 'setup-set-k');
    this.text.bindText(label, labelKey);
    box.appendChild(label);
    const group = el('div', 'setup-set-v');
    values.forEach(([value, caption], index) => {
      const button = el('button', 'setup-chip', caption);
      button.type = 'button';
      button.dataset.value = value;
      const key = textKeys?.[index];
      if (key) this.text.bindText(button, key);
      button.addEventListener('click', () => onPick(value));
      group.appendChild(button);
    });
    box.appendChild(group);
    parent.appendChild(box);
    return [...group.children] as HTMLButtonElement[];
  }

  /** 当前语言那一档高亮。语言是问 HudText 要的，所以别处换了这里也跟得上。 */
  private markLocale(): void {
    for (const button of this.localeButtons) {
      button.classList.toggle('on', button.dataset.value === this.text.current);
    }
  }

  private markSfx(): void {
    for (const button of this.sfxButtons) {
      button.classList.toggle('on', button.dataset.value === (this.sfxOn ? 'on' : 'off'));
    }
  }

  private markMusic(): void {
    for (const button of this.musicButtons) {
      button.classList.toggle('on', button.dataset.value === (this.musicOn ? 'on' : 'off'));
    }
  }

  /** 存档（或者 ESC 页上那一组）先告诉这一屏音效当前是开是关。 */
  setSfxEnabled(on: boolean): void {
    this.sfxOn = on;
    this.markSfx();
  }

  /** 同上，音乐。 */
  setMusicEnabled(on: boolean): void {
    this.musicOn = on;
    this.markMusic();
  }

  private rebuild(): void {
    this.startButton.textContent = this.text.value('setupStart');
    this.buildHeroList();
    this.buildHeroDetail();
    this.buildMapStrip();
    this.buildMapDetail();
    this.refreshMapSummary();
    this.refreshSummary();
    this.updateStep();
  }

  private setStep(step: 'battlefield' | 'hero'): void {
    if (this.entering || this.step === step) return;
    this.step = step;
    this.updateStep();
  }

  private updateStep(): void {
    this.root.dataset.step = this.step;
    this.battlefieldStepLabel.textContent = `1 · ${this.text.value('setupStepBattlefield')}`;
    this.heroStepLabel.textContent = `2 · ${this.text.value('setupStepHero')}`;
    this.battlefieldStepLabel.parentElement?.setAttribute('aria-label', this.text.value('setupLead'));
    this.battlefieldPage.hidden = this.step !== 'battlefield';
    this.heroPage.hidden = this.step !== 'hero';
    this.battlefieldStepLabel.classList.toggle('on', this.step === 'battlefield');
    this.battlefieldStepLabel.classList.toggle('done', this.step === 'hero');
    this.heroStepLabel.classList.toggle('on', this.step === 'hero');
    this.battlefieldStepLabel.setAttribute('aria-current', this.step === 'battlefield' ? 'step' : 'false');
    this.heroStepLabel.setAttribute('aria-current', this.step === 'hero' ? 'step' : 'false');
  }

  hide(): void {
    this.root.hidden = true;
    this.root.dataset.phase = '';
  }


  // ---------------------------------------------------------------- 将领选择

  private buildHeroList(): void {
    this.heroList.replaceChildren();
    this.bridge.heroes.forEach((hero, index) => {
      const item = el('button', 'setup-item');
      item.classList.toggle('on', index === this.heroIndex);
      const face = el('div', 'setup-face');
      const portrait = this.portraitOf(hero);
      if (portrait) face.appendChild(portrait);
      else face.textContent = this.text.value(hero.nameKey).slice(0, 1);
      item.appendChild(face);
      const box = el('div', 'setup-item-text');
      const nameRow = el('div', 'setup-item-name');
      nameRow.appendChild(el('span', 'setup-item-k', this.text.value(hero.nameKey)));
      // 等级贴在名字后面，不另起一行：每个角色各记各的等级，列表上一眼看出练了谁。
      nameRow.appendChild(el('span', 'setup-item-lv', `Lv.${this.bridge.progress.level(hero)}`));
      box.appendChild(nameRow);
      box.appendChild(el('span', 'setup-item-v', this.text.value(hero.taglineKey)));
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

  /** 当前将领的简介、技能、等级与属性，集中显示在预览舞台旁。 */
  private buildHeroDetail(): void {
    const hero = this.currentHero;
    this.heroTags.replaceChildren();

    const head = el('div', 'setup-tags-head');
    head.appendChild(el('span', 'setup-tags-k', this.text.value(hero.nameKey)));
    head.appendChild(el('span', 'setup-tags-v', this.text.value(hero.blurbKey)));
    this.heroTags.appendChild(head);

    const chips = el('div', 'setup-chips');
    for (const group of groupSkills(this.bridge.progress.skills(hero))) {
      for (const skill of group.skills) {
        const chip = el('span', 'setup-chip');
        chip.appendChild(createSkillIcon(skill.id, 'setup-chip-icon'));
        chip.appendChild(el('span', undefined, this.text.value(skill.nameKey)));
        chip.title = `${this.text.value(group.groupKey)} · ${this.text.value(skill.noteKey)}`;
        chips.appendChild(chip);
      }
    }
    this.heroTags.appendChild(chips);

    // 等级、经验和六项基础属性。
    //
    // 以前这一整块是三个破折号 —— 注释里写着"摆一串假数比空着更容易被当真"。现在数是真的：
    // 由角色的基础值摊上等级成长、再乘被动算出来（见 game/stats.ts），和进去之后身上挂的
    // 是同一份。
    const level = this.bridge.progress.level(hero);
    const exp = this.bridge.progress.exp(hero);
    const stats = this.bridge.progress.stats(hero);

    const levelRow = el('div', 'setup-stats');
    const one = (parent: HTMLElement, key: string, value: string) => {
      const cell = el('span', 'setup-stat');
      cell.appendChild(el('span', 'setup-stat-k', key));
      cell.appendChild(el('span', 'setup-stat-v', value));
      parent.appendChild(cell);
    };
    one(levelRow, this.text.value('statLevel'), `${level}`);
    one(levelRow, this.text.value('setupGrowth'), this.text.value(ARCHETYPE_LABEL[hero.archetype]));
    one(levelRow, this.text.value('statExp'), `${Math.floor(exp.have)} / ${exp.need}`);
    this.heroTags.appendChild(levelRow);

    const statRow = el('div', 'setup-stats');
    one(statRow, this.text.value('statHp'), `${Math.round(stats.maxHp)}`);
    one(statRow, this.text.value('statAttack'), `${Math.round(stats.attack)}`);
    one(statRow, this.text.value('statDefense'), `${Math.round(stats.defense)}`);
    one(statRow, this.text.value('statSpeed'), `${Math.round(stats.moveSpeed)}`);
    one(statRow, this.text.value('statAgility'), `${stats.attackSpeed.toFixed(2)}x`);
    one(statRow, this.text.value('statCrit'), `${Math.round(stats.crit * 100)}%`);
    one(statRow, this.text.value('statRange'), `${Math.round(stats.attackRange)}`);
    one(statRow, this.text.value('statPickup'), `${Math.round(stats.pickupRange)}`);

    /*
     * 六边形和那排数字并排，不是二选一。
     *
     * 两者回答的不是同一个问题：数字回答"我有多少血"，图形回答"这个人和那个人差在哪儿"。
     * 选人界面上后一个问题更要紧，所以图在左、数在右。
     *
     * 归一化的分母是**四个角色各自在自己等级上**的值，不是同一级的值 —— 玩家看的就是
     * "我现在这几个人里谁更硬"，而不是一个把等级抑掉的理论值。
     */
    const all = this.bridge.heroes.map((h) => this.bridge.progress.stats(h));
    const axis = (label: string, read: (s: typeof stats) => number): StatAxis => ({
      label,
      value: read(stats),
      max: Math.max(...all.map(read)),
    });
    this.statHex.draw([
      axis(this.text.value('statHp'), (s) => s.maxHp),
      axis(this.text.value('statAttack'), (s) => s.attack),
      axis(this.text.value('statAgility'), (s) => s.attackSpeed),
      axis(this.text.value('statCrit'), (s) => s.crit),
      axis(this.text.value('statSpeed'), (s) => s.moveSpeed),
      axis(this.text.value('statDefense'), (s) => s.defense),
    ]);
    const statBox = el('div', 'setup-stat-box');
    statBox.appendChild(this.statHex.root);
    statBox.appendChild(statRow);
    this.heroTags.appendChild(statBox);
  }

  // ---------------------------------------------------------------- 战场选择

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
      card.appendChild(el('span', 'setup-strip-k', this.text.value(map.presentation.nameKey)));
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
    // 天气跟着地图走：每张图自己写了"这地方本来什么样"。玩家换完图
    // 还能自己点回去，但默认值该是这张图的，不该是上一张图上留下来的那一档。
    this.weather = this.currentMap.weather;
    this.buildMapStrip();
    this.buildMapDetail();
    this.refreshMapSummary();
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

  // ---------------------------------------------------------------- 战场信息与敌军预览

  private buildMapDetail(): void {
    const map = this.currentMap;
    this.mapInfo.replaceChildren();

    const head = el('div', 'setup-detail-head');
    head.appendChild(el('h2', 'setup-detail-k', this.text.value(map.presentation.nameKey)));
    head.appendChild(el('p', 'setup-detail-v', this.text.value(map.presentation.blurbKey)));
    this.mapInfo.appendChild(head);

    const env = block(this.mapInfo, this.text.value('setupEnvironment'));
    line(env, this.text.value('setupTerrain'), this.text.value(map.presentation.terrainKey));
    line(env, this.text.value('setupSight'), this.text.value(map.presentation.sightKey));
    const sky = el('div', 'setup-weather');
    this.weatherButtons.length = 0;
    for (const { kind, nameKey } of WEATHERS) {
      const button = el('button', 'setup-weather-b', this.text.value(nameKey));
      button.classList.toggle('on', kind === this.weather);
      button.addEventListener('click', () => this.selectWeather(kind));
      this.weatherButtons.push({ node: button, kind });
      sky.appendChild(button);
    }
    env.appendChild(sky);
    // 这张图本来是什么天气。三个按钮说的是"这一局下什么"，这一行说的是"这地方平时什么样"。
    line(env, this.text.value('setupWeather'), this.text.value(map.presentation.weatherNoteKey));

    const goal = block(this.mapInfo, this.text.value('setupObjective'));
    goal.appendChild(el('p', 'setup-goal', this.text.value(map.presentation.objectiveKey)));

    // 出兵人物**不在**上面那块信息面板里，它是右栏里单独的一块。
    //
    // 因为面板有底色，而人是画在画布上、由这一层 DOM 盖着的 —— 摆进去就等于把他们埋在
    // 一块九成不透明的深色底下（这个坑第三次踩了：根、栏、面板，凡是有底色的祖先都会吃掉
    // 底下的画布）。框本身是空的：人和他脚下那块地都由画布画在框里。
    this.foeSlots.length = 0;
    this.foeBox.replaceChildren();
    for (const enemy of map.presentation.foes) {
      const card = el('div', `setup-foe${enemy.boss ? ' boss' : ''}`);
      const frame = el('div', 'setup-foe-frame');
      card.appendChild(frame);
      const foeName = this.text.value(enemy.nameKey);
      card.appendChild(el('span', 'setup-foe-k',
        enemy.boss ? this.text.value('setupBossTag', { name: foeName }) : foeName));
      this.foeBox.appendChild(card);
      this.foeSlots.push(frame);
    }
  }

  private selectWeather(kind: WeatherKind): void {
    if (this.entering || kind === this.weather) return;
    this.weather = kind;
    for (const button of this.weatherButtons) button.node.classList.toggle('on', button.kind === kind);
    this.refreshMapSummary();
    this.bridge.onWeatherChange(kind);
  }

  private refreshMapSummary(): void {
    const map = this.currentMap;
    this.mapSummaryThumb.replaceChildren();
    const image = this.bridge.mapImage(map);
    if (image) this.mapSummaryThumb.appendChild(image);
    this.mapSummaryName.textContent = this.text.value(map.presentation.nameKey);
    const weather = WEATHERS.find((entry) => entry.kind === this.weather);
    this.mapSummaryWeather.textContent = this.text.value('setupWeatherSummary', {
      weather: weather ? this.text.value(weather.nameKey) : '',
    });
    this.mapSummaryObjective.textContent = this.text.value('setupObjectiveSummary', {
      objective: this.text.value(map.presentation.objectiveKey),
    });
  }

  private refreshSummary(): void {
    this.summary.textContent =
      `${this.text.value(this.currentHero.nameKey)} · ${this.text.value(this.currentMap.presentation.nameKey)}`;
    this.purse.textContent = String(this.bridge.progress.coins());
    this.refreshCarry();
  }

  /** 开始按钮底下那一排。一件都没买就整排藏起来，不摆一行"暂无"。 */
  private refreshCarry(): void {
    const carried = this.bridge.progress.supplies();
    this.carryBox.replaceChildren();
    this.carryBox.hidden = carried.length === 0;
    if (carried.length === 0) return;
    /*
     * 不写"随身"这个牌子，图底下写物品名就够了。
     *
     * 牌子回答的是"这一排是什么"，而它摆在开始按钮底下、里面是几个药符图标，这件事
     * 本来就不需要解释。真正读不出来的是"每一个分别是什么" —— 四张符的图彼此很像，
     * 而名字一眼就分得开。
     */
    const row = el('div', 'setup-carry-row');
    for (const entry of carried) {
      const cell = el('span', 'setup-carry-item');
      cell.title = entry.note;
      const frame = el('span', 'setup-carry-frame');
      const icon = el('img', 'setup-carry-icon');
      icon.src = entry.icon;
      icon.alt = '';
      icon.draggable = false;
      frame.appendChild(icon);
      // 个数压在右下角，和快捷栏上那个数字同一个位置。
      frame.appendChild(el('span', 'setup-carry-n', String(entry.count)));
      cell.appendChild(frame);
      cell.appendChild(el('span', 'setup-carry-name', entry.name));
      row.appendChild(cell);
    }
    this.carryBox.appendChild(row);
  }

  // ---------------------------------------------------------------- 进入

  private start(): void {
    if (this.entering) return;
    // 不弹确认框：确认就是这一下。按钮当场锁住并改字，重复点击进不来第二次。
    this.entering = true;
    this.startButton.disabled = true;
    this.startButton.textContent = this.text.value('setupEntering');
    this.entryLines.replaceChildren();
    this.entryLines.appendChild(el('div', 'setup-veil-k',
      this.text.value('setupEnteringMap', { map: this.text.value(this.currentMap.presentation.nameKey) })));
    this.entryLines.appendChild(el('div', 'setup-veil-v',
      this.text.value('setupEnteringHero', { hero: this.text.value(this.currentHero.nameKey) })));
    this.entryLines.appendChild(el('div', 'setup-veil-w', this.text.value('setupPreparing')));
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
    const lead = el('span', 'setup-lead');
    this.text.bindText(lead, 'setupLead');
    top.appendChild(lead);
    // 顶栏右边：金币和商店入口。
    //
    // 摆在这儿而不是角色那一栏：金币是**跨局**的家底，不属于任何一个角色，换谁上场它都
    // 是那个数。灵石不在这里 —— 那是一局之内的东西，打完就清零。
    const purseBox = el('div', 'setup-top-right');
    purseBox.appendChild(createHudIcon('coin', 'setup-purse-icon'));
    purseBox.appendChild(this.purse);
    // 这两个按钮上一轮被我删掉了字面量却没接文案，成了两个空按钮。绑上去。
    this.text.bindText(this.shopButton, 'shopTitle');
    this.shopButton.type = 'button';
    this.shopButton.addEventListener('click', () => this.bridge.onShop());
    purseBox.appendChild(this.shopButton);
    this.text.bindText(this.historyButton, 'historyTitle');
    this.historyButton.type = 'button';
    this.historyButton.addEventListener('click', () => this.bridge.onHistory(this.currentHero.id));
    purseBox.appendChild(this.historyButton);
    purseBox.appendChild(el('span', 'setup-top-sep'));
    this.buildSettings(purseBox);
    top.appendChild(purseBox);
    this.root.appendChild(top);

    const body = el('div', 'setup-body');

    const route = el('nav', 'setup-route');
    route.setAttribute('aria-label', this.text.value('setupLead'));
    route.append(this.battlefieldStepLabel, this.heroStepLabel);
    body.appendChild(route);

    // ---- 第一步：地图、环境与目标
    const mapLayout = el('div', 'setup-map-layout');
    const mapColumn = el('div', 'setup-map-column');
    this.mapFrame.appendChild(this.mapPins);
    const mapBox = el('div', 'setup-map-box');
    mapBox.appendChild(this.mapFrame);
    mapColumn.appendChild(mapBox);

    const legend = el('div', 'setup-legend');
    legend.appendChild(el('span', 'setup-legend-i start'));
    const spawnTag = el('span');
    this.text.bindText(spawnTag, 'setupSpawn');
    legend.appendChild(spawnTag);
    legend.appendChild(el('span', 'setup-legend-i camp'));
    const campTag = el('span');
    this.text.bindText(campTag, 'setupCamp');
    legend.appendChild(campTag);
    const mapHint = el('span', 'setup-legend-t');
    this.text.bindText(mapHint, 'setupMapHint');
    legend.appendChild(mapHint);
    mapColumn.appendChild(legend);

    const strip = el('div', 'setup-strip');
    strip.appendChild(this.stripArrow('‹', -1));
    strip.appendChild(this.mapStrip);
    strip.appendChild(this.stripArrow('›', 1));
    mapColumn.appendChild(strip);
    mapLayout.appendChild(mapColumn);

    const mapAside = el('aside', 'setup-map-aside');
    mapAside.appendChild(this.mapInfo);
    const foeSection = el('div', 'setup-foe-section');
    this.text.bindText(this.foeTitle, 'setupFoes');
    foeSection.appendChild(this.foeTitle);
    foeSection.appendChild(this.foeBox);
    mapAside.appendChild(foeSection);
    mapLayout.appendChild(mapAside);
    this.battlefieldPage.appendChild(mapLayout);

    const mapFooter = el('div', 'setup-step-footer');
    const mapFooterNote = el('span', 'setup-step-note');
    this.text.bindText(mapFooterNote, 'setupChooseBattlefield');
    mapFooter.appendChild(mapFooterNote);
    this.text.bindText(this.mapNextButton, 'setupNextHero');
    this.mapNextButton.type = 'button';
    this.mapNextButton.addEventListener('click', () => this.setStep('hero'));
    mapFooter.appendChild(this.mapNextButton);
    this.battlefieldPage.appendChild(mapFooter);
    body.appendChild(this.battlefieldPage);

    // ---- 第二步：队伍与将领
    const heroMapSummary = el('div', 'setup-map-summary');
    heroMapSummary.appendChild(this.mapSummaryThumb);
    const mapCopy = el('div', 'setup-map-summary-copy');
    mapCopy.appendChild(this.mapSummaryName);
    mapCopy.appendChild(this.mapSummaryWeather);
    mapCopy.appendChild(this.mapSummaryObjective);
    heroMapSummary.appendChild(mapCopy);
    const changeMapButton = el('button', 'setup-map-change');
    this.text.bindText(changeMapButton, 'setupChangeBattlefield');
    changeMapButton.type = 'button';
    changeMapButton.addEventListener('click', () => this.setStep('battlefield'));
    heroMapSummary.appendChild(changeMapButton);
    this.heroPage.appendChild(heroMapSummary);

    const heroChoice = el('section', 'setup-hero-choice');
    const heroChoiceTitle = el('h2', 'setup-section-title');
    this.text.bindText(heroChoiceTitle, 'setupStepHero');
    heroChoice.appendChild(heroChoiceTitle);
    heroChoice.appendChild(this.heroList);
    this.heroPage.appendChild(heroChoice);

    const heroLayout = el('div', 'setup-hero-layout');
    const heroDetailPanel = el('div', 'setup-hero-detail-panel');
    heroDetailPanel.appendChild(this.heroTags);
    heroLayout.appendChild(heroDetailPanel);
    const heroStagePanel = el('div', 'setup-hero-stage-panel');
    heroStagePanel.appendChild(this.heroStage);
    heroLayout.appendChild(heroStagePanel);
    this.heroPage.appendChild(heroLayout);

    const heroFooter = el('div', 'setup-step-footer setup-step-footer--hero');
    this.text.bindText(this.heroBackButton, 'setupBackBattlefield');
    this.heroBackButton.type = 'button';
    this.heroBackButton.addEventListener('click', () => this.setStep('battlefield'));
    heroFooter.appendChild(this.heroBackButton);
    const heroFooterInfo = el('div', 'setup-hero-footer-info');
    heroFooterInfo.append(this.summary, this.carryBox);
    heroFooter.appendChild(heroFooterInfo);
    this.startButton.addEventListener('click', () => this.start());
    heroFooter.appendChild(this.startButton);
    this.heroPage.appendChild(heroFooter);
    body.appendChild(this.heroPage);

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
