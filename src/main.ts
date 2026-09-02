import { Application, Graphics, Text } from 'pixi.js';
import { clamp, v2 } from './core/math';
import { PALETTE_BLUE, PALETTE_PEASANT, PALETTE_RED, type CharacterPalette } from './characters/palette';
import { drawCharacter, drawSkeleton } from './characters/renderer';
import { RigSpec } from './characters/rig';
import { type UnitDef, UnitPresets } from './characters/unitDef';
import { ImpactEffects, weaponImpactPoint } from './effects/impact';
import { Character } from './game/character';
import { inAttackArc } from './game/combat';
import { isFreeSpot, moveWithCollision } from './game/collision';
import { PixelSurface } from './render/pixelSurface';
import { Projection } from './render/projection';
import { Projector } from './render/projector';
import { ShapeBatch } from './render/shapeBatch';
import { Terrain } from './world/terrain';
import { Weather, type WeatherKind } from './world/weather';
import { GroundSurface } from './world/groundSurface';
import { Props } from './world/props';
import { FootstepEffects } from './effects/footsteps';
import './style.css';

// 最小的战斗循环：武将站在场中央，杂兵从屏幕外源源不断走过来，锤子的冲击弧扫到谁谁倒。
// 还没有寻路、没有敌人攻击、没有血量 —— 先把手感跑起来。

/**
 * 人的写实步行速度，世界单位/秒（一个人大约 19 单位高）。
 *
 * 只用来给动画做归一化：动画器拿它判断"这个速度算走还是算跑"，从而决定步态混合、
 * 摆臂幅度和斗篷的甩动。它描述的是身体，不是游戏手感，所以调玩家速度时不要动它 ——
 * 移动速度翻倍之后，人相对这个基准就是在跑，斗篷和步幅会自己跟上去。
 */
const HUMAN_PACE = 16;

/** 玩家的基础移动速度。 */
const PLAYER_SPEED = 32;
/** 按住 Shift 的速度。 */
const PLAYER_RUN_SPEED = 60;

/**
 * 画面的颗粒度由两个正交的旋钮决定，两个都能在运行时调：
 *
 *   grain  —— 投影缩放，决定**人由多少个像素构成**。1 是 overlord 的出货尺寸（人约 12
 *             像素高），越大人身上的像素越细。超过 2 会打开细节层级（甲片、金边这些）。
 *   magnify —— 一个缓冲像素在屏幕上占多少个物理像素，决定**一个像素有多大**。必须是整数，
 *             否则最近邻放大会让某些像素比邻居宽一格，那正是像素画最典型的抖动。
 *
 * 两者的乘积才是人在屏幕上的大小。想要"同样大小、更细的颗粒"就调高 grain、调低 magnify。
 *
 * 定下来的值是 grain 3 / magnify 2：人 37 像素高，屏幕上 74 物理像素。这是几档里观感最好
 * 的一档 —— 再粗脸就糊成一团，再细像素感就没了。改之前先跑 `npm run figures` 看对照图。
 *
 * 滚轮调的是 grain，因为要看的是"更多的地"而不是"更小的像素"。范围放到 0.22 是为了
 * 让整片 3200 单位宽的场地能塞进一屏 —— 那是调试用的全景，不是给玩家的视野。
 */
let grain = 3;
let magnify = 2;

/** 滚轮每一格的缩放系数，以及能拉到的两头。 */
const ZOOM_STEP = 1.14;
const MIN_GRAIN = 0.22;
const MAX_GRAIN = 8;

const app = new Application();
await app.init({
  resizeTo: window,
  background: '#0b0d12',
  antialias: false,
  // 这两个是清晰度的关键。默认 resolution 是 1：在 125%/150% 缩放的屏幕上，画布只按 CSS
  // 尺寸出图，再被浏览器用双线性插值拉到物理像素上 —— 于是整个画面糊掉，而且是"最近邻
  // 放大之后又被重新插值"这种最难看的糊法。
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
});
document.querySelector<HTMLDivElement>('#app')!.appendChild(app.canvas);

const surface = new PixelSurface(app.renderer, magnify);
app.stage.addChild(surface.view);

// ---------------------------------------------------------------- 野战场

// 正方形，边长 1200 个世界单位 —— 一个人 19 单位高，所以是六十三个人宽，
// 大约是原来那块横向场地面积的四分之一多一点。四条边铺满树，边界是看得见的。
const FIELD_W = 1200;
const FIELD_H = 1200;

const terrain = new Terrain(FIELD_W, FIELD_H, 20260902);
const weather = new Weather();
const footsteps = new FootstepEffects();

/**
 * 地面分两层，分界线是"变得有多快"。
 *
 *   底图  —— 材质、色阶、积雪、水洼。慢变，烘成一张纹理，天气跨档时分帧重烘。
 *   云影  —— 连续飘动，每帧重传一张很小的图，正片叠底压上去。
 *
 * 草丛、石子、落叶**没有**烘进去，虽然它们确实不会变。原因是分辨率：地面纹理一个纹素
 * 是三个世界单位，而一丛草才两个单位宽、六个缓冲像素高 —— 比一个纹素还小。要烘它们得把
 * 纹理放大三十倍，整片场地就是一亿像素、四百兆显存。它们留在每帧的批次里还有两个好处：
 * 能随风摆、能被雪压短，也能和站在草里的人正确排序。代价是每帧一千多个图元，约等于
 * 二十个人。
 */
const ground = new GroundSurface(terrain, weather);
surface.ground.addChild(ground.sprite, ground.shadowSprite);

// 营地：帐篷和篝火。和树的区别在于**摆**还是**长** —— 树按噪声撒在林地里，营地是人选的
// 位置，所以它是一个显式列表。
const props = new Props();
props.place(terrain, 4);

// ---------------------------------------------------------------- 场上的人

const shapes = new ShapeBatch();
const effects = new ImpactEffects();
const figure = new Graphics();
const reticle = new Graphics();
surface.units.addChild(figure, reticle);

const playerPresets: { name: string; make: () => UnitDef }[] = [
  { name: 'warlord 武将 双锤', make: UnitPresets.warlord },
  { name: 'hero 披风剑士', make: UnitPresets.hero },
  { name: 'thug 杂兵', make: UnitPresets.thug },
  { name: 'shieldman 持盾兵', make: UnitPresets.shieldman },
  { name: 'spearman 长枪兵', make: UnitPresets.spearman },
  { name: 'archer 弓手', make: UnitPresets.archer },
  { name: 'elite 精英', make: UnitPresets.elite },
];

let presetIndex = 0;
/** 镜头中心的世界坐标。跟随玩家，但被夹在场地内。 */
const camera = { x: FIELD_W * 0.5, y: FIELD_H * 0.5 };
const PLAYER_HP = 20;
const player = new Character(playerPresets[0].make(), PALETTE_BLUE, HUMAN_PACE);
player.facing = Math.PI * 0.5; // 面朝镜头
player.x = FIELD_W * 0.5;
player.y = FIELD_H * 0.5;
player.maxHp = PLAYER_HP;
player.hp = PLAYER_HP;
let deaths = 0;

/**
 * 敌人的种类。def 和调色板是共享的只读数据，一百个杂兵指向同一份就够了。
 *
 * 速度是按"多久能走进画面"倒推的，不是按写实的步行速度。视野半径有两百多个世界单位
 * （一个人才 19 单位高），照真人步速走进来要半分钟 —— 开局一整分钟画面上什么都不会发生。
 * 割草游戏里的杂兵本来也是小跑着扑过来的。
 */
const enemyKinds: { def: UnitDef; palette: CharacterPalette; speed: number }[] = [
  { def: UnitPresets.thug(), palette: PALETTE_RED, speed: 26 },
  { def: UnitPresets.thug(), palette: PALETTE_PEASANT, speed: 30 },
  { def: UnitPresets.spearman(), palette: PALETTE_RED, speed: 23 },
  { def: UnitPresets.shieldman(), palette: PALETTE_RED, speed: 20 },
  { def: UnitPresets.archer(), palette: PALETTE_PEASANT, speed: 33 },
];

const enemies: Character[] = [];
/**
 * 同屏上限，运行时可调（逗号/句号）。
 *
 * 一开始定在 90 是出于对渲染开销的担心：每个人六十多个图元，每帧全部重新灌进一个
 * Graphics 重新三角化并重传顶点缓冲。那件事确实在发生，但 Pixi 的批处理器远比预期快，
 * 几千个图元不是问题 —— 这个上限是猜的，不是量出来的。
 *
 * 所以做成可调的，并且 HUD 上给的是**每帧毫秒数**而不是只看 fps：fps 会被垂直同步顶住，
 * 120 帧既可能是 3 毫秒的大把余量，也可能是 8.2 毫秒的将将够用，两者看起来一模一样。
 */
let maxEnemies = 90;
// 出怪间隔。玩家清场的速度约每秒三个，所以这个值定得比它快不少，场面才会一直是满的 ——
// 割草游戏的压迫感来自"杀不完"，出怪率一旦低于清场速度，画面就空了。
const SPAWN_INTERVAL = 0.18;
let spawnTimer = 0;
let kills = 0;

/** 玩家两次挥击之间的间隙，秒。动作本身的时长之外再等这么久。 */
const PLAYER_SWING_GAP = 0.16;
/** 敌人两次出手之间的间隙，秒。给一段随机量，免得一圈人整齐划一地同时挥。 */
const ENEMY_SWING_GAP = 1.15;
const ENEMY_SWING_JITTER = 0.7;
let autoAttack = true;

let showSkeleton = false;

/**
 * 每帧我们自己花掉的毫秒数，指数平滑。
 *
 * 分成两段量：sim 是逻辑（AI、分离、判定），build 是把这一帧的图元算出来并交给 Pixi
 * （含 Graphics 的几何重建）。真正的 GPU 时间量不到，但那从来不是这里的瓶颈 —— 画面
 * 先被画进一个小缓冲再放大，填充率低得可以忽略，开销全在 CPU 侧的几何上。
 */
const timing = { sim: 0, build: 0 };
const smooth = (prev: number, now: number) => prev * 0.9 + now * 0.1;

// ---------------------------------------------------------------- 输入

/**
 * 指针锁定下浏览器不再给绝对坐标，只给 movementX/Y 增量，所以准星的位置得自己攒。
 * 这也正是要把它画出来的原因：系统光标已经隐藏了，不画就没有任何东西告诉玩家"朝向"
 * 到底指着哪儿。位置存在缓冲像素坐标里，和人物的投影用同一套坐标。
 */
const cursor = { x: 0, y: 0 };
let cursorReady = false;
let pointerLocked = false;
let moving = false;

const canvas = app.canvas;

canvas.addEventListener('mousedown', (e) => {
  if (!pointerLocked) {
    // 这一下只用来夺取指针，不当成移动指令 —— 否则每次点进画面人都会先窜一步。
    //
    // 新版浏览器让 requestPointerLock 返回 Promise，而刚按过 ESC 之后的一小段冷却期里它会
    // 直接 reject。那是正常的用户操作，不该在控制台里留一条未捕获的拒绝。
    const request = canvas.requestPointerLock?.() as Promise<void> | undefined;
    request?.catch?.(() => {});
    return;
  }
  if (e.button === 0) moving = true;
});

// 锁定状态下右键菜单会顶掉指针锁定。
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('mouseup', (e) => {
  if (e.button === 0) moving = false;
});

// ESC 由浏览器自己处理：它会退出指针锁定并触发这个事件，不需要（也不允许）我们拦截。
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked) moving = false;
});

/**
 * 滚轮缩放。乘性步进而不是加性 —— 缩放在感觉上是几何的，每一格该是"再放大一成"，
 * 而不是"再加 0.5"，否则拉远时越来越慢、拉近时越来越粗暴。
 */
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const step = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    grain = clamp(grain * step, MIN_GRAIN, MAX_GRAIN);
  },
  { passive: false },
);

addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  // movementX/Y 是 CSS 像素，缓冲是物理像素除以放大倍数，所以两次换算。
  const perCssPixel = (app.renderer.resolution || 1) / magnify;
  cursor.x = clamp(cursor.x + e.movementX * perCssPixel, 0, surface.width);
  cursor.y = clamp(cursor.y + e.movementY * perCssPixel, 0, surface.height);
});

const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (!keys.has(e.code)) onKeyPressed(e.code);
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));

function onKeyPressed(code: string): void {
  if (code === 'Space') player.swing();
  if (code === 'KeyK') showSkeleton = !showSkeleton;
  if (code === 'KeyF') autoAttack = !autoAttack;

  // 天气。切换的是"在下什么"，地上积多少雪、湿到什么程度会自己慢慢跟上来。
  if (code === 'KeyT') {
    const order: WeatherKind[] = ['clear', 'rain', 'snow'];
    weather.kind = order[(order.indexOf(weather.kind) + 1) % order.length];
  }
  if (code === 'KeyC') weather.cloudiness = weather.cloudiness > 0.05 ? 0 : 0.55;
  if (code === 'KeyG') weather.windSpeed = weather.windSpeed > 0.6 ? 0.1 : 0.9;
  if (code === 'KeyR') {
    enemies.length = 0;
    kills = 0;
    player.death = -1;
    player.hp = player.maxHp;
    seedField();
  }

  // 颗粒度：人由多少像素构成。
  if (code === 'Minus') grain = clamp(grain / ZOOM_STEP, MIN_GRAIN, MAX_GRAIN);
  if (code === 'Equal') grain = clamp(grain * ZOOM_STEP, MIN_GRAIN, MAX_GRAIN);
  // 一键回到出货尺寸。调试拉远之后找回来，比一格一格滚回去快。
  if (code === 'Digit0') grain = 3;

  // 同屏上限。往上顶到帧时间开始涨为止，那才是真正的天花板。
  if (code === 'Comma') maxEnemies = Math.max(10, maxEnemies - 30);
  if (code === 'Period') maxEnemies = Math.min(1200, maxEnemies + 30);

  // 放大：一个像素多大。只走整数。
  if (code === 'BracketLeft') magnify = clamp(magnify - 1, 1, 8);
  if (code === 'BracketRight') magnify = clamp(magnify + 1, 1, 8);

  const digit = code.startsWith('Digit') ? Number(code.slice(5)) : NaN;
  if (digit >= 1 && digit <= playerPresets.length) {
    presetIndex = digit - 1;
    player.def = playerPresets[presetIndex].make();
    player.hp = player.maxHp;
  }
}

// ---------------------------------------------------------------- HUD

const hud = new Text({
  text: '',
  style: { fill: 0x9aa4bb, fontSize: 13, fontFamily: 'monospace', lineHeight: 18 },
});
hud.position.set(12, 10);
app.stage.addChild(hud);

// ---------------------------------------------------------------- 出生

/** 视野在世界坐标里的半径。敌人要生成在这个圈之外，玩家才看不见他们凭空出现。 */
function viewRadius(): number {
  const halfW = (surface.width * 0.5) / grain;
  const halfH = (surface.height * 0.5) / (grain * Projection.groundSquash);
  return Math.hypot(halfW, halfH);
}

function spawnEnemy(distance?: number): void {
  const kind = enemyKinds[Math.floor(Math.random() * enemyKinds.length)];
  const e = new Character(kind.def, kind.palette, kind.speed);

  // 沿着视野圈外的一圈随机放，但必须落在场内、并且不在水里。试几次，实在找不到就贴到
  // 场地边上 —— 玩家走到角落时，圈上大半个方向都在场外，硬要那个方向就会一个也生不出来。
  let x = 0;
  let y = 0;
  const base = distance ?? viewRadius() + 15;
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const r = base + Math.random() * 45;
    x = player.x + Math.cos(angle) * r;
    y = player.y + Math.sin(angle) * r;
    const inside = x > 20 && x < FIELD_W - 20 && y > 20 && y < FIELD_H - 20;
    if (inside && isFreeSpot(terrain, props, x, y, e.radius)) break;
    x = clamp(x, 20, FIELD_W - 20);
    y = clamp(y, 20, FIELD_H - 20);
  }
  e.x = x;
  e.y = y;
  e.facing = Math.atan2(player.y - y, player.x - x);
  // 随机的初始冷却，免得同一批出生的人到了跟前整齐划一地同时出手。
  e.attackCooldown = Math.random() * ENEMY_SWING_GAP;
  enemies.push(e);
}

/**
 * 开局先在场上铺一批，从很近到视野边缘都有。
 *
 * 不铺的话，第一个敌人得从视野外走进来，前几秒是一片空地 —— 而这几秒恰恰是要给人看的
 * 那几秒。铺一批之后一进画面就有活干，后面靠持续出怪接上。
 */
function seedField(): void {
  const r = viewRadius();
  for (let i = 0; i < 30; i++) spawnEnemy(30 + Math.random() * (r - 30));
}
let seeded = false;

// ---------------------------------------------------------------- 主循环

app.ticker.add((ticker) => {
  const tSim = performance.now();
  const dt = Math.min(ticker.deltaMS / 1000, 1 / 20);
  surface.scale = magnify;
  surface.resize(app.screen.width, app.screen.height, app.renderer.resolution);

  // 相机。
  //
  // 人不再钉死在屏幕中心：场地是有边界的，镜头贴着边走出去就会露出场外的虚空。所以镜头
  // 跟随玩家、但被夹在场内，玩家走到角落时是他在画面上偏出去，而不是画面跟着飘出场。
  // 场地在某个轴上比视野还小时就居中 —— 夹取的上下界会交叉，不特判会抖。
  const halfW = surface.width * 0.5 / grain;
  const halfH = surface.height * 0.5 / (grain * Projection.groundSquash);
  camera.x = FIELD_W <= halfW * 2 ? FIELD_W * 0.5 : clamp(player.x, halfW, FIELD_W - halfW);
  camera.y = FIELD_H <= halfH * 2 ? FIELD_H * 0.5 : clamp(player.y, halfH, FIELD_H - halfH);

  const rootX = Math.round(surface.width * 0.5);
  const rootY = Math.round(surface.height * 0.5);

  // 首帧才知道缓冲多大。放在人的正下方，也就是面朝镜头 —— 和初始朝向一致，
  // 不然第一帧人会先扭一下。
  if (!cursorReady && surface.width > 0) {
    cursor.x = rootX;
    cursor.y = rootY + 30;
    cursorReady = true;
  }

  // 视野半径要等缓冲尺寸出来才算得出来，所以铺场放在首帧而不是模块顶层。
  if (!seeded && surface.width > 0) {
    seedField();
    seeded = true;
  }

  // ---- 玩家

  // 朝向 = 从人指向准星。
  //
  // 屏幕的纵向被相机压扁了 groundSquash 倍，所以不能直接对屏幕增量取 atan2 —— 那样人会
  // 明显地"看不准"，越接近正上/正下偏得越多。先把纵向除回去还原成地面平面上的方向，
  // 再取角度，人的前轴投影回屏幕才真正压在准星上。
  const aimX = cursor.x - rootX;
  const aimY = (cursor.y - rootY) / Projection.groundSquash;
  if (Math.hypot(aimX, aimY) > 0.5) player.facing = Math.atan2(aimY, aimX);

  const target = keys.has('ShiftLeft') || keys.has('ShiftRight') ? PLAYER_RUN_SPEED : PLAYER_SPEED;
  if (moving) {
    player.speed = target;
    const to = moveWithCollision(
      terrain,
      props,
      player.radius,
      player.x,
      player.y,
      clamp(player.x + Math.cos(player.facing) * target * dt, 12, FIELD_W - 12),
      clamp(player.y + Math.sin(player.facing) * target * dt, 12, FIELD_H - 12),
    );
    player.x = to.x;
    player.y = to.y;
  } else {
    player.speed = 0;
  }

  // ---- 出怪

  spawnTimer += dt;
  while (spawnTimer >= SPAWN_INTERVAL) {
    spawnTimer -= SPAWN_INTERVAL;
    if (enemies.length < maxEnemies) spawnEnemy();
  }

  // ---- 自动攻击
  //
  // 只在有敌人进入攻击距离时才挥。不加这个条件，人在空地上也会一直挥，那既费眼睛也让
  // "他打到东西了"这件事失去分量。触发距离用的就是判定的范围，所以"挥了就该中"。
  if (autoAttack && player.alive) {
    let nearest = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < nearest) nearest = d;
    }
    if (nearest <= player.def.attackRange) player.swing(PLAYER_SWING_GAP);
  }

  // ---- 推进动画。落点那一帧结算判定，并放出冲击弧
  //
  // 判定和特效在同一个时刻发生，但两者互不依赖：弧是画给人看的，中不中由扇形判定说了算。

  if (player.update(dt)) {
    const at = weaponImpactPoint(player.pose, player.def, player.x, player.y, player.facing);
    effects.spawn(at.x, at.y, player.facing, { power: player.def.bulk });

    for (const e of enemies) {
      if (!e.alive) continue;
      if (inAttackArc(player, e)) {
        e.kill(player.x, player.y);
        kills++;
      }
    }
  }

  // 敌人：直线走向玩家，没有寻路。走进自己的攻击距离就停下出手。
  const animateRadius = viewRadius() + 40;
  for (const e of enemies) {
    if (e.alive) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.hypot(dx, dy);
      e.facing = Math.atan2(dy, dx);

      // 停在攻击距离的八成处，而不是正好在边缘上：卡在边缘的话玩家稍一后退就出圈，
      // 一群人会在"走两步"和"挥一下"之间反复横跳。
      const stop = e.def.attackRange * 0.8;
      if (dist > stop) {
        e.speed = e.walkSpeed;
        // 没有寻路：撞上障碍就被推开，沿着它蹭过去。绕不过去的死角会卡住，但这张图上
        // 没有能围死人的东西 —— 真需要寻路的时候再说。
        const to = moveWithCollision(
          terrain,
          props,
          e.radius,
          e.x,
          e.y,
          e.x + (dx / dist) * e.walkSpeed * dt,
          e.y + (dy / dist) * e.walkSpeed * dt,
        );
        e.x = to.x;
        e.y = to.y;
      } else {
        e.speed = 0;
        e.swing(ENEMY_SWING_GAP + Math.random() * ENEMY_SWING_JITTER);
      }
    }

    // 画面外的只走计时、不搭姿势。搭姿势加 IK 是每个单位每帧最贵的一块，而屏幕外没人
    // 看得见 —— 走回画面里时下一帧就重新算出正确姿势，看不出接缝。
    const onScreen = Math.hypot(e.x - camera.x, e.y - camera.y) <= animateRadius;
    if (e.update(dt, onScreen) && player.alive && inAttackArc(e, player)) {
      if (player.takeHit(e.x, e.y)) deaths++;
    }
  }

  // 互相推开。不是寻路，只是不让一群人叠在同一个像素上 —— 少了这一步，一百个杂兵会
  // 精确地重合成一个人，人群完全读不出数量。O(n²)，一百多个单位每帧一万次比较，可以忽略。
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      if (!b.alive) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) * 0.5;
      const nx = (dx / d) * push;
      const ny = (dy / d) * push;
      a.x -= nx;
      a.y -= ny;
      b.x += nx;
      b.y += ny;
    }
  }

  effects.update(dt);
  weather.update(dt);

  // 脚步：从步态相位的跨越读触地，所以一步正好一次。走在水里溅水花，走在雪上留脚印。
  footsteps.update([player, ...enemies], dt, terrain, weather);

  // 玩家倒下了就重开：清场、回血、重新铺一批。
  if (!player.alive && player.death > 1.2) {
    player.death = -1;
    player.hp = player.maxHp;
    player.hurt = 0;
    enemies.length = 0;
    seedField();
  }

  // 清掉已经沉下去的尸体。
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].gone) {
      enemies[i] = enemies[enemies.length - 1];
      enemies.pop();
    }
  }

  // ---- 绘制

  timing.sim = smooth(timing.sim, performance.now() - tSim);
  const tBuild = performance.now();

  // 地面。云影的格点铺在视口范围上，摆位必须和它一致，否则影子会相对地面滑动。
  ground.update(camera.x, camera.y, halfW, halfH);
  ground.layout(camera.x, camera.y, rootX, rootY, grain, surface.width, surface.height);

  figure.clear();

  // 视野半宽/半高，留一格余量。地面细节和树只画看得见的那部分。
  const spanX = surface.width * 0.5 / grain + 40;
  const spanY = surface.height * 0.5 / (grain * Projection.groundSquash) + 60;

  // 脚印和涟漪贴在地上，压在草之下。
  footsteps.drawGround(shapes, camera.x, camera.y, rootX, rootY, grain);
  terrain.drawDetail(shapes, weather, camera.x, camera.y, rootX, rootY, grain, spanX, spanY);

  effects.draw(shapes, camera.x, camera.y, rootX, rootY, grain);

  // 场上所有人和树共用一个批次：深度排序是全局的，站得靠下的自然压在靠上的前面，
  // 所以人能走到树后面去，不需要先按 y 排一遍再画。
  terrain.drawScatter(shapes, weather, camera.x, camera.y, rootX, rootY, grain, spanX, spanY);
  terrain.drawTrees(shapes, weather, camera.x, camera.y, rootX, rootY, grain, spanX, spanY);
  props.draw(shapes, weather, camera.x, camera.y, rootX, rootY, grain, spanX, spanY);

  const cullRadius = viewRadius() + 30;
  let drawn = 0;
  for (const e of enemies) {
    if (Math.hypot(e.x - camera.x, e.y - camera.y) > cullRadius) continue;
    drawCharacterAt(e);
    drawn++;
  }
  drawCharacterAt(player);
  if (showSkeleton) {
    drawSkeleton(shapes, player.pose, new Projector(screenOf(player), player.facing, Projection.groundSquash, grain));
  }

  // 溅起来的水珠画在人之后：它们是被脚踢起来的，该压在鞋面上。
  footsteps.drawSplashes(shapes, camera.x, camera.y, rootX, rootY, grain);
  // 落下的雨雪在所有东西之前 —— 它在镜头和世界之间，不参与排序。
  weather.draw(shapes, camera.x, camera.y, rootX, rootY, grain);

  const primitives = shapes.primitiveCount; // flush 之后计数会清零
  shapes.flush(figure, surface.width, surface.height);

  // 准星。中间留空，免得盖住脚下那块地。它画在单位层里，所以会跟着吃那圈一像素暗边 ——
  // 在草地上正是靠那圈边才看得清。
  reticle.clear();
  if (pointerLocked) {
    const cx = Math.round(cursor.x);
    const cy = Math.round(cursor.y);
    const arm = Math.max(2, Math.round(grain));
    const gap = arm;
    for (const [ox, oy, w, h] of [
      [-gap - arm, 0, arm, 1],
      [gap, 0, arm, 1],
      [0, -gap - arm, 1, arm],
      [0, gap, 1, arm],
    ]) {
      reticle.rect(cx + ox, cy + oy, w, h).fill(0xf0e6d2);
    }
  }

  surface.render();
  timing.build = smooth(timing.build, performance.now() - tBuild);

  // 人从脚底到头顶大约 18.3 个世界单位，被相机俯角压掉一截才是屏幕上的高度。
  const figureUnits = (RigSpec.headZ + RigSpec.headRadius) * Projection.heightSquash;
  const figurePixels = Math.round(figureUnits * grain);
  const figureScreen = Math.round((figurePixels * magnify) / (app.renderer.resolution || 1));

  hud.text =
    `IronWall · ${Math.round(ticker.FPS)} fps · ${primitives} 图元 · 场上 ${enemies.length} (画 ${drawn}) · 击杀 ${kills}\n` +
    `${playerPresets[presetIndex].name} · 自动攻击 ${autoAttack ? '开' : '关'}\n` +
    `颗粒度 ${grain.toFixed(1)} (人高 ${figurePixels} 像素) · 放大 ${magnify}x (屏幕上 ${figureScreen} px)\n` +
    (pointerLocked
      ? `按住左键 移动 · Shift 跑 · 空格 挥击 · F 自动攻击 · R 清场 · ESC 释放鼠标
` +
        `1-7 换角色 · T 天气 · C 云 · G 风 · K 骨架 · 滚轮/-/= 缩放 · 0 复位 · [ ] 放大 · ,/. 同屏上限`
      : `点击画面锁定鼠标`);
});

/** 一个单位站在缓冲里的哪个像素上。 */
function screenOf(c: Character) {
  return v2(
    Math.round(surface.width * 0.5) + (c.x - camera.x) * grain,
    Math.round(surface.height * 0.5) + (c.y - camera.y) * Projection.groundSquash * grain,
  );
}

/** 把一个单位画到它在缓冲里该在的位置上。 */
function drawCharacterAt(c: Character): void {
  const p = new Projector(screenOf(c), c.facing, Projection.groundSquash, grain);
  drawCharacter(shapes, c.pose, p, c.palette, c.def, { hurt: c.hurt });
}
