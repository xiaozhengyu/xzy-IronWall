import { attackDuration } from '../characters/animator';
import { PALETTE_BLUE, PALETTE_PEASANT, PALETTE_RED, type CharacterPalette } from '../characters/palette';
import { type UnitDef, UnitPresets } from '../characters/unitDef';
import { clamp } from '../core/math';
import { ImpactEffects, weaponImpactPoint } from '../effects/impact';
import { Character } from './character';
import { isFreeSpot, moveWithCollision } from './collision';
import { inAttackArc } from './combat';
import type { Field } from './field';

/**
 * 一局割草：场上的所有人，以及他们之间发生的事。
 *
 * 这里是接下来长肉的地方 —— 波次、技能、掉落、经验，全部往这个文件加。它不认识 Pixi，也不
 * 认识相机：外面每帧告诉它"玩家想朝哪儿走"和"视野有多大"，它回一个推进过的世界。想验证
 * 一条规则不用开浏览器，把这个类拿到 node 里空跑几分钟就行。
 */

/**
 * 人的写实步行速度，世界单位/秒（一个人大约 19 单位高）。
 *
 * 只用来给动画做归一化：动画器拿它判断"这个速度算走还是算跑"，从而决定步态混合、摆臂幅度
 * 和斗篷的甩动。它描述的是身体，不是游戏手感，所以调玩家速度时不要动它 —— 移动速度翻倍
 * 之后，人相对这个基准就是在跑，斗篷和步幅会自己跟上去。
 */
const HUMAN_PACE = 16;

/** 玩家的基础移动速度，以及按住 Shift 的速度。 */
const PLAYER_SPEED = 32;
const PLAYER_RUN_SPEED = 60;
const PLAYER_HP = 20;

/**
 * 攻击频率：一次挥击**结束**之后再等多久才起下一次，秒。0 就是一刀接一刀。
 *
 * 默认 0，节奏就是动作时长本身 —— 锤子 0.72 秒一下、拳头 0.38 秒一下。攻击频率本来就该是
 * 每种武器自己的属性，这个常量只是在它之上再加一段停顿。
 */
const PLAYER_SWING_GAP = 0;

/**
 * 出怪间隔。玩家清场的速度约每秒三个，所以这个值定得比它快不少，场面才会一直是满的 ——
 * 割草游戏的压迫感来自"杀不完"，出怪率一旦低于清场速度，画面就空了。
 */
const SPAWN_INTERVAL = 0.18;

/** 开局先铺这么多，从很近到视野边缘都有。 */
const SEED_COUNT = 30;

/**
 * 追击提速的两头和倍率。见下面敌人 AI 里那段注释。
 *
 * 近的一头（45）要落在贴身那圈人之外：围着玩家的那一坨是被互相推开撑出来的，让他们跟着
 * 提速只会把人堆挤得更紧，看不出是在追。
 */
const CHASE_NEAR = 45;
const CHASE_FAR = 75;
const CHASE_BOOST = 1.8;

/** 敌人两次出手之间的间隙，秒。给一段随机量，免得一圈人整齐划一地同时挥。 */
const ENEMY_SWING_GAP = 1.15;
const ENEMY_SWING_JITTER = 0.7;

/** 玩家倒下之后躺多久重开。 */
const RESPAWN_DELAY = 1.2;

/** 可选的玩家形象。菜单上那一排按钮就是这张表。 */
export const PlayerPresets: { name: string; make: () => UnitDef }[] = [
  { name: 'warlord 武将 双锤', make: UnitPresets.warlord },
  { name: 'hero 披风剑士', make: UnitPresets.hero },
  { name: 'thug 杂兵', make: UnitPresets.thug },
  { name: 'shieldman 持盾兵', make: UnitPresets.shieldman },
  { name: 'spearman 长枪兵', make: UnitPresets.spearman },
  { name: 'archer 弓手', make: UnitPresets.archer },
  { name: 'elite 精英', make: UnitPresets.elite },
];

/**
 * 敌人的种类。def 和调色板是共享的只读数据，一百个杂兵指向同一份就够了。
 *
 * 速度是按"多久能走进画面"倒推的，不是按写实的步行速度。视野半径有两百多个世界单位（一个人
 * 才 19 单位高），照真人步速走进来要半分钟 —— 开局一整分钟画面上什么都不会发生。割草游戏里
 * 的杂兵本来也是小跑着扑过来的。
 */
const EnemyKinds: { def: UnitDef; palette: CharacterPalette; speed: number }[] = [
  { def: UnitPresets.thug(), palette: PALETTE_RED, speed: 26 },
  { def: UnitPresets.thug(), palette: PALETTE_PEASANT, speed: 30 },
  { def: UnitPresets.spearman(), palette: PALETTE_RED, speed: 23 },
  { def: UnitPresets.shieldman(), palette: PALETTE_RED, speed: 20 },
  { def: UnitPresets.archer(), palette: PALETTE_PEASANT, speed: 33 },
];

/** 这一帧玩家想干什么。由输入层翻译好再交进来，Battle 不认识鼠标和键盘。 */
export interface BattleInput {
  /** 该朝哪儿，弧度；null 表示保持不变（准星正压在人身上时方向没有意义）。 */
  facing: number | null;
  moving: boolean;
  running: boolean;
}

/** 这一帧看得见多大范围。出怪圈和"要不要搭姿势"都按它算。 */
export interface BattleView {
  /** 镜头中心的世界坐标。 */
  x: number;
  y: number;
  /** 视野半径，世界单位。 */
  radius: number;
}

const smooth = (prev: number, now: number): number => prev * 0.9 + now * 0.1;

export class Battle {
  readonly player: Character;
  readonly enemies: Character[] = [];
  /** 冲击弧。由挥击的落点放出，所以归战斗管；画它的是 Scene。 */
  readonly effects = new ImpactEffects();

  kills = 0;
  deaths = 0;
  presetIndex = 0;

  /**
   * 同屏上限，运行时可调（逗号/句号）。
   *
   * 一开始定在 90 是出于对渲染开销的担心：每个人六十多个图元，每帧全部重新灌进一个 Graphics
   * 重新三角化并重传顶点缓冲。那件事确实在发生，但 Pixi 的批处理器远比预期快，几千个图元不是
   * 问题 —— 这个上限是猜的，不是量出来的。所以做成可调的，顶到帧时间开始涨为止。
   */
  maxEnemies = 90;
  autoAttack = true;

  /** 逻辑这一段花掉的毫秒，指数平滑。暂停面板要读。 */
  simMs = 0;

  private readonly field: Field;
  private spawnTimer = 0;

  constructor(field: Field) {
    this.field = field;
    this.player = new Character(PlayerPresets[0].make(), PALETTE_BLUE, HUMAN_PACE);
    this.player.facing = Math.PI * 0.5; // 面朝镜头
    this.player.x = field.width * 0.5;
    this.player.y = field.height * 0.5;
    this.player.maxHp = PLAYER_HP;
    this.player.hp = PLAYER_HP;
  }

  /** 玩家加所有敌人。脚印那边要遍历全场，用生成器省掉每帧一个临时数组。 */
  *actors(): Generator<Character> {
    yield this.player;
    yield* this.enemies;
  }

  /** 换一个玩家形象。血量按新的上限补满，免得换成小个子之后血条读不出来。 */
  setPreset(index: number): void {
    if (index < 0 || index >= PlayerPresets.length) return;
    this.presetIndex = index;
    this.player.def = PlayerPresets[index].make();
    this.player.hp = this.player.maxHp;
  }

  /** 清场重来。 */
  reset(viewRadius: number): void {
    this.enemies.length = 0;
    this.kills = 0;
    this.player.death = -1;
    this.player.hurt = 0;
    this.player.hp = this.player.maxHp;
    this.seed(viewRadius);
  }

  /**
   * 开局先在场上铺一批，从很近到视野边缘都有。
   *
   * 不铺的话，第一个敌人得从视野外走进来，前几秒是一片空地 —— 而这几秒恰恰是要给人看的那
   * 几秒。铺一批之后一进画面就有活干，后面靠持续出怪接上。
   */
  seed(viewRadius: number): void {
    for (let i = 0; i < SEED_COUNT; i++) {
      this.spawn(viewRadius, 30 + Math.random() * (viewRadius - 30));
    }
  }

  spawn(viewRadius: number, distance?: number): void {
    const field = this.field;
    const kind = EnemyKinds[Math.floor(Math.random() * EnemyKinds.length)];
    const e = new Character(kind.def, kind.palette, kind.speed);

    // 沿着视野圈外的一圈随机放，但必须落在场内、并且不和树重叠。试几次，实在找不到就贴到
    // 边界上 —— 玩家走到角落时，圈上大半个方向都在场外，硬要那个方向就会一个也生不出来。
    let x = 0;
    let y = 0;
    const base = distance ?? viewRadius + 15;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const r = base + Math.random() * 45;
      x = this.player.x + Math.cos(angle) * r;
      y = this.player.y + Math.sin(angle) * r;
      if (field.inBounds(x, y) && isFreeSpot(field.terrain, field.props, x, y, e.radius)) break;
      x = field.clampX(x);
      y = field.clampY(y);
    }
    e.x = x;
    e.y = y;
    e.facing = Math.atan2(this.player.y - y, this.player.x - x);
    // 随机的初始冷却，免得同一批出生的人到了跟前整齐划一地同时出手。
    e.attackCooldown = Math.random() * ENEMY_SWING_GAP;
    this.enemies.push(e);
  }

  /** 推进一帧。暂停时唯一被停下的就是它。 */
  update(dt: number, input: BattleInput, view: BattleView): void {
    const t0 = performance.now();
    const { player, enemies, field } = this;

    this.movePlayer(dt, input);
    this.spawnWave(dt, view.radius);
    this.swing();
    this.advancePlayerAttack(dt);
    this.driveEnemies(dt, view);
    this.separate();

    this.effects.update(dt);
    field.update(dt, this.actors());

    // 玩家倒下了就重开：清场、回血、重新铺一批。
    if (!player.alive && player.death > RESPAWN_DELAY) {
      this.player.death = -1;
      this.player.hp = this.player.maxHp;
      this.player.hurt = 0;
      enemies.length = 0;
      this.seed(view.radius);
    }

    // 清掉已经沉下去的尸体。
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].gone) {
        enemies[i] = enemies[enemies.length - 1];
        enemies.pop();
      }
    }

    this.simMs = smooth(this.simMs, performance.now() - t0);
  }

  // ---------------------------------------------------------------- 玩家

  private movePlayer(dt: number, input: BattleInput): void {
    const { player, field } = this;
    if (input.facing !== null) player.facing = input.facing;

    if (!input.moving) {
      player.speed = 0;
      return;
    }
    const speed = input.running ? PLAYER_RUN_SPEED : PLAYER_SPEED;
    player.speed = speed;
    const to = moveWithCollision(
      field.terrain,
      field.props,
      player.radius,
      player.x,
      player.y,
      field.clampX(player.x + Math.cos(player.facing) * speed * dt),
      field.clampY(player.y + Math.sin(player.facing) * speed * dt),
    );
    player.x = to.x;
    player.y = to.y;
  }

  /**
   * 攻击是常态：到点就挥，不看周围有没有人、朝哪边、在不在跑。割草游戏里"挥不挥"根本不是
   * 一个需要判断的问题 —— 基础攻击就是攻击力、攻击范围、攻击频率三个数，而**发动只由频率
   * 决定**，其余的交给命中判定。
   *
   * 挥空不是问题：落点那一刻放出的是**武器扫过的弧**，说的是"这一下从这儿扫过去了"，而不是
   * "打中了"。中不中由 inAttackArc 的扇形判定单独说了算。
   */
  private swing(): void {
    if (!this.autoAttack || !this.player.alive) return;
    this.player.swing(attackDuration(this.player.def) + PLAYER_SWING_GAP);
  }

  /** 手动挥一下（空格）。已经在挥或者还在冷却就忽略。 */
  swingNow(): void {
    this.player.swing();
  }

  /**
   * 推进玩家的动画，并在落点那一帧结算判定、放出冲击弧。
   *
   * 判定和特效在同一个时刻发生，但两者互不依赖：弧是画给人看的，中不中由扇形判定说了算。
   *
   * player.update 的返回值就是"这一帧跨过落点了没有"，是一次**跨越**检测而不是阈值比较，
   * 所以它必须每帧正好调一次 —— 漏一帧那一下就白挥了，多调一帧就会连着结算两次。
   */
  private advancePlayerAttack(dt: number): void {
    const { player } = this;
    if (!player.update(dt)) return;
    const at = weaponImpactPoint(player.pose, player.def, player.x, player.y, player.facing);
    this.effects.spawn(at.x, at.y, player.facing, { power: player.def.bulk });

    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (inAttackArc(player, e)) {
        e.kill(player.x, player.y);
        this.kills++;
      }
    }
  }

  // ---------------------------------------------------------------- 敌人

  private driveEnemies(dt: number, view: BattleView): void {
    const { player, field } = this;
    // 画面外的只走计时、不搭姿势。搭姿势加 IK 是每个单位每帧最贵的一块，而屏幕外没人看得见
    // —— 走回画面里时下一帧就重新算出正确姿势，看不出接缝。
    const animateRadius = view.radius + 40;

    for (const e of this.enemies) {
      if (e.alive) {
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const dist = Math.hypot(dx, dy);
        e.facing = Math.atan2(dy, dx);

        // 停在攻击距离的八成处，而不是正好在边缘上：卡在边缘的话玩家稍一后退就出圈，一群人
        // 会在"走两步"和"挥一下"之间反复横跳。
        const stop = e.def.attackRange * 0.8;
        if (dist > stop) {
          // 落远了就跑起来。
          //
          // 玩家走 32、冲刺 60，敌人只有 20~33 —— 不提速的话，光是按住左键前进就能把整队甩在
          // 身后，割草游戏最要紧的那份"杀不完"的压迫感直接没了。
          //
          // 倍率 1.8 是按"走路甩不掉、冲刺能甩掉"倒推的：20~33 乘 1.8 得 36~59.4，全都快过
          // 走路的 32，又全都慢过冲刺的 60。于是冲刺是一张真能用的脱身牌，散步不是。离线跑
          // 九十秒、同屏上限 90：击杀 351 → 422（走）、365 → 453（冲刺）。
          //
          // 用一段斜坡而不是一个阈值：硬切会让卡在线上的人每帧在走和跑之间跳，而动画器是按
          // speed 混合步态的，跳档一眼看得出来。走斜坡的话，追上来的人自己就变成跑的姿势。
          const chase = clamp((dist - CHASE_NEAR) / (CHASE_FAR - CHASE_NEAR), 0, 1);
          const speed = e.walkSpeed * (1 + (CHASE_BOOST - 1) * chase);
          e.speed = speed;
          // 没有寻路：撞上障碍就被推开，沿着它蹭过去。绕不过去的死角会卡住，但这张图上没有
          // 能围死人的东西 —— 真需要寻路的时候再说。
          const to = moveWithCollision(
            field.terrain,
            field.props,
            e.radius,
            e.x,
            e.y,
            e.x + (dx / dist) * speed * dt,
            e.y + (dy / dist) * speed * dt,
          );
          e.x = to.x;
          e.y = to.y;
        } else {
          e.speed = 0;
          e.swing(ENEMY_SWING_GAP + Math.random() * ENEMY_SWING_JITTER);
        }
      }

      const onScreen = Math.hypot(e.x - view.x, e.y - view.y) <= animateRadius;
      if (e.update(dt, onScreen) && player.alive && inAttackArc(e, player)) {
        if (player.takeHit(e.x, e.y)) this.deaths++;
      }
    }
  }

  /**
   * 互相推开。不是寻路，只是不让一群人叠在同一个像素上 —— 少了这一步，一百个杂兵会精确地
   * 重合成一个人，人群完全读不出数量。O(n²)，一百多个单位每帧一万次比较，可以忽略。
   */
  private separate(): void {
    const enemies = this.enemies;
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
  }

  // ---------------------------------------------------------------- 出怪

  private spawnWave(dt: number, viewRadius: number): void {
    this.spawnTimer += dt;
    while (this.spawnTimer >= SPAWN_INTERVAL) {
      this.spawnTimer -= SPAWN_INTERVAL;
      if (this.enemies.length < this.maxEnemies) this.spawn(viewRadius);
    }
  }
}
