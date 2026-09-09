import './setup.css';
import type { HeroDef } from '../game/roster';
import type { GameMapDef } from '../game/maps';
import { SkillCategoryRules, skillById, type SkillCategory, type SkillId } from '../game/skills';
import { createHudIcon, type HudIconName } from './hudIcons';
import { HudText } from './text/hudText';

/**
 * 备战界面：选角色 → 选地图 → 开始。
 *
 * 两步共用一套布局（顶栏 / 左中右三栏 / 底栏），切步只换三栏里的内容。这不是省代码，是为了
 * 让"下一步该干什么"始终在同一个地方：右下角那个主按钮一直在那儿，玩家选完自然把视线移过去，
 * 按下去就走到下一步。做成两个各自独立的界面，玩家每一步都得重新找一遍按钮在哪。
 *
 * 界面只做三件事：把目录摆出来、记住选了谁、把"开始"喊回去。它不认识 Battle，也不认识
 * Field —— 角色最终变成 battle.setPreset 的一个下标、地图最终变成一份 Field 参数，这两件事
 * 都在 main.ts 里完成（见 SetupBridge）。所以这一版没有接数值，界面这边一行都不用改。
 *
 * 用 DOM 而不是画进画布，理由和暂停面板同一条：这里全是十几号字，而画布上的东西要先被量化
 * 到像素格子里再最近邻放大。唯一画进画布的是中间那个人物模型 —— 那本来就该吃像素网格。
 */

export type SetupStep = 'hero' | 'map';

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

export interface SetupMarker {
  /** 已经归一化到 0..1 的地图坐标。界面不认识世界单位。 */
  u: number;
  v: number;
  label: string;
  kind: 'start' | 'camp';
}

export interface SetupBridge {
  readonly heroes: HeroDef[];
  readonly maps: GameMapDef[];
  /**
   * 角色头像。渲染归 Scene，这里只负责摆。
   * 每次调用给一张**新的**画布 —— 一张画布只能挂在 DOM 的一个地方，而头像列表里和底栏都要用。
   */
  portrait(hero: HeroDef): HTMLCanvasElement | null;
  /** 地图缩略图。同上，每次给一张新的。 */
  mapImage(map: GameMapDef): HTMLCanvasElement | null;
  /** 地图上要标出来的点。 */
  markers(map: GameMapDef): SetupMarker[];
  /** 选中的角色变了 —— 主循环拿它换中间那个模型。 */
  onHeroChange(hero: HeroDef): void;
  /** 选中的地图变了 —— 主循环拿它换底下那排敌人。 */
  onMapChange(map: GameMapDef): void;
  /** 走到哪一步了 —— 主循环拿它决定画不画人物台。 */
  onStepChange(step: SetupStep): void;
  /** 开始游戏。界面这时候已经把自己锁住了，不会再来第二次。 */
  onStart(hero: HeroDef, map: GameMapDef): void;
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

/** 右栏的一块：一行小标题，下面是内容。 */
function block(parent: HTMLElement, title: string): HTMLElement {
  const box = el('section', 'setup-block');
  box.appendChild(el('h3', 'setup-block-k', title));
  const body = el('div', 'setup-block-v');
  box.appendChild(body);
  parent.appendChild(box);
  return body;
}

/** 一行「名称 —— 值」。没接上的数据一律给破折号，见 roster.ts 顶上那段。 */
function line(parent: HTMLElement, key: string, value: string): HTMLElement {
  const row = el('div', 'setup-line');
  row.appendChild(el('span', 'setup-line-k', key));
  const v = el('span', 'setup-line-v', value);
  row.appendChild(v);
  parent.appendChild(row);
  return v;
}

/**
 * 把一个角色带的技能按类别分组。
 *
 * 分组名和顺序都取自 skills.ts 的 SkillCategoryRules —— 界面不自己起名字，也不自己排顺序，
 * 否则加一个新类别就要在两个地方各改一次，而两处迟早会不一致。
 */
function groupSkills(ids: readonly SkillId[]): { group: string; icon: HudIconName; skills: { id: string; name: string; note: string }[] }[] {
  const order: SkillCategory[] = ['attack', 'active', 'projectile', 'guard'];
  const out = [];
  for (const category of order) {
    const skills = ids
      .map((id) => skillById(id))
      .filter((skill) => skill.category === category)
      .map((skill) => ({ id: skill.id, name: skill.name, note: skill.note }));
    if (skills.length === 0) continue;
    out.push({ group: SkillCategoryRules[category].name, icon: CATEGORY_ICONS[category], skills });
  }
  return out;
}

/** 还没接上数值的字段统一显示这个。 */
const NOT_WIRED = '—';

export class SetupScreen {
  private readonly bridge: SetupBridge;
  readonly text: HudText;

  readonly root = el('div', 'setup');

  private step: SetupStep = 'hero';
  private heroIndex = 0;
  private mapIndex = 0;
  /** 已经按下开始，界面锁住。 */
  private entering = false;

  // ---- 顶栏
  private readonly backButton = el('button', 'setup-back', '← 返回选人');
  private readonly stepOne = el('button', 'setup-step');
  private readonly stepTwo = el('span', 'setup-step');

  // ---- 三栏
  private readonly list = el('div', 'setup-list');
  private readonly stageTitle = el('h2', 'setup-stage-k');
  private readonly stageLead = el('p', 'setup-stage-lead');
  /**
   * 人物台：这一块是**透明**的，露出画布上那块草地和站在上面的人。
   *
   * 公开出去是为了让 main 把鼠标挂上来 —— 按住左键走、Shift 跑那一套发生在画布上，而能
   * 分辨"按在试练地上"还是"按在左边列表上"的只有这个元素本身。
   */
  readonly heroStage = el('div', 'setup-stage-hero');
  /** 地图详图。 */
  private readonly stageMap = el('div', 'setup-stage-map');
  /**
   * 底下那排敌人的空框，按 map.foes 的顺序。
   *
   * 公开出去是给渲染那边量位置的：框由 CSS 排版，画布按量出来的框画人。这样"框在哪儿"
   * 只有一份来源 —— 两边各写一套百分比的话，换个窗口尺寸就会错位。
   */
  readonly foeSlots: HTMLElement[] = [];
  private readonly detail = el('div', 'setup-detail');

  // ---- 底栏
  private readonly summaryFace = el('div', 'setup-face');
  private readonly summaryText = el('div', 'setup-summary-v');
  private readonly summaryHint = el('div', 'setup-hint');
  private readonly mainButton = el('button', 'setup-main');
  private readonly swapButton = el('button', 'setup-swap', '更换角色');

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

  /** 当前这一步要不要在画布上画试练地。 */
  get showsHeroStage(): boolean {
    return this.step === 'hero' && !this.entering && !this.root.hidden;
  }

  /** 当前这一步要不要在画布上画底下那排敌人。 */
  get showsFoeStage(): boolean {
    return this.step === 'map' && !this.entering && !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.entering = false;
    this.entryVeil.hidden = true;
    this.goto('hero');
    this.bridge.onHeroChange(this.currentHero);
  }

  hide(): void {
    this.root.hidden = true;
  }

  // ---------------------------------------------------------------- 两步

  /**
   * 切步。**两边的选择都留着** —— 回选人再进选图，之前挑的地图和列表位置原样还在。
   * 这是这个界面唯一有状态的地方，也是它必须有状态的地方：来回走一趟就把选择清掉的界面，
   * 玩家不敢点返回。
   */
  private goto(step: SetupStep): void {
    if (this.entering) return;
    this.step = step;
    this.backButton.hidden = step !== 'map';
    this.stepOne.classList.toggle('on', step === 'hero');
    this.stepTwo.classList.toggle('on', step === 'map');
    this.stepOne.disabled = step === 'hero';
    this.heroStage.hidden = step !== 'hero';
    this.stageMap.hidden = step !== 'map';
    this.swapButton.hidden = step !== 'map';
    this.stageTitle.textContent = step === 'hero' ? '选择角色' : '选择地图';
    this.stageLead.textContent = step === 'hero' ? '选择你的出战角色' : '选择本次出战的地图';
    this.mainButton.textContent = step === 'hero' ? '选择地图 →' : '开始游戏';
    this.buildList();
    this.buildDetail();
    this.refreshSummary();
    this.bridge.onStepChange(step);
  }

  // ---------------------------------------------------------------- 左栏

  private buildList(): void {
    this.list.replaceChildren();
    if (this.step === 'hero') {
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
        this.list.appendChild(item);
      });
      return;
    }

    this.bridge.maps.forEach((map, index) => {
      const item = el('button', 'setup-item');
      item.classList.toggle('on', index === this.mapIndex);
      const thumb = el('div', 'setup-thumb');
      const image = this.bridge.mapImage(map);
      if (image) thumb.appendChild(image);
      item.appendChild(thumb);
      const box = el('div', 'setup-item-text');
      box.appendChild(el('span', 'setup-item-k', map.name));
      box.appendChild(el('span', 'setup-item-v', map.tag));
      item.appendChild(box);
      item.addEventListener('click', () => this.selectMap(index));
      this.list.appendChild(item);
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
    this.buildList();
    // 换角色时右栏技能详情重置为新角色的默认技能 —— 这一条是文档里明确要的。
    this.buildDetail();
    this.refreshSummary();
    this.bridge.onHeroChange(this.currentHero);
  }

  private selectMap(index: number): void {
    if (this.entering || index === this.mapIndex) return;
    this.mapIndex = index;
    this.buildList();
    this.buildDetail();
    this.refreshSummary();
    // buildDetail 已经把这张图的敌人框摆好了，渲染那边这时候才量得到位置。
    this.bridge.onMapChange(this.currentMap);
  }

  // ---------------------------------------------------------------- 中栏与右栏

  private buildDetail(): void {
    this.detail.replaceChildren();
    if (this.step === 'hero') {
      this.buildHeroDetail();
      return;
    }
    this.buildMapDetail();
  }

  private buildHeroDetail(): void {
    const hero = this.currentHero;

    const head = el('div', 'setup-detail-head');
    head.appendChild(el('h2', 'setup-detail-k', hero.name));
    head.appendChild(el('p', 'setup-detail-v', `${hero.tagline} · ${hero.blurb}`));
    this.detail.appendChild(head);

    const skills = block(this.detail, '角色技能');
    const groups = groupSkills(hero.skills);
    // 技能说明跟着点选变：一次只讲一个，列表里堆四段说明没人读。
    const note = el('div', 'setup-skill-note');
    const chips: { node: HTMLElement; id: string }[] = [];
    const showNote = (id: string) => {
      for (const chip of chips) chip.node.classList.toggle('on', chip.id === id);
      for (const group of groups) {
        const found = group.skills.find((skill) => skill.id === id);
        if (found) {
          note.replaceChildren();
          note.appendChild(el('span', 'setup-skill-name', found.name));
          note.appendChild(el('span', 'setup-skill-text', found.note));
          return;
        }
      }
    };
    for (const group of groups) {
      const row = el('div', 'setup-skill-row');
      row.appendChild(el('span', 'setup-skill-k', group.group));
      const chipBox = el('div', 'setup-chips');
      for (const skill of group.skills) {
        const chip = el('button', 'setup-chip');
        chip.appendChild(createHudIcon(group.icon, 'setup-chip-icon'));
        chip.appendChild(el('span', undefined, skill.name));
        chip.addEventListener('click', () => showNote(skill.id));
        chips.push({ node: chip, id: skill.id });
        chipBox.appendChild(chip);
      }
      row.appendChild(chipBox);
      skills.appendChild(row);
    }
    skills.appendChild(note);
    // 默认讲第一个 —— 说明框空着的话，玩家要先点一下才知道这块地方是干什么的。
    showNote(groups[0]?.skills[0]?.id ?? '');

    // 等级和属性：位置先留着，数值一个都没有 —— 摆一串假数比空着更容易被当真。
    const stats = block(this.detail, '角色属性');
    line(stats, '等级', NOT_WIRED);
    line(stats, '生命', NOT_WIRED);
    line(stats, '法力', NOT_WIRED);
    stats.appendChild(el('p', 'setup-foot', '属性尚未接入，进入战场后以实际数值为准。'));
  }

  private buildMapDetail(): void {
    const map = this.currentMap;

    const head = el('div', 'setup-detail-head');
    head.appendChild(el('h2', 'setup-detail-k', map.name));
    head.appendChild(el('p', 'setup-detail-v', map.blurb));
    this.detail.appendChild(head);

    const env = block(this.detail, '战场环境');
    line(env, '地形', map.terrain);
    line(env, '天气', map.weatherNote);
    line(env, '视野', map.sight);

    const foes = block(this.detail, '主要敌人');
    for (const enemy of map.foes) line(foes, enemy.boss ? `${enemy.name}（首领）` : enemy.name, enemy.note);

    const goal = block(this.detail, '本局目标');
    goal.appendChild(el('p', 'setup-goal', map.objective));

    // 中间那张详图：底图是真的烘出来的这块地，标记点是真的坐标。
    this.stageMap.replaceChildren();

    // 上半：详图。底图是真的烘出来的这块地，标记点是真的坐标。
    const box = el('div', 'setup-map-box');
    const frame = el('div', 'setup-map-frame');
    const image = this.bridge.mapImage(map);
    if (image) frame.appendChild(image);
    for (const marker of this.bridge.markers(map)) {
      const dot = el('span', `setup-marker ${marker.kind}`);
      dot.style.left = `${marker.u * 100}%`;
      dot.style.top = `${marker.v * 100}%`;
      dot.appendChild(el('i'));
      dot.appendChild(el('span', 'setup-marker-k', marker.label));
      frame.appendChild(dot);
    }
    box.appendChild(frame);
    this.stageMap.appendChild(box);

    const legend = el('div', 'setup-legend');
    legend.appendChild(el('span', 'setup-legend-i start'));
    legend.appendChild(el('span', undefined, '进入位置'));
    legend.appendChild(el('span', 'setup-legend-i camp'));
    legend.appendChild(el('span', undefined, '营地'));
    this.stageMap.appendChild(legend);

    // 下半：这张图上会遇到谁。**框是空的** —— 人由画布画在框里，因为他们要走要挥，
    // 而烘成图片就动不了了（见 Scene.drawFoeStage）。这里只负责摆框和写名字，然后把
    // 每个框的位置量给渲染那边。
    this.foeSlots.length = 0;
    const roster = el('div', 'setup-foes');
    for (const enemy of map.foes) {
      const card = el('div', `setup-foe${enemy.boss ? ' boss' : ''}`);
      const frame = el('div', 'setup-foe-frame');
      card.appendChild(frame);
      card.appendChild(el('span', 'setup-foe-k', enemy.boss ? `${enemy.name} · 首领` : enemy.name));
      roster.appendChild(card);
      this.foeSlots.push(frame);
    }
    this.stageMap.appendChild(roster);
  }

  // ---------------------------------------------------------------- 底栏

  private refreshSummary(): void {
    const hero = this.currentHero;
    this.summaryFace.replaceChildren();
    const portrait = this.portraitOf(hero);
    if (portrait) this.summaryFace.appendChild(portrait);
    else this.summaryFace.textContent = hero.name.slice(0, 1);
    this.summaryText.textContent =
      this.step === 'hero' ? `出战角色：${hero.name}` : `${hero.name} · ${this.currentMap.name}`;
    this.summaryHint.textContent =
      this.step === 'hero'
        ? '按住左键移动 · Shift 跑 · 空格 挥击 · Q/W/E/R 主动技能'
        : '进入后按 ESC 暂停';
  }

  // ---------------------------------------------------------------- 进入

  private start(): void {
    if (this.entering) return;
    if (this.step === 'hero') {
      this.goto('map');
      return;
    }
    // 不再弹一次确认框：确认就是这一下。按钮当场锁住并改字，重复点击进不来第二次。
    this.entering = true;
    this.mainButton.disabled = true;
    this.mainButton.textContent = '正在进入…';
    this.entryLines.replaceChildren();
    this.entryLines.appendChild(el('div', 'setup-veil-k', `正在进入 · ${this.currentMap.name}`));
    this.entryLines.appendChild(el('div', 'setup-veil-v', `出战角色：${this.currentHero.name}`));
    this.entryLines.appendChild(el('div', 'setup-veil-w', '准备战场…'));
    this.entryVeil.hidden = false;
    this.bridge.onStart(this.currentHero, this.currentMap);
  }

  // ---------------------------------------------------------------- 搭界面

  private build(): void {
    // ---- 顶栏
    const top = el('div', 'setup-top');
    const brand = el('span', 'setup-brand');
    this.text.bindText(brand, 'gameTitle');
    const left = el('div', 'setup-top-l');
    left.appendChild(brand);
    this.backButton.addEventListener('click', () => this.goto('hero'));
    left.appendChild(this.backButton);
    top.appendChild(left);

    const steps = el('div', 'setup-steps');
    this.stepOne.textContent = '① 选择角色';
    this.stepOne.addEventListener('click', () => this.goto('hero'));
    this.stepTwo.textContent = '② 选择地图';
    steps.appendChild(this.stepOne);
    steps.appendChild(el('span', 'setup-steps-arrow', '→'));
    steps.appendChild(this.stepTwo);
    top.appendChild(steps);
    this.root.appendChild(top);

    // ---- 三栏
    const body = el('div', 'setup-body');
    const colLeft = el('div', 'setup-col l');
    colLeft.appendChild(this.list);
    body.appendChild(colLeft);

    const colMid = el('div', 'setup-col m');
    const stageHead = el('div', 'setup-stage-head');
    stageHead.appendChild(this.stageTitle);
    stageHead.appendChild(this.stageLead);
    colMid.appendChild(stageHead);
    colMid.appendChild(this.heroStage);
    colMid.appendChild(this.stageMap);
    body.appendChild(colMid);

    const colRight = el('div', 'setup-col r');
    colRight.appendChild(this.detail);
    body.appendChild(colRight);
    this.root.appendChild(body);

    // ---- 底栏
    const bottom = el('div', 'setup-bottom');
    const summary = el('div', 'setup-summary');
    summary.appendChild(this.summaryFace);
    const summaryBox = el('div');
    summaryBox.appendChild(this.summaryText);
    summaryBox.appendChild(this.summaryHint);
    summary.appendChild(summaryBox);
    this.swapButton.addEventListener('click', () => this.goto('hero'));
    summary.appendChild(this.swapButton);
    bottom.appendChild(summary);

    this.mainButton.addEventListener('click', () => this.start());
    bottom.appendChild(this.mainButton);
    this.root.appendChild(bottom);

    // ---- 进入战场那一层
    this.entryVeil.hidden = true;
    this.entryVeil.appendChild(this.entryLines);
    this.root.appendChild(this.entryVeil);
  }
}
