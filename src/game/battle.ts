import { attackDuration } from '../characters/animator';
import { RigSpec } from '../characters/rig';
import { PALETTE_HERO, PALETTE_PEASANT, PALETTE_RED, type CharacterPalette } from '../characters/palette';
import { type UnitDef, UnitPresets } from '../characters/unitDef';
import { clamp } from '../core/math';
import { Debris } from '../effects/debris';
import { ImpactEffects, frontRadius, weaponImpactPoint } from '../effects/impact';
import { Character } from './character';
import { isFreeSpot, moveWithCollision } from './collision';
import { inAttackArc, inSector, sweptBy } from './combat';
import type { Field } from './field';
import { rgb } from '../render/color';
import { SpatialGrid } from './grid';
import {
  SKILL_HIT_MARGIN,
  Skills,
  WAVE_NEAR_HALF_WIDTH,
  cappedReach,
  skillAt,
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
 * 开局默认用哪一招。
 *
 * 按 id 找而不是写死下标：技能表往里插一条、或者调一下顺序，下标就悄悄指向另一招了，而这种
 * 错不会报任何错，只会让开局手感莫名其妙变了。
 */
const DEFAULT_SKILL: SkillId = 'wave';

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
const SEED_COUNT = 30;

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

/**
 * 回收之后，那个**位置**还替原主留多久，秒。
 *
 * 修的是跑步机最容易穿帮的一处：左边聚起几百人，玩家往右跑几步再回头，人海没了 —— 那一坨
 * 人明明只是走出了回收框，回来时却要从视野外重新走进来，中间有好几秒的空场。真实世界里
 * 转身回头看到的应该是同一群人站在同一个地方。
 *
 * 所以回收只丢**模型**，位置进一张预留表；视线回来时照着表把人放回去（见 restoreReserved）。
 *
 * 12 秒是按"跑开再回头"这件事本身的时长定的：玩家冲刺 60、回收框边缘离镜头中心约 156 个
 * 单位（出货视口半宽 120 × 1.3），也就是跑 2.6 秒才刚把最外圈甩掉；往返再加上转身，一次
 * "去看看那边再回来"大约就是十秒出头。给到 12 秒，正常的回头都还认得出原来那片人海；再长
 * 就开始不像回事了 —— 离开半分钟回来还是原封不动的一群人，反而假。
 *
 * 想让人海"记得更久"就往上调，想让它更快忘掉就往下调。这个值只影响观感，不影响人数稳态
 * （稳态还是回收框定的）。
 */
const RESERVE_TIME = 12;

/**
 * 预留表的条数上限。纯粹是内存兜底。
 *
 * 稳态下用不到：冲刺时每秒回收一百多个，12 秒也就一千五百条上下，而一条只是几个数加两个
 * 共享引用。留 6000 是给"缩放拉远 + 出兵拉满"那种调试情形的余量。顶到上限就不再记新的 ——
 * 丢掉的是最新回收的那些，它们离视线最远，最不可能被立刻看回来。
 */
const MAX_RESERVATIONS = 6000;

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
  heading: number;
  age: number;
  life: number;
  from: number;
  to: number;
  arc: number;
  /** 打中时溅多少碎片，见 SkillDef.power。 */
  power: number;
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
 * 不记血量和倒地进度：只有活人进这张表（见 recycle）。尸体在画面外躺满两秒多就沉掉了，把
 * 一具尸体"恢复"回来没有意义，反而会让人看见一片凭空长出来的尸体。
 */
interface Reservation {
  x: number;
  y: number;
  facing: number;
  def: UnitDef;
  palette: CharacterPalette;
  speed: number;
  /** 出手冷却。连这个也带上，回来的那一群才不会整齐划一地同时挥。 */
  cooldown: number;
  /** clock 走到这个值就作废。 */
  expires: number;
}

export class Battle {
  readonly player: Character;
  readonly enemies: Character[] = [];
  /** 冲击弧。由挥击的落点放出，所以归战斗管；画它的是 Scene。 */
  readonly effects = new ImpactEffects();
  /** 打碎溅出来的血珠和甲片。同上：谁放出来的归战斗管，画它的是 Scene。 */
  readonly debris = new Debris();

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
  /**
   * 人数硬上限，运行时可调（逗号/句号）。
   *
   * 这**不是**同屏上限，也不是玩法旋钮 —— 它是性能兜底。场上有多少人由跑步机自己定：出怪
   * 往前补、回收往后抹，population 会稳在"回收框装得下多少"上（见 DESPAWN_MARGIN）。这个数
   * 只负责在某种没预料到的情形下别让人数跑飞。
   *
   * 三千是照着回收框反推的：出货视口 240×245（grain 4），放大到 1.3 倍是 312×319，按每人 122
   * 平方单位算能装约八百人 —— 实测站桩稳在 700 上下，所以正常永远顶不到三千。留这么大的余量是
   * 因为它跟着 DEFAULT_GRAIN 变：颗粒度调细一档，视口变大，稳态人数也会跟着涨。
   */
  maxEnemies = 3000;
  autoAttack = true;

  /**
   * 当前选中的攻击技能，见 game/skills.ts。菜单里直接选，也可以按 J 循环。
   *
   * 只作用于玩家。敌人一直走基础攻击那条路 —— 让杂兵也放技能，画面上会同时有几十道波，
   * 分不清哪道是自己放的。
   */
  skillIndex = Skills.findIndex((s) => s.id === DEFAULT_SKILL);

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

  /**
   * 回收掉的位置，等着视线回来。见 RESERVE_TIME。
   *
   * 用普通数组加"末位换补"删除：这张表每帧要整个扫一遍判过期，顺序没有意义，而每帧的增删
   * 都是几十上百条，链表或者堆在这个量级上只会更慢。
   */
  private readonly reserved: Reservation[] = [];

  /** 这一局跑了多久，秒。目前只有预留位置的过期判定用它。 */
  private clock = 0;

  /** 逻辑这一段花掉的毫秒，指数平滑。暂停面板要读。 */
  simMs = 0;

  private readonly field: Field;
  private spawnTimer = 0;

  /**
   * 邻居查表。每帧重建一次，分离和"把人推出玩家身体"都走它。
   *
   * 它自己按人群的包围盒开表，所以图外那一圈不用特意交代 —— 人走到哪儿，表就盖到哪儿。
   */
  private readonly grid: SpatialGrid;

  constructor(field: Field) {
    this.field = field;
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
    // 跨帧的招式也得清掉：重开之后还有一道上一局的波在飞，会凭空杀掉刚铺下去的人。
    this.skillWaves.length = 0;
    this.lunge = null;
    this.aegis = null;
    this.dharma = null;
    this.skyArrow = null;
    this.debris.clear();
    this.player.death = -1;
    this.player.hurt = 0;
    this.player.hp = this.player.maxHp;
    this.seed(view);
  }

  /**
   * 开局先在场上铺一批，从很近到视野边缘都有。
   *
   * 不铺的话，第一个敌人得从视野外走进来，前几秒是一片空地 —— 而这几秒恰恰是要给人看的那
   * 几秒。铺一批之后一进画面就有活干，后面靠持续出怪接上。
   */
  seed(view: BattleView): void {
    // 全部生在视口外，和之后每一个走同一条路：方向均匀一整圈，距离按"沿这个方向走多远才
    // 出画面"算，再往外多撒一段随机纵深（见 SEED_DEPTH）让他们分批到达。
    for (let i = 0; i < SEED_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const r = this.exitDistance(cos, sin, view) + SPAWN_MARGIN + Math.random() * SEED_DEPTH;
      this.place(this.player.x + cos * r, this.player.y + sin * r);
    }
  }

  /**
   * 在视口外随机一个方向生一个。
   *
   * 方向是均匀的一整圈，不做任何"这边在图外就换一边"的挑拣 —— 那正是包围感的来源。距离按
   * **沿这个方向走多远才出画面**算，所以每个方向都恰好在看不见的地方生成，不多走一步。
   */
  spawn(view: BattleView): void {
    const angle = this.spawnAngle();
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const r = this.exitDistance(cos, sin, view) + SPAWN_MARGIN + Math.random() * SPAWN_JITTER;
    this.place(this.player.x + cos * r, this.player.y + sin * r);
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
   * 把跟不上的人抹掉。
   *
   * 判的是**出货那一档**的视口再放大 1 + DESPAWN_MARGIN 倍。用出货视口而不是当前视口，是为了
   * 和出怪保持同一把尺子 —— 否则调试时拉远镜头，出怪按出货框算、回收按当前框算，两边打架。
   *
   * 尸体也一起回收：它们已经在画面外，没人看得见，留着只是占着数组。
   *
   * 抹掉的是**模型**，不是那个人站过的地方：活人在离场时把位置记进预留表，视线回来时照着
   * 放回去（见 RESERVE_TIME / restoreReserved）。
   */
  private recycle(view: BattleView): void {
    const box = view.spawn;
    const keepX = box.halfW * (1 + DESPAWN_MARGIN);
    const keepY = box.halfH * (1 + DESPAWN_MARGIN);
    const enemies = this.enemies;
    const reserved = this.reserved;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (Math.abs(e.x - box.x) <= keepX && Math.abs(e.y - box.y) <= keepY) continue;
      if (e.alive && reserved.length < MAX_RESERVATIONS) {
        reserved.push({
          x: e.x,
          y: e.y,
          facing: e.facing,
          def: e.def,
          palette: e.palette,
          speed: e.walkSpeed,
          cooldown: e.attackCooldown,
          expires: this.clock + RESERVE_TIME,
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
   * 一条预留只要进了恢复框就**用掉**，不管放没放成 —— 放不下（那儿已经站了人、或者压着树）
   * 就丢掉。留着等下一帧看是错的：那时它已经在框里、再往里就是画面上，成功了也是当着面
   * 凭空长出一个人来。宁可少一个，不能穿帮。
   *
   * 必须在 grid.build 之后调：判"那儿有没有人"走的是同一张邻居表。这一帧刚放回去的人不在
   * 表里，所以两条预留之间的重叠查不出来 —— 但同一批预留本来就是从同一个瞬间的人群里记
   * 下来的，彼此天然不重叠；万一有残留，separate() 紧接着就收拾掉了。
   */
  private restoreReserved(view: BattleView): void {
    const box = view.spawn;
    const seeX = box.halfW * (1 + RESTORE_MARGIN);
    const seeY = box.halfH * (1 + RESTORE_MARGIN);
    const reserved = this.reserved;
    const enemies = this.enemies;

    for (let i = reserved.length - 1; i >= 0; i--) {
      const r = reserved[i];
      const expired = this.clock >= r.expires;
      // 还没看见、也还没过期：留着。
      if (!expired && (Math.abs(r.x - box.x) > seeX || Math.abs(r.y - box.y) > seeY)) continue;

      reserved[i] = reserved[reserved.length - 1];
      reserved.pop();
      if (expired || enemies.length >= this.maxEnemies) continue;

      if (!this.spotFree(r.x, r.y, r.def)) continue;

      const e = new Character(r.def, r.palette, r.speed);
      e.x = r.x;
      e.y = r.y;
      e.facing = r.facing;
      e.attackCooldown = r.cooldown;
      enemies.push(e);
      this.restored++;
    }
  }

  /**
   * (x, y) 能不能塞得下 who：地形不挡、玩家不在那儿、也没有别的活人占着。
   *
   * 只给恢复用。出怪那条路不查这个 —— 出怪点在视野外的空地上，撞上了由分离顺手推开就行；
   * 而恢复是往**人堆里**放，放错了就是两个人叠在一起从画面外走出来。
   */
  private spotFree(x: number, y: number, def: UnitDef): boolean {
    const { field, grid, enemies, player, crowdSpacing } = this;
    // 尺寸只由 def 推出来（见 Character 的 radius / spacing），所以不必先造一个人再来问。
    // 这条路每帧会为每个还没放回去的预留走一次，白造的 Character 会连带 Pose 和 Animator。
    const radius = RigSpec.hipHalfWidth * def.bulk * 1.15;
    const spacing = RigSpec.torsoHalfWidth * def.bulk;
    if (!isFreeSpot(field.terrain, field.props, x, y, radius)) return false;

    const toPlayer = (player.spacing + spacing) * crowdSpacing;
    if ((x - player.x) ** 2 + (y - player.y) ** 2 < toPlayer * toPlayer) return false;

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
  private place(x: number, y: number): void {
    const field = this.field;
    const kind = EnemyKinds[Math.floor(Math.random() * EnemyKinds.length)];
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
    e.attackCooldown = Math.random() * ENEMY_SWING_GAP;
    this.enemies.push(e);
  }

  /** 推进一帧。暂停时唯一被停下的就是它。 */
  update(dt: number, input: BattleInput, view: BattleView): void {
    const t0 = performance.now();
    const { player, enemies, field } = this;

    this.clock += dt;
    this.movePlayer(dt, input);
    this.recycle(view);
    this.spawnWave(dt, view);
    this.swing();
    this.advancePlayerAttack(dt, view);
    this.advanceSkills(dt, view);
    // 先建一次表：敌人要先查"前面有没有人占着位子"。分离那边会按挪完的位置再建一次。
    this.grid.build(enemies);
    // 恢复排在建表之后：判"那个位置有没有人"要用这张表。见 restoreReserved。
    this.restoreReserved(view);
    this.driveEnemies(dt, view);
    this.separate();

    this.effects.update(dt);
    this.debris.update(dt);
    field.update(dt, this.actors());

    // 玩家倒下了就重开：清场、回血、重新铺一批。
    if (!player.alive && player.death > RESPAWN_DELAY) {
      this.player.death = -1;
      this.player.hp = this.player.maxHp;
      this.player.hurt = 0;
      enemies.length = 0;
      // 和 reset 一样：清场就该是真的清场，不能让预留把上一条命的人海放回来。
      this.reserved.length = 0;
      this.skillWaves.length = 0;
      this.lunge = null;
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
      return;
    }

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
    this.player.swing(attackDuration(this.player.def) + PLAYER_SWING_GAP + skillAt(this.skillIndex).gap);
  }

  /** 选一个技能。越界忽略，菜单和键盘走同一条路。 */
  setSkill(index: number): void {
    if (index < 0 || index >= Skills.length) return;
    this.skillIndex = index;
  }

  /** 循环切下一个技能（键盘用）。 */
  cycleSkill(): void {
    this.skillIndex = (this.skillIndex + 1) % Skills.length;
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
  private advancePlayerAttack(dt: number, view: BattleView): void {
    const { player } = this;
    if (!player.update(dt)) return;
    this.castSkill(skillAt(this.skillIndex), view);
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
   * 三种结算方式对应 skills.ts 里那三条路：instant 当场算清，wave 和 lunge 只是把一个
   * 会跨帧推进的东西放出去，真正的杀伤在 advanceSkills 里逐帧结算。
   *
   * 谁被打中都是**碰到就死**，和基础攻击完全一样 —— 技能之间的区别只有形状，没有强度。
   */
  private castSkill(skill: SkillDef, view: BattleView): void {
    const { player } = this;
    const at = weaponImpactPoint(player.pose, player.def, player.x, player.y, player.facing);
    const reach = player.def.attackRange * skill.reach;

    switch (skill.kind) {
      case 'instant': {
        const arc = skill.arc ?? player.def.attackArc;
        // 整圈那一招的圆心是**人**，不是武器落点：转一圈扫开身周，落点在身前一侧没有意义。
        const full = arc >= Math.PI * 1.99;
        if (full) {
          // 回旋：一圈从脚下推开的环，见 castRing（突进的收招用的是同一份）。
          this.castRing(reach, skill.power);
          return;
        }
        {
          // 横扫也压在人群之上，但比另外三招轻一档。
          //
          // 它是菜单里能选的一招，完全看不见说不过去；但它同时是自动挥的那一下，每隔零点
          // 几秒就来一次 —— 给足另外三招的份量会让屏幕上一直横着一道白弧，反而把真正按出来
          // 的技能淹掉。轻一档、短一点，看得见又不抢戏。
          this.effects.spawn(at.x, at.y, player.facing, {
            power: player.def.bulk,
            weight: 1.5,
            life: 0.34,
            overhead: true,
          });
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
  private castRing(reach: number, power: number, x = this.player.x, y = this.player.y): void {
    const { player } = this;
    this.effects.spawn(x, y, player.facing, {
      power: 1,
      span: Math.PI * 2,
      from: 1.5,
      to: reach / SKILL_HIT_MARGIN,
      life: 0.5,
      weight: 2.1 * player.def.bulk,
      overhead: true,
    });
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= (reach + e.radius) * (reach + e.radius)) this.slay(e, x, y, power);
    }
  }

  /**
   * 推进跨帧的那两招，并结算它们这一帧碰到的人。
   *
   * 这两招是**故意**偏离"发招那一刻一次算清"那条规矩的（combat.ts 顶上那段）。理由很直接：
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
        this.castRing(arrow.radius, arrow.power, arrow.targetX, arrow.targetY);
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

    if (this.lunge) {
      this.lunge.left -= dt;
      // 撞到谁谁死，判定就是人自己的身体加一点余量 —— 冲过去的是这个人，不是一个扇形。
      //
      // 但判定的是**这一帧走过的那条线段**，不是落点那一个圈。冲刺速度接近 500 单位/秒，
      // 60 帧下一步就跨 8 个单位，而 main.ts 把 dt 夹在 1/20 —— 掉帧时一步跨 25 个单位，
      // 比判定圈的直径还大，中间的人整个被跳过去。实测 20 帧下一条 18 人的队列漏掉 7 个，
      // 而且漏的位置是散的（第 0、1、5、8、9 个），玩家读作"从人身上穿过去了"。
      const hit = player.radius + LUNGE_BODY_MARGIN;
      const ax = this.lunge.fromX;
      const ay = this.lunge.fromY;
      const segX = player.x - ax;
      const segY = player.y - ay;
      const segLen2 = segX * segX + segY * segY;
      // 冲刺方向和它的左手法线，用来把人往两侧掀。
      const dirX = Math.cos(this.lunge.heading);
      const dirY = Math.sin(this.lunge.heading);
      for (const e of this.enemies) {
        if (!e.alive) continue;
        // 点到线段的最近距离。t 夹在 [0,1]，所以线段两端之外按端点算。
        let t = segLen2 > 1e-9 ? ((e.x - ax) * segX + (e.y - ay) * segY) / segLen2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = e.x - (ax + segX * t);
        const dy = e.y - (ay + segY * t);
        const reach = hit + e.radius;
        if (dx * dx + dy * dy <= reach * reach) {
          // 往哪一侧掀：看他落在冲刺线的哪一边。正好压在线上的人（横向分量接近 0）用他自己
          // 那个固定的惯用侧 —— 不给定值的话方向会在零附近抖，同一帧里挨着的两个人可能被
          // 掀向相反的方向，读作原地炸开而不是被犁开。
          const side = -dx * dirY + dy * dirX;
          const sign = Math.abs(side) > 0.05 ? Math.sign(side) : e.sideBias;
          // 主要横着、带一点前冲。
          let kx = -dirY * sign + dirX * LUNGE_SIDE_FORWARD;
          let ky = dirX * sign + dirY * LUNGE_SIDE_FORWARD;
          const kl = Math.hypot(kx, ky) || 1;
          kx /= kl;
          ky /= kl;
          // kill() 是按"背对打击来源"算方向的，所以把来源放在想要的方向的反面。
          this.slay(e, e.x - kx * 10, e.y - ky * 10, this.lunge.power, {
            force: LUNGE_FORCE,
            freeze: LUNGE_FREEZE,
          });
        }
      }
      if (this.lunge.left <= 0) {
        // 冲到头再炸一圈：把走廊两侧漏掉的人一起带走。冲锋该以"撞进人堆里停下"收尾，
        // 而不是穿过去就没事了。
        if (this.lunge.finishRing > 0) this.castRing(this.lunge.finishRing, this.lunge.power);
        this.lunge = null;
      }
    }
  }

  // ---------------------------------------------------------------- 敌人

  private driveEnemies(dt: number, view: BattleView): void {
    const { player, field } = this;

    const enemies = this.enemies;
    const box = view.spawn;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      // 在不在画面里。找空位和搭姿势都只给画面里的人做。
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
          // 只给**画面里**的人算。跑步机模型下场上能有一两千人，而其中只有一半在屏幕上；
          // 外面那一半处在人堆的稀疏外围，本来也没人挡路，算了也是白算 —— 而这一步是每帧
          // 最贵的一块（要按探测半径查好几圈格子）。他们走进画面的那一刻自然就开始找位置，
          // 中间的重叠由分离一直在收拾，看不出接缝。
          const room = this.slotAhead(i, dx / dist, dy / dist, dist);

          // 越是被堵住越慢，而且越靠后越慢。直行那一份按 room 走全速；绕行那一份先打个折，
          // 再按离玩家多远衰减 —— 见 SIDESTEP_SPEED 上那段。
          const shuffle = SIDESTEP_SPEED * clamp(SIDESTEP_NEAR / dist, 0, 1);
          // 快到站位时再乘一段减速，把"走"和"站定"之间那个硬开关抹平 —— 见 APPROACH_BAND。
          const approach = clamp((dist - stop) / APPROACH_BAND, 0, 1);
          // 目标速度不直接用，先滑过去 —— 见 PACE_TAU。
          const wantPace = (room + (1 - room) * shuffle) * approach;
          e.crowdPace += (wantPace - e.crowdPace) * (1 - Math.exp(-dt / PACE_TAU));
          const pace = e.crowdPace;

          const side = this.slotSide;
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
          const to = moveWithCollision(
            field.terrain,
            field.props,
            e.radius,
            e.x,
            e.y,
            e.x + mx * want * pace * dt,
            e.y + my * want * pace * dt,
          );
          // 交给动画器的是**实际走了多远**，不是想走多快。
          //
          // 这两者在人堆里差得很远：挤在最里圈的人每帧只能蹭出零点几个单位，而按意图报速度
          // 的话他会以全速播走路循环 —— 一排原地大步流星的人，看着比穿模还假。蹭着树走的
          // 那种半速也是同一回事。动画器本来就是按 speed 混合步态的，喂给它真值即可。
          const moved = Math.hypot(to.x - e.x, to.y - e.y);
          e.speed = dt > 0 ? moved / dt : 0;
          e.x = to.x;
          e.y = to.y;
        } else {
          // 到位了：站定出手。crowdPace 也归零，免得下次起步带着旧值窜一下。
          e.crowdPace = 0;
          e.speed = 0;
          e.swing(ENEMY_SWING_GAP + Math.random() * ENEMY_SWING_JITTER);
        }
      }

      if (e.update(dt, onScreen) && player.alive && inAttackArc(e, player)) {
        if (player.takeHit(e.x, e.y)) this.deaths++;
      }
    }
  }

  /** slotAhead 顺带算出来的绕行方向：+1 往左，-1 往右。 */
  private slotSide = 1;

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
    const { grid, enemies, crowdSpacing, player } = this;
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
   * 重合成一个人，人群完全读不出数量。O(n²)，一百多个单位每帧一万次比较，可以忽略。
   */
  private separate(): void {
    const enemies = this.enemies;
    const grid = this.grid;
    grid.build(enemies);
    // 必须在 build **之后**取：人数涨过上次容量时 build 会重开这个数组，先取就拿到旧的那根了。
    const items = grid.indices;

    for (let pass = 0; pass < this.separationPasses; pass++) {
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (!a.alive) continue;
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
            // 只处理 j > i：每对人恰好推一次，和原来两层循环的语义一模一样。
            //
            // 试过按"到玩家的距离从近到远"排序再扫，指望修正一趟就从里圈推到外圈。实测在
            // 一千人时间距只从 9.2 变成 9.3（噪声），却多花 0.4 毫秒排序 —— 因为瓶颈根本不
            // 是修正传得快不快，是那么多人**真的没地方站**（见 separationPasses 上那段）。
            const j = items[k];
            if (j <= i) continue;
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
    const { player, grid } = this;
    const items = grid.indices;
    const enemies = this.enemies;
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
      const room = this.maxEnemies - this.enemies.length;
      const batch = Math.min(this.spawnBatch, room);
      for (let i = 0; i < batch; i++) this.spawn(view);
    }
  }
}
