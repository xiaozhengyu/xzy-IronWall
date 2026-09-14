import { Character } from '../game/character';
import type { UnitDef } from '../characters/unitDef';
import { IRON_BODY_GLOW, PALETTE_HERO, brightenPalette } from '../characters/palette';
import type { CharacterPalette } from '../characters/palette';
import { HUMAN_PACE } from '../game/battle';
import { ImpactEffects, weaponImpactPoint } from '../effects/impact';
import { RigSpec } from '../characters/rig';
import { drawAegisDome } from '../effects/aegisDome';
import { drawDharmaAspect } from '../effects/dharmaAspect';
import { drawOrbitStars } from '../effects/orbitStars';
import {
  SKY_BLADE_LENGTH, drawSkyBlade, heavenSplitBlade, skyArrowBlade,
} from '../effects/skyBlade';
import { PLAYER_RUN_SPEED } from '../game/battle';
import { ORB_ORBIT_REACH, ORB_SPIN } from '../data/balance';
import { v2, type Vec2 } from '../core/math';
import { rgb, rgba, type Rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';
import {
  STAGE_ARC_FLASH, STAGE_ARC_WEIGHT, drawFigureStage, spawnStageSkill,
} from '../render/figureStage';
import { skillById, type SkillId } from '../game/skills';

/**
 * 牌上那一招**从起手到收干净**的整段。
 *
 * 上一版是"挥一下，配一道弧"：三种形状（扇、圈、波）分给十三个招式，谁都没匹配上就给波。
 * 于是穿云箭在牌上演的是破空 —— 一道朝前推出去的波，而这一招真正的样子是冲天、等一拍、
 * 一把三个人高的大剑从天上砸下来。牌面写穿云箭，画面演破空，那比什么都不演更误人。
 *
 * 而且"挥一下"只是**起手**，不是这一招。突进的内容是人真的冲出去、收招再炸一圈；金钟罩的
 * 内容是那个罩子在身上顶几秒；法相的内容是壳子展开、撑住、收势。这些全发生在那一下挥手
 * **之后**，上一版一个都没演到。而玩家在三选一里要判断的恰恰是这个：按下去之后屏幕上会
 * 发生什么、持续多久。
 *
 * 所以每一招在这里各有一条**时间轴**，走的都是战场上那一份画法 —— drawSkyBlade、
 * drawAegisDome、drawDharmaAspect、drawOrbitStars、ImpactEffects，一个都不是为牌面另画的。
 * 牌上看到的就是选完之后屏幕上会出现的东西，这是这块界面唯一要保证的事。
 *
 * **距离一律按地块折算，不按兵种的攻击距离**（spawnStageSkill 顶上那段说的是同一件事）：
 * 金钟罩的罩子在场上是三十多个世界单位、快到人物身高的两倍，照搬到一张 176 像素宽的牌上
 * 就是一个盖住整张牌的圈。牌要说的是形状和节奏，不是够多远。
 */

/** 一台演示能碰到的东西。demo 只认这几样，不认画布也不认 DOM。 */
export interface DemoStage {
  readonly actor: Character;
  readonly effects: ImpactEffects;
  /**
   * 这个人的攻击距离在台子上折算成多少，世界单位。
   *
   * 场上每一招的范围都是 `attackRange × skill.reach`（见 battle.ts 的 castSkill），台子上
   * 乘的是**同一张表**，只把 attackRange 按 STAGE_SQUEEZE 压过一道。
   */
  readonly range: number;
  /** 这一招自己的范围 = range × 技能表里那个倍数。和场上是同一条式子。 */
  readonly reach: number;
  /** 画布尺寸，缓冲像素。穿云箭要知道屏幕顶在哪儿才飞得出去。 */
  readonly view: { readonly width: number; readonly height: number };
  /** 脚下的地往后流 dist 个世界单位 —— 等于人往前走了这么远。人自己不挪窝。 */
  travel(dist: number): void;
}

export interface SkillDemo {
  /**
   * 一整个来回多长，秒：从静立起手，到收干净，再加一小段留白。
   *
   * **各招不一样长。** 上一版三张牌共用 1.8 秒，为的是"不各闪各的"；但一招的节奏本来就是
   * 它的身份（技能表里 lunge 那条 duration 上写的就是这句话），把天地法相和横扫压进同一个
   * 格子，要么法相演不完，要么横扫挥完之后干站一秒半。三张牌是同时摆出来的，起点一致，
   * 之后各走各的 —— 那正是它们在战场上的样子。
   */
  readonly loop: number;
  /** 起手落在周期的第几秒。前面那一段静立是"起手"的一部分，不是空转。 */
  readonly cast: number;
  /** 起手那一帧。 */
  begin?(stage: DemoStage): void;
  /** 每一帧。age = 距起手多久，负数表示还没起手。 */
  update?(stage: DemoStage, age: number, dt: number): void;
  /** 人和弧之后再画一层：罩子、法相、飞剑、流星。 */
  draw?(shapes: ShapeBatch, stage: DemoStage, at: Vec2, grain: number, age: number): void;
  /** 通体提亮，0..1；不给就是不提亮。目前只有铁布衫。 */
  glow?(age: number): number;
}

/**
 * 脚下那块地放大多少（只放地，不放人 —— 见 drawFigureStage 的 tileScale）。
 *
 * 按**最大的那个圈**定：金钟罩落地那一圈半径 20 个世界单位，而地块原尺寸的半径只有 9.3。
 * 不放大的话，罩子那一圈、回旋那一圈、横扫那片扇面全落在地块外的黑底上 —— 画面读作"一个
 * 人站在小台子上，周围浮着几个光圈"，而场上它们是实实在在扫在地面上的。放到 2.2 倍，地块
 * 的四个角仍然整个在画布里，而最大的那个圈刚好落在地上。
 *
 * 选人界面那一台不跟着放（它那儿只有一道弧，地大了只是把人显得小）—— 所以这是牌面自己的
 * 一个数，不动 STAGE_TILE_RADIUS。
 */
const TILE_ZOOM = 2.2;

/** 起手前那一小段静立。所有招共用 —— 它是"起手"这件事本身，不是各招自己的东西。 */
const CAST_AT = 0.45;

/**
 * 台子上的距离按场上的几成给。**牌面上唯一一个"不忠实"的数，其余全是场上那套式子。**
 *
 * 为什么非压不可：武将的金钟罩半径是 32 个世界单位，而他自己只有 19 高 —— 场上那个罩子有
 * 三个多身高宽（见 .preview-aegis.png）。牌上那块画布按 CSS 只有 132 像素宽，要把它整个塞
 * 进去，人就得缩到二十几像素，"这个角色真在放这一招"当场就没了。
 *
 * 上一版的毛病不是压得多，是**每样东西各压各的**：罩子按地块半径的 0.82、流星 0.75、弧
 * 1.35、剑按颗粒度的 0.3 —— 四个系数互不相干，于是牌上的金钟罩比回旋还小一圈，而场上它们
 * 是 0.95 比 1.25，本来就该小，但不是小成那样。现在只有这一个数，各招之间的大小关系和场上
 * 分毫不差，整体一起缩。
 *
 * 0.62：罩子落在一个身高上下 —— 人明显站在一个"罩子里"，而不是顶着一圈贴身的光边。
 */
const STAGE_SQUEEZE = 0.62;

/**
 * 剑按同一个数缩。
 *
 * 它其实是个**物体**不是一段距离（54 个世界单位、约三个人高），照理不该跟着距离一起压。
 * 但它是这张牌上最长的东西：不压的话，剑出现的那几帧整张牌就是一条剑身，护手和柄都在画布
 * 外 —— 而"天上掉下来一把大剑"这件事，靠的正是看得见它是一把剑。
 */
const BLADE_SHRINK = STAGE_SQUEEZE;
/** 和 Scene 的 SKY_ARROW_TINT 是同一个色：开天和穿云箭飞的是同一把剑。 */
const BLADE_TINT = rgb(255, 236, 190);

/** 把台子的局部世界（原点在地块中心）折算到缓冲像素。 */
const project = (at: Vec2, x: number, y: number, grain: number): Vec2 =>
  v2(at.x + x * grain, at.y + y * Projection.groundSquash * grain);

/** 某一行的深度。和场上所有东西共用一套排序。 */
const depthAt = (screenY: number, bias: number): number =>
  Math.round(screenY) * Projector.DEPTH_PER_ROW + bias;

/** 挥一下，配一道弧。横扫、回旋、破空三招的全部内容就是这一下。 */
function swingDemo(shape: 'fan' | 'ring' | 'wave', loop = 1.8): SkillDemo {
  return {
    loop,
    cast: CAST_AT,
    begin(stage) {
      stage.actor.swing(0);
      spawnStageSkill(stage.effects, stage.actor, shape, stage.reach);
    },
  };
}

/** 原地炸开的一圈。突进的收招、穿云箭的落地、金钟罩和法相的撑开都是它。 */
function stageRing(
  stage: DemoStage,
  x: number,
  y: number,
  reach: number,
  style: 'ring' | 'burst',
  tint: Rgba,
  life = 0.5,
): void {
  stage.effects.spawn(x, y, stage.actor.facing, {
    span: Math.PI * 2,
    from: 1.5,
    to: reach,
    weight: STAGE_ARC_WEIGHT * 1.1,
    life,
    overhead: true,
    style,
    sparks: 0,
    flash: STAGE_ARC_FLASH,
    tint,
  });
}

/*
 * 突进冲多快、冲多久。
 *
 * 速度**不是**技能表里那 8.2 倍奔跑速度。那个数配的是一整张地图：一下冲出去一百多个世界
 * 单位，而这块地半径只有九个多 —— 草丛得在 0.22 秒里卷十一圈，出来是一片频闪，不是冲刺。
 * 3.2 倍正好是步态本身的上限（见 animator 里那条夹子），腿和地这才是同一个速度。
 */
const DASH_SPEED = PLAYER_RUN_SPEED * 3.2;
const DASH_TIME = skillById('lunge').duration;

/** 金钟罩在台子上顶多久，以及最后多久开始急闪（场上那条 AEGIS_WARN 按台子的节奏缩过）。 */
const AEGIS_HOLD = 1.5;
const AEGIS_WARN = 0.55;
/** 法相撑住多久。松手之后那段收势由技能表给（duration 0.35），和场上是同一个数。 */
const DHARMA_HOLD = 1.3;
const DHARMA_FADE = skillById('dharma').duration;
/**
 * 法相**不缩**。
 *
 * 它和剑不一样：剑是飞出去的东西，而它是罩在人身上的一层壳，大小就是"人的 2.25 倍"这个
 * 比例本身 —— 压过之后它比人还小，那不叫压，那是说了另一件事（上一版压到 0.62，牌上的
 * 法相比它罩着的人还矮）。颗粒度降下来之后它竖着整个在框里，肩膀两侧还会蹭掉一点：一层
 * 罩在人身上的壳被画布切掉一点边，读起来仍然是"壳"，而缩小之后就不是了。
 */
/** 穿云箭什么时候落地。和 skyBlade.ts 里那三段、Battle 里那个 1.08 是同一条时间轴。 */
const ARROW_LAND = 1.08;
/** 开天那把剑飞多久。中途就出了画布，剩下那段留着不画 —— 场上它也是一路飞出视野的。 */
const SPLIT_FLIGHT = 0.75;

/** 落点：身前那一段，按地块折算。固定不随机 —— 牌上要的是"从天上砸在他身前"这个形状。 */
function arrowLanding(stage: DemoStage): Vec2 {
  const d = stage.range * 0.9;
  return v2(Math.cos(stage.actor.facing) * d, Math.sin(stage.actor.facing) * d);
}

const DEMOS: Partial<Record<SkillId, SkillDemo>> = {
  sweep: swingDemo('fan'),
  spin: swingDemo('ring'),
  // 破空那一下是**推出去**的：弧的圆心在武器落点，波前一路往外扫到头。
  wave: swingDemo('wave'),

  /**
   * 突进：人冲出去，收招再炸一圈。
   *
   * 上一版只有那道前推的波 —— 而这一招一半的内容是"眼前一花人已经在那边了"，另一半是撞停
   * 时脚下炸开的那一圈。少了这两样，牌上演的其实还是破空。
   */
  lunge: {
    loop: 1.9,
    cast: CAST_AT,
    begin(stage) {
      const { actor } = stage;
      const from = weaponImpactPoint(actor.pose, actor.def, 0, 0, actor.facing);
      // 一道窄而急的前推弧，跟着人一起冲出去。长度按**真正冲出去的距离**给（场上也是这么
      // 写的）—— 突进那一条 skill.reach 是"冲刺是奔跑的几倍"，不是距离。
      stage.effects.spawn(from.x, from.y, actor.facing, {
        span: 1.1,
        from: 2,
        to: DASH_SPEED * DASH_TIME * 0.62,
        weight: STAGE_ARC_WEIGHT * 0.9,
        life: 0.42,
        overhead: true,
        style: 'surge',
        sparks: 0,
        flash: STAGE_ARC_FLASH,
        tint: rgb(255, 232, 190),
      });
    },
    update(stage, age, dt) {
      if (age < 0) return;
      if (age < DASH_TIME) {
        // 腿和地喂的是同一个数：speed 进步态，travel 让地倒流。差开的话人是在冰上滑。
        stage.actor.speed = DASH_SPEED;
        stage.travel(DASH_SPEED * dt);
        return;
      }
      // 冲到头那一帧收招：原地一圈，把走廊两侧漏掉的人一起带走。
      if (age - dt < DASH_TIME) {
        stageRing(stage, 0, 0, stage.range * skillById('lunge').finishRing, 'ring', rgb(255, 214, 124));
      }
    },
  },

  /**
   * 金钟罩：撑开那一下，然后罩子在身上**顶几秒**。
   *
   * 顶住的那几秒才是这一招花掉 26 点蓝买来的东西 —— 上一版只演了撑开那一圈，牌上看过去和
   * 回旋没有区别。最后那段急闪也留着：它在场上说的是"要没了"，而"还剩多久"正是这一招的一半。
   */
  aegis: {
    loop: 2.5,
    cast: CAST_AT,
    begin(stage) {
      stageRing(stage, 0, 0, stage.reach, 'ring', rgb(255, 226, 140), 0.3);
    },
    draw(shapes, stage, at, grain, age) {
      const left = AEGIS_HOLD - age;
      if (age < 0 || left <= 0) return;
      const blink = left > AEGIS_WARN
        ? 1
        : 0.45 + 0.55 * Math.abs(Math.sin((AEGIS_WARN - left) * 22));
      drawAegisDome(
        shapes,
        at.x,
        at.y,
        // 半径走场上那条式子（attackRange × 0.95），只是 attackRange 压过一道。
        stage.reach * grain,
        RigSpec.chestZ * Projection.heightSquash * grain,
        grain,
        blink,
        depthAt(at.y, 16),
        1,
        age,
      );
    },
  },

  /**
   * 天地法相：壳子展开、撑住、收势明灭。
   *
   * 三段缺一段都不是这一招 —— 它在场上是个"要一直付钱的姿态"，而姿态说的就是撑住的那一段。
   */
  dharma: {
    loop: 2.5,
    cast: CAST_AT,
    begin(stage) {
      stageRing(stage, 0, 0, stage.reach, 'ring', rgb(255, 196, 72), 0.3);
    },
    draw(shapes, stage, at, grain, age) {
      if (age < 0 || age > DHARMA_HOLD + DHARMA_FADE) return;
      // 按住期间 left 每帧顶回满（Battle 就是这么写的），松手才开始掉 —— 收势那几帧的明灭
      // 由 drawDharmaAspect 自己按 left 算，这里不另做一套。
      const left = age < DHARMA_HOLD ? DHARMA_FADE : DHARMA_HOLD + DHARMA_FADE - age;
      drawDharmaAspect(shapes, stage.actor, at, grain, left, DHARMA_FADE);
    },
  },

  /**
   * 开天：那把剑**贴着地飞出去**。
   *
   * 上一版给的是一道推出去的波，而这一招从头到尾是一个**物体**在飞 —— 波和剑在画面上是两件
   * 完全不同的东西，玩家凭牌面分不出自己抽到的是开天还是破空。
   */
  heavenSplit: {
    loop: 2,
    cast: CAST_AT,
    begin(stage) {
      stage.actor.swing(0);
    },
    draw(shapes, stage, at, grain, age) {
      if (age < 0 || age > SPLIT_FLIGHT) return;
      const bladeGrain = grain * BLADE_SHRINK;
      const length = SKY_BLADE_LENGTH * BLADE_SHRINK;
      const heading = stage.actor.facing;
      // 速度走场上那条式子：reach ÷ duration，飞到出画布为止。
      const dist = (stage.reach / skillById('heavenSplit').duration) * age;
      const butt = project(at, Math.cos(heading) * dist, Math.sin(heading) * dist, grain);
      const tip = project(
        at,
        Math.cos(heading) * (dist + length),
        Math.sin(heading) * (dist + length),
        grain,
      );
      const pose = heavenSplitBlade(age, SPLIT_FLIGHT - age, butt, tip, bladeGrain);
      drawSkyBlade(
        shapes,
        pose.tip,
        pose.butt,
        pose.side,
        pose.width,
        pose.alpha,
        BLADE_TINT,
        depthAt((pose.tip.y + pose.butt.y) * 0.5, 30),
      );
    },
  },

  /**
   * 穿云箭：冲天出画、空一拍、从天上砸下来、落地炸一圈。
   *
   * **这一张是这次动手的起点。** 上一版它在牌上演的是破空 —— 一道朝前推的波。那不是演得不够，
   * 是演成了另一招：这一招的全部内容恰恰是"人放完之后什么都没有，要等将近一秒"，而波是当场
   * 就打出去的。中间那一拍在这里照样留着，它不是空转，它就是这一招。
   */
  skyArrow: {
    loop: 2.6,
    cast: CAST_AT,
    begin(stage) {
      const { actor } = stage;
      actor.swing(0);
      // 起手那一小道斩：人先出手，剑才上天。
      const from = weaponImpactPoint(actor.pose, actor.def, 0, 0, actor.facing);
      stage.effects.spawn(from.x, from.y, actor.facing, {
        span: 0.48,
        from: 1,
        to: stage.range * 1.5,
        weight: STAGE_ARC_WEIGHT * 0.8,
        life: 0.18,
        overhead: true,
        style: 'slash',
        sparks: 0,
        flash: STAGE_ARC_FLASH,
        tint: rgb(255, 222, 140),
      });
    },
    update(stage, age, dt) {
      if (age < ARROW_LAND || age - dt >= ARROW_LAND) return;
      const land = arrowLanding(stage);
      stageRing(stage, land.x, land.y, stage.reach, 'burst', rgb(255, 188, 62));
    },
    draw(shapes, stage, at, grain, age) {
      if (age < 0 || age > ARROW_LAND) return;
      const bladeGrain = grain * BLADE_SHRINK;
      const land = arrowLanding(stage);
      const ground = project(at, land.x, land.y, grain);

      // 地上那个细环：剑还在画面外时就先把落点交出去。等待那一拍里它是屏幕上唯一的东西。
      if (age >= 0.8) {
        const pulse = 1 - Math.min((age - 0.8) / 0.28, 1);
        shapes.ellipseRing(
          ground,
          (5 + pulse * 8) * bladeGrain,
          (2.5 + pulse * 4) * bladeGrain,
          0,
          Math.max(1, bladeGrain * 0.45),
          rgba(255, 198, 92, Math.round(120 + 100 * pulse)),
          depthAt(ground.y, 18),
          16,
        );
      }

      // 冲天段从人脚下出发、俯冲段砸向落点，摆位走的是场上那一份 skyArrowBlade。
      const pose = skyArrowBlade(age, at, ground, stage.view.height, bladeGrain);
      if (!pose) return;
      drawSkyBlade(
        shapes,
        pose.tip,
        pose.butt,
        pose.side,
        pose.width,
        pose.alpha,
        BLADE_TINT,
        depthAt(ground.y, 30),
      );
    },
  },

  /**
   * 疾走：跑起来。
   *
   * 它没有弧，但它也不是"站着就生效"的那一类 —— 它本身就是移动，让他站着恰恰把这一招说反了。
   */
  sprint: {
    loop: 1.8,
    cast: 0,
    update(stage, _age, dt) {
      stage.actor.speed = PLAYER_RUN_SPEED;
      stage.travel(PLAYER_RUN_SPEED * dt);
    },
  },

  /**
   * 铁布衫：通体呼吸提亮。
   *
   * 牌上那行小字写的就是这个，而它在场上确实只有这一层光 —— 两秒一个来回，没有别的。
   * 给它配一道弧（上一版那个兽底）等于在牌面上许一个游戏里不存在的承诺。
   */
  ironBody: {
    loop: 2.1,
    cast: 0,
    glow: (age) => 0.5 + 0.5 * Math.sin((age * Math.PI * 2) / 2.1),
  },

  /**
   * 磐石：绕着人飞的那颗流星。
   *
   * 四个护身技里唯一有画面、会打人的那个，而上一版它在牌上和另外三个一样站着不动 —— 玩家
   * 看不出自己拿到的正是"唯一那个看得见的"。一级一颗，和场上同一条规矩。
   */
  bulwark: {
    // 一圈正好这么久（转速走场上那个 ORB_SPIN）—— 循环接得上，流星不会每轮跳一次。
    loop: (Math.PI * 2) / ORB_SPIN,
    cast: 0,
    draw(shapes, stage, at, grain, age) {
      drawOrbitStars(
        shapes,
        0,
        0,
        age * ORB_SPIN,
        1,
        // 轨道半径走场上那条式子（attackRange × ORB_ORBIT_REACH），和 Battle.advanceOrbit 同一份。
        stage.range * ORB_ORBIT_REACH,
        grain,
        (x, y, z) => v2(
          at.x + x * grain,
          at.y + (y * Projection.groundSquash - z * Projection.heightSquash) * grain,
        ),
        (worldY) => depthAt(at.y + worldY * Projection.groundSquash * grain, 0),
      );
    },
  },

  // 锋锐和疾锋在这张表上是**故意空着**的：它们在场上一个画面都没有，全部内容是一包属性。
  // 补一段演示只能是编的 —— 而牌上编出来的那一下，玩家按下去之后是等不到的。
};

/** 站着不动。没有画面的那两个护身技走这一条。 */
const IDLE: SkillDemo = { loop: 1.8, cast: 0 };

export const skillDemo = (id: SkillId): SkillDemo => DEMOS[id] ?? IDLE;

/**
 * 一台正在演的招：推时间、管姿势、把整台画出来。
 *
 * 和画布分开是为了**离线出图能走同一条路**（tools/preview.ts 的那张牌面连拍）。上一版这段
 * 逻辑长在 SkillFigure 上，而 SkillFigure 一开头就 document.createElement —— 于是这一层在
 * node 里根本跑不起来，图上验的只能是另写一遍的近似。这个工程里"图上验过的就是玩家看到的"
 * 是靠两边读同一份代码保证的，不是靠两边写得像。
 */
export class SkillStage implements DemoStage {
  readonly actor: Character;
  readonly effects = new ImpactEffects();
  readonly range: number;
  readonly reach: number;
  readonly view: { readonly width: number; readonly height: number };

  private readonly demo: SkillDemo;
  /** 没提亮时的那一套色。铁布衫每帧从它推一份新的出来，不能在推过的基础上再推。 */
  private readonly basePalette: CharacterPalette;
  private clock: number;
  private scrollX = 0;
  private scrollY = 0;
  /** 这一帧距起手多久。draw 要它，而它是 step 算出来的。 */
  private age = 0;

  /**
   * @param attackRange 这个角色**场上**的攻击距离（HeroDef.base.attackRange）。
   *
   *                    传真的那个数，不是一个牌面专用的常数：武将 34、骑士 16，同一招在两人
   *                    手里本来就不一样大，而那正是玩家该从牌上读到的东西。台子只把它整体
   *                    压过一道（STAGE_SQUEEZE），比例关系一条都不改。
   */
  constructor(
    def: UnitDef,
    skill: SkillId,
    view: { width: number; height: number },
    attackRange: number,
  ) {
    this.view = view;
    this.range = attackRange * STAGE_SQUEEZE;
    this.reach = this.range * skillById(skill).reach;
    this.actor = new Character(def, PALETTE_HERO, HUMAN_PACE);
    this.basePalette = this.actor.palette;
    /*
     * 朝左下偏前。
     *
     * 上一版是 0.75π（正左下）。取景拉远之后那个角度不够用了：横扫的扇面有四十八个世界单位
     * 宽，正左下扫出去，整片都落在画布左边界外，牌上只剩贴着边的一条月牙 —— 而"前方一大片"
     * 正是这一招要说的全部。
     *
     * 0.64π 把它转向画面下方（也就是镜头这一侧）。地面是压扁的，**竖着一个像素装得下的世界
     * 单位比横着多近一倍**，所以同样一片扇面，朝下比朝左放得下得多。
     *
     * 不转到正下方（0.5π）是为了留住斜的那一点：开天那把剑朝正下飞会被压扁成一截短粗的东西
     * （看不出是剑），而斜着飞全长都在。顺带，弧仍然偏左下走，图标挂在左上角，两者各占一角。
     */
    this.actor.facing = Math.PI * 0.64;
    this.demo = skillDemo(skill);
    // 从一整圈的末尾起步：第一帧就翻过去，于是开场也有那一小段静立的起手。
    this.clock = this.demo.loop;
  }

  /** 脚下的地往后流这么远。人自己永远不挪窝，见 drawStageTile。 */
  travel(dist: number): void {
    this.scrollX += Math.cos(this.actor.facing) * dist;
    this.scrollY += Math.sin(this.actor.facing) * dist;
  }

  /** 推进一帧。牌开着的时候由 requestAnimationFrame 驱动。 */
  step(dt: number): void {
    const { demo } = this;
    this.clock += dt;
    if (this.clock >= demo.loop) {
      this.clock -= demo.loop;
      // 上一轮的弧在这里清干净：周期本来就把收尾那一段算进去了，还挂着的都是漏出周期的。
      this.effects.clear();
    }
    const age = this.clock - demo.cast;
    this.age = age;
    // 起手落在周期里固定的那一点上，不是一到头就挥 —— 前面那一段静立是"起手"的一部分。
    if (age >= 0 && age - dt < 0) demo.begin?.(this);

    // 每帧先归零：会跑的招（疾走、突进）自己在 update 里顶上去，别的招站着。
    this.actor.speed = 0;
    demo.update?.(this, age, dt);

    const glow = demo.glow?.(age);
    // 提亮那条公式和场上是同一条（见 Scene.drawCharacterAt）：牌上的铁布衫和进游戏之后亮成
    // 一样，不然这张牌许的是另一个承诺。
    this.actor.palette = glow === undefined
      ? this.basePalette
      : brightenPalette(this.basePalette, Math.min(0.55, 0.1 + glow * 0.16), IRON_BODY_GLOW);

    this.actor.update(dt, true);
    this.effects.update(dt);
  }

  /** 地、人、弧，再加这一招自己那一层。 */
  draw(shapes: ShapeBatch, at: Vec2, grain: number): void {
    drawFigureStage(shapes, this.actor, at, grain, this.scrollX, this.scrollY, TILE_ZOOM, this.effects);
    // 罩子、法相、飞剑、流星和人进同一个批次，所以谁压谁仍然由深度说了算。
    this.demo.draw?.(shapes, this, at, grain, this.age);
  }
}
