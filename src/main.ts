import { Application } from 'pixi.js';
import { RigSpec } from './characters/rig';
import { PALETTE_HERO } from './characters/palette';
import { Battle, HUMAN_PACE, PLAYER_RUN_SPEED, PLAYER_SPEED, PlayerPresets, playerPresetDisplayName } from './game/battle';
import { Character } from './game/character';
import { ImpactEffects } from './effects/impact';
import { skillById } from './game/skills';
import { GameMaps, type GameMapDef } from './game/maps';
import { Roster, heroUnitDef, type HeroDef } from './game/roster';
import { Skills } from './game/skills';
import { ACTIVE_SKILL_CODES, type ActiveSkillSlot } from './game/skillLoadout';
import { Field } from './game/field';
import { ItemCatalog } from './items/catalog';
import { ItemSheet } from './items/renderer';
import { clamp, v2 } from './core/math';
import { Camera } from './render/camera';
import type { MapView, StageFigure } from './render/scene';
import { STAGE_TILE_RADIUS, spawnStageSkill, type StageSkillShape } from './render/figureStage';
import { Projection } from './render/projection';
import { Scene } from './render/scene';
import { Props } from './world/props';
import type { WeatherKind } from './world/weather';
import { Controls } from './ui/controls';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
import { SetupScreen, type MapPin } from './ui/setup';
import { SummaryScreen, type SummaryStats } from './ui/summary';
import './style.css';

/**
 * 装配和主循环，别的都不在这里。
 *
 *   Camera    —— 世界坐标怎么变成缓冲像素（render/camera.ts）
 *   Scene     —— 一帧从头到尾怎么画（render/scene.ts）
 *   Field     —— 打仗的那块地：地形、天气、营地、地面、脚印（game/field.ts）
 *   Battle    —— 场上的人和他们之间发生的事，割草逻辑往那儿加（game/battle.ts）
 *   Controls  —— 鼠标键盘收成状态（ui/controls.ts）
 *   Menu      —— 加载条、开始、暂停面板（ui/menu.ts）
 *
 * 这个文件负责的是把它们接起来，外加两件只有"全局"才知道的事：游戏处在哪个状态，
 * 以及一个按键该翻译成对谁的哪次调用。
 */

// ---------------------------------------------------------------- 状态

/**
 * 游戏的七个状态，也就是一整圈流程：
 *
 *   loading   —— 在烘地面，面板上是进度条。
 *   setup     —— 备战：选角色 → 选地图。烘完就直接进这里，没有单独的标题页。
 *   entering  —— 按下开始之后那一小段：界面盖着"正在进入"，底下在换角色、清场、铺人。
 *   playing   —— 世界在跑。
 *   interlude —— ESC 或者 HUD 上的暂停按钮：临时结算画面，出口是"继续游戏"或"结束游戏"。
 *   result    —— 这一局结束了（主动结束或者被打倒）：最终结算，出口只有"确认"，回 setup。
 *   paused    —— 调试菜单。**只由 HUD 上的系统按钮打开**，和 ESC 无关。
 *
 * setup → entering → playing → interlude → result → setup 就是那个圈。
 *
 * 三个"停下来"的状态（interlude / result / paused）停的都只是 battle.update，画面照常
 * 想画就画 —— 理由见主循环那一段。它们的区别只在于面板上写什么、以及能不能点回去。
 */
type GameState = 'loading' | 'setup' | 'entering' | 'playing' | 'interlude' | 'result' | 'paused';
let state: GameState = 'loading';

/** 世界是不是冻住的（结算画面、调试菜单都算）。 */
function frozen(): boolean {
  return state === 'interlude' || state === 'result' || state === 'paused';
}

/** 场地：正方形，边长 1200 个世界单位 —— 一个人 19 单位高，所以是六十三个人宽。 */
const FIELD_W = 1200;
const FIELD_H = 1200;
const FIELD_SEED = 20260902;

/**
 * 固定的游戏构图。窗口只负责把这张 16:9 画面等比放大或缩小，不再改变玩家能看见多少世界。
 * renderer 用 2 倍分辨率输出 1920×1080，PixelSurface 再按自己的 magnify 生成像素颗粒。
 */
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const VIEW_RESOLUTION = 2;

const appRoot = document.querySelector<HTMLDivElement>('#app')!;
const gameViewport = document.createElement('div');
gameViewport.className = 'game-viewport';
appRoot.appendChild(gameViewport);

const camera = new Camera();

/**
 * 面板。它得在渲染器之前就建好 —— 它本来就是用来盖住启动那段时间的。
 *
 * 适配层只有四件事：把点击翻译成键码、报一份当前状态、换天气、帮忙夺指针。菜单里没有任何
 * 一个功能是自己实现的，全部转回 onKeyPressed，所以鼠标和键盘不会分岔。
 */
const menu = new Menu({
  presets: PlayerPresets.map((_, index) => playerPresetDisplayName(index)),
  skills: Skills.map((s) => ({
    id: s.id,
    name: s.name,
    note: s.note,
    category: s.category,
    cooldown: s.cooldown,
  })),
  press: (code) => onKeyPressed(code),
  setWeather: (kind) => {
    field.weather.kind = kind;
  },
  toggleSkill: (id) => battle.toggleSkill(id),
  resume: () => controls.resume(),
  read: () => {
    // 人从脚底到头顶大约 18.3 个世界单位，被相机俯角压掉一截才是屏幕上的高度。
    const figureUnits = (RigSpec.headZ + RigSpec.headRadius) * Projection.heightSquash;
    const figure = camera.figureSize(figureUnits);
    return {
      kills: battle.kills,
      deaths: battle.deaths,
      alive: battle.enemies.length,
      drawn: scene.drawn,
      hp: battle.player.hp,
      maxHp: battle.player.maxHp,
      invincible: battle.invincible,
      spawnBatch: battle.spawnBatch,
      wave: battle.waveStatus,
      recycled: battle.recycled,
      restored: battle.restored,
      fps: lastFps,
      simMs: battle.simMs,
      buildMs: scene.buildMs,
      primitives: scene.primitives,
      preset: battle.presetIndex,
      skillLoadout: battle.skillLoadout.snapshot(),
      autoAttack: battle.autoAttack,
      autoRespawn: battle.autoRespawn,
      showItems,
      showCards: hud.cardsEnabled,
      skeleton: showSkeleton,
      maxEnemies: battle.maxEnemies,
      weather: field.weather.kind,
      cloudy: field.weather.cloudiness > 0.05,
      windy: field.weather.windSpeed > 0.6,
      grain: camera.grain,
      magnify: camera.magnify,
      figurePixels: figure.buffer,
      figureScreen: figure.screen,
    };
  },
});

// ---------------------------------------------------------------- 加载

/**
 * 加载条走的是真进度，没有假延时。
 *
 * 这个工程一张图都不加载 —— 人、树、地面全是程序化画出来的，没有任何资源可等。真正花时间的
 * 是两件 CPU 活：建 WebGL 上下文编着色器，以及把整片场地烘成一张四百乘四百的底图。两者都
 * 发生在第一帧之前，也就是白屏期间。
 *
 * 权重是拍的，但比例大致对：烘地面占大头，所以它一个人就分了十六格。
 */
const RENDERER_WEIGHT = 4;
const TERRAIN_WEIGHT = 2;
const FIELD_WEIGHT = 2;
/** 物品精灵表：一次取图，比烘地面快得多，占一格就够。 */
const SHEET_WEIGHT = 1;
const BOOT_WORK =
  RENDERER_WEIGHT + TERRAIN_WEIGHT + Field.BAKE_SLICES + SHEET_WEIGHT + FIELD_WEIGHT;
let bootDone = 0;

/**
 * 报一步加载：显示接下来要干什么、已经干完多少，然后让出去把条画出来。
 *
 * rAF 之后还要再等一个宏任务。只 await rAF 的话，后续代码作为微任务仍然跑在**这一帧里**，
 * 一直顶到绘制前 —— 于是整个加载过程一帧都画不出来，进度条从头到尾只有一帧，等于白做。
 */
function boot(label: string): Promise<void> {
  menu.showLoading(label, bootDone / BOOT_WORK);
  return new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

await boot('启动渲染器');
const app = new Application();
await app.init({
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  background: '#0b0d12',
  antialias: false,
  // 输出尺寸固定为 1920×1080。浏览器只缩放最终画布，不参与相机和出怪范围的计算。
  resolution: VIEW_RESOLUTION,
  autoDensity: false,
});
gameViewport.appendChild(app.canvas);
const hud = new Hud(gameViewport, {
  // 暂停按钮和 ESC 是同一件事：临时结算。
  requestPause: () => openInterlude(),
  // 系统按钮是调试菜单**唯一**的入口。
  requestSystemMenu: () => openDebugMenu(),
});

const scene = new Scene(app.renderer, camera);
app.stage.addChild(scene.view);
// 缓冲尺寸立刻就要定下来：铺场要按视野半径算生成圈，准星要按人的屏幕位置摆，而这两件事都
// 得在加载期间做完 —— 那时还一帧都没跑过，指望不上主循环里那次 resize。
scene.resize(app.screen.width, app.screen.height, app.renderer.resolution);
bootDone += RENDERER_WEIGHT;

await boot('生成地形');
/**
 * 当前正在显示的那块地 —— 打仗时是战场，备战界面上是中栏那张地图。跟着选中的地图换，
 * 所以是 let（换法见 showField）。
 *
 * 开局这一份就是 GameMaps[0]（演武荒原）那三个数，所以它烘完之后直接进缓存，第一张图
 * 不会被再建一次。maps.ts 上那条记录的注释写了这个约定。
 */
let field = new Field(FIELD_W, FIELD_H, FIELD_SEED, GameMaps[0].layout);
scene.attachField(field);
bootDone += TERRAIN_WEIGHT;

for (let i = 0; i < Field.BAKE_SLICES; i++) {
  await boot('烘制地面');
  field.bakeSlice(i);
  bootDone += 1;
}

/**
 * 每张地图一块地，用到才建。
 *
 * 建一块要生成地形（几十毫秒）再把底图整片烘出来（又几十毫秒），还占一张几百 KB 的
 * RGBA 加一张同样大的显存纹理。所以按地图存着 —— 玩家在备战界面上来回点四张图不该每次
 * 重建，进图之后再退回来也不该。
 *
 * **备战界面上那张地图预览用的就是这一份**，不是另烘的缩略图。于是"选图时看到的"和"进去
 * 之后走的"是同一块地的同一份数据，而且进图那一下不用再烘一次 —— 预览的时候已经烘完了。
 */
const fieldCache = new Map<string, Field>([[GameMaps[0].id, field]]);

function fieldOf(map: GameMapDef): Field {
  let made = fieldCache.get(map.id);
  if (!made) {
    made = new Field(map.width, map.height, map.seed, map.layout);
    // 分片烘是为了让加载条走得起来，这里没有条可走，一片一片连着烘完就行。
    for (let i = 0; i < Field.BAKE_SLICES; i++) made.bakeSlice(i);
    fieldCache.set(map.id, made);
  }
  return made;
}

/** 把画面切到这张图的地上。备战界面换图和真正进图走的是同一句。 */
function showField(map: GameMapDef): void {
  field = fieldOf(map);
  scene.attachField(field);
}

await boot('加载物品贴图');
// 图不在也照常开局 —— 这个工程本来一张图都不加载，物品表是后补的。加载不上时 ready 是
// false，图鉴里显示一行提示，别的什么都不受影响。
const itemSheet = new ItemSheet();
await itemSheet.load();
bootDone += SHEET_WEIGHT;

const battle = new Battle(field);
const controls = new Controls(app.canvas as HTMLCanvasElement, camera, {
  onKey: (code) => onKeyPressed(code),
  onActiveChange: (active) => {
    if (active) {
      if (state === 'paused' || state === 'interlude') {
        state = 'playing';
        menu.hide();
        summary.hide();
      }
      return;
    }
    // 从游戏里掉出来。**默认走流程那条路**（临时结算），调试菜单要由 openDebugMenu 先把
    // 目标改掉 —— 于是失去窗口焦点看到的是结算画面，而不是一屏帧率和图元数。
    if (state !== 'playing') return;
    if (pauseTarget === 'debug') {
      state = 'paused';
      menu.showPause();
    } else {
      state = 'interlude';
      summary.show('interlude', summaryStats());
    }
    pauseTarget = 'interlude';
  },
  // 备战界面盖在画布上，点它不该把游戏"继续"起来 —— 那时候还没选完地图。
  // 最终结算（result）也不认：那一局已经结束了，只能按"确认"回选人。
  canActivate: () => state === 'playing' || state === 'paused' || state === 'interlude',
  onEscape: () => {
    // ESC 只管流程这一条线：打仗时弹临时结算，结算画面上按第二下等于"继续游戏"。
    // 调试菜单开着的时候它什么也不做 —— 那块面板是系统按钮开的，就该由它自己的按钮关。
    if (state === 'playing') openInterlude();
    else if (state === 'interlude') controls.resume();
  },
});

/**
 * 下一次"掉出游戏"该弹哪一块面板。
 *
 * 只有系统按钮会把它改成 'debug'，而且用完立刻弹回 —— 失去焦点、ESC、暂停按钮全部落在
 * 流程那条路上。用一个一次性的目标而不是给 Controls.pause 加参数，是因为掉出游戏的路不止
 * 一条（还有 blur 和 visibilitychange，它们在 Controls 内部），而它们都该走默认那一条。
 */
let pauseTarget: 'interlude' | 'debug' = 'interlude';

// ---------------------------------------------------------------- 命令表

/** 骨架叠加。只影响画面，所以留在这里而不是 Battle 里。 */
let showSkeleton = false;

/**
 * 物品图鉴：画的不是战场而是一格一件的物品表（见 Scene.drawItems）。
 *
 * 和骨架叠加一样只影响画面，所以也留在这里。世界照常冻在暂停那一刻，图鉴关掉就回原样。
 */
let showItems = false;

/**
 * 一个键（或者菜单上对应的那个按钮）该干什么。
 *
 * 键盘和菜单走同一张表，所以两条路的行为不会分岔 —— 详见 Menu 的 press 那段注释。
 */
function onKeyPressed(code: string): void {
  // 只有打仗和调试菜单里认这些键。
  //
  // 备战界面上一个调试键都不认：那些开关全是对着战场的，而战场还没开始。结算画面上同理 ——
  // 那一局已经停下来等玩家做决定了，这时候切天气、跳波次只会把结算里的数字改掉。Shift 不走
  // 这条路（跑步读的是 Controls 自己的按键集合），所以试练地上照样能跑。
  if (state !== 'playing' && state !== 'paused') return;

  if (code === 'Space') battle.swingNow();
  if (code === 'KeyK') showSkeleton = !showSkeleton;

  // 图鉴。暂停时面板得跟着让开，否则那张图正好被遮罩盖住 —— 状态归这里管，所以由这里
  // 告诉面板该显示成哪样，菜单自己不知道有"图鉴"这回事。
  //
  // 载入期间直接不认这个键：那时候按下去，开关翻了但一帧都画不出来，等启动结束那次 draw
  // 就会画成图鉴而不是战场 —— 玩家只看到一屏对不上的东西，还不知道自己按过什么。
  //
  // 只在打仗和暂停时认。备战界面盖着整块画布，那时候翻开关只会把图鉴画在看不见的地方。
  if (code === 'KeyI' && (state === 'playing' || state === 'paused')) {
    showItems = !showItems;
    if (state === 'paused') {
      if (showItems) menu.showGallery(galleryCount());
      else menu.showPause();
    }
    // 暂停时没有帧在跑，这一下得自己补一帧，和改颗粒度、拖窗口是同一个道理。
    draw();
  }
  // 升级卡牌。开关本身放在 HUD 上（弹不弹是它自己的事），这里只负责翻它。
  if (code === 'KeyB') {
    hud.cardsEnabled = !hud.cardsEnabled;
    if (!hud.cardsEnabled) hud.cards.hide();
  }
  // 敌人平涂档：省掉每个部件那条硬边阴影带，图元数降三成，代价是明暗少一档。默认关着，
  // 这个键把它打开。见 Scene.liteEnemies。
  if (code === 'KeyL') scene.liteEnemies = !scene.liteEnemies;
  if (code === 'KeyF') battle.autoAttack = !battle.autoAttack;
  // 倒下自动重开。默认关着（倒下会走结算流程），压力测试时打开。
  if (code === 'KeyV') battle.autoRespawn = !battle.autoRespawn;
  if (code === 'KeyJ') battle.cycleAttackSkill();
  const activeSlot = ACTIVE_SKILL_CODES.indexOf(code as (typeof ACTIVE_SKILL_CODES)[number]);
  if (activeSlot >= 0) battle.triggerActiveSkill(activeSlot as ActiveSkillSlot, viewOf());

  // 天气。切换的是"在下什么"，地上积多少雪、湿到什么程度会自己慢慢跟上来。
  const weather = field.weather;
  if (code === 'KeyT') {
    const order: WeatherKind[] = ['clear', 'rain', 'snow'];
    weather.kind = order[(order.indexOf(weather.kind) + 1) % order.length];
  }
  if (code === 'KeyC') weather.cloudiness = weather.cloudiness > 0.05 ? 0 : 0.55;
  if (code === 'KeyG') weather.windSpeed = weather.windSpeed > 0.6 ? 0.1 : 0.9;
  if (code === 'KeyX') battle.reset(viewOf());

  // 颗粒度：人由多少像素构成。
  if (code === 'Minus') camera.zoom(false);
  if (code === 'Equal') camera.zoom(true);
  if (code === 'Digit0') camera.resetZoom();

  // 生命上限。调试同屏几百人的时候用，顶格是无敌。
  if (code === 'KeyN') battle.nudgeMaxHp(-1);
  if (code === 'KeyM') battle.nudgeMaxHp(1);

  // 出兵批量：模板速度的倍率。
  if (code === 'Semicolon') battle.nudgeSpawnBatch(-1);
  if (code === 'Quote') battle.nudgeSpawnBatch(1);

  // 波次：跳到哪一波，以及一步到末波。都会当场把人海补到那一波的预算，见 jumpToWave。
  if (code === 'KeyO') battle.jumpToWave(battle.waveStatus.wave - 1, viewOf());
  if (code === 'KeyP') battle.jumpToWave(battle.waveStatus.wave + 1, viewOf());
  if (code === 'Backslash') battle.jumpToLastWave(viewOf());

  // 人数硬上限。这不是玩法旋钮，是性能兜底 —— 场上有多少人由跑步机自己定，见 DESPAWN_MARGIN。
  if (code === 'Comma') battle.maxEnemies = Math.max(200, battle.maxEnemies - 250);
  if (code === 'Period') battle.maxEnemies = Math.min(6000, battle.maxEnemies + 250);

  // 放大：一个像素多大。只走整数。
  if (code === 'BracketLeft') camera.nudgeMagnify(-1);
  if (code === 'BracketRight') camera.nudgeMagnify(1);

  const digit = code.startsWith('Digit') ? Number(code.slice(5)) : NaN;
  // 卡牌弹着的时候数字键先归它，不然选牌会顺手把药喝了。
  if (hud.cards.open && digit >= 1 && hud.cards.choose(digit - 1)) return;
  if (state === 'playing' && digit >= 1 && digit <= 4) {
    hud.useItem(digit - 1);
  } else if (state === 'paused' && digit >= 1 && digit <= PlayerPresets.length) {
    // 调试用的那一排形象。正经的选人在备战界面里（见 ui/setup.ts），这里能翻到八个全部
    // 预设，包括杂兵和弓手这些本来就不给玩家选的。
    battle.setPreset(digit - 1);
    // 暂停时主循环不跑；菜单换角色后主动补一帧，让名称和头像当场同步。
    draw();
  }
}

// ---------------------------------------------------------------- 主循环

let lastFps = 0;

/**
 * 一帧三步：layout 把缓冲和镜头对齐到当前的窗口与颗粒度，battle.update 推进世界，
 * scene.draw 画出来。
 *
 * 拆开是为了让"暂停"有地方落脚：停的只有 update，layout 和 draw 想调几次调几次。整块套一圈
 * if 的话，暂停时改一档颗粒度、拖一下窗口，画面就再也刷不出来了。
 */
app.ticker.add((ticker) => {
  // 备战界面：世界冻着，动的只有三块 —— 台子上那个人、地图上的天气、右边那排敌人。
  if (state === 'setup' || state === 'entering') {
    if (setup.showsStages) drawSetupScreen(Math.min(ticker.deltaMS / 1000, 1 / 20));
    return;
  }
  if (state !== 'playing') return;
  lastFps = ticker.FPS;
  layout();
  // 弹升级卡牌时把世界停住：和 ESC 暂停同一个道理，停的只有 update —— 牌是 DOM，
  // 战场那一帧照样得画出来，否则改颗粒度或拖窗口时背景就定在旧尺寸上了。
  if (hud.cards.open) {
    draw();
    return;
  }
  // dt 夹在二十分之一秒：暂停期间 ticker 照常在跑，所以回来时并不会攒出一个大步长，但切
  // 后台、断点、掉帧都会，夹一下省得人一口气瞬移出去。
  const dt = Math.min(ticker.deltaMS / 1000, 1 / 20);
  battle.update(dt, readInput(), viewOf());
  hud.update(dt);
  draw();
  // 倒地动画放完那一帧才判负（见 Battle 里 RESPAWN_DELAY 那一段），所以这里已经画过了 ——
  // 玩家看得见自己是怎么倒下的，然后结算才盖上来。
  if (battle.defeated) endRun();
});

// 开始画面和暂停时没有帧在跑，窗口尺寸变了得自己补一帧，否则画面会一直停在旧尺寸那张图上。
addEventListener('resize', () => {
  if (state === 'setup' || state === 'entering') {
    scene.resize(app.screen.width, app.screen.height, app.renderer.resolution);
    if (setup.showsStages) drawSetupScreen(0);
    return;
  }
  if (frozen()) {
    layout();
    draw();
  }
});

/** 把缓冲和镜头对齐到固定逻辑画幅、颗粒度和玩家位置。窗口变化只影响 CSS 外框。 */
function layout(): void {
  const previousWidth = camera.viewWidth;
  const previousHeight = camera.viewHeight;
  scene.resize(app.screen.width, app.screen.height, app.renderer.resolution);
  controls.resizeCursor(previousWidth, previousHeight);
  camera.follow(battle.player.x, battle.player.y, field.width, field.height);
}

/** 把这一帧的输入翻译成"玩家想干什么"。 */
function readInput() {
  const player = battle.player;
  return {
    facing: camera.aimAngle(player.x, player.y, controls.cursor.x, controls.cursor.y),
    moving: controls.moving,
    running: controls.running,
  };
}

/**
 * 这一帧的视野。当前的那一份给性能裁剪用，出货那一份给出怪用 —— 见 BattleView。
 */
function viewOf() {
  const player = battle.player;
  return {
    x: camera.x,
    y: camera.y,
    radius: camera.viewRadius,
    visible: { x: camera.x, y: camera.y, halfW: camera.halfW, halfH: camera.halfH },
    spawn: camera.shipViewport(player.x, player.y, field.width, field.height),
  };
}

/** 图鉴里真正画得出来的件数。登记了但精灵表里还没这一格的不算。 */
function galleryCount(): number {
  if (!itemSheet.ready) return 0;
  return ItemCatalog.filter((d) => itemSheet.textureOf(d) !== null).length;
}

function draw(): void {
  if (state !== 'playing') battle.syncEnemyVisibility(viewOf());
  hud.draw(field, battle, camera);
  if (showItems) {
    scene.drawItems(ItemCatalog, itemSheet);
    return;
  }
  scene.draw(field, battle, {
    showSkeleton,
  });
}

// ---------------------------------------------------------------- 流程
//
// 一整圈是 setup → entering → playing → interlude → result → setup。三个入口（ESC、HUD
// 上的两个按钮）和一个出口（玩家倒下）全部收在这一段里，别处只调用它们。

/**
 * 这一局到目前为止的战果，交给结算画面显示。
 *
 * 临时结算和最终结算读的是同一份 —— 它们要回答的本来就是同一个问题（"我这一局干了什么"），
 * 区别只在于后面还能不能接着打。
 */
function summaryStats(): SummaryStats {
  const wave = battle.waveStatus;
  return {
    hero: setup.currentHero.name,
    map: setup.currentMap.name,
    time: battle.runTime,
    coins: battle.collectedCoins,
    gems: battle.collectedGems,
    kills: battle.kills,
    deaths: battle.deaths,
    wave: wave.wave,
    waves: wave.waves,
    cleared: wave.cleared,
    defeated: battle.defeated,
  };
}

/** ESC 或者 HUD 上的暂停按钮：把世界停住，弹临时结算。 */
function openInterlude(): void {
  if (state !== 'playing') return;
  pauseTarget = 'interlude';
  controls.pause();
}

/** HUD 上的系统按钮：调试菜单。这是它唯一的入口。 */
function openDebugMenu(): void {
  if (state !== 'playing') return;
  pauseTarget = 'debug';
  controls.pause();
}

/**
 * 这一局结束了：临时结算里按了"结束游戏"，或者玩家被打倒。
 *
 * 先把状态推成 result 再 pause —— onActiveChange 只在 'playing' 时才自己决定弹哪块面板，
 * 状态先落地就不会被它改回临时结算。
 */
function endRun(): void {
  if (state === 'result') return;
  state = 'result';
  controls.pause();
  menu.hide();
  showItems = false;
  summary.show('result', summaryStats());
  // 世界停在玩家倒下的那一帧，画面留着当结算的背景 —— 比盖一块纯色更能说明刚才发生了什么。
  draw();
}

/**
 * 结算画面上按了确认：回到选人。
 *
 * 场上的东西不在这里清 —— 真正的清场在 enterMap 里（battle.reset），那一次连地图和天气
 * 一起换掉。这里只负责把界面切回去，让备战界面重新长出来。
 */
function returnToSetup(): void {
  summary.hide();
  menu.hide();
  hud.setVisible(false);
  showItems = false;
  state = 'setup';
  setup.show();
}

// ---------------------------------------------------------------- 备战

/**
 * 选图那一步底下那排敌人有多大：就是出货那一档，和进游戏之后**一模一样**。
 *
 * 那一排要回答的是"我会遇到谁"，而认人靠的是轮廓，轮廓要在他真实的尺寸下才算数。
 */
const FOE_GRAIN = Camera.DEFAULT_GRAIN;

/**
 * 试练地上那个人比出货尺寸大多少。
 *
 * 敌人那一排要的是"和场上一样"，这里要的是另一件事：看清自己带的这个人 —— 头盔、肩甲、
 * 武器怎么握、披风怎么甩。出货尺寸下他只有三十八个像素高，这些全糊在一起。
 *
 * 1.5 倍先把他放到看得清装备的档位，再加两成 —— 中栏空得下，而这一步的全部意义就是看清他。
 * 更早试过三倍半，那太远了：放大到那个程度，选人时看到的和真打起来看到的不是一个东西。
 *
 * 地块半径写的是世界单位（见 figureStage.ts），所以它跟着一起放大，比例不变。
 */
const HERO_STAGE_ZOOM = 1.5 * 1.2;
const HERO_GRAIN = Camera.DEFAULT_GRAIN * HERO_STAGE_ZOOM;

/**
 * 选人那一台的地块单独放宽，**人不跟着变**。
 *
 * 地块和人的那个 1.5 倍是给敌人那一排定的（见 figureStage.ts 的 STAGE_TILE_RADIUS）：小格子
 * 里地紧一点才不显得空。中间这一台不一样 —— 人在上面走，脚下这块地是玩家真正会盯着看的
 * 一块，宽出去的部分给的是草流动的余地。两次各加两成，合起来 1.44。
 */
const HERO_TILE_ZOOM = 1.2 * 1.2;

/**
 * 骑马的角色在台子上缩回去多少。
 *
 * 骑兵从脚底到头顶是 24.5 个单位（马肩隆就有 10 个），步兵是 18.3。按同一个倍率放，他的头
 * 会顶出台子的上沿 —— 而这一台的全部意义就是**看清这个人**，看不见头等于白摆。
 *
 * 比值正好是两个身高的商，所以骑兵在台子上占的高度和步兵一样。**这一档只用在台子上。**
 * 右栏那一排敌人不缩：那一排要回答的是"我会遇到谁"，而"骑兵比所有人高出一头"正是要回答的
 * 内容之一，缩掉就把那句话抹了。
 */
const MOUNTED_STAGE_SHRINK = 18.3 / 24.5;
/** 敌人和头像侧过来一点。正对镜头时武器在身体正前方，被自己挡掉一半。 */
const PREVIEW_TURN = 0.38;

/**
 * 台子上那个人，以及他的动作脚本。
 *
 * 用一个真的 Character 而不是自己搭一份姿势：待机的呼吸、走跑的步态、武器怎么握、披风怎么
 * 甩，全在 CharacterAnimator 里，重写一份迟早和场上那个人长得不一样。
 *
 * 动作原来是鼠标驱动的（按住走、Shift 跑）。合并成一屏之后中栏的地图也要收鼠标，两处抢一个
 * 光标只会互相打架；而且选人这件事本来就该是"他自己演给你看"，不是"你先学会怎么操作他"。
 */
const preview = {
  actor: new Character(heroUnitDef(Roster[0]), PALETTE_HERO, HUMAN_PACE),
  /** 这一台自己的冲击弧。和战斗那套 ImpactEffects 是同一份代码，只是活在台子的局部坐标里。 */
  effects: new ImpactEffects(),
  beat: 0,
  clock: 0,
  /** 走过的路。人不动，草按它的反方向流。 */
  scrollX: 0,
  scrollY: 0,
  /** 朝向的基准，摆动加在它上面。 */
  facing: Math.PI * 0.5,
};
preview.actor.facing = preview.facing;

/**
 * 一轮把这个人会的几件事各演一遍：站着、走、跑、挥两下、放一次招。
 *
 * 每一拍的时长按动作自己的节奏给 —— 挥击那两拍要留够武器抡完的时间，放招那一拍要留够弧
 * 跑完的时间，否则下一拍会把上一拍打断，看着像抽搐。
 */
const PREVIEW_SCRIPT: { act: 'idle' | 'walk' | 'run' | 'attack' | 'skill'; time: number }[] = [
  { act: 'idle', time: 1.5 },
  { act: 'walk', time: 2.4 },
  { act: 'idle', time: 0.7 },
  { act: 'run', time: 2.0 },
  { act: 'attack', time: 1.0 },
  { act: 'attack', time: 1.0 },
  { act: 'skill', time: 1.8 },
];

/** 走跑时朝向慢慢摆一点。一直朝同一个方向走，草流成一条直线，读起来像贴图在滚。 */
const PREVIEW_SWAY = 0.5;

/**
 * 放一道给这个角色看的弧。
 *
 * 形状按他自己的自动攻击技来 —— 横扫是一片扇面、回旋是一整圈、破空是一道推出去的窄波。
 * 这是选人界面唯一能把"这个人打起来什么样"说清楚的地方，三个人放同一道弧就白放了。
 */
function spawnPreviewSkill(): void {
  const attack = setup.currentHero.skills
    .map((id) => skillById(id))
    .find((skill) => skill.category === 'attack');
  const shape: StageSkillShape = attack?.id === 'spin' ? 'ring' : attack?.id === 'wave' ? 'wave' : 'fan';
  spawnStageSkill(preview.effects, preview.actor, shape, STAGE_TILE_RADIUS * HERO_TILE_ZOOM);
}

/** 推进一拍。走完最后一拍绕回第一拍。 */
function advancePreview(dt: number): void {
  const actor = preview.actor;
  preview.clock += dt;
  let beat = PREVIEW_SCRIPT[preview.beat];
  if (preview.clock >= beat.time) {
    preview.clock = 0;
    preview.beat = (preview.beat + 1) % PREVIEW_SCRIPT.length;
    beat = PREVIEW_SCRIPT[preview.beat];
    if (beat.act === 'attack') actor.swing(0);
    if (beat.act === 'skill') {
      actor.swing(0);
      spawnPreviewSkill();
    }
  }

  const running = beat.act === 'run';
  const moving = running || beat.act === 'walk';
  actor.speed = moving ? (running ? PLAYER_RUN_SPEED : PLAYER_SPEED) : 0;
  if (moving) {
    // 摆动只在走跑时加：站着和挥击时朝向必须是死的，一边挥一边转身读起来像被人推了一下。
    actor.facing = preview.facing + Math.sin(preview.clock * 1.1) * PREVIEW_SWAY;
    preview.scrollX += Math.cos(actor.facing) * actor.speed * dt;
    preview.scrollY += Math.sin(actor.facing) * actor.speed * dt;
  }
  actor.update(dt, true);
  preview.effects.update(dt);
}

/**
 * 把一个 DOM 框换算成缓冲坐标。
 *
 * 画布和界面是**同一个** 16:9 的框（.game-viewport 和 .setup 用的是同一组 min() 尺寸），
 * 所以两者之间只差一个等比缩放。让画布跟着 DOM 走，而不是两边各写一套百分比 —— 后者换个
 * 窗口尺寸或者改一次 CSS 就会错位，而错位的表现是"人从框里跑出来"，很难查。
 */
function boxToBuffer(node: HTMLElement) {
  const view = app.canvas.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const kx = camera.viewWidth / Math.max(1, view.width);
  const ky = camera.viewHeight / Math.max(1, view.height);
  return {
    x: (box.left - view.left) * kx,
    y: (box.top - view.top) * ky,
    w: box.width * kx,
    h: box.height * ky,
  };
}

/** 地块中心落在缓冲的哪个像素上。0.62 是在框里留出头顶的地方：人是从脚往上画的。 */
function stageAnchor() {
  const box = boxToBuffer(setup.heroStage);
  return v2(Math.round(box.x + box.w * 0.5), Math.round(box.y + box.h * 0.62));
}

/** 台子那一台的绘制参数。三块画布内容（人、地图、敌人）在同一帧里一起交出去。 */
function heroStageFigure(): StageFigure {
  return {
    actor: preview.actor,
    at: stageAnchor(),
    grain: preview.actor.def.mounted ? HERO_GRAIN * MOUNTED_STAGE_SHRINK : HERO_GRAIN,
    scrollX: preview.scrollX,
    scrollY: preview.scrollY,
    tileScale: HERO_TILE_ZOOM,
    effects: preview.effects,
  };
}

/**
 * 选图那一步底下那排敌人。
 *
 * 他们要走要挥：走是把 speed 给上去（人本身不挪窝，动的只有步态），挥是每隔几秒 swing 一次，
 * 各人错开，免得五个人整整齐齐一起抬手 —— 那读作一排提线木偶。
 */
const foeActors: Character[] = [];
/** 每个敌人各自走了多远。他们各走各的方向，草也就各流各的。 */
const foeScroll: { x: number; y: number }[] = [];
let foeMapId = '';

function syncFoeActors(map: GameMapDef): void {
  if (foeMapId === map.id) return;
  foeMapId = map.id;
  foeActors.length = 0;
  foeScroll.length = 0;
  map.foes.forEach((foe, i) => {
    const actor = new Character(foe.def, foe.palette, HUMAN_PACE);
    actor.facing = Math.PI * 0.5 + PREVIEW_TURN;
    // 走给一半的速度：台子上的人是在"走给你看"，不是在冲锋。
    actor.speed = HUMAN_PACE;
    actor.attackCooldown = 0.6 + i * 0.45;
    foeActors.push(actor);
    foeScroll.push({ x: 0, y: 0 });
  });
}

function updateFoes(dt: number): void {
  foeActors.forEach((actor, i) => {
    if (actor.attack < 0 && actor.attackCooldown <= 0) actor.swing(2.2 + Math.random() * 1.4);
    actor.update(dt, true);
    // 挥击那一下站住不动：一边挥一边脚下的草还在往后跑，读起来像踩着传送带打人。
    const speed = actor.attack >= 0 ? 0 : actor.speed;
    foeScroll[i].x += Math.cos(actor.facing) * speed * dt;
    foeScroll[i].y += Math.sin(actor.facing) * speed * dt;
  });
}

/**
 * 备战界面的一帧：台子上那个人、地图、右边那排敌人，外加地图上的点位。
 *
 * 三块画在同一张画布上，所以只能一起交出去（一次 drawStages）。
 *
 * 顺序是**先量后写**：量框的位置会逼浏览器立刻算一遍布局，而写点位的位置又会把布局作废。
 * 两者交替着来，每一帧都要多算好几遍版 —— 拖动地图时那就是看得见的卡顿。所以框的尺寸这一
 * 帧只量一次，点位最后一起写。
 *
 * @param dt 0 表示只重画不推进（改窗口尺寸时走这一条）。
 */
function drawSetupScreen(dt: number): void {
  const map = setup.currentMap;
  if (dt > 0) {
    advancePreview(dt);
    updateFoes(dt);
    // 天气得自己走：积雪和地面湿度是慢慢累出来的，没人推它就永远停在 0，切了雪地图也不会白。
    field.weather.update(dt);
  }

  const stages: StageFigure[] = [heroStageFigure(), ...foeStageFigures()];
  const rect = mapRect();
  if (rect.w <= 0 || rect.h <= 0) {
    scene.drawStages(field, stages);
    return;
  }
  if (mapCam.grain <= 0) resetMapCam(map);
  clampMapCam(map, rect);
  scene.drawStages(field, stages, mapViewOf(rect));
  setup.setMapPins(mapPinsOf(map, rect));
}

/** 右栏那几个敌人各自的绘制参数。格子由 CSS 排版，画布按量出来的框画人。 */
function foeStageFigures(): StageFigure[] {
  const slots = setup.foeSlots;
  const stages: StageFigure[] = [];
  for (let i = 0; i < foeActors.length && i < slots.length; i++) {
    const box = boxToBuffer(slots[i]);
    // 地块中心落在格子偏下的位置：人从脚往上画，头顶那一半留给他和他举起来的武器。
    //
    // 骑兵再往下压一截：他比步兵高出六个多单位（出货尺寸下十三个像素），照步兵那个落点摆，
    // 格子里就只剩一顶盔的下半截。这一排不缩尺寸（理由见 MOUNTED_STAGE_SHRINK），所以只能
    // 挪落点。
    const foot = foeActors[i].def.mounted ? 0.86 : 0.74;
    stages.push({
      actor: foeActors[i],
      at: v2(Math.round(box.x + box.w * 0.5), Math.round(box.y + box.h * foot)),
      grain: FOE_GRAIN,
      scrollX: foeScroll[i].x,
      scrollY: foeScroll[i].y,
    });
  }
  return stages;
}

/** 一个角色的头像。列表和底栏都要，画一次存着，见 SetupScreen.portraitOf。 */
function heroPortrait(hero: HeroDef): HTMLCanvasElement | null {
  const model = new Character(heroUnitDef(hero), PALETTE_HERO, HUMAN_PACE);
  model.facing = Math.PI * 0.5 + PREVIEW_TURN;
  // 走几帧把姿势搭出来 —— 没跑过 update 的骨架是一堆零。
  for (let i = 0; i < 20; i++) model.update(1 / 60, true);
  // 64 见方，脚落在纹理下沿之外 —— 于是画面从胸口往上截断，头盔、肩甲和武器都在。
  //
  // 骑马的那个要把落点再往下放一截，正好补上他多出来的那段高度：骑手的头在 21.7 个单位
  // （坐在 13.5 的鞍上），步兵是 15.8，差 5.9 个单位 —— 换算到这一档缩放就是 26 个像素。
  // 不补的话他的头会掉到框子中间，一排头像里只有他不齐。
  const mounted = model.def.mounted;
  return scene.renderPortrait(
    model.pose,
    model.def,
    PALETTE_HERO,
    64,
    64,
    6.5,
    mounted ? 117 : 91,
    model.facing,
    // 头像里不画马：这一格只有 64 见方，一匹马进来就把人挤成一个像素点，而列表要认的是人。
    null,
  );
}

/**
 * 底下那条列表里那张缩略图的像素。
 *
 * 烘一次几十毫秒，所以按地图存着。天气传 null：卡片上该是这块地**本来**的样子，不该跟着
 * 玩家在右栏点了雨还是雪来回变 —— 那一栏改的是这一局的天气，不是这块地长什么样。
 */
const mapPixels = new Map<string, ImageData | null>();

function mapImageData(map: GameMapDef): ImageData | null {
  if (!mapPixels.has(map.id)) {
    const baked = fieldOf(map).terrain.bakeGround(null);
    const pixels = new ImageData(new Uint8ClampedArray(baked.data), baked.texWidth, baked.texHeight);
    mapPixels.set(map.id, pixels);
  }
  return mapPixels.get(map.id) ?? null;
}

/**
 * 这张地图上的营地。
 *
 * 就是 Field 自己那一份 —— Props.place 在构造时就跑完了，而它是确定性的（同一份地形摆在
 * 同一处）。所以中栏地图上标出来的那几个点，就是进去之后真会走到的那几处营地。
 */
function mapProps(map: GameMapDef): Props {
  return fieldOf(map).props;
}

/** 每次给一张新画布：一张画布只能挂在 DOM 的一个地方，而缩略图和详图都要用。 */
function mapCanvas(map: GameMapDef): HTMLCanvasElement | null {
  const pixels = mapImageData(map);
  if (!pixels) return null;
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext('2d')?.putImageData(pixels, 0, 0);
  return canvas;
}

/**
 * 地图预览的镜头：看着世界的哪一点、多大。
 *
 * 和战斗那个 Camera 是两回事，所以单独存一份：那个跟着玩家走、有出怪视口和回收框；这个只
 * 被拖动和滚轮改，唯一的约束是别把镜头拖到地图外面去。
 */
const mapCam = { x: 0, y: 0, grain: 1, dragX: 0, dragY: 0, dragging: false };

/** 地图能缩到多小、放到多大。放大的上限就是出货那一档 —— 再大也不会比进游戏看到的更真。 */
const MAP_ZOOM_MAX = Camera.DEFAULT_GRAIN;
const MAP_ZOOM_STEP = 1.18;

/** 点位挤到多近就不写字了，缓冲像素。 */
const PIN_LABEL_GAP = 52;
/** 再近就连点都合并掉。 */
const PIN_MERGE_GAP = 14;
/** 贴边指引离框边留多少，缓冲像素。 */
const PIN_EDGE_INSET = 13;

/** 地图框在缓冲里的矩形。DOM 摆框，画布跟着框走。 */
function mapRect() {
  return boxToBuffer(setup.mapFrame);
}

/** 整幅刚好铺满框时的颗粒度。缩放的下限就是它 —— 再缩就是在框里看一张越来越小的邮票。 */
function mapFitGrain(map: GameMapDef, rect: { w: number; h: number }): number {
  return Math.min(rect.w / map.width, rect.h / (map.height * Projection.groundSquash));
}

/**
 * 把镜头夹回地图里。
 *
 * 视野比地图大的那一档（缩到底时）直接钉在正中：那时候"拖动"没有任何意义，让它纹丝不动比
 * 让它在框里滑来滑去清楚得多。
 */
function clampMapCam(map: GameMapDef, rect: { w: number; h: number }): void {
  const halfW = rect.w * 0.5 / mapCam.grain;
  const halfH = rect.h * 0.5 / (mapCam.grain * Projection.groundSquash);
  mapCam.x = halfW * 2 >= map.width ? map.width * 0.5 : clamp(mapCam.x, halfW, map.width - halfW);
  mapCam.y = halfH * 2 >= map.height ? map.height * 0.5 : clamp(mapCam.y, halfH, map.height - halfH);
}

/** 回到整幅。换地图、进这一步时都从这儿起步。 */
function resetMapCam(map: GameMapDef): void {
  const rect = mapRect();
  if (rect.w <= 0) return; // 这一步还没显示出来，量不到框；显示时会再走一次。
  mapCam.grain = mapFitGrain(map, rect);
  mapCam.x = map.width * 0.5;
  mapCam.y = map.height * 0.5;
  mapCam.dragging = false;
}

function mapViewOf(rect: MapView['rect']): MapView {
  return { rect, camX: mapCam.x, camY: mapCam.y, grain: mapCam.grain };
}

/**
 * 这一帧地图上要摆哪些点位。
 *
 * 三件事在这里一起决定，因为它们互相牵扯：
 *
 *   **在不在视野里**。在框里的画一个点；被拖出去的不是丢掉，而是贴到框边上画成一个指向它的
 *   箭头 —— 玩家放大之后仍然知道营地在哪个方向。
 *
 *   **写不写名字**。缩到整幅时几处营地会挤成一团，四个"营地"叠在一起谁也读不出来。所以按
 *   屏幕距离贪心地筛一遍：太近的不写字，再近的连点都并掉。留下来的那些字一定是看得清的。
 *
 *   **名字摆哪边**。贴着框右半边的点，字要摆到点的左边去，否则顶出框外。
 */
function mapPinsOf(map: GameMapDef, rect: { w: number; h: number }): MapPin[] {
  const spots: { x: number; y: number; label: string; kind: 'start' | 'camp' }[] = [
    { x: map.width * 0.5, y: map.height * 0.5, label: '进入位置', kind: 'start' },
  ];
  for (const prop of mapProps(map).list) spots.push({ x: prop.x, y: prop.y, label: '营地', kind: 'camp' });

  const pins: MapPin[] = [];
  const placed: { x: number; y: number; labelled: boolean }[] = [];
  const cx = rect.w * 0.5;
  const cy = rect.h * 0.5;
  spots.forEach((spot, index) => {
    const x = cx + (spot.x - mapCam.x) * mapCam.grain;
    const y = cy + (spot.y - mapCam.y) * Projection.groundSquash * mapCam.grain;
    const inside = x >= PIN_EDGE_INSET && x <= rect.w - PIN_EDGE_INSET
      && y >= PIN_EDGE_INSET && y <= rect.h - PIN_EDGE_INSET;

    if (!inside) {
      // 贴边指引：从框中心朝目标射一条线，落在框内缘上的那一点就是它该待的地方。
      const dx = x - cx;
      const dy = y - cy;
      const k = Math.min(
        Math.abs(dx) < 1e-3 ? Infinity : (cx - PIN_EDGE_INSET) / Math.abs(dx),
        Math.abs(dy) < 1e-3 ? Infinity : (cy - PIN_EDGE_INSET) / Math.abs(dy),
      );
      const ex = cx + dx * k;
      const ey = cy + dy * k;
      pins.push({
        u: ex / rect.w,
        v: ey / rect.h,
        // 进入位置一直写字（只有一个，不会挤）；营地贴边时只留箭头，四个"营地"沿着框边排开
        // 反而更乱。
        label: spot.kind === 'start' ? spot.label : '',
        kind: spot.kind,
        edge: true,
        angle: Math.atan2(dy, dx),
        flip: ex > cx,
      });
      return;
    }

    // 太近的先并掉，只留先来的那一个。第一个是进入位置，所以它永远留得住。
    if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < PIN_MERGE_GAP)) return;
    const crowded = placed.some((p) => p.labelled && Math.hypot(p.x - x, p.y - y) < PIN_LABEL_GAP);
    const labelled = index === 0 || !crowded;
    placed.push({ x, y, labelled });
    pins.push({
      u: x / rect.w,
      v: y / rect.h,
      label: labelled ? spot.label : '',
      kind: spot.kind,
      edge: false,
      angle: 0,
      flip: x > cx,
    });
  });
  return pins;
}

/** 换角色：形象 + 那一套默认技能。数值还没有，所以只有这两样。 */
function applyHero(hero: HeroDef): void {
  battle.setPreset(hero.preset);
  battle.skillLoadout.apply(hero.skills);
}

/**
 * 换地图：换那块地，也换那张出兵表。
 *
 * 地本身在备战界面选中这张图的时候就建好烘完了（见 fieldOf），所以这一步基本不花时间。
 *
 * 顺序要紧：人先挪到新场地的中央（setField 干这件事），镜头再跟过去。反过来的话
 * camera.follow 会按上一块地的尺寸去夹，而紧接着 reset 要靠 viewOf 决定把人生在哪儿 ——
 * 拿到一份指着旧地的视野，开场那一批人就全生在图外了。
 */
function applyMap(map: GameMapDef): void {
  battle.setSpawnTemplate(map.template);
  showField(map);
  battle.setField(field);
  camera.follow(battle.player.x, battle.player.y, field.width, field.height);
}

/**
 * 按下开始之后。
 *
 * 先把状态推到 entering 再让出一帧：换角色、清场、重新铺一批人加起来是看得见的一段卡顿，
 * 而"正在进入"那一层是 DOM，得等浏览器画一帧才出现。顺序反过来的话玩家盯着的是一个卡住
 * 不动的选图界面。
 */
function enterMap(hero: HeroDef, map: GameMapDef, weather: WeatherKind): void {
  state = 'entering';
  requestAnimationFrame(() =>
    setTimeout(() => {
      applyHero(hero);
      applyMap(map);
      // 天气用备战界面上选的那一档，不是地图自己写的默认值 —— 玩家刚在右栏点过，
      // 而且地图预览已经按那一档重烘过了，进去再换回来会是"我选的没作数"。
      //
      // settle 而不是只改 kind：地上该积的雪、该湿的地要一次到位。玩家在备战界面看到的
      // 就是稳定之后的样子（见 onWeatherChange），进去再从零慢慢积一遍是两张不同的图。
      field.weather.settle(weather);
      field.ground.bakeWeatherNow();
      battle.reset(viewOf());
      layout();
      // 零步长跑一次，让每个人先把姿势搭出来 —— 和开场那一次是同一个道理。
      battle.update(0, readInput(), viewOf());
      state = 'playing';
      pauseTarget = 'interlude';
      setup.hide();
      summary.hide();
      hud.setVisible(true);
      draw();
      controls.resume();
    }, 0),
  );
}

/**
 * 结算画面。三个按钮各自对应流程上的一条边，界面自己不知道有"状态"这回事。
 *
 * 建在 setup 之前 —— 它的 show 要读 setup.currentHero/currentMap（结算上要写清是谁在哪儿
 * 打的），但那只发生在按下 ESC 之后，那时两块界面都早就建好了。
 */
const summary = new SummaryScreen({
  onResume: () => controls.resume(),
  onEnd: () => endRun(),
  onConfirm: () => returnToSetup(),
});

const setup = new SetupScreen(
  {
    heroes: Roster,
    maps: GameMaps,
    portrait: heroPortrait,
    mapImage: mapCanvas,
    onHeroChange: (hero) => {
      preview.actor.def = heroUnitDef(hero);
      // 换人从头演一遍：不重置的话新角色可能正好接在"放招"那一拍上，一上来就抡一下。
      preview.beat = 0;
      preview.clock = 0;
      preview.actor.attack = -1;
      drawSetupScreen(0);
    },
    onMapChange: (map) => {
      // 中栏那张地图画的**就是这块地本身**（Scene.drawMapView 读的是 field），所以换图
      // 第一件事是把画面切过去 —— 不切的话，卡片换了、名字换了，中间那张图还是上一块地。
      showField(map);
      // 天气跟着走：备战界面在换图时会把选择重置成这张图自己的默认档（见 SetupScreen.selectMap），
      // 而地上积多少雪、湿到什么程度要一次到位，玩家看到的就该是稳定之后的样子。
      field.weather.settle(setup.currentWeather);
      field.ground.bakeWeatherNow();
      syncFoeActors(map);
      resetMapCam(map);
      drawSetupScreen(0);
    },
    onWeatherChange: (kind) => {
      // 备战地图展示稳定后的天气：地表直接积到目标状态，并当场整片重烘。局内自然天气仍使用
      // Weather.update + GroundSurface.update 的渐变过程。
      field.weather.settle(kind);
      field.ground.bakeWeatherNow();
      drawSetupScreen(0);
    },
    onStart: enterMap,
  },
  menu.text,
);

// 地图框：左键拖动看别处，滚轮缩放。
//
// 缩放**以光标为锚**：光标底下那一点在缩放前后落在同一个像素上。以框心为锚的话，玩家想看
// 角落里那处营地时得先放大再把它拖回来，每一次都要两步。
setup.mapFrame.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  mapCam.dragging = true;
  mapCam.dragX = event.clientX;
  mapCam.dragY = event.clientY;
});
/*
 * 松手就停，别的什么条件都没有。
 *
 * 这一条挂在 window 上而不是那个框上：按住之后拖出框外再松手是很常见的一下，只听框自己的
 * mouseup 就会漏掉，于是地图从此粘着鼠标走 —— 表现是"地图锁定了鼠标"。切走窗口（alt-tab）
 * 时同理，那时候连 mouseup 都不会来。
 */
addEventListener('mouseup', (event) => {
  if (event.button === 0) mapCam.dragging = false;
});
addEventListener('blur', () => {
  mapCam.dragging = false;
});

setup.mapFrame.addEventListener('mousemove', (event) => {
  if (!mapCam.dragging) return;
  const view = app.canvas.getBoundingClientRect();
  const kx = camera.viewWidth / Math.max(1, view.width);
  const ky = camera.viewHeight / Math.max(1, view.height);
  // 拖的是地图不是镜头，所以镜头往反方向走。
  mapCam.x -= ((event.clientX - mapCam.dragX) * kx) / mapCam.grain;
  mapCam.y -= ((event.clientY - mapCam.dragY) * ky) / (mapCam.grain * Projection.groundSquash);
  mapCam.dragX = event.clientX;
  mapCam.dragY = event.clientY;
});
setup.mapFrame.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const rect = mapRect();
    const view = app.canvas.getBoundingClientRect();
    const px = ((event.clientX - view.left) / Math.max(1, view.width)) * camera.viewWidth - rect.x - rect.w * 0.5;
    const py = ((event.clientY - view.top) / Math.max(1, view.height)) * camera.viewHeight - rect.y - rect.h * 0.5;
    // 缩放前光标指着世界的哪一点。
    const worldX = mapCam.x + px / mapCam.grain;
    const worldY = mapCam.y + py / (mapCam.grain * Projection.groundSquash);
    const fit = mapFitGrain(setup.currentMap, rect);
    const next = mapCam.grain * (event.deltaY <= 0 ? MAP_ZOOM_STEP : 1 / MAP_ZOOM_STEP);
    mapCam.grain = clamp(next, fit, MAP_ZOOM_MAX);
    // 缩放后把那一点挪回光标底下。
    mapCam.x = worldX - px / mapCam.grain;
    mapCam.y = worldY - py / (mapCam.grain * Projection.groundSquash);
  },
  { passive: false },
);

// ---------------------------------------------------------------- 开场

layout();

// 准星摆在人的正下方，也就是面朝镜头 —— 和玩家的初始朝向一致，不然第一帧人会先扭一下。
// 走相机的投影而不是缓冲中心：和每帧瞄准同一个原点，两处不会各算一套。
const start = camera.worldToScreen(battle.player.x, battle.player.y);
controls.placeCursor(start.x, start.y + 30);

await boot('布置战场');
battle.seed(viewOf());
bootDone += FIELD_WEIGHT;

// 先跑一个零步长的 update 再画。update(0) 不推进任何东西，但会让每个人把姿势搭出来 ——
// 少了这一步，开始画面上是一场景摆着未初始化骨架的人。
battle.update(0, readInput(), viewOf());
draw();

// 加载结束，直接进备战界面 —— 中间不再插一页只有"开始游戏"一个按钮的标题页，那一页
// 除了多一次点击什么也没给。"铁壁"这块招牌搬到了备战界面的顶栏上。
state = 'setup';
menu.hide();
hud.setVisible(false);
setup.show();
