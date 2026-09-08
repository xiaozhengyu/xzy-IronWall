import { attackDuration } from '../characters/animator';
import { RigSpec } from '../characters/rig';
import { PALETTE_HERO, PALETTE_PEASANT, PALETTE_RED, type CharacterPalette } from '../characters/palette';
import { type UnitDef, UnitPresets } from '../characters/unitDef';
import { clamp } from '../core/math';
import { Debris } from '../effects/debris';
import { ImpactEffects, frontRadius, weaponImpactPoint, type ShockwaveOptions } from '../effects/impact';
import { SKY_BLADE_LENGTH, SKY_BLADE_WIDTH } from '../effects/skyBlade';
import { Character } from './character';
import { isFreeSpot, moveWithCollision } from './collision';
import { inAttackArc, inSector, sweptBy } from './combat';
import type { Field } from './field';
import { rgb } from '../render/color';
import { SpatialGrid } from './grid';
import { WorldPopulation } from './worldPopulation';
import { DistantMotion } from './distantMotion';
import { SkillLoadout, type ActiveSkillSlot } from './skillLoadout';
import { Collectibles } from '../world/collectibles';
import {
  SKILL_HIT_MARGIN,
  WAVE_NEAR_HALF_WIDTH,
  cappedReach,
  exitDistance,
  skillById,
  type SkillDef,
  type SkillId,
} from './skills';

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

/**
 * 突进的两个常量。
 *
 * LUNGE_TIME_SCALE 把"冲多远"换算成速度：技能表里给的是距离（reach × attackRange），
 * 除以它得到速度，于是改冲的距离不会顺带改冲的时长——一招的节奏该是固定的。
 *
 * LUNGE_BODY_MARGIN 是撞人判定在身体半径之外再放宽多少。
 *
 * 13 不是"放宽一点"，是**犁出一条看得见的道**。原来给 2.5，加上体宽总半宽才 8 个单位，而
 * 人群互相分离的间距是 11 —— 一次冲刺只扫掉正中一列人，人群立刻合拢，画面上什么都没发生。
 * 实测玩家正前方 110 单位内有 184 人，半宽 8 只罩得住 9 个，半宽 16 罩得住 24 个。
 *
 * 这一条是"撞飞看不见"的真正原因，而不是力度或方向：尸体确实以 170 单位/秒横着甩出去，
 * 但它从一团人飞进另一团人，没有空地做参照就读不出位移。先有道，才看得见飞。
 */
const LUNGE_TIME_SCALE = 0.22;


/**
 * 冲刺撞人时的击飞力度和定格时长。
 *
 * 冲刺中的玩家（也就是镜头）跑 495 单位/秒，而普通击飞初速只有 78 —— 相对屏幕，被撞的人
 * 是往后退的。实测：尸体飞 55 个单位的同时玩家跑了 74 个，所以"撞飞"在画面上根本读不出来。
 *
 * 力度给到 2.2 倍，定格压到 25 毫秒（普通是 70）：被车撞和被刀砍不是一回事，而定格那段时间
 * 里镜头正在飞走，人钉在原地反而最像"没打中"。
 */
// 1.8 不是 2.2：改成横着甩之后，整份力气都用在"离开冲刺线"上了，不再有一半浪费在追着
// 镜头跑的前向分量上。2.2 时横向中位到 138 个单位，而视口半高才 109 —— 一半的尸体直接
// 飞出画面，看不到落地就是白飞。
const LUNGE_FORCE = 1.8;
const LUNGE_FREEZE = 0.025;

/**
 * 撞飞的方向里，"顺着冲刺方向"那一份占多少（横向那一份固定是 1）。
 *
 * 一开始把撞飞做成了朝正前方 —— 那是错的，而且错得很隐蔽：**朝前正是镜头追着跑的方向**。
 * 尸体以 170 单位/秒往前飞，玩家以 495 追上去，相对屏幕它几乎没动，看着就是被推着走的一堆
 * 东西，不是被撞开的人。
 *
 * 真正让人"飞出去"的是**垂直于路径**那一份：只有横向位移才能让尸体离开冲刺线，从镜头旁边
 * 甩出去。前向留一点（0.35）是为了不显得诡异 —— 被高速撞上的人当然会带一点前冲，但那只是
 * 佐料，主菜是横着掀开。
 */
const LUNGE_SIDE_FORWARD = 0.35;
const LUNGE_BODY_MARGIN = 13;

/*
 * 不要在这里加"打击顿帧"（砍中就把整个世界停几十毫秒）。试过一版，是错的。
 *
 * 它在别的类型里是标准做法，在割草里是原则性错误：玩家每 0.7 秒自动挥一次、每次都杀到人，
 * 于是世界每 0.7 秒停一下，占空比接近一成。那不读作"有力"，读作掉帧 —— 而割草的核心体验
 * 恰恰是**不停地**推进，任何周期性的停顿都在跟这件事对着干。
 *
 * 顿帧真正想给的重量，由受击者自己表达就够了：他在中刀的姿势上定住几帧再被掀飞（见
 * Character 的 HIT_FREEZE）。同样的冲击感，一分钱不从玩家的时间里出。
 */

/** 玩家的基础移动速度，以及按住 Shift 的速度。 */
const PLAYER_SPEED = 32;
const PLAYER_RUN_SPEED = 60;
/**
 * 找空位时往前看多远（按两人该有的间距的倍数），以及绕行时切向分量给到多少。
 *
 * 敌人围住玩家之后要**站定**，不能继续往里挤 —— 挤是塌陷的唯一来源。但光"挡住就停"不够：
 * 那样人只会沿半径方向一层层堆叠，内圈那一环永远填不满，玩家周围反而空。所以挡住之后要
 * 沿切线**绕行**去找空位，绕不到就停在外面（哪怕在屏幕外）。
 *
 * SIDESTEP 是绕行时切向占的权重。给满 1 会让人绕着玩家转圈永远不进来；太小又绕不开。
 *
 * SIDESTEP_SPEED 是绕行时的速度，按步速的几成算；SIDESTEP_NEAR 让它**随着离玩家变远再衰减**。
 * 围满之后那一圈没有缺口，全速绕行就是几百个人贴着人堆原地转圈 —— 整个画面一直在闪，而没有
 * 一个人真的挪到了更好的位置。
 *
 * 两段式而不是一刀切，是因为前后排要的东西不一样：贴着玩家那一圈得继续抢位置，人一死立刻
 * 有人补上，不然清场速度会塌；而后排怎么挪都轮不到他们，那点动作纯粹是噪声。所以近处保留
 * 绕行、远处按 SIDESTEP_NEAR/dist 衰减下去 —— 屏幕上绝大多数人属于后排，画面因此静下来。
 *
 * 真正在闪的是**步态**，不是位移：动画器按 speed/walkSpeed 混合走路循环，全速绕行时后排的
 * 幅度有 0.45，几百个人一起走就是满屏在晃。0.12 这一档把它压到 0.15，前排还留着 0.26 在补位。
 * 扫过 0.3 / 0.2 / 0.12 / 0.06：再往下清场速度开始塌（站桩测法下从 3.6 掉到 2.9），收益却
 * 只剩零点几。想让人群更活就往上调，更静就往下。
 *
 * 试过两条"干脆让他停住"的路，都失败了，记在这儿免得再走一遍：
 *
 *   左右也堵住就停 —— 密集场里每个人旁边都有人，整片人冻成一块，连该进攻的前排都不动。
 *   排在站定的人后面就站定 —— 会死锁。人群冻成刚体之后，玩家把正面扇区清空，空出来的地方
 *     再没人流进去（边上的人被站定的邻居锁着，而那些邻居不在攻击弧里永远不死），二十秒里
 *     一个都杀不掉。
 *
 * 教训是一样的：人群必须保持能流动，"减少移动"只能靠**压低速度**，不能靠禁止移动。
 */
const SLOT_LOOKAHEAD = 1.5;
const SIDESTEP = 0.9;
const SIDESTEP_SPEED = 0.12;
const SIDESTEP_NEAR = 45;

/** 大到打不完，当"无敌"用。不使用 Infinity：省得血量参与运算的地方冒出 NaN。 */
export const INVINCIBLE_HP = 999999;

/**
 * 生命值的档位。菜单里那个 [− 生命 N +] 在这张表上走。
 *
 * 走梯子不走等差：调试同屏几百人的时候，二十点血撑不过两秒，而一格一格加十点要按半天。
 * 顶格是 INVINCIBLE_HP，面板上显示成"无敌"。
 */
const HP_LADDER = [5, 10, 20, 50, 100, 200, 500, 1000, INVINCIBLE_HP];

/**
 * 开局血量。必须是 HP_LADDER 上的一档 —— 菜单里的 [− 生命 +] 是在那张表上走的，起点不在
 * 表上的话第一次按加号会先跳到最近的一档，看着像少了一次。
 */
const PLAYER_HP = 100;

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

/**
 * 开局先在**视口外**铺这么多。
 *
 * 以前是从脚边到视野边缘直接撒，开场第一帧玩家周围就凭空围了一圈人 —— 那不是"战场上有敌人"，
 * 是"敌人是刚才生出来的"，穿帮得很明显。现在这一批和之后每一个都走同一条路（spawn），
 * 全部生在看不见的地方再走进来。
 *
 * 代价是开局有几秒钟画面偏空。这是对的：割草的压迫感来自人越涌越多，而不是一上来就满屏。
 */
/**
 * 敌人死亡掉金币的概率，剩下的都掉灵石。
 *
 * 1/50 是故意压低的：金币要当成一局里能记住的小惊喜，掉多了就和灵石一样成了背景噪音，
 * 玩家反而两种都不会去看。数值平衡以后要动的话改这一个常量就行。
 */
const COIN_DROP_CHANCE = 1 / 50;

const SEED_COUNT = 30;

/** 每种兵连续出生多少个再换下一种；和开局人数一致，第一屏天然就是完整的一波。 */
const ENEMIES_PER_TYPE_WAVE = SEED_COUNT;

/**
 * 开局那一批往视口外再多撒多远。
 *
 * 光走 spawn 的话三十个人全贴在视口边缘上，会读作一个同时收缩的圆环 —— 整整齐齐，一眼假。
 * 多给一段随机纵深，他们就分批到达：近的几秒内就打上来，远的还在路上。
 */
const SEED_DEPTH = 150;

/**
 * 出兵倍率的上限。
 *
 * 这个值现在是**手调的**，菜单里那个 [− 出兵 xN +] 就是它，随游戏进行自动涨是后面做游戏性
 * 时的事，这里不掺和。
 */
const MAX_SPAWN_BATCH = 12;

/**
 * 出怪点落在视口外多远，以及随机抖动的幅度。
 *
 * 只要出了视口就看不见，所以这个数不用大 —— 它决定的是"敌人从看不见的地方走进来要多久"。
 * 给得太大，玩家清完一波要等上好几秒；太小，缩放拉远的那一帧可能刚好把人露出来。
 *
 * 它同时是 DESPAWN_MARGIN 的下限：出怪点必须落在回收框里面，否则人一生出来就被抹掉。
 */
const SPAWN_MARGIN = 12;
const SPAWN_JITTER = 24;

/**
 * 视野外多远开始回收，按视口半宽/半高的倍数。
 *
 * 跑步机模型的另一半：出怪只管往前补，回收负责把身后跟不上的人抹掉。少了它，玩家一路跑
 * 过去会拖着一条越来越长的尾巴 —— 那些人永远追不上，只是在白烧 CPU。
 *
 * 下限由出怪点定：出怪最远落在视口外 SPAWN_MARGIN + SPAWN_JITTER（36 个单位），而 0.3 个
 * 视口有 49，生出来不会当场被回收掉。
 *
 * 这个数直接决定场上养多少人，而屏幕上看到的几乎不受影响 —— 多出来的全是屏幕外排队的。
 * 实测站桩：0.5 时场上 1043、屏内 451、逻辑 3.1ms；0.3 时场上 702、屏内 381、逻辑 2.0ms。
 * 场上少了三分之一，屏内只少 15%，逻辑省了 35% —— 那部分人纯粹是在屏幕外白烧 CPU。
 */
const DESPAWN_MARGIN = 0.3;

/** 全图初始散布及持续补怪的目标间距（世界单位），调小会增加远处怪物密度。 */
export const WORLD_ENEMY_SPACING = 28;
/** 完整怪物和移动数据共享的 CPU/内存兜底；常规新增及远处名额调配优先遵守更低的日常预算。 */
export const MAX_WORLD_ENEMIES = 4000;
/** 日常总量预算。远处预留名额不能把玩家附近的跑步机刷怪永久关掉。 */
export const TARGET_WORLD_ENEMIES = 2400;
const WORLD_REFILL_RESERVE = 600;
/** 总量拥挤时仍保障这批附近进攻者；并非额外增加全图上限。 */
export const LOCAL_ENEMY_TARGET = 600;

/**
 * "重新获得视线"的判定框，同样按出货视口半宽/半高的倍数。
 *
 * 必须**小于** DESPAWN_MARGIN，两者之间那条带子就是迟滞区。少了它，恰好卡在回收线上的位置
 * 会每帧"恢复—回收—恢复"地抖，白白搅动人数。
 *
 * 0.15：恢复线落在视口外 0.15 × 120 = 18 个单位，人是在**画面外**放回去的，看不到凭空出现；
 * 而离回收线还有 18 个单位，冲刺也要 0.3 秒才穿过，抖不起来。
 */
const RESTORE_MARGIN = 0.15;

/**
 * 玩家在动时，出怪往前方偏多少。0 是四面八方，1 是正后方完全不出。
 *
 * 理由是物理性的：玩家跑起来（60）比每一种敌人都快，生在身后的人永远追不上，走两步就被
 * 回收了 —— 那是纯粹的浪费。偏移量按"玩家跑得多快"缩放，站着不动时自然退回四面八方，
 * 也就是围杀的那个形态。
 */
const FORWARD_BIAS = 0.85;

/**
 * "算不算在画面里"的余量，世界单位。
 *
 * 画面外的人只走计时：不搭姿势（那是每人每帧最贵的一块，而没人看得见），也不找空位。留一点
 * 余量是为了让人在真正露头之前就已经在正常行事，边界上看不出切换。
 */
const SCREEN_SLACK = 40;

/**
 * 允许在地图外多远的地方出怪。
 *
 * 图外**是可以出人的**，而且必须可以：玩家贴到边界时，四周有大半个方向在图外，只在图内找
 * 位置的话那些方向一个人也生不出来 —— 于是人只从场内一侧涌来，包围感直接没了。相机被夹在
 * 场内，图外永远不会出现在画面上，所以那里生出来的人是从视野外走进来的，和场内没有区别。
 *
 * 留一个上限只是为了兜住"缩放拉到全景"那种情形：那时视口比整张图还大，射线要跑很远才出得
 * 去，不夹一下会把人扔到几千个单位以外，走一分钟都到不了。
 */
const SPAWN_OUTSIDE = 300;

/**
 * 人群间距的倍率，乘在 Character.spacing（躯干半宽）上。可运行时调，用来对比手感。
 */
/**
 * 人群间距的倍率，乘在 Character.spacing（躯干半宽）上。
 *
 * 1 是"两个人的躯干圆刚好相切"。但相切**还不够看**：描边是整层一次的合成通道（见
 * PixelSurface），不是逐人描的，所以挨在一起的两个人会融成一个带一圈边的团，读不出是两个。
 * 胳膊还会再往外伸一点，把那点缝也填掉。
 *
 * 量出来的：贴身那圈人的中位间距，x1.0 是 7.4 个单位 —— 躯干边缘差 2 个像素才分开，也就是
 * 还在重叠；x1.5 是 10.5，躯干之间空出 3.1 个世界单位（出货那一档是 12 个像素），而贴身 25
 * 单位内的人数只从
 * 13 掉到 12。再往上到 x1.6 空隙 11 像素，但贴身圈就掉到 9 人了，密度开始真的变稀。
 */
const CROWD_SPACING = 1.5;
/** 允许调到的上限。 */
const MAX_CROWD_SPACING = 2.2;

/** 场上最胖的人。格子边长和探测半径都按他算最坏情况。 */
const MAX_BULK = 1.34;
/** 最胖那位的站位半径。 */
const MAX_SPACING = RigSpec.torsoHalfWidth * MAX_BULK;

/** 当前间距下，分离的最大交互距离 —— 也就是格子边长的下限。 */
const cellSizeFor = (spacing: number): number =>
  Math.ceil(RigSpec.torsoHalfWidth * MAX_BULK * 2 * spacing);



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
/** 弓手单独放慢到约每 2.8～3.8 秒一箭，避免落地箭很快铺满画面。 */
const ENEMY_ARCHER_SHOT_GAP = 2.8;
const ENEMY_ARCHER_SHOT_JITTER = 1;

/** 敌军箭矢：速度决定玩家看见箭后有多少反应时间；落点半径只比玩家身体略宽。 */
const ENEMY_ARROW_SPEED = 105;
const ENEMY_ARROW_MIN_TIME = 0.35;
const ENEMY_ARROW_MAX_TIME = 1.1;
const ENEMY_ARROW_HIT_MARGIN = 1.2;
const ENEMY_ARROW_GROUND_TIME = 3.5;
const ENEMY_ARROW_FADE_TIME = 0.9;

/**
 * 停步之前多长一段距离用来减速，世界单位。
 *
 * 不加这一段的话，"走"和"到位站定"之间是个硬开关：停在这个距离上的人每帧都在全速走路循环和
 * 站姿之间翻，几十个人一起翻就是那种特别刺眼的闪。实测走↔站的跳变占到 5% 的帧。
 * 有了这段缓冲，人是滑进位置的，速度连续到零。
 */
const APPROACH_BAND = 6;

/**
 * "想走多快"跟随目标值的时间常数，秒。见 Character.crowdPace。
 *
 * 0.18 秒：足够把每两三帧一次的抖动抹平，又不至于让人在前排腾出位置时反应迟钝（那会掉清场
 * 速度）。用 1 - exp(-dt/τ) 而不是定值系数，掉帧时行为才不变。
 */
const PACE_TAU = 0.18;

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
  { name: 'knight 骑士', make: UnitPresets.knight },
];

/** 菜单和 HUD 共用的角色显示名，英文部分只是内部预设代号。 */
export function playerPresetDisplayName(index: number): string {
  return PlayerPresets[index]?.name.replace(/^[a-z]+\s*/, '') ?? '';
}

/**
 * 敌人的种类。def 和调色板是共享的只读数据，一百个杂兵指向同一份就够了。
 *
 * 这张表只放杂兵。UnitPresets.knight 是 boss，刻意不在这里 —— 他一个人 120 个图元
 * （杂兵六十上下），而且面甲、盔冠、金护手那些细节是为"这个人不一样"准备的，一屏站
 * 二十个就什么也不说明了。理由写在 unitDef.ts 那条预设上面。
 *
 * 速度是按"多久能走进画面"倒推的，不是按写实的步行速度。视野半径有两百多个世界单位（一个人
 * 才 19 单位高），照真人步速走进来要半分钟 —— 开局一整分钟画面上什么都不会发生。割草游戏里
 * 的杂兵本来也是小跑着扑过来的。
 */
type EnemyKind = { def: UnitDef; palette: CharacterPalette; speed: number };

const EnemyKinds: EnemyKind[] = [
  { def: UnitPresets.thug(), palette: PALETTE_RED, speed: 26 },
  { def: UnitPresets.thug(), palette: PALETTE_PEASANT, speed: 30 },
  { def: UnitPresets.spearman(), palette: PALETTE_RED, speed: 23 },
  { def: UnitPresets.shieldman(), palette: PALETTE_RED, speed: 20 },
  { def: UnitPresets.archer(), palette: PALETTE_PEASANT, speed: 33 },
];

/**
 * 同类兵种按波进入；两种杂兵只是配色不同，仍放在同一波里。
 * 顺序固定，观察角色时不会被随机混兵打断。
 */
const EnemyTypeWaves: readonly (readonly EnemyKind[])[] = [
  [EnemyKinds[0], EnemyKinds[1]],
  [EnemyKinds[2]],
  [EnemyKinds[3]],
  [EnemyKinds[4]],
];

/**
 * 一道正在往外跑的技能波。
 *
 * 这是**游戏状态**，不是特效：它每帧都要结算杀伤。同名的东西在 effects/impact.ts 里也有
 * 一份，那份是画出来的样子，这份是判定，两者用同一条推进曲线（frontRadius）所以永远对得上。
 * 分成两份是因为它们的生命周期不一样：特效可以在玩家死了、重开了之后继续跑完，判定不行。
 */
interface SkillWave {
  x: number;
  y: number;
  /** 施放瞬间从玩家继承的世界速度；判定和画面必须一起平移。 */
  vx: number;
  vy: number;
  heading: number;
  age: number;
  life: number;
  from: number;
  to: number;
  arc: number;
  /** 打中时溅多少碎片，见 SkillDef.power。 */
  power: number;
}

/**
 * 一支已经离弦的敌军箭。targetX/Y 在撒放瞬间写死，之后绝不读取玩家位置来修正弹道。
 * current/previous 给渲染器画出有长度的箭体，判定只在抵达固定落点时发生。
 */
export interface EnemyArrow {
  fromX: number;
  fromY: number;
  targetX: number;
  targetY: number;
  x: number;
  y: number;
  z: number;
  previousX: number;
  previousY: number;
  previousZ: number;
  startZ: number;
  arcHeight: number;
  age: number;
  total: number;
  landed: boolean;
  groundLeft: number;
  opacity: number;
}

/** 取敌军箭在固定弹道某一时刻的位置；逻辑推进和渲染尾迹共用，避免两条弧线错位。 */
export function enemyArrowPosition(arrow: EnemyArrow, age = arrow.age): { x: number; y: number; z: number } {
  const t = clamp(age / arrow.total, 0, 1);
  return {
    x: arrow.fromX + (arrow.targetX - arrow.fromX) * t,
    y: arrow.fromY + (arrow.targetY - arrow.fromY) * t,
    z: arrow.startZ * (1 - t) + 0.7 * t + Math.sin(Math.PI * t) * arrow.arcHeight,
  };
}

/** 这一帧玩家想干什么。由输入层翻译好再交进来，Battle 不认识鼠标和键盘。 */
export interface BattleInput {
  /** 该朝哪儿，弧度；null 表示保持不变（准星正压在人身上时方向没有意义）。 */
  facing: number | null;
  moving: boolean;
  running: boolean;
}

/**
 * 这一帧的视野。两个框，各管各的事。
 *
 * 出怪用 spawn 那个框，它按**出货那一档**缩放算，和运行时的滚轮无关 —— 缩放是调试旋钮，
 * 上线后视口固定，出怪的节奏不该跟着调试视角变。而 x/y/radius 是**当前真实**的视野，用来
 * 判断谁远到不必搭姿势：那是纯性能优化，看得见的人就得搭，跟出货尺寸没关系。
 *
 * 出怪框给的是**矩形**而不是一个半径。用绕玩家的圆有个隐蔽的毛病：玩家贴到地图边缘时镜头
 * 被夹住，人就偏出了画面中心，这时以玩家为心、半径等于视口对角线的圆**盖不住整个视口**
 * —— 偏出去的那一侧会有敌人当着面刷出来。
 */
export interface BattleView {
  /** 当前镜头中心的世界坐标。 */
  x: number;
  y: number;
  /** 当前视口对角线的一半。只用来判断谁远到不必搭姿势。 */
  radius: number;
  /** 实际可见矩形。省略时使用 spawn，兼容离线战斗模拟。 */
  visible?: { x: number; y: number; halfW: number; halfH: number };
  /** 出怪框：出货那一档缩放下的视口，中心也按那一档夹过。 */
  spawn: { x: number; y: number; halfW: number; halfH: number };
}

const smooth = (prev: number, now: number): number => prev * 0.9 + now * 0.1;

/**
 * 一个被回收掉的敌人留下的**位置**。
 *
 * 存的是重建一个一模一样的人所需的全部东西。def 和 palette 是 EnemyKinds 里那份共享的只读
 * 数据，直接引用即可，不用记下标 —— 一千条预留指向同五份 def。
 *
 * 只存活人；远处照常移动、避障和推进冷却，但不创建骨架或动画器。
 */
type EnemyMover = Pick<Character,
  'x' | 'y' | 'facing' | 'def' | 'speed' | 'walkSpeed' | 'crowdPace' |
  'sideBias' | 'radius' | 'spacing' | 'alive'
>;

/** 只缓存邻居让路决策；朝向、速度、移动和碰撞仍逐帧计算。 */
interface CrowdDecision {
  group: number;
  /** 下次问到必须重算：刚建的，以及站定过又重新起步的。 */
  stale: boolean;
  dirX: number;
  dirY: number;
  crowdSpacing: number;
  room: number;
  side: number;
}

/**
 * 近处的邻居让路决策分几组轮流做，一帧只做其中一组。
 *
 * 分组本身就是陈旧度的上限：最多隔三帧。**不要再叠一道按游戏时间算的上限** —— dt 被夹在
 * 1/20 秒（见 main.ts 主循环那段），所以掉到二十帧以下时，任何 50 毫秒量级的时间上限每帧
 * 都正好到期，缓存命中率直接归零。实测命中率 60Hz 66%、30Hz 33%、20Hz 0%、15Hz 0%：那道
 * 上限让这条优化在最需要它的机器上关掉了自己。
 *
 * 这和 collisionSteps 曾经按 moveDt 分子步是同一类错：按时间定的规则，掉帧时会反过来加重
 * 下一帧，而那正是掉帧的机器承受不起的。
 */
const CROWD_DECISION_GROUPS = 3;

interface Reservation extends EnemyMover {
  motion: DistantMotion;
  palette: CharacterPalette;
  /** 出手冷却。连这个也带上，回来的那一群才不会整齐划一地同时挥。 */
  cooldown: number;
  hp: number;
  maxHp: number;
}

export class Battle {
  readonly player: Character;
  readonly enemies: Character[] = [];
  /** 冲击弧。由挥击的落点放出，所以归战斗管；画它的是 Scene。 */
  readonly effects = new ImpactEffects();
  /** 打碎溅出来的血珠和甲片。同上：谁放出来的归战斗管，画它的是 Scene。 */
  readonly debris = new Debris();
  /** 地图上的掉落物。数值结算尚未接入，目前只负责生成、落地和吸附。 */
  readonly collectibles = new Collectibles();
  /** 当前一局实际拾取的宝石数，HUD 用于循环进度；暂不参与升级或奖励。 */
  collectedGems = 0;
  collectedCoins = 0;
  /** 弓箭手已经射出的箭。公开只供 Scene 读取并绘制。 */
  readonly enemyArrows: EnemyArrow[] = [];

  kills = 0;
  deaths = 0;
  presetIndex = 0;

  /**
   * 完整 Character 的性能上限，含尚未清理的尸体，运行时用逗号/句号调整。
   * 只约束近处激活和近处补兵；远处按区域密度补充轻量数据，不消耗这些槽位。
   * 全图移动/碰撞开销另由 MAX_WORLD_ENEMIES 兜底，区域补怪也必须遵守它。
   */
  maxEnemies = 1500;
  autoAttack = true;

  /** 玩家这一帧真正走出的速度；撞墙时会小于 player.speed。 */
  private playerVelocityX = 0;
  private playerVelocityY = 0;

  /**
   * 玩家当前拥有的技能、互斥槽与每项独立冷却。敌人仍只使用自己的基础攻击。
   * 装备规则全部收在 SkillLoadout，Battle 只负责到了触发时刻之后具体发生什么。
   */
  readonly skillLoadout = new SkillLoadout();

  /** 一次挥击起手时锁定的自动攻击；中途改菜单不会把已经挥出的招偷换掉。 */
  private pendingAttackSkill: SkillId = this.skillLoadout.attackSkill;

  /** 正在往外跑的技能波。只有"破空"会往这里放东西。 */
  private readonly skillWaves: SkillWave[] = [];

  /** 正在冲刺。Scene 拿它把玩家点亮 —— 高速位移得有个"我在冲"的信号。 */
  get dashing(): boolean {
    return this.lunge !== null;
  }

  /** 突进：还剩多久、朝哪个方向冲。null = 没在冲。 */
  private lunge: {
    left: number;
    heading: number;
    speed: number;
    power: number;
    /** 收招时补的那一圈的半径，世界单位。0 = 不补。 */
    finishRing: number;
    /** 这一帧移动**之前**在哪儿。判定要按走过的那一整段算，不是按落点。 */
    fromX: number;
    fromY: number;
  } | null = null;

  /**
   * 金钟罩：一个跟着玩家走的罩子，碰到的人全飞。
   *
   * 公开是给 Scene 画的 —— 它和别的技能不一样，不是一瞬间的事件而是一段**持续的状态**，
   * 特效系统里"放出去就不管了"的冲击弧表达不了它，得每帧跟着人重画。
   */
  aegis: { left: number; total: number; radius: number; power: number } | null = null;

  /** 天地法相：持续判定跟着玩家走；公开状态只供 Scene 同步上半身外壳。 */
  dharma: { left: number; total: number; radius: number; power: number } | null = null;

  /** 开天：柄的位置沿施放时的行走朝向推进；Scene 用同一状态画穿云剑模型。 */
  heavenSplit: {
    age: number;
    left: number;
    total: number;
    x: number;
    y: number;
    heading: number;
    speed: number;
    power: number;
  } | null = null;

  /** 穿云箭：升空后在第 0.8 秒选定当前视口内的落点，再从天而降。Scene 只读这个状态来画箭。 */
  skyArrow: {
    age: number;
    targetX: number;
    targetY: number;
    radius: number;
    power: number;
  } | null = null;

  /** 生命上限顶到了"无敌"那一档没有。面板要显示成文字，不是一串九。 */
  get invincible(): boolean {
    return this.player.maxHp >= INVINCIBLE_HP;
  }

  /**
   * 调生命上限，沿 HP_LADDER 走一格，并把血补满。
   *
   * 补满是有意的：调血量只在调试时用，留着半管血继续打没有意义，还会让"改完之后到底死没死"
   * 变成两个变量的事。
   */
  nudgeMaxHp(delta: number): void {
    let at = HP_LADDER.indexOf(this.player.maxHp);
    // 当前值不在梯子上（比如以前手改过）就从第一个不小于它的档起步。
    if (at < 0) {
      at = HP_LADDER.findIndex((v) => v >= this.player.maxHp);
      if (at < 0) at = HP_LADDER.length - 1;
    }
    const next = clamp(at + delta, 0, HP_LADDER.length - 1);
    this.player.maxHp = HP_LADDER[next];
    this.player.hp = this.player.maxHp;
  }

  /**
   * 一个出怪间隔里放几个人进来。菜单里那个 [− 出兵 xN +]。
   *
   * x1 是一个一个挪进画面，往上调就是一小群一小群涌上来。
   *
   * 注意它**不决定场上有多少人** —— 稳态是回收框定的（见 DESPAWN_MARGIN），出兵再快也只是更快
   * 顶到那条线。实测（grain 3 那一档视口下）x8 稳在 1335、x20 稳在 1465，差别很小。这个数真正
   * 影响的是**多快填满**：默认 6 大约几十秒填满一屏，调到 1 要好几分钟。
   */
  spawnBatch = 6;

  private innerCrowdSpacing = CROWD_SPACING;

  /**
   * 人群间距倍率，乘在躯干半宽上。1 就是两个人的躯干圆刚好相切。
   *
   * 调大人堆更松、更读得出个数，调小更挤。夹在上限里是因为 GRID_CELL 是按上限算死的 ——
   * 超过它，分离就会开始漏判边上的人，症状是偶尔两个人穿模，很难查。
   */
  get crowdSpacing(): number {
    return this.innerCrowdSpacing;
  }
  set crowdSpacing(value: number) {
    this.innerCrowdSpacing = clamp(value, 0.2, MAX_CROWD_SPACING);
    // 格子必须跟着交互距离走：小了分离会漏判（偶尔两个人穿模，很难查），大了每次查询白扫
    // 一堆够不着的人。
    this.grid.setMinCellSize(cellSizeFor(this.innerCrowdSpacing));
  }

  /** 调出兵批量。菜单和键盘走同一条路。 */
  nudgeSpawnBatch(delta: number): void {
    this.spawnBatch = clamp(this.spawnBatch + delta, 1, MAX_SPAWN_BATCH);
  }

  /**
   * 分离要跑几趟。
   *
   * 这个数曾经高达 16，因为那时敌人会无视前方一直往里挤，分离是唯一的对抗力量 —— 而位置
   * 松弛一趟只能把每对的重叠推开一半、且"我被推开"要一趟才传给身后那个人，十几排深的人堆
   * 就得十几趟才收敛。现在 slotAhead 让人在挤上之前就停下绕行，压力从源头没了，分离退回成
   * 收尾用的小修补。
   *
   * 实测（同屏 1000）：1 趟还有 3% 的人视觉上叠着，2 趟就是 0%，再往上到 16 趟间距没有任何
   * 变化，只有逻辑时间从 2.5 毫秒涨到 5.1。取 3 是在 2 的基础上留一点余量。
   *
   * 注意这个数和 slotAhead 是一对：哪天把找空位那段去掉，这里必须变回十几趟。
   */
  private get separationPasses(): number {
    return 3;
  }

  /** 这一局回收掉多少人。面板上显示，用来看跑步机转得对不对。 */
  recycled = 0;
  /** 这一局按预留位置放回去多少人。和 recycled 一起看就知道"回头"这件事有没有生效。 */
  restored = 0;

  /** 全图无骨架怪物：继续推进移动的数据，以及离开可见范围的怪物。 */
  private readonly reserved: Reservation[] = [];
  private distantRegionCounts = new Uint32Array(0);

  /** 两种表示共享同一张移动邻居表，视口边界两侧的怪物也能互相避让。每帧复用数组。 */
  private readonly movers: EnemyMover[] = [];
  private readonly movementGrid = new SpatialGrid(cellSizeFor(CROWD_SPACING));
  /** 0 本帧跳过，1 近处逐帧，2 远处本帧轮到（只做一轮分离）。 */
  private movementDue = new Uint8Array(0);
  private farGroup = 0;
  // 按对象绑定分组，数组交换删除不会改组；回收/恢复的新对象首次移动时重新决策。
  private readonly crowdDecisions = new WeakMap<EnemyMover, CrowdDecision>();
  private crowdDecisionGroup = 0;
  private crowdDecisionFrame = 0;

  /** 小地图读取实时位置，不需要访问无骨架怪物的战斗内部状态。 */
  *enemyPositions(): Generator<Readonly<{ x: number; y: number }>> {
    for (const enemy of this.enemies) if (enemy.alive) yield enemy;
    yield* this.reserved;
  }

  /** 小地图用平滑坐标；刷怪密度、激活与碰撞始终使用真实模拟坐标。 */
  *minimapEnemyPositions(): Generator<Readonly<{ x: number; y: number }>> {
    for (const enemy of this.enemies) if (enemy.alive) yield enemy;
    for (const enemy of this.reserved) yield enemy.motion.map;
  }

  get dormantEnemyCount(): number {
    return this.reserved.length;
  }

  /** 包含尸体占用的活跃槽位，确保生成和休眠转换共用同一个硬上限。 */
  get worldEnemyCount(): number {
    return this.enemies.length + this.reserved.length;
  }

  /** 这一局跑了多久，秒。 */
  private clock = 0;

  /** 只读的战斗时间，供不改变战斗状态的呼吸光等连续视觉使用。 */
  get elapsed(): number {
    return this.clock;
  }

  /** 逻辑这一段花掉的毫秒，指数平滑。暂停面板要读。 */
  simMs = 0;

  private readonly field: Field;
  private readonly worldPopulation: WorldPopulation;
  private spawnTimer = 0;
  private enemyWaveIndex = 0;
  private enemiesLeftInWave = ENEMIES_PER_TYPE_WAVE;

  /**
   * 邻居查表。每帧重建一次，分离和"把人推出玩家身体"都走它。
   *
   * 它自己按人群的包围盒开表，所以图外那一圈不用特意交代 —— 人走到哪儿，表就盖到哪儿。
   */
  private readonly grid: SpatialGrid;

  constructor(field: Field) {
    this.field = field;
    this.worldPopulation = new WorldPopulation(field.width, field.height, WORLD_ENEMY_SPACING);
    this.grid = new SpatialGrid(cellSizeFor(CROWD_SPACING));
    this.player = new Character(PlayerPresets[0].make(), PALETTE_HERO, HUMAN_PACE);
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
  reset(view: BattleView): void {
    this.enemies.length = 0;
    // 预留的是"刚才那片人海"，重开之后它不该再长回来。
    this.reserved.length = 0;
    this.kills = 0;
    this.recycled = 0;
    this.restored = 0;
    // 跨帧招式和各自冷却一起归零；装备方案保留，重开不会替玩家换技能。
    this.resetSkillRuntime();
    this.enemyArrows.length = 0;
    this.debris.clear();
    this.collectibles.clear();
    this.collectedGems = 0;
    this.collectedCoins = 0;
    this.player.death = -1;
    this.player.hurt = 0;
    this.player.hp = this.player.maxHp;
    this.seed(view);
  }

  /** 清掉已经放出的技能状态与冷却，但保留玩家的装备方案。 */
  private resetSkillRuntime(): void {
    this.skillWaves.length = 0;
    this.lunge = null;
    this.aegis = null;
    this.dharma = null;
    this.heavenSplit = null;
    this.skyArrow = null;
    this.pendingAttackSkill = this.skillLoadout.attackSkill;
    this.skillLoadout.resetCooldowns();
  }

  /**
   * 开局在视口外放一批进攻者，并在全图空地散布会移动的轻量怪物数据。
   */
  seed(view: BattleView): void {
    this.spawnTimer = 0;
    this.farGroup = 0;
    this.enemyWaveIndex = 0;
    this.enemiesLeftInWave = ENEMIES_PER_TYPE_WAVE;
    // 全部生在视口外，和之后每一个走同一条路：方向均匀一整圈，距离按"沿这个方向走多远才
    // 出画面"算，再往外多撒一段随机纵深（见 SEED_DEPTH）让他们分批到达。
    for (let i = 0; i < SEED_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const r = this.exitDistance(cos, sin, view) + SPAWN_MARGIN + Math.random() * SEED_DEPTH;
      if (this.place(this.player.x + cos * r, this.player.y + sin * r, view, EnemyTypeWaves[this.enemyWaveIndex])) {
        this.enemiesLeftInWave--;
      }
    }
    if (this.enemiesLeftInWave <= 0) this.advanceEnemyWave();
    this.seedWorld(view);
    this.worldPopulation.reset();
  }

  /** 分格散布全图。每格随机一点，避免扎堆；避开开局视口和实际障碍。 */
  private seedWorld(view: BattleView): void {
    const field = this.field;
    const cols = Math.max(1, Math.floor(field.width / WORLD_ENEMY_SPACING));
    const rows = Math.max(1, Math.floor(field.height / WORLD_ENEMY_SPACING));
    const cellW = field.width / cols;
    const cellH = field.height / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (this.worldEnemyCount >= MAX_WORLD_ENEMIES) return;
        const kind = EnemyKinds[Math.floor(Math.random() * EnemyKinds.length)];
        for (let attempt = 0; attempt < 4; attempt++) {
          const x = (col + 0.25 + Math.random() * 0.5) * cellW;
          const y = (row + 0.25 + Math.random() * 0.5) * cellH;
          if (this.placeWorldEnemy(x, y, view, kind)) break;
        }
      }
    }
  }

  /** 开局和持续补怪共用：不占完整怪物槽位，不在可见区生成，不创建 Character。 */
  private placeWorldEnemy(
    x: number, y: number, view: BattleView,
    kind: EnemyKind = EnemyKinds[Math.floor(Math.random() * EnemyKinds.length)],
  ): Reservation | null {
    if (this.worldEnemyCount >= MAX_WORLD_ENEMIES || this.inActiveArea(x, y, view, DESPAWN_MARGIN)) return null;
    const radius = RigSpec.hipHalfWidth * kind.def.bulk * 1.15;
    if (!isFreeSpot(this.field.terrain, this.field.props, x, y, radius)) return null;
    const enemy: Reservation = {
      motion: new DistantMotion(x, y, this.clock, this.farGroup++),
      x, y, def: kind.def, palette: kind.palette,
      walkSpeed: kind.speed, speed: 0, crowdPace: 0,
      sideBias: Math.random() < 0.5 ? -1 : 1,
      radius, spacing: RigSpec.torsoHalfWidth * kind.def.bulk, alive: true,
      facing: Math.atan2(this.player.y - y, this.player.x - x),
      cooldown: Math.random() * (kind.def.weapon === 'bow' ? ENEMY_ARCHER_SHOT_GAP : ENEMY_SWING_GAP),
      hp: 1, maxHp: 1,
    };
    this.reserved.push(enemy);
    return enemy;
  }

  /** 实际镜头与出怪框的并集；恢复区小于回收区，避免边缘反复装卸。 */
  private inActiveArea(x: number, y: number, view: BattleView, margin: number): boolean {
    const box = view.spawn;
    if (Math.abs(x - box.x) <= box.halfW * (1 + margin) &&
        Math.abs(y - box.y) <= box.halfH * (1 + margin)) return true;
    const visible = view.visible;
    const slack = SCREEN_SLACK * margin / RESTORE_MARGIN;
    return visible !== undefined &&
      Math.abs(x - visible.x) <= visible.halfW + slack &&
      Math.abs(y - visible.y) <= visible.halfH + slack;
  }

  /** 更新完整怪物与轻量数据的归属，也可在暂停后调整镜头时调用。此方法不推进移动。 */
  syncEnemyVisibility(view: BattleView): void {
    // 释放上一帧移动数组对已卸载 Character 的引用。
    this.movers.length = 0;
    this.recycle(view);
    this.grid.build(this.enemies);
    this.restoreReserved(view);
  }

  /**
   * 在视口外随机一个方向生一个。
   *
   * 方向是均匀的一整圈，不做任何"这边在图外就换一边"的挑拣 —— 那正是包围感的来源。距离按
   * **沿这个方向走多远才出画面**算，所以每个方向都恰好在看不见的地方生成，不多走一步。
   */
  spawn(view: BattleView, kinds: readonly EnemyKind[] = EnemyKinds): boolean {
    const angle = this.spawnAngle();
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const r = this.exitDistance(cos, sin, view) + SPAWN_MARGIN + Math.random() * SPAWN_JITTER;
    return this.place(this.player.x + cos * r, this.player.y + sin * r, view, kinds);
  }

  /**
   * 这一个从哪个方向来。
   *
   * 站着不动就是均匀的一整圈（围杀那个形态）；一旦跑起来就往前方偏 —— 生在身后的人追不上，
   * 走两步就被回收，纯属浪费。见 FORWARD_BIAS。
   *
   * 用拒绝采样而不是解析反变换：权重是 1 + bias·cos(θ−前进方向)，反变换要解一个超越方程，
   * 而拒绝采样在这个权重下平均一两次就中，还顺带保证了分布是精确的。
   */
  private spawnAngle(): number {
    const bias = clamp(this.player.speed / PLAYER_RUN_SPEED, 0, 1) * FORWARD_BIAS;
    if (bias < 0.02) return Math.random() * Math.PI * 2;
    const dir = this.player.facing;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      if (Math.random() * (1 + bias) <= 1 + bias * Math.cos(a - dir)) return a;
    }
    return dir;
  }

  /**
   * 把远处的人转为无骨架数据。出怪框和实际可见框之外都留缓冲带；调试拉远镜头时，仍然保留
   * 画面中可见的怪物。出怪节奏继续按出货框计算。
   *
   * 尸体也一起回收：它们已经在画面外，没人看得见，留着只是占着数组。
   *
   * 抹掉的是**模型**，不是那个人站过的地方：活人在离场时把位置记进预留表，视线回来时照着
   * 放回去。数据不按时间过期；仅在总量满且附近缺兵时，允许从远处密集区调配刷怪名额。
   */
  private recycle(view: BattleView): void {
    const enemies = this.enemies;
    const reserved = this.reserved;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (this.inActiveArea(e.x, e.y, view, DESPAWN_MARGIN)) continue;
      if (e.alive) {
        reserved.push({
          motion: new DistantMotion(e.x, e.y, this.clock, this.farGroup++),
          x: e.x,
          y: e.y,
          facing: e.facing,
          def: e.def,
          palette: e.palette,
          walkSpeed: e.walkSpeed,
          speed: e.speed,
          crowdPace: e.crowdPace,
          sideBias: e.sideBias,
          radius: e.radius,
          spacing: e.spacing,
          alive: true,
          cooldown: e.attackCooldown,
          hp: e.hp,
          maxHp: e.maxHp,
        });
      }
      enemies[i] = enemies[enemies.length - 1];
      enemies.pop();
      this.recycled++;
    }
  }

  /**
   * 视线回到哪儿，就把那儿预留的人放回去。
   *
   * 只有成功激活才消费记录；容量不足或落点被占时保留数据，不能让小地图上的怪物凭空消失。
   *
   * 必须在 grid.build 之后调。邻居表覆盖原来的活跃怪物，本批新增者单独检查，避免不同时间
   * 留下的记录激活到同一位置。正常 update 在推进敌人之前再统一建表。
   */
  private restoreReserved(view: BattleView): void {
    const reserved = this.reserved;
    const enemies = this.enemies;
    const initialCount = enemies.length;

    for (let i = reserved.length - 1; i >= 0; i--) {
      const r = reserved[i];
      if (enemies.length >= this.maxEnemies) break;
      if (!this.inActiveArea(r.x, r.y, view, RESTORE_MARGIN)) continue;
      if (!this.spotFree(r.x, r.y, r.def, initialCount)) continue;

      const e = new Character(r.def, r.palette, r.walkSpeed, r.sideBias);
      e.x = r.x;
      e.y = r.y;
      e.facing = r.facing;
      e.speed = r.speed;
      e.crowdPace = r.crowdPace;
      e.attackCooldown = r.cooldown;
      e.hp = r.hp;
      e.maxHp = r.maxHp;
      e.update(0); // 暂停/缩放时也要有已构建的姿势。
      enemies.push(e);
      reserved[i] = reserved[reserved.length - 1];
      reserved.pop();
      this.restored++;
    }
  }

  /**
   * (x, y) 能不能塞得下 who：地形不挡、玩家不在那儿、也没有别的活人占着。
   *
   * 只给恢复用。出怪那条路不查这个 —— 出怪点在视野外的空地上，撞上了由分离顺手推开就行；
   * 而恢复是往**人堆里**放，放错了就是两个人叠在一起从画面外走出来。
   */
  private spotFree(x: number, y: number, def: UnitDef, initialCount: number): boolean {
    const { field, grid, enemies, player, crowdSpacing } = this;
    // 尺寸只由 def 推出来（见 Character 的 radius / spacing），所以不必先造一个人再来问。
    // 这条路每帧会为每个还没放回去的预留走一次，白造的 Character 会连带 Pose 和 Animator。
    const radius = RigSpec.hipHalfWidth * def.bulk * 1.15;
    const spacing = RigSpec.torsoHalfWidth * def.bulk;
    if (!isFreeSpot(field.terrain, field.props, x, y, radius)) return false;

    const toPlayer = (player.spacing + spacing) * crowdSpacing;
    if ((x - player.x) ** 2 + (y - player.y) ** 2 < toPlayer * toPlayer) return false;

    for (let i = initialCount; i < enemies.length; i++) {
      const other = enemies[i];
      const min = (spacing + other.spacing) * crowdSpacing;
      if ((other.x - x) ** 2 + (other.y - y) ** 2 < min * min) return false;
    }

    // 最坏情况下够得着的距离：对面是场上最胖的那位。按它开查询窗口，格子数才与间距无关。
    const reach = (spacing + MAX_SPACING) * crowdSpacing;
    const span = Math.max(1, Math.ceil(reach / grid.cellSize));
    const cx = grid.colOf(x);
    const cy = grid.rowOf(y);
    const x0 = Math.max(0, cx - span);
    const x1 = Math.min(grid.cols - 1, cx + span);
    const y0 = Math.max(0, cy - span);
    const y1 = Math.min(grid.rows - 1, cy + span);
    const items = grid.indices;

    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const end = grid.end(gx, gy);
        for (let k = grid.begin(gx, gy); k < end; k++) {
          const other = enemies[items[k]];
          if (!other.alive) continue;
          const min = (spacing + other.spacing) * crowdSpacing;
          const dx = other.x - x;
          const dy = other.y - y;
          if (dx * dx + dy * dy < min * min) return false;
        }
      }
    }
    return true;
  }

  /**
   * 沿 (cos, sin) 从玩家走多远才离开视口。
   *
   * 玩家一定在视口里面（镜头夹取保证了这点），所以四条边里至少有一条在正方向上被穿过，
   * 取最近的那次穿越就是出口。
   */
  private exitDistance(cos: number, sin: number, view: BattleView): number {
    const box = view.spawn;
    const px = this.player.x;
    const py = this.player.y;
    let t = Infinity;
    if (cos > 1e-6) t = Math.min(t, (box.x + box.halfW - px) / cos);
    else if (cos < -1e-6) t = Math.min(t, (box.x - box.halfW - px) / cos);
    if (sin > 1e-6) t = Math.min(t, (box.y + box.halfH - py) / sin);
    else if (sin < -1e-6) t = Math.min(t, (box.y - box.halfH - py) / sin);
    // 玩家在框里的话四条边至少有一条在正方向上被穿过，t 必为正。他要是落在框外（不该发生，
    // shipViewport 已经把中心夹过了），负的 t 会让人刷在脚底下，所以兜一个对角线。
    if (!Number.isFinite(t) || t <= 0) return Math.hypot(box.halfW, box.halfH);
    return t;
  }

  /**
   * 真正把一个敌人放到 (x, y) 附近。
   *
   * 只夹到"图外一圈"这个大框里，**不**夹回场内 —— 图外生成是有意的，见 SPAWN_OUTSIDE。
   * 落点和树重叠就沿着原方向往外挪一点重试；图外没有树，所以那边一次就成。
   */
  private place(x: number, y: number, view: BattleView, kinds: readonly EnemyKind[] = EnemyKinds): boolean {
    if (this.localSpawnRoom() <= 0) return false;
    // 总量满时只置换远离玩家、也不在实际镜头里的数据。可见怪物和即将进场者不动。
    if (this.worldEnemyCount >= TARGET_WORLD_ENEMIES && !this.releaseDistantSpawnSlot(view)) return false;
    const field = this.field;
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const e = new Character(kind.def, kind.palette, kind.speed);

    const px = this.player.x;
    const py = this.player.y;
    let dx = x - px;
    let dy = y - py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;

    let fx = x;
    let fy = y;
    for (let attempt = 0; attempt < 6; attempt++) {
      fx = clamp(x + dx * attempt * 6, -SPAWN_OUTSIDE, field.width + SPAWN_OUTSIDE);
      fy = clamp(y + dy * attempt * 6, -SPAWN_OUTSIDE, field.height + SPAWN_OUTSIDE);
      if (isFreeSpot(field.terrain, field.props, fx, fy, e.radius)) break;
    }

    e.x = fx;
    e.y = fy;
    e.facing = Math.atan2(py - fy, px - fx);
    // 随机的初始冷却，免得同一批出生的人到了跟前整齐划一地同时出手。
    const initialGap = e.def.weapon === 'bow' ? ENEMY_ARCHER_SHOT_GAP : ENEMY_SWING_GAP;
    e.attackCooldown = Math.random() * initialGap;
    this.enemies.push(e);
    return true;
  }

  /** 远处占满预算时，附近不足目标数量仍可以按原批次补兵。 */
  private localSpawnRoom(): number {
    return Math.max(0, Math.min(this.maxEnemies - this.enemies.length, Math.max(
      TARGET_WORLD_ENEMIES - WORLD_REFILL_RESERVE - this.worldEnemyCount,
      LOCAL_ENEMY_TARGET - this.enemies.length,
    )));
  }

  private releaseDistantSpawnSlot(view: BattleView): boolean {
    const cell = 112;
    const cols = Math.ceil(this.field.width / cell);
    const rows = Math.ceil(this.field.height / cell);
    if (this.distantRegionCounts.length !== cols * rows) this.distantRegionCounts = new Uint32Array(cols * rows);
    const counts = this.distantRegionCounts;
    counts.fill(0);
    const region = (r: Reservation) =>
      clamp(Math.floor(r.y / cell), 0, rows - 1) * cols + clamp(Math.floor(r.x / cell), 0, cols - 1);
    for (const r of this.reserved) {
      if (!this.inActiveArea(r.x, r.y, view, 1)) counts[region(r)]++;
    }
    let selected = -1;
    let densest = 1;
    let farthest = 0;
    for (let i = 0; i < this.reserved.length; i++) {
      const r = this.reserved[i];
      // 两倍出货框之外才允许调配，避免镜头边缘红点消失或进攻队列突然断层。
      if (this.inActiveArea(r.x, r.y, view, 1)) continue;
      const density = counts[region(r)];
      // 优先从密集区调配，不把最远的边缘区域一只只抽空。
      if (density < densest || density <= 1) continue;
      const distance = (r.x - this.player.x) ** 2 + (r.y - this.player.y) ** 2;
      if (density === densest && distance <= farthest) continue;
      densest = density;
      farthest = distance;
      selected = i;
    }
    if (selected < 0) return false;
    this.reserved[selected] = this.reserved[this.reserved.length - 1];
    this.reserved.pop();
    return true;
  }

  /** 推进一帧。暂停时唯一被停下的就是它。 */
  update(dt: number, input: BattleInput, view: BattleView): void {
    const t0 = performance.now();
    const { player, enemies, field } = this;

    this.clock += dt;
    this.movePlayer(dt, input);
    this.advanceEnemyArrows(dt);
    this.syncEnemyVisibility(view);
    this.worldPopulation.update(dt, () => this.enemyPositions(), TARGET_WORLD_ENEMIES - this.worldEnemyCount,
      (x, y) => this.placeWorldEnemy(x, y, view));
    this.spawnWave(dt, view);
    this.advanceSkillSchedule(dt, view);
    // 先推进当前攻击和完整攻击间隔；本帧一旦归零，就在同一帧开始下一次攻击。
    // 这样 HUD 的 0 与实际再次发动严格重合，不会出现归零后空等一帧。
    this.advancePlayerAttack(dt, view);
    this.swing();
    this.advanceSkills(dt, view);
    // 完整怪物和无骨架数据一起移动，并共享避让与分离。
    this.driveEnemies(dt, view);
    this.separate();
    const mapBlend = DistantMotion.mapBlend(dt);
    for (const enemy of this.reserved) enemy.motion.smoothMap(enemy.x, enemy.y, mapBlend);

    this.effects.update(dt);
    this.debris.update(dt);
    this.collectibles.update(dt, player);
    this.collectedGems += this.collectibles.collected.gem;
    this.collectedCoins += this.collectibles.collected.coin;
    field.update(dt, this.actors());

    // 玩家倒下了就重开：清场、回血、重新铺一批。
    if (!player.alive && player.death > RESPAWN_DELAY) {
      this.player.death = -1;
      this.player.hp = this.player.maxHp;
      this.player.hurt = 0;
      enemies.length = 0;
      // 和 reset 一样：清场就该是真的清场，不能让预留把上一条命的人海放回来。
      this.reserved.length = 0;
      this.resetSkillRuntime();
      this.enemyArrows.length = 0;
      this.collectibles.clear();
      this.collectedGems = 0;
      this.collectedCoins = 0;
      this.seed(view);
    }

    // 清掉已经沉下去的尸体；还在飞的尸体夹回场地内。
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.gone) {
        enemies[i] = enemies[enemies.length - 1];
        enemies.pop();
        continue;
      }
      // 击飞不查地形（Character 不认识 field，也不该认识），但不能飞出地图 —— 场地边缘
      // 之外没有地面，尸体会躺在虚空里。撞树穿模无所谓：那是一堆两秒后就沉下去的尸体，
      // 而地图边界是**看得见**的。
      if (!e.alive) {
        e.x = field.clampX(e.x);
        e.y = field.clampY(e.y);
      }
    }

    this.simMs = smooth(this.simMs, performance.now() - t0);
  }

  // ---------------------------------------------------------------- 玩家

  private movePlayer(dt: number, input: BattleInput): void {
    const { player, field } = this;
    const fromX = player.x;
    const fromY = player.y;

    // 突进期间不听输入：方向在起手那一刻就定死了。
    //
    // 允许中途转向的话，玩家会拿它当一个"更快的走"来用 —— 那就不是一招了，而且判定跟着
    // 身体走，能转向就等于能画出一条任意折线的死亡走廊。冲多远由 dashSpeed × duration
    // 定，一旦发动就是固定的一段。
    if (this.lunge) {
      // 这一帧从哪儿走到哪儿。判定用它连成的线段，见 advanceSkills。
      this.lunge.fromX = player.x;
      this.lunge.fromY = player.y;
      // 方向和速度都在起手那一刻就存进去了：冲到一半换个技能不该改变这一次冲刺。
      const speed = this.lunge.speed;
      player.facing = this.lunge.heading;
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
      this.playerVelocityX = dt > 0 ? (to.x - fromX) / dt : 0;
      this.playerVelocityY = dt > 0 ? (to.y - fromY) / dt : 0;
      return;
    }

    if (input.facing !== null) player.facing = input.facing;

    if (!input.moving) {
      player.speed = 0;
      this.playerVelocityX = 0;
      this.playerVelocityY = 0;
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
    this.playerVelocityX = dt > 0 ? (to.x - fromX) / dt : 0;
    this.playerVelocityY = dt > 0 ? (to.y - fromY) / dt : 0;
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
    this.startPlayerAttack();
  }

  /**
   * 显式装备或卸下一个技能。单选类别会自动替换旧项，多选类别互不影响，主动类占一个空槽。
   * 返回 false 表示装备规则拒绝了这次操作。
   */
  setSkillEnabled(id: SkillId, enabled: boolean): boolean {
    const oldGuard = this.skillLoadout.guardSkill;
    const wasEquipped = this.skillLoadout.isEquipped(id);
    if (!this.skillLoadout.setEquipped(id, enabled)) return false;

    if (oldGuard && oldGuard !== this.skillLoadout.guardSkill) this.clearSkillEffect(oldGuard);
    if (wasEquipped && !this.skillLoadout.isEquipped(id)) this.clearSkillEffect(id);
    return true;
  }

  toggleSkill(id: SkillId): boolean {
    const skill = skillById(id);
    return this.setSkillEnabled(id, skill.category === 'attack' || !this.skillLoadout.isEquipped(id));
  }

  /** J 只在三个自动攻击之间循环，不再把护身、发射或主动技能塞进武器挥击。 */
  cycleAttackSkill(): void {
    this.skillLoadout.cycleAttack();
  }

  /** Q/W/E/R 触发对应主动槽；技能未装备、尚在冷却或玩家正在位移时都不会发动。 */
  triggerActiveSkill(slot: ActiveSkillSlot, view: BattleView): boolean {
    const id = this.skillLoadout.activeSkillSlots[slot];
    if (!id || !this.player.alive || this.dashing || !this.skillLoadout.ready(id)) return false;
    const skill = skillById(id);
    if (skill.category !== 'active') return false;
    this.castSkill(skill, view);
    this.skillLoadout.consume(id);
    return true;
  }

  /** 手动挥一下（空格）。已经在挥或者还在冷却就忽略。 */
  swingNow(): void {
    this.startPlayerAttack();
  }

  skillCooldown(id: SkillId): number {
    if (skillById(id).category === 'attack') {
      return this.skillLoadout.attackSkill === id ? this.player.attackCooldown : 0;
    }
    return this.skillLoadout.cooldownOf(id);
  }

  /** HUD 使用的完整发动间隔；自动攻击还要包含武器动作本身，而不只是技能表里的额外等待。 */
  skillCooldownDuration(id: SkillId): number {
    const skill = skillById(id);
    if (skill.category === 'attack') {
      return attackDuration(this.player.def) + PLAYER_SWING_GAP + skill.cooldown;
    }
    return skill.cooldown;
  }

  private startPlayerAttack(): boolean {
    const skill = skillById(this.skillLoadout.attackSkill);
    if (!this.skillLoadout.ready(skill.id)) return false;
    const started = this.player.swing(attackDuration(this.player.def) + PLAYER_SWING_GAP + skill.cooldown);
    if (!started) return false;
    this.pendingAttackSkill = skill.id;
    this.skillLoadout.consume(skill.id);
    return true;
  }

  /** 所有自动型技能各减各的冷却；同一帧到点也可以同时发动。 */
  private advanceSkillSchedule(dt: number, view: BattleView): void {
    this.skillLoadout.tick(dt);
    if (!this.player.alive) return;
    for (const skill of this.skillLoadout.automaticSkills()) {
      if (!this.skillLoadout.ready(skill.id)) continue;
      this.castSkill(skill, view);
      this.skillLoadout.consume(skill.id);
    }
  }

  /** 菜单卸下技能时同步撤掉它尚未结束的实体；已经飞出去的通用冲击波仍自然播完。 */
  private clearSkillEffect(id: SkillId): void {
    switch (id) {
      case 'aegis':
        this.aegis = null;
        break;
      case 'dharma':
        this.dharma = null;
        break;
      case 'heavenSplit':
        this.heavenSplit = null;
        break;
      case 'skyArrow':
        this.skyArrow = null;
        break;
      case 'lunge':
        this.lunge = null;
        break;
    }
  }

  /**
   * 推进玩家的动画，并在落点那一帧结算判定、放出冲击弧。
   *
   * 判定和特效在同一个时刻发生，但两者互不依赖：弧是画给人看的，中不中由扇形判定说了算。
   *
   * player.update 的返回值就是"这一帧跨过落点了没有"，是一次**跨越**检测而不是阈值比较，
   * 所以它必须每帧正好调一次 —— 漏一帧那一下就白挥了，多调一帧就会连着结算两次。
   */
  private advancePlayerAttack(dt: number, view: BattleView): void {
    const { player } = this;
    if (!player.update(dt)) return;
    this.castSkill(skillById(this.pendingAttackSkill), view);
  }

  /**
   * 杀掉一个敌人：击飞、溅碎片、记账。
   *
   * 所有杀伤都从这里走，免得四个技能各写一遍"kill 完别忘了加 kills"。
   *
   * @param fromX/fromY 打击来自哪儿，决定往哪边飞。
   * @param power       1 = 平砍（只溅血），2 = 技能（血 + 甲片）。这是平砍和技能在画面上
   *                    唯一的区别 —— 两者都是碰到就死，但技能得看着更狠。
   */
  private slay(
    e: Character,
    fromX: number,
    fromY: number,
    power: number,
    launch: { force?: number; freeze?: number } = {},
  ): void {
    e.kill(fromX, fromY, launch);
    this.kills++;
    // 掉落二选一：绝大多数是灵石，偶尔出一枚金币。概率低是故意的 —— 金币要当成
    // 一局里能记住的小惊喜，掉多了就和灵石一样变成背景噪音。
    if (Math.random() < COIN_DROP_CHANCE) this.collectibles.dropCoin(e.x, e.y);
    else this.collectibles.dropGem(e.x, e.y);

    let dx = e.x - fromX;
    let dy = e.y - fromY;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) {
      dx = Math.cos(e.facing);
      dy = Math.sin(e.facing);
    } else {
      dx /= len;
      dy /= len;
    }
    this.debris.burst(e.x, e.y, dx, dy, power, e.palette);
  }

  /**
   * 放一招。
   *
   * kind 对应 skills.ts 里的结算路径：instant 当场算清，其余持续或飞行技能把状态放出去，
   * 真正的杀伤在 advanceSkills 里逐帧结算。
   *
   * 谁被打中都是**碰到就死**，和基础攻击完全一样 —— 技能之间的区别只有形状，没有强度。
   */
  private castSkill(skill: SkillDef, view: BattleView): void {
    const { player } = this;
    const at = weaponImpactPoint(player.pose, player.def, player.x, player.y, player.facing);
    const reach = player.def.attackRange * skill.reach;

    switch (skill.kind) {
      case 'passive':
        return;

      case 'instant': {
        const arc = skill.arc ?? player.def.attackArc;
        // 整圈那一招的圆心是**人**，不是武器落点：转一圈扫开身周，落点在身前一侧没有意义。
        const full = arc >= Math.PI * 1.99;
        if (full) {
          // 回旋：一圈从脚下推开的环，见 castRing（突进的收招用的是同一份）。
          this.castRing(reach, skill.power, player.x, player.y, {
            velocityX: this.playerVelocityX,
            velocityY: this.playerVelocityY,
          });
          return;
        }
        {
          // 横扫是外三、内二的两层扇面。五片各自够宽、够粗，但不附带通用余波，避免自动挥击
          // 每隔零点几秒就在画面里叠出十几道弧。外层画到判定边缘，画面与实际杀伤保持一致。
          const fanOrigin = player.def.attackRange * 0.12;
          const fan: { side: number; distance: number; weight: number; tint: ReturnType<typeof rgb> }[] = [
            // 外层三片：完整横扫距离，负责把整个攻击扇区撑开。
            { side: -0.36, distance: 1, weight: 2.05, tint: rgb(255, 178, 58) },
            { side: 0, distance: 1, weight: 2.35, tint: rgb(255, 226, 142) },
            { side: 0.36, distance: 1, weight: 2.05, tint: rgb(255, 178, 58) },
            // 内层两片：停在七成距离，和外层错开，形成清楚的第二排扇面。
            { side: -0.17, distance: 0.68, weight: 1.8, tint: rgb(255, 210, 104) },
            { side: 0.17, distance: 0.68, weight: 1.8, tint: rgb(255, 210, 104) },
          ];
          for (const blade of fan) {
            const heading = player.facing + blade.side * arc;
            const originX = player.x + Math.cos(heading) * fanOrigin;
            const originY = player.y + Math.sin(heading) * fanOrigin;
            this.effects.spawn(originX, originY, heading, {
              power: player.def.bulk,
              // 接近破空单片波的 0.9 弧度，不再是上一版看不清的 0.32 小弧。
              span: 0.78,
              from: 1.1,
              to: (reach * blade.distance - fanOrigin) / player.def.bulk,
              weight: blade.weight,
              life: 0.42,
              overhead: true,
              style: 'slash',
              flash: 0.2,
              sparks: 0.32,
              trail: 0,
              tint: blade.tint,
              velocityX: this.playerVelocityX,
              velocityY: this.playerVelocityY,
            });
          }
        }
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (inSector(player, e, reach, arc)) this.slay(e, player.x, player.y, skill.power);
        }
        return;
      }

      case 'wave': {
        const arc = skill.arc ?? player.def.attackArc;
        const wave: SkillWave = {
          x: at.x,
          y: at.y,
          vx: this.playerVelocityX,
          vy: this.playerVelocityY,
          heading: player.facing,
          age: 0,
          life: skill.duration,
          from: 2,
          // 打不出画面。见 cappedReach —— 屏幕外一片人无声消失不是爽快，是茫然。
          to: cappedReach(at.x, at.y, player.facing, arc, reach, player.def.attackRange, view.spawn),
          arc,
          power: skill.power,
        };
        this.skillWaves.push(wave);
        // 特效和判定共用同一条推进曲线和同一组端点，所以画面上波扫到谁，谁就正好死。
        this.effects.spawn(wave.x, wave.y, wave.heading, {
          power: 1,
          span: wave.arc,
          from: wave.from,
          // 判定比画面宽一圈，见 SKILL_HIT_MARGIN。近处那条走廊没有对应的画面 —— 它就在
          // 玩家脚底下，那儿本来就是"我这一下打出去了"的位置，不需要再画一遍给他看。
          to: wave.to / SKILL_HIT_MARGIN,
          life: wave.life,
          weight: 2.4,
          overhead: true,
          style: 'surge',
          velocityX: wave.vx,
          velocityY: wave.vy,
          // 偏冷的白。破空是唯一一个离开施放者独立飞出去的东西，给它一个和别的招不同的
          // 色温，玩家余光里就能分出"这是我放出去的那道波"还是"我脚下扫了一圈"。
          tint: rgb(214, 236, 255),
        });
        return;
      }

      case 'aura': {
        this.aegis = { left: skill.duration, total: skill.duration, radius: reach, power: skill.power };
        // 撑开那一下：一圈从脚下推开的环，比回旋快、比回旋细 —— 它说的是"罩子立起来了"，
        // 不是"我扫了一圈"。罩子本身由 Scene 每帧跟着人画（见 aegis）。
        this.effects.spawn(player.x, player.y, player.facing, {
          power: 1,
          span: Math.PI * 2,
          from: 1,
          to: reach / SKILL_HIT_MARGIN,
          life: 0.3,
          weight: 1.8 * player.def.bulk,
          overhead: true,
          tint: rgb(255, 226, 140),
        });
        return;
      }

      case 'dharma': {
        this.dharma = { left: skill.duration, total: skill.duration, radius: reach, power: skill.power };
        this.effects.spawn(player.x, player.y, player.facing, {
          power: 1,
          span: Math.PI * 2,
          from: 1,
          to: reach / SKILL_HIT_MARGIN,
          life: 0.3,
          weight: 1.8 * player.def.bulk,
          overhead: true,
          tint: rgb(255, 196, 72),
        });
        return;
      }

      case 'heavenSplit': {
        // 玩家只有“朝准星向前走”这一种移动方式，所以 cast 这一帧的 facing 就是行走朝向。
        // 起手后把它锁进状态，飞剑不会再跟着鼠标拐弯。
        const heading = player.facing;
        const clearance = SKY_BLADE_WIDTH * 1.4;
        const outOfView = exitDistance(player.x, player.y, heading, {
          x: view.spawn.x,
          y: view.spawn.y,
          halfW: view.spawn.halfW + clearance,
          halfH: view.spawn.halfH + clearance,
        });
        // reach 继续定义原来的飞行速度；实际距离至少走完 reach，并延长到剑柄也越过扩张后的
        // 视口边界。这样增大窗口、切换体型或站到屏幕偏侧时，都恰好是整把剑飞出画面后消失。
        const speed = reach / skill.duration;
        const duration = Math.max(reach, outOfView) / speed;
        this.heavenSplit = {
          age: 0,
          left: duration,
          total: duration,
          x: player.x,
          y: player.y,
          heading,
          speed,
          power: skill.power,
        };
        return;
      }

      case 'skyArrow': {
        // 落点不是起手时锁死：等待期间镜头跟着玩家移动，0.8 秒一到才在“此刻”的视口里抽取位置。
        this.skyArrow = { age: 0, targetX: 0, targetY: 0, radius: reach, power: skill.power };
        this.effects.spawn(at.x, at.y, player.facing, {
          power: 0.8,
          span: 0.48,
          from: 1,
          to: player.def.attackRange * 1.5,
          life: 0.18,
          weight: 1.2,
          overhead: true,
          style: 'slash',
          tint: rgb(255, 222, 140),
        });
        return;
      }

      case 'lunge':
        this.lunge = {
          left: skill.duration,
          heading: player.facing,
          speed: reach / LUNGE_TIME_SCALE,
          power: skill.power,
          finishRing: player.def.attackRange * skill.finishRing,
          fromX: player.x,
          fromY: player.y,
        };
        // 突进：一道窄而急的前推弧，跟着人一起冲出去。
        this.effects.spawn(at.x, at.y, player.facing, {
          power: 1,
          span: 1.1,
          from: 2,
          to: reach * 0.62,
          life: 0.42,
          weight: 2.2 * player.def.bulk,
          overhead: true,
          style: 'surge',
          tint: rgb(255, 232, 190),
        });
        return;
    }
  }

  /**
   * 原地炸一圈：以玩家为心的整圈判定，外加一道推开的环。
   *
   * 回旋是它、突进的收招也是它。抽出来不是为了省几行，是为了让"同一个形状"在画面和判定上
   * 真的是同一份代码 —— 两处各写一遍的话，改了一处忘了另一处，玩家就会看到两个长得像但
   * 判定不一样的圈。
   */
  private castRing(
    reach: number,
    power: number,
    x = this.player.x,
    y = this.player.y,
    options: Pick<ShockwaveOptions, 'style' | 'tint' | 'velocityX' | 'velocityY'> = {},
  ): void {
    const { player } = this;
    this.effects.spawn(x, y, player.facing, {
      power: 1,
      span: Math.PI * 2,
      from: 1.5,
      to: reach / SKILL_HIT_MARGIN,
      life: 0.5,
      weight: 2.1 * player.def.bulk,
      overhead: true,
      style: options.style ?? 'ring',
      tint: options.tint ?? rgb(255, 214, 124),
      velocityX: options.velocityX,
      velocityY: options.velocityY,
    });
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= (reach + e.radius) * (reach + e.radius)) this.slay(e, x, y, power);
    }
  }

  /**
   * 推进所有跨帧技能，并结算它们这一帧碰到的人。
   *
   * 这些技能是**故意**偏离"发招那一刻一次算清"那条规矩的（combat.ts 顶上那段）。理由很直接：
   * 一道要飞两百个单位的波，如果在起手那一帧就把远处的人杀了，玩家会看到人先倒、波后到 ——
   * 画面在撒谎。而"碰到就死"本来就是这个游戏唯一的伤害规则，让它按时间发生正是这条规则的
   * 字面意思。基础攻击和 instant 类技能仍然走老路：它们的范围只有十几个单位，一帧之内到达，
   * 分不分帧看不出来。
   */
  private advanceSkills(dt: number, view: BattleView): void {
    const { player } = this;

    for (let i = this.skillWaves.length - 1; i >= 0; i--) {
      const w = this.skillWaves[i];
      w.age += dt;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      const radius = frontRadius(Math.min(w.age / w.life, 1), w.from, w.to);
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (sweptBy(e, w.x, w.y, w.heading, radius, w.arc, WAVE_NEAR_HALF_WIDTH)) {
          this.slay(e, w.x, w.y, w.power);
        }
      }
      if (w.age >= w.life) {
        this.skillWaves[i] = this.skillWaves[this.skillWaves.length - 1];
        this.skillWaves.pop();
      }
    }

    if (this.skyArrow) {
      const arrow = this.skyArrow;
      const before = arrow.age;
      arrow.age += dt;
      if (before < 0.8 && arrow.age >= 0.8) {
        // 稍留边距，避免箭头与回旋环被屏幕边缘截断。
        const box = view.spawn;
        arrow.targetX = box.x + (Math.random() * 2 - 1) * box.halfW * 0.78;
        arrow.targetY = box.y + (Math.random() * 2 - 1) * box.halfH * 0.72;
      }
      // 0.8 秒呼应用户要求；后续 0.28 秒是可见的俯冲与落地窗口。
      if (arrow.age >= 1.08) {
        this.castRing(arrow.radius, arrow.power, arrow.targetX, arrow.targetY, {
          style: 'burst',
          tint: rgb(255, 188, 62),
        });
        this.skyArrow = null;
      }
    }

    if (this.aegis) {
      this.aegis.left -= dt;
      // 碰到罩子就飞。原点是玩家自己 —— 罩子是以他为心的，人本来就该被朝外推开。
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (inSector(player, e, this.aegis.radius, Math.PI * 2)) {
          this.slay(e, player.x, player.y, this.aegis.power);
        }
      }
      if (this.aegis.left <= 0) this.aegis = null;
    }

    if (this.dharma) {
      this.dharma.left -= dt;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (inSector(player, e, this.dharma.radius, Math.PI * 2)) {
          this.slay(e, player.x, player.y, this.dharma.power);
        }
      }
      if (this.dharma.left <= 0) this.dharma = null;
    }

    if (this.heavenSplit) {
      const blade = this.heavenSplit;
      const fromX = blade.x;
      const fromY = blade.y;
      const dirX = Math.cos(blade.heading);
      const dirY = Math.sin(blade.heading);
      blade.age += dt;
      blade.left -= dt;
      blade.x += dirX * blade.speed * dt;
      blade.y += dirY * blade.speed * dt;

      // 上一帧的柄到这一帧的剑尖是一条连续线段，包含整截剑身和这一帧扫过的距离。判定半径
      // 与画出来的刃宽一致；命中后的横向击飞与定格则直接走突进的同一个函数。
      this.slayAlongLunge(
        fromX,
        fromY,
        blade.x + dirX * SKY_BLADE_LENGTH,
        blade.y + dirY * SKY_BLADE_LENGTH,
        blade.heading,
        SKY_BLADE_WIDTH * 0.5,
        blade.power,
      );
      if (blade.left <= 0) this.heavenSplit = null;
    }

    if (this.lunge) {
      this.lunge.left -= dt;
      // 撞到谁谁死，判定就是人自己的身体加一点余量 —— 冲过去的是这个人，不是一个扇形。
      //
      // 但判定的是**这一帧走过的那条线段**，不是落点那一个圈。冲刺速度接近 500 单位/秒，
      // 60 帧下一步就跨 8 个单位，而 main.ts 把 dt 夹在 1/20 —— 掉帧时一步跨 25 个单位，
      // 比判定圈的直径还大，中间的人整个被跳过去。实测 20 帧下一条 18 人的队列漏掉 7 个，
      // 而且漏的位置是散的（第 0、1、5、8、9 个），玩家读作"从人身上穿过去了"。
      const ax = this.lunge.fromX;
      const ay = this.lunge.fromY;
      this.slayAlongLunge(
        ax,
        ay,
        player.x,
        player.y,
        this.lunge.heading,
        player.radius + LUNGE_BODY_MARGIN,
        this.lunge.power,
      );
      if (this.lunge.left <= 0) {
        // 冲到头再炸一圈：把走廊两侧漏掉的人一起带走。冲锋该以"撞进人堆里停下"收尾，
        // 而不是穿过去就没事了。
        if (this.lunge.finishRing > 0) {
          this.castRing(this.lunge.finishRing, this.lunge.power, player.x, player.y, {
            style: 'burst',
            tint: rgb(255, 142, 74),
          });
        }
        this.lunge = null;
      }
    }
  }

  /**
   * 按突进规则扫过一条线段：连续碰撞、向路径两侧击飞，并使用突进的力度和短定格。
   * 玩家突进与开天的剑体共用这一份，保证“按照突进技能处理”不是近似相同而是同一条代码路径。
   */
  private slayAlongLunge(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    heading: number,
    hit: number,
    power: number,
  ): void {
    const segX = bx - ax;
    const segY = by - ay;
    const segLen2 = segX * segX + segY * segY;
    const dirX = Math.cos(heading);
    const dirY = Math.sin(heading);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      let t = segLen2 > 1e-9 ? ((e.x - ax) * segX + (e.y - ay) * segY) / segLen2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = e.x - (ax + segX * t);
      const dy = e.y - (ay + segY * t);
      const reach = hit + e.radius;
      if (dx * dx + dy * dy > reach * reach) continue;

      const side = -dx * dirY + dy * dirX;
      const sign = Math.abs(side) > 0.05 ? Math.sign(side) : e.sideBias;
      let kx = -dirY * sign + dirX * LUNGE_SIDE_FORWARD;
      let ky = dirX * sign + dirY * LUNGE_SIDE_FORWARD;
      const kl = Math.hypot(kx, ky) || 1;
      kx /= kl;
      ky /= kl;
      this.slay(e, e.x - kx * 10, e.y - ky * 10, power, {
        force: LUNGE_FORCE,
        freeze: LUNGE_FREEZE,
      });
    }
  }

  // ---------------------------------------------------------------- 敌人

  /** 在弓弦撒放的那一帧，记录玩家此刻的位置并生成一支不追踪的箭。 */
  private fireEnemyArrow(archer: Character): void {
    const local = archer.pose.weaponGrip;
    const sin = Math.sin(archer.facing);
    const cos = Math.cos(archer.facing);
    const fromX = archer.x + local.x * sin + local.y * cos;
    const fromY = archer.y - local.x * cos + local.y * sin;
    const targetX = this.player.x;
    const targetY = this.player.y;
    const distance = Math.hypot(targetX - fromX, targetY - fromY);
    const total = clamp(distance / ENEMY_ARROW_SPEED, ENEMY_ARROW_MIN_TIME, ENEMY_ARROW_MAX_TIME);
    const startZ = Math.max(6, local.z);

    this.enemyArrows.push({
      fromX,
      fromY,
      targetX,
      targetY,
      x: fromX,
      y: fromY,
      z: startZ,
      previousX: fromX,
      previousY: fromY,
      previousZ: startZ,
      startZ,
      arcHeight: clamp(distance * 0.24, 14, 24),
      age: 0,
      total,
      landed: false,
      groundLeft: 0,
      opacity: 1,
    });
  }

  /** 推进固定弹道；命中玩家便消失，落空则保持入射角插在旧落点，数秒后渐隐。 */
  private advanceEnemyArrows(dt: number): void {
    const arrows = this.enemyArrows;
    const player = this.player;
    for (let i = arrows.length - 1; i >= 0; i--) {
      const arrow = arrows[i];
      if (arrow.landed) {
        arrow.groundLeft -= dt;
        arrow.opacity = clamp(arrow.groundLeft / ENEMY_ARROW_FADE_TIME, 0, 1);
        if (arrow.groundLeft > 0) continue;
        arrows[i] = arrows[arrows.length - 1];
        arrows.pop();
        continue;
      }

      arrow.previousX = arrow.x;
      arrow.previousY = arrow.y;
      arrow.previousZ = arrow.z;
      arrow.age += dt;
      const t = clamp(arrow.age / arrow.total, 0, 1);
      const position = enemyArrowPosition(arrow);
      arrow.x = position.x;
      arrow.y = position.y;
      arrow.z = position.z;

      if (t < 1) continue;

      const dx = player.x - arrow.targetX;
      const dy = player.y - arrow.targetY;
      const hit = player.radius + ENEMY_ARROW_HIT_MARGIN;
      if (player.alive && dx * dx + dy * dy <= hit * hit) {
        if (player.takeHit(arrow.fromX, arrow.fromY)) this.deaths++;
        arrows[i] = arrows[arrows.length - 1];
        arrows.pop();
        continue;
      }

      arrow.age = arrow.total;
      arrow.landed = true;
      arrow.groundLeft = ENEMY_ARROW_GROUND_TIME;
      arrow.opacity = 1;
    }
  }

  private driveEnemies(dt: number, view: BattleView): void {
    const { player, field } = this;
    this.crowdDecisionFrame = (this.crowdDecisionFrame + 1) % CROWD_DECISION_GROUPS;

    const enemies = this.movers;
    enemies.length = 0;
    for (const enemy of this.enemies) enemies.push(enemy);
    for (const enemy of this.reserved) enemies.push(enemy);
    this.movementGrid.setMinCellSize(cellSizeFor(this.crowdSpacing));
    this.movementGrid.build(enemies);
    const activeCount = this.enemies.length;
    if (this.movementDue.length < enemies.length) this.movementDue = new Uint8Array(enemies.length);
    this.movementDue.fill(0, 0, enemies.length);
    const box = view.visible ?? view.spawn;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const data = i >= activeCount ? this.reserved[i - activeCount] : null;
      const near = data === null || this.inActiveArea(e.x, e.y, view, RESTORE_MARGIN);
      if (data) data.cooldown = Math.max(0, data.cooldown - dt);
      const moveDt = data ? data.motion.step(this.clock, dt, near) : dt;
      if (data && moveDt <= 0) continue;
      this.movementDue[i] = near ? 1 : 2;
      // 是否计算骨架只看真实镜头，移动规则对所有怪物一致。
      const onScreen =
        Math.abs(e.x - box.x) <= box.halfW + SCREEN_SLACK &&
        Math.abs(e.y - box.y) <= box.halfH + SCREEN_SLACK;
      if (e.alive) {
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const dist = Math.hypot(dx, dy);
        e.facing = Math.atan2(dy, dx);

        // 停在攻击距离的八成处，而不是正好在边缘上：卡在边缘的话玩家稍一后退就出圈，一群人
        // 会在"走两步"和"挥一下"之间反复横跳。
        //
        // 但不能比"两个人的身体贴在一起"还近 —— 那个距离他**到不了**，会被 clearPlayerBody
        // 每帧推回来，于是他永远以为自己还在赶路，一直播着走路动画原地踏步。取两者的大者，
        // 他就停在真正站得住的地方，然后老老实实出手。
        const stop = Math.max(
          e.def.attackRange * 0.8,
          (player.spacing + e.spacing) * this.crowdSpacing,
        );
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
          const want = e.walkSpeed * (1 + (CHASE_BOOST - 1) * chase);

          // 找空位：正前方被占了就沿切线绕过去。room 是"还能直着走多少"，0 表示完全被堵。
          //
          // 包括远处无骨架的数据；共用邻居表才能在进入视口前就排好队、绕开前方的人。
          // 近处按三组轮流查询邻居；远处本来已是 10 Hz，轮到移动时直接决策。
          let room: number;
          let side: number;
          if (near) {
            const decision = this.crowdDecision(i, dx / dist, dy / dist, dist, stop);
            room = decision.room;
            side = decision.side;
          } else {
            room = this.slotAhead(i, dx / dist, dy / dist, dist);
            side = this.slotSide;
          }

          // 越是被堵住越慢，而且越靠后越慢。直行那一份按 room 走全速；绕行那一份先打个折，
          // 再按离玩家多远衰减 —— 见 SIDESTEP_SPEED 上那段。
          const shuffle = SIDESTEP_SPEED * clamp(SIDESTEP_NEAR / dist, 0, 1);
          // 快到站位时再乘一段减速，把"走"和"站定"之间那个硬开关抹平 —— 见 APPROACH_BAND。
          const approach = clamp((dist - stop) / APPROACH_BAND, 0, 1);
          // 目标速度不直接用，先滑过去 —— 见 PACE_TAU。
          const wantPace = (room + (1 - room) * shuffle) * approach;
          e.crowdPace += (wantPace - e.crowdPace) * (1 - Math.exp(-moveDt / PACE_TAU));
          const pace = e.crowdPace;

          let mx = (dx / dist) * room + (-dy / dist) * side * SIDESTEP * (1 - room);
          let my = (dy / dist) * room + (dx / dist) * side * SIDESTEP * (1 - room);
          const mlen = Math.hypot(mx, my);
          if (mlen > 1e-6) {
            mx /= mlen;
            my /= mlen;
          } else {
            mx = 0;
            my = 0;
          }
          // 没有寻路：撞上障碍就被推开，沿着它蹭过去。绕不过去的死角会卡住，但这张图上没有
          // 能围死人的东西 —— 真需要寻路的时候再说。
          // 远处较大的时间步拆成短碰撞步，避免高速越过树干；昂贵的邻居决策仍只做一次。
          const collisionSteps = Math.max(1, Math.ceil(moveDt / (1 / 30)));
          const stepX = mx * want * pace * moveDt / collisionSteps;
          const stepY = my * want * pace * moveDt / collisionSteps;
          let to = { x: e.x, y: e.y };
          for (let step = 0; step < collisionSteps; step++) {
            to = moveWithCollision(field.terrain, field.props, e.radius, to.x, to.y, to.x + stepX, to.y + stepY);
          }
          // 交给动画器的是**实际走了多远**，不是想走多快。
          //
          // 这两者在人堆里差得很远：挤在最里圈的人每帧只能蹭出零点几个单位，而按意图报速度
          // 的话他会以全速播走路循环 —— 一排原地大步流星的人，看着比穿模还假。蹭着树走的
          // 那种半速也是同一回事。动画器本来就是按 speed 混合步态的，喂给它真值即可。
          const moved = Math.hypot(to.x - e.x, to.y - e.y);
          e.speed = moveDt > 0 ? moved / moveDt : 0;
          e.x = to.x;
          e.y = to.y;
        } else {
          // 到位了：站定出手。crowdPace 也归零，免得下次起步带着旧值窜一下。
          e.crowdPace = 0;
          e.speed = 0;
          const decision = this.crowdDecisions.get(e);
          if (decision) decision.stale = true; // 重新起步时不能沿用站定前的邻居。
          if (i < activeCount) {
            const cooldown =
              e.def.weapon === 'bow'
                ? ENEMY_ARCHER_SHOT_GAP + Math.random() * ENEMY_ARCHER_SHOT_JITTER
                : ENEMY_SWING_GAP + Math.random() * ENEMY_SWING_JITTER;
            this.enemies[i].swing(cooldown);
          }
        }
      }

      if (i < activeCount) {
        const actor = this.enemies[i];
        if (actor.update(dt, onScreen) && player.alive) {
          if (actor.def.weapon === 'bow') this.fireEnemyArrow(actor);
          else if (inAttackArc(actor, player) && player.takeHit(actor.x, actor.y)) this.deaths++;
        }
      }
    }
  }

  /** slotAhead 顺带算出来的绕行方向：+1 往左，-1 往右。 */
  private slotSide = 1;

  private crowdDecision(i: number, dirX: number, dirY: number, dist: number, stop: number): CrowdDecision {
    const e = this.movers[i];
    let decision = this.crowdDecisions.get(e);
    if (!decision) {
      decision = {
        group: this.crowdDecisionGroup++ % CROWD_DECISION_GROUPS,
        stale: true, dirX, dirY, crowdSpacing: this.crowdSpacing, room: 1, side: e.sideBias,
      };
      this.crowdDecisions.set(e, decision);
    }
    // 近身保持逐帧响应；追击方向急转或间距设置变化也立即重算。
    if (decision.stale ||
        decision.group === this.crowdDecisionFrame ||
        dist <= stop + APPROACH_BAND ||
        dirX * decision.dirX + dirY * decision.dirY < 0.94 ||
        decision.crowdSpacing !== this.crowdSpacing) {
      decision.room = this.slotAhead(i, dirX, dirY, dist);
      decision.side = this.slotSide;
      decision.stale = false;
      decision.dirX = dirX;
      decision.dirY = dirY;
      decision.crowdSpacing = this.crowdSpacing;
    }
    return decision;
  }

  /**
   * 第 i 个敌人朝 (dirX, dirY) 还能直着走多少，0..1；顺带把该往哪边绕写进 slotSide。
   *
   * 只给**比我更靠近玩家**的人让路。所有人都朝同一个点收拢，路径必然两两交叉，没有优先权
   * 的话"别撞上别人"会退化成"谁都别动"；按到玩家的距离排先后天然无环 —— 最里圈那个永远
   * 不让人，外面的依次绕着它找缝。
   *
   * 判的是一条**走廊**而不是扇形：那个人在不在我前面（沿朝向的投影为正且不远），以及他离
   * 我的行进直线偏多少（横向小于两人该有的间距才算挡路）。扇形会把并排的邻居也算进来，
   * 围成一圈之后前排互相刹车，谁都够不到玩家。
   */
  private slotAhead(i: number, dirX: number, dirY: number, distToPlayer: number): number {
    const { movementGrid: grid, movers: enemies, crowdSpacing, player } = this;
    const self = enemies[i];
    const items = grid.indices;
    const maxLook = (self.spacing + MAX_SPACING) * crowdSpacing * SLOT_LOOKAHEAD;
    const span = Math.max(1, Math.ceil(maxLook / grid.cellSize));
    const cx = grid.colOf(self.x);
    const cy = grid.rowOf(self.y);
    const x0 = Math.max(0, cx - span);
    const x1 = Math.min(grid.cols - 1, cx + span);
    const y0 = Math.max(0, cy - span);
    const y1 = Math.min(grid.rows - 1, cy + span);

    let room = 1;
    let side = 1;
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const end = grid.end(gx, gy);
        for (let k = grid.begin(gx, gy); k < end; k++) {
          const j = items[k];
          if (j === i) continue;
          const other = enemies[j];
          if (!other.alive) continue;
          const ox = other.x - player.x;
          const oy = other.y - player.y;
          if (ox * ox + oy * oy >= distToPlayer * distToPlayer) continue;

          const dx = other.x - self.x;
          const dy = other.y - self.y;
          const along = dx * dirX + dy * dirY;
          if (along <= 0) continue;
          const touch = (self.spacing + other.spacing) * crowdSpacing;
          const look = touch * SLOT_LOOKAHEAD;
          if (along >= look) continue;
          const lateral = dx * -dirY + dy * dirX;
          if (Math.abs(lateral) >= touch) continue;

          const k2 = clamp((along - touch) / (look - touch), 0, 1);
          if (k2 < room) {
            room = k2;
            // 往远离他的那一侧绕。他基本正对着我时横向偏移在零附近抖，这时候按符号选边会
            // 每帧翻一次，人在原地左右抽搐 —— 所以改用这个人固定的习惯侧，见 sideBias。
            side =
              Math.abs(lateral) > touch * 0.25 ? (lateral > 0 ? -1 : 1) : self.sideBias;
          }
        }
      }
    }
    this.slotSide = side;
    return room;
  }

  /**
   * 互相推开。不是寻路，只是不让一群人叠在同一个像素上 —— 少了这一步，一百个杂兵会精确地
   * 重合成一个人，人群完全读不出数量。用全图移动网格查邻居，完整怪物和数据怪物共享此规则。
   */
  private separate(): void {
    const enemies = this.movers;
    const grid = this.movementGrid;
    grid.build(enemies);
    // 必须在 build **之后**取：人数涨过上次容量时 build 会重开这个数组，先取就拿到旧的那根了。
    const items = grid.indices;

    for (let pass = 0; pass < this.separationPasses; pass++) {
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      const due = this.movementDue[i];
      if (!a.alive || due === 0 || (due === 2 && pass > 0)) continue;
      const cx = grid.colOf(a.x);
      const cy = grid.rowOf(a.y);
      const x0 = cx > 0 ? cx - 1 : 0;
      const x1 = cx < grid.cols - 1 ? cx + 1 : grid.cols - 1;
      const y0 = cy > 0 ? cy - 1 : 0;
      const y1 = cy < grid.rows - 1 ? cy + 1 : grid.rows - 1;

      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const end = grid.end(gx, gy);
          for (let k = grid.begin(gx, gy); k < end; k++) {
            // 两者本轮都更新时只处理 j > i；另一只没轮到，也要允许当前这只与它分离。
            //
            // 试过按"到玩家的距离从近到远"排序再扫，指望修正一趟就从里圈推到外圈。实测在
            // 一千人时间距只从 9.2 变成 9.3（噪声），却多花 0.4 毫秒排序 —— 因为瓶颈根本不
            // 是修正传得快不快，是那么多人**真的没地方站**（见 separationPasses 上那段）。
            const j = items[k];
            const otherDue = this.movementDue[j] === 1 || (pass === 0 && this.movementDue[j] === 2);
            if (j === i || (j < i && otherDue)) continue;
            const b = enemies[j];
            if (!b.alive) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const min = (a.spacing + b.spacing) * this.crowdSpacing;
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
    }
    }

    this.clearPlayerBody();
  }

  /**
   * 把压在玩家身上的人推出去。
   *
   * 玩家**不动**：他有体积，但质量当成无穷大。互推的话，一圈人能把玩家从人堆里挤出去 ——
   * 割草游戏里那是最难受的一种失控，明明没按任何键，人却在漂。所以推的是敌人那一边。
   *
   * 只查玩家所在的 3x3 格，所以这一步和场上有多少人无关。
   */
  private clearPlayerBody(): void {
    const { player, movementGrid: grid } = this;
    const items = grid.indices;
    const enemies = this.movers;
    const cx = grid.colOf(player.x);
    const cy = grid.rowOf(player.y);
    const x0 = cx > 0 ? cx - 1 : 0;
    const x1 = cx < grid.cols - 1 ? cx + 1 : grid.cols - 1;
    const y0 = cy > 0 ? cy - 1 : 0;
    const y1 = cy < grid.rows - 1 ? cy + 1 : grid.rows - 1;

    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const end = grid.end(gx, gy);
        for (let k = grid.begin(gx, gy); k < end; k++) {
          const e = enemies[items[k]];
          if (!e.alive) continue;
          const dx = e.x - player.x;
          const dy = e.y - player.y;
          const min = (player.spacing + e.spacing) * this.crowdSpacing;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          if (d2 < 1e-6) {
            // 正好压在中心：没有方向可推，随便挑一个，下一帧就正常了。
            e.x = player.x + min;
            continue;
          }
          const d = Math.sqrt(d2);
          const push = (min - d) / d;
          e.x += dx * push;
          e.y += dy * push;
        }
      }
    }
  }

  // ---------------------------------------------------------------- 出怪

  private spawnWave(dt: number, view: BattleView): void {
    this.spawnTimer += dt;
    while (this.spawnTimer >= SPAWN_INTERVAL) {
      this.spawnTimer -= SPAWN_INTERVAL;
      // 一次放一批。批量调大了就是一小群一小群涌上来，不再是一个一个挪进画面。
      const room = this.localSpawnRoom();
      // 一个批次不跨兵种波：即使菜单把批量调成 7，也不会在最后一批里混入下一种兵。
      const batch = Math.min(this.spawnBatch, room, this.enemiesLeftInWave);
      const kinds = EnemyTypeWaves[this.enemyWaveIndex];
      for (let i = 0; i < batch; i++) {
        if (!this.spawn(view, kinds)) break;
        this.enemiesLeftInWave--;
      }
      if (this.enemiesLeftInWave <= 0) this.advanceEnemyWave();
    }
  }

  /** 当前兵种的一整波出完后，切到下一种并重新计数。 */
  private advanceEnemyWave(): void {
    this.enemyWaveIndex = (this.enemyWaveIndex + 1) % EnemyTypeWaves.length;
    this.enemiesLeftInWave = ENEMIES_PER_TYPE_WAVE;
  }
}
