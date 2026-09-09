import { Application } from 'pixi.js';
import { RigSpec } from './characters/rig';
import { PALETTE_HERO } from './characters/palette';
import { Battle, HUMAN_PACE, PLAYER_RUN_SPEED, PLAYER_SPEED, PlayerPresets, playerPresetDisplayName } from './game/battle';
import { Character } from './game/character';
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
import { Projection } from './render/projection';
import { Scene } from './render/scene';
import { Props } from './world/props';
import { Terrain } from './world/terrain';
import type { WeatherKind } from './world/weather';
import { Controls } from './ui/controls';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
import { SetupScreen, type MapPin, type SetupStep } from './ui/setup';
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
 * 游戏的五个状态。
 *
 *   loading  —— 在烘地面，面板上是进度条。
 *   setup    —— 备战：选角色 → 选地图。烘完就直接进这里，没有单独的标题页。
 *   entering —— 按下开始之后那一小段：界面盖着"正在进入"，底下在换角色、清场、铺人。
 *   playing  —— 世界在跑。
 *   paused   —— ESC、暂停按钮或失去窗口焦点。
 *
 * Controls 统一切换运行状态；鼠标始终使用普通屏幕坐标，暂停不移动光标。
 */
type GameState = 'loading' | 'setup' | 'entering' | 'playing' | 'paused';
let state: GameState = 'loading';

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
  requestPause: () => {
    if (state !== 'playing') return;
    controls.pause();
  },
});

const scene = new Scene(app.renderer, camera);
app.stage.addChild(scene.view);
// 缓冲尺寸立刻就要定下来：铺场要按视野半径算生成圈，准星要按人的屏幕位置摆，而这两件事都
// 得在加载期间做完 —— 那时还一帧都没跑过，指望不上主循环里那次 resize。
scene.resize(app.screen.width, app.screen.height, app.renderer.resolution);
bootDone += RENDERER_WEIGHT;

await boot('生成地形');
const field = new Field(FIELD_W, FIELD_H, FIELD_SEED);
scene.attachField(field);
bootDone += TERRAIN_WEIGHT;

for (let i = 0; i < Field.BAKE_SLICES; i++) {
  await boot('烘制地面');
  field.bakeSlice(i);
  bootDone += 1;
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
      if (state === 'paused') {
        state = 'playing';
        menu.hide();
      }
      return;
    }
    if (state === 'playing') {
      state = 'paused';
      menu.showPause();
    }
  },
  // 备战界面盖在画布上，点它不该把游戏"继续"起来 —— 那时候还没选完地图。
  canActivate: () => state === 'playing' || state === 'paused',
});

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
  // 备战界面上一个调试键都不认：那些开关全是对着战场的，而战场还没开始。Shift 不走这条路
  // （跑步读的是 Controls 自己的按键集合），所以试练地上照样能跑。
  if (state === 'setup' || state === 'entering') return;

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
  // 备战界面：世界冻着，动的只有中间那一块 —— 选人时是试练地上那个人，选图时是底下那排敌人。
  if (state === 'setup' || state === 'entering') {
    const dt = Math.min(ticker.deltaMS / 1000, 1 / 20);
    if (setup.showsHeroStage) {
      updatePreview(dt);
      drawHeroStage();
    } else if (setup.showsFoeStage) {
      updateFoes(dt);
      drawMapStep();
    }
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
});

// 开始画面和暂停时没有帧在跑，窗口尺寸变了得自己补一帧，否则画面会一直停在旧尺寸那张图上。
addEventListener('resize', () => {
  if (state === 'setup' || state === 'entering') {
    scene.resize(app.screen.width, app.screen.height, app.renderer.resolution);
    if (setup.showsHeroStage) drawHeroStage();
    else if (setup.showsFoeStage) drawMapStep();
    return;
  }
  if (state === 'paused') {
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
/** 敌人和头像侧过来一点。正对镜头时武器在身体正前方，被自己挡掉一半。 */
const PREVIEW_TURN = 0.38;

/**
 * 站在试练地上的那个人。
 *
 * 用一个真的 Character 而不是自己搭一份姿势：待机的呼吸、走和跑的步态、武器怎么握、披风
 * 怎么甩，全在 CharacterAnimator 里，重写一份迟早和场上那个人长得不一样。走和跑的速度也
 * 直接用战斗那两档 —— 这里试出来的手感就是进去之后的手感。
 */
const preview = new Character(heroUnitDef(Roster[0]), PALETTE_HERO, HUMAN_PACE);
preview.facing = Math.PI * 0.5;

/**
 * 光标在试练地上的位置（缓冲像素）、按住了没有，以及走过的路。
 *
 * aiming 只在光标**落在那个框里**的时候为真。整屏都能转向的话，玩家在右栏读技能说明时，
 * 中间那个人会跟着鼠标转圈 —— 那不是他在做的事。
 */
const stage = { x: 0, y: 0, aiming: false, moving: false, scrollX: 0, scrollY: 0 };

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

/** 把一次鼠标事件换算成缓冲坐标。和 Controls.syncCursor 是同一笔换算。 */
function trackStagePointer(event: MouseEvent): void {
  const view = app.canvas.getBoundingClientRect();
  stage.x = ((event.clientX - view.left) / Math.max(1, view.width)) * camera.viewWidth;
  stage.y = ((event.clientY - view.top) / Math.max(1, view.height)) * camera.viewHeight;
  stage.aiming = true;
}

/**
 * 试练地上的一帧：转向、走、跑。
 *
 * 和战斗里那套输入是同一个形状 —— 朝向跟着光标，按住左键往那个方向走，Shift 是跑。区别只有
 * 一处：**人不动，草动**。走的距离累加到 scroll 上，草丛按它的反方向流过去。
 *
 * 跑步状态直接读 Controls：它的键盘监听挂在 window 上，备战界面盖着画布也照样收得到 Shift。
 */
function updatePreview(dt: number): void {
  const anchor = stageAnchor();
  if (stage.aiming) {
    const dx = stage.x - anchor.x;
    // 屏幕纵向是被压扁过的，除回去才是地面上的方向 —— 和 Camera.aimAngle 同一笔账。
    const dy = (stage.y - anchor.y) / Projection.groundSquash;
    if (Math.hypot(dx, dy) > 1) preview.facing = Math.atan2(dy, dx);
  }
  preview.speed = stage.moving ? (controls.running ? PLAYER_RUN_SPEED : PLAYER_SPEED) : 0;
  stage.scrollX += Math.cos(preview.facing) * preview.speed * dt;
  stage.scrollY += Math.sin(preview.facing) * preview.speed * dt;
  preview.update(dt, true);
}

function drawHeroStage(): void {
  scene.drawStages(field, [
    {
      actor: preview,
      at: stageAnchor(),
      grain: HERO_GRAIN,
      scrollX: stage.scrollX,
      scrollY: stage.scrollY,
      tileScale: HERO_TILE_ZOOM,
    },
  ]);
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
 * 选图那一步的一帧：地图 + 底下那排敌人 + 地图上的点位。
 *
 * 顺序是**先量后写**：量框的位置会逼浏览器立刻算一遍布局，而写点位的位置又会把布局作废。
 * 两者交替着来，每一帧都要多算好几遍版 —— 拖动地图时那就是看得见的卡顿。所以框的尺寸这一
 * 帧只量一次，点位最后一起写。
 */
function drawMapStep(): void {
  const map = setup.currentMap;
  const rect = mapRect();
  if (rect.w <= 0 || rect.h <= 0) return;
  if (mapCam.grain <= 0) resetMapCam(map);
  clampMapCam(map, rect);
  drawFoeStage(mapViewOf(rect));
  setup.setMapPins(mapPinsOf(map, rect));
}

function drawFoeStage(map: MapView | null = null): void {
  const slots = setup.foeSlots;
  const stages: StageFigure[] = [];
  for (let i = 0; i < foeActors.length && i < slots.length; i++) {
    const box = boxToBuffer(slots[i]);
    stages.push({
      actor: foeActors[i],
      // 地块中心落在格子偏下的位置：人从脚往上画，头顶那一半留给他和他举起来的武器。
      at: v2(Math.round(box.x + box.w * 0.5), Math.round(box.y + box.h * 0.74)),
      grain: FOE_GRAIN,
      scrollX: foeScroll[i].x,
      scrollY: foeScroll[i].y,
    });
  }
  scene.drawStages(field, stages, map);
}

/** 一个角色的头像。列表和底栏都要，画一次存着，见 SetupScreen.portraitOf。 */
function heroPortrait(hero: HeroDef): HTMLCanvasElement | null {
  const model = new Character(heroUnitDef(hero), PALETTE_HERO, HUMAN_PACE);
  model.facing = Math.PI * 0.5 + PREVIEW_TURN;
  // 走几帧把姿势搭出来 —— 没跑过 update 的骨架是一堆零。
  for (let i = 0; i < 20; i++) model.update(1 / 60, true);
  // 64 见方，脚落在纹理下沿之外 —— 于是画面从胸口往上截断，头盔、肩甲和武器都在。
  return scene.renderPortrait(model.pose, model.def, PALETTE_HERO, 64, 64, 6.5, 91, model.facing);
}

/**
 * 这张地图对应的地形。
 *
 * 就是当前这块场地时直接用它 —— 生成一份地形要几十毫秒，而这一份已经烘在画面上了。
 * 换成别的图时才现生成一份，那时它本来就还没存在。
 */
function terrainOf(map: GameMapDef): Terrain {
  if (map.width === field.width && map.height === field.height && map.seed === FIELD_SEED) {
    return field.terrain;
  }
  return new Terrain(map.width, map.height, map.seed);
}

/** 地图底图烘一次就存着：一张四百乘二百二的 RGBA，烘一次几十毫秒。 */
const mapPixels = new Map<string, ImageData | null>();

function mapImageData(map: GameMapDef): ImageData | null {
  if (!mapPixels.has(map.id)) {
    // 天气传 null：卡片上该是这块地本来的样子，不该跟着局内下不下雪变。
    const baked = terrainOf(map).bakeGround(null);
    const pixels = new ImageData(new Uint8ClampedArray(baked.data), baked.texWidth, baked.texHeight);
    mapPixels.set(map.id, pixels);
  }
  return mapPixels.get(map.id) ?? null;
}

/**
 * 这张地图上的营地。
 *
 * Props.place 是确定性的（同一份地形、同一个种子摆在同一处），所以这里摆出来的就是进去
 * 之后看到的那几处。存一份是因为点位每帧都要算一遍，而摆营地要在地形上试探几百次。
 */
const mapPropsCache = new Map<string, Props>();

function mapProps(map: GameMapDef): Props {
  let props = mapPropsCache.get(map.id);
  if (!props) {
    props = new Props();
    props.place(terrainOf(map), 4);
    mapPropsCache.set(map.id, props);
  }
  return props;
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
 * 按下开始之后。
 *
 * 先把状态推到 entering 再让出一帧：换角色、清场、重新铺一批人加起来是看得见的一段卡顿，
 * 而"正在进入"那一层是 DOM，得等浏览器画一帧才出现。顺序反过来的话玩家盯着的是一个卡住
 * 不动的选图界面。
 */
function enterMap(hero: HeroDef, map: GameMapDef): void {
  state = 'entering';
  requestAnimationFrame(() =>
    setTimeout(() => {
      applyHero(hero);
      field.weather.kind = map.weather;
      // 换地图本来还要重烘地面（Field 就是宽、高、种子三个数），但目前只有一张图，而它正是
      // 启动时烘好的那一份。加第二张图时，这里要多一步重建 Field 并重跑烘制那一段进度条。
      battle.reset(viewOf());
      layout();
      // 零步长跑一次，让每个人先把姿势搭出来 —— 和开场那一次是同一个道理。
      battle.update(0, readInput(), viewOf());
      state = 'playing';
      setup.hide();
      hud.setVisible(true);
      draw();
      controls.resume();
    }, 0),
  );
}

const setup = new SetupScreen(
  {
    heroes: Roster,
    maps: GameMaps,
    portrait: heroPortrait,
    mapImage: mapCanvas,
    onHeroChange: (hero) => {
      preview.def = heroUnitDef(hero);
      drawHeroStage();
    },
    onMapChange: (map) => {
      syncFoeActors(map);
      resetMapCam(map);
      drawMapStep();
    },
    onStepChange: (step: SetupStep) => {
      if (step === 'hero') {
        drawHeroStage();
        return;
      }
      // 选图那一步画布上换成地图加底下那排敌人。人物台那块地必须擦掉，不然会从地图边上露出来。
      syncFoeActors(setup.currentMap);
      resetMapCam(setup.currentMap);
      drawMapStep();
    },
    onStart: enterMap,
  },
  menu.text,
);

// 试练地的鼠标**只挂在那个框上**：光标出了框就不再转向，也不该在读右栏技能说明的时候
// 把中间那个人拽得团团转。松手挂在 window 上 —— 按下之后拖出框外再松手，也得停下来。
setup.heroStage.addEventListener('mousemove', (event) => trackStagePointer(event));
setup.heroStage.addEventListener('mouseleave', () => {
  stage.aiming = false;
  stage.moving = false;
});
setup.heroStage.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  trackStagePointer(event);
  stage.moving = true;
});
addEventListener('mouseup', (event) => {
  if (event.button === 0) {
    stage.moving = false;
    mapCam.dragging = false;
  }
});

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
