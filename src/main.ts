import { Application } from 'pixi.js';
import { RigSpec } from './characters/rig';
import { Battle, PlayerPresets } from './game/battle';
import { Skills } from './game/skills';
import { ACTIVE_SKILL_CODES, type ActiveSkillSlot } from './game/skillLoadout';
import { Field } from './game/field';
import { ItemCatalog } from './items/catalog';
import { ItemSheet } from './items/renderer';
import { Camera } from './render/camera';
import { Projection } from './render/projection';
import { Scene } from './render/scene';
import type { WeatherKind } from './world/weather';
import { Controls } from './ui/controls';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
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
 * 游戏的四个状态。
 *
 *   loading —— 在烘地面，面板上是进度条。
 *   title   —— 烘完了，等玩家点一下。这一下不是仪式：指针锁定必须由一次真实的用户手势
 *               发起，没有那一下就进不了锁定状态。
 *   playing —— 指针锁着，世界在跑。
 *   paused  —— 指针丢了。
 *
 * playing 和 paused 的分界线就是**指针锁定在不在**，不是另一件事。所以没有一个处理器叫
 * "ESC 暂停"，监听的是丢锁定 —— 详见 Controls 里 pointerlockchange 上那段。
 */
type GameState = 'loading' | 'title' | 'playing' | 'paused';
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
  presets: PlayerPresets.map((p) => p.name),
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
  requestLock: () => controls.requestLock(),
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
const hud = new Hud(gameViewport);

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
  onLockChange: (locked) => {
    if (locked) {
      if (state === 'title' || state === 'paused') {
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
  canLock: () => state !== 'loading',
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
  if (code === 'Space') battle.swingNow();
  if (code === 'KeyK') showSkeleton = !showSkeleton;

  // 图鉴。暂停时面板得跟着让开，否则那张图正好被遮罩盖住 —— 状态归这里管，所以由这里
  // 告诉面板该显示成哪样，菜单自己不知道有"图鉴"这回事。
  //
  // 载入期间直接不认这个键：那时候按下去，开关翻了但一帧都画不出来，等启动结束那次 draw
  // 就会画成图鉴而不是战场 —— 玩家只看到一屏对不上的东西，还不知道自己按过什么。
  if (code === 'KeyI' && state !== 'loading') {
    showItems = !showItems;
    // 开始画面也能看：想核对一件东西画成什么样，不该逼人先开一局再暂停。
    if (state === 'paused' || state === 'title') {
      if (showItems) menu.showGallery(galleryCount());
      else if (state === 'paused') menu.showPause();
      else menu.showTitle();
    }
    // 暂停和开始画面都没有帧在跑，这一下得自己补一帧，和改颗粒度、拖窗口是同一个道理。
    draw();
  }
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

  // 出兵批量：一次涌上来几个。
  if (code === 'Semicolon') battle.nudgeSpawnBatch(-1);
  if (code === 'Quote') battle.nudgeSpawnBatch(1);

  // 人数硬上限。这不是玩法旋钮，是性能兜底 —— 场上有多少人由跑步机自己定，见 DESPAWN_MARGIN。
  if (code === 'Comma') battle.maxEnemies = Math.max(200, battle.maxEnemies - 250);
  if (code === 'Period') battle.maxEnemies = Math.min(6000, battle.maxEnemies + 250);

  // 放大：一个像素多大。只走整数。
  if (code === 'BracketLeft') camera.nudgeMagnify(-1);
  if (code === 'BracketRight') camera.nudgeMagnify(1);

  const digit = code.startsWith('Digit') ? Number(code.slice(5)) : NaN;
  if (digit >= 1 && digit <= PlayerPresets.length) battle.setPreset(digit - 1);
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
  if (state !== 'playing') return;
  lastFps = ticker.FPS;
  layout();
  // dt 夹在二十分之一秒：暂停期间 ticker 照常在跑，所以回来时并不会攒出一个大步长，但切
  // 后台、断点、掉帧都会，夹一下省得人一口气瞬移出去。
  const dt = Math.min(ticker.deltaMS / 1000, 1 / 20);
  battle.update(dt, readInput(), viewOf());
  draw();
});

// 开始画面和暂停时没有帧在跑，窗口尺寸变了得自己补一帧，否则画面会一直停在旧尺寸那张图上。
addEventListener('resize', () => {
  if (state === 'title' || state === 'paused') {
    layout();
    draw();
  }
});

/** 把缓冲和镜头对齐到固定逻辑画幅、颗粒度和玩家位置。窗口变化只影响 CSS 外框。 */
function layout(): void {
  scene.resize(app.screen.width, app.screen.height, app.renderer.resolution);
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
    cursor: controls.cursor,
    showReticle: controls.pointerLocked,
    showSkeleton,
  });
}

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

// 加载结束。接下来那一下点击不是仪式：指针锁定必须由一次真实的用户手势发起，而"开始游戏"
// 就是那一下。锁上之后 pointerlockchange 会把状态推进到 playing。
state = 'title';
menu.showTitle();
