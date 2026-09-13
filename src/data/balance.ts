/**
 * 全局曲线和公式常量：等级、经验、波次成长、伤害、掉落。
 *
 * 单独一个文件，因为这里每一个数都不属于任何一个具体的角色、兵种或地图 —— 它们是这四张表
 * 之间的**换算关系**。调一个角色的攻击力只影响那个角色，调这里的 DEFENSE_SCALE 会同时改变
 * 场上每一次伤害结算。所以它们不该混在一起。
 */

import type { StatBonus, StatGrowth, UnitStats } from './types';

// ---------------------------------------------------------------- 等级与经验

/**
 * 等级上限。
 *
 * 三十级而不是无限：成长表是**绝对增量**的直线（见 StatGrowth），没有上限的直线迟早会让
 * 移动速度超过冲刺、攻击范围盖满半个屏幕。有上限，满级是多少一眼能算出来。
 */
export const MAX_LEVEL = 30;

/**
 * 从第 level 级升到下一级需要多少经验。
 *
 * 平方曲线，不是指数：指数曲线的末段会陡到只能靠数值膨胀去填，而平方的增速一直是可算的 ——
 * 升到 10 级要 8,250 点，升到 30 级要 855,500 点，正好是一百倍的关系。
 *
 * 参照系是一局的产出：满配那一局玩家每秒杀四十来个，二十二分钟下来三万上下的击杀，按杂兵
 * 一点经验算就是三万点。所以**一整局大约推到十级**，往后每一级都得靠多打几局，这正是等级
 * 该有的节奏 —— 第一局就满级的话，后面所有局的成长都没有了。
 */
export const expToNextLevel = (level: number): number => {
  if (level >= MAX_LEVEL) return Infinity;
  return 100 * level * level;
};

// ---------------------------------------------------------------- 伤害

/**
 * 防御的递减系数：防御 d 挡掉 d / (d + DEFENSE_SCALE) 的伤害。
 *
 * 用递减而不是"攻减防"：减法在两端都会出事 —— 防御高过攻击就完全免疫，防御低的时候一点
 * 防御又毫无感觉。递减公式里每一点防御都有用，而且永远挡不满。
 *
 * 100 这个量级是按玩家的攻击力定的（一级武将 120）：杂兵 4 点防御只挡掉 3.8%，一刀照样
 * 秒；持盾兵 16 点挡掉 13.8%，能看出"这个人硬"；末波的枪骑兵四十多点挡掉三成，得补第二刀。
 */
export const DEFENSE_SCALE = 100;

export const damageAfterDefense = (attack: number, defense: number): number =>
  attack * (1 - defense / (defense + DEFENSE_SCALE));

/**
 * 技能相对平砍的伤害倍率。
 *
 * skills.ts 的 power 字段本来只管"打中时溅多少碎片"（1 = 只飙血，2 = 血加甲片），那是画面
 * 上平砍和技能唯一的区别。现在它同时当伤害倍率用：power 每高一档，伤害乘一次这个数。两件
 * 事共用一个字段是有意的 —— 看着更狠的那一下本来就该更疼，分成两个字段迟早会调出"画面很
 * 炸但不疼"的招。
 */
export const SKILL_DAMAGE_PER_POWER = 2.2;

/** 暴击。技能更容易出，让大招偶尔炸出一个特别烫的数。 */
export const CRIT_CHANCE_BASIC = 0.09;
export const CRIT_CHANCE_SKILL = 0.18;
export const CRIT_MULTIPLIER = 2.4;

/** 每一下的随机浮动，±12%。完全固定的伤害数字看久了像是假的。 */
export const DAMAGE_VARIANCE = 0.12;

/** 伤害的下限。防御再高也得掉一点血，否则会出现打不动的怪。 */
export const MIN_DAMAGE = 1;

// ---------------------------------------------------------------- 波次成长

/**
 * 波次曲线：第 n 波的敌人比第一波强多少。
 *
 * 全是"每多一波再加这么多"的线性增量，乘在兵种的基础属性上。
 *
 * **速度那一条是一条斜坡，不是一个常数。** 它每波涨 16.7%，比血和攻击的斜率都大 —— 因为它
 * 要从"追不上"一直走到"甩不掉"。兵种表里的速度是**第一波的**速度，乘完七步正好回到以前
 * 那一档（杂兵 12 → 26、骑兵 16 → 35）。以前整局都是末波那个速度，第一波就追得上散步的玩家，
 * 一开局就被围 —— 而前几波本来该是用来攒等级和攒技能的。
 *
 * 另有一条硬上限夹着。敌人的追击速度是这个工程里唯一一个不能随便涨的数：driveEnemies 在远
 * 距离还会乘 1.8 的追击倍率，而整套走位设计建立在"走路甩不掉、冲刺能甩掉"上（见 battle.ts
 * 的 CHASE_BOOST）。波次再把速度乘上去，末波的骑兵会追过玩家的冲刺，冲刺这张脱身牌就废了 ——
 * 所以斜坡的终点仍然被 MAX_ENEMY_SPEED 夹住。
 */
export const WAVE_HP_PER_WAVE = 0.09;
export const WAVE_ATTACK_PER_WAVE = 0.26;
export const WAVE_DEFENSE_PER_WAVE = 0.22;
export const WAVE_SPEED_PER_WAVE = 0.167;
export const WAVE_ATTACK_SPEED_PER_WAVE = 0.03;

/**
 * 首领的血每波涨多少。
 *
 * 首领**不吃普通那条波次曲线**（见 resolveEnemyStats），但也不能整局一个数：现在每一波到点都
 * 出一个，而玩家的伤害一局涨六倍。写死的话，第一个首领要砍四十多刀（打不动），最后一个两三刀
 * （不配叫首领）。自己那条斜坡比普通兵降得快得多，正好把他一直钉在"要认真砍十来刀"那一档。
 */
export const BOSS_HP_PER_WAVE = 0.5;

/**
 * 最后一批首领全部出场之后，给多久把他们清完，秒。
 *
 * 前面每一波的截止线都是"下一波到点"，而最后一波后面没有下一波了 —— 得单给一个数，否则要么
 * 永远不结束，要么按末波那 215 秒算（那是出兵的时长，和"砍三个首领要多久"没有关系）。
 *
 * 三分钟：满配玩家砍一个末波首领大约十六秒，三个加上找人、跑位、被人海缠住的时间，三分钟是
 * 一个要你动起来、但不逼着你打完美的窗口。
 */
export const FINAL_BOSS_LIMIT = 180;

/**
 * 敌人移动速度的硬上限，世界单位每秒。
 *
 * 这条上限是**防止波次和地图把速度堆上去**，不是给速度定一个理想值 —— 36 就是场上本来最快
 * 的那个兵（骑射 35）再留一点点余量。换句话说：练到末波、在赤沙荒原上，敌人也不会比这个
 * 游戏一直以来最快的那个人更快。
 *
 * 为什么偏偏是速度要有这么一道闸：driveEnemies 在远距离还会乘 1.8 的追击倍率，而整套走位
 * 设计建立在"走路甩不掉、冲刺能甩掉"上（见 battle.ts 的 CHASE_BOOST）。36 × 1.8 = 64.8，
 * 和基准角色的冲刺 60 是同一个量级 —— 骑射能吊着玩家跑，但他停在八十多个单位外放箭，本来
 * 也不追上来。真要让后面几波更难缠，该加的是血和防御，不是速度。
 */
export const MAX_ENEMY_SPEED = 36;

/** 经验：波次越高，同一个兵给的经验越多。 */
export const WAVE_EXP_PER_WAVE = 0.15;

// ---------------------------------------------------------------- 技能等级

/**
 * 技能等级上限。
 *
 * 五级不是随手定的：HUD 上每个技能格底下那排菱形就是五颗（hudSkillLevel.ts），那排东西一直
 * 在那儿，只是以前填的是写死的预览值。等级的上限得和玩家看得见的格子数一样，多一级少一级都
 * 会让那排菱形要么填不满、要么填不下。
 */
export const SKILL_MAX_LEVEL = 5;

/**
 * 一套完整配置有几个技能：4 个主动（含疾走）、1 个自动攻击、2 个发射、1 个护身。
 *
 * 它决定"一局要抽多少次牌"，所以以后加槽位（比如主动开到五格）必须同步改这里，否则卡牌的
 * 节奏会慢慢跟不上技能的数量。
 */
export const BUILD_SKILL_COUNT = 8;

/**
 * 一局开始时手上有几个技能：一个自动攻击技，加一个钉在 R 上的疾走。
 *
 * 剩下的六个（三个主动、两个发射、一个护身）都要靠抽牌拿，所以"抽满一套"要算上这六张
 * "获取"牌，不只是升级那部分。
 */
export const BUILD_SKILL_STARTING = 2;

/**
 * 把一整套配置堆齐并顶满，一共要抽多少次牌。
 *
 * 两笔账：先把缺的六个技能一张一张抽到手，再把八个技能各从 1 级升到 5 级。
 */
export const CARD_PICKS_FOR_FULL_BUILD =
  (BUILD_SKILL_COUNT - BUILD_SKILL_STARTING) + BUILD_SKILL_COUNT * (SKILL_MAX_LEVEL - 1);

/**
 * 满级该提前几波达成。
 *
 * 2 = 倒数第三波打完的时候就该顶满。留出这一段是有意的：最后两波是**用满配打**的，那是一局
 * 的高潮；如果满级正好落在最后一帧，玩家从来没机会用上自己攒了二十分钟的那套东西。
 */
export const FULL_BUILD_WAVES_EARLY = 2;

/**
 * 每升一级：作用距离 +10%，法力开销 -8%。
 *
 * 只动这两项是定下来的（升级不改冷却、不改动作时长）—— 那两个改的是节奏，而一招的节奏是它
 * 的身份。满级（5 级）就是范围 +40%、开销 -32%。
 */
/**
 * 一份出兵预算换算成多少颗**收到手里**的灵石。
 *
 * 出兵预算是纯数据（每波的爆兵加密度乘时长，见 data/waves.ts 的 spawnsThroughWave），而实际
 * 收到多少灵石取决于一堆跑起来才知道的事：场上人数上限、走出画面的回收、掉落物本身有 1800
 * 个的上限、以及玩家的拾取范围。所以这个系数是**离线空跑量出来的**，不是推的。
 *
 * 量法：无敌的玩家一直走位、开自动攻击，把四张图各空跑完整一局，记下每一波打完时收到的灵石
 * （tools 之外的一次性脚本）。结果在"满配那一波"上高度一致：
 *
 *   演武荒原 第 6 波打完  预算 21400  灵石 23907  比值 1.12
 *   黑石隘口 第 4 波打完  预算 11330  灵石 12839  比值 1.13
 *
 * 比值大于 1 是对的：预算只数出兵那条路放出来的人，而从画面外走进来的那一批（跑步机的回收
 * 与恢复）不经过出兵，却照样会被杀、照样掉灵石。
 *
 * 它在前几波更高（1.5 上下）、后几波更低（0.88）—— 因为后期出兵量涨得比玩家的清场速度快。
 * 取的是**满配那一波**上的值，因为卡牌节奏就是照着那一刻定的。
 */
export const GEMS_PER_SPAWN = 1.12;

/**
 * 第 k 张牌比第一张贵多少：门槛按 base × (1 + 0.06 × k) 往上走。
 *
 * 门槛要是从头到尾一个数，第一张牌会来得非常晚 —— 灵石收入本身就是往后越来越猛的（第一波
 * 一千颗，第八波九千颗），平的门槛摊下去就是"开局一分钟只弹一次，最后两分钟连弹五次"。玩家
 * 对"这一局在变强"的感觉恰恰是在**前几分钟**建立的。
 *
 * 往上走的门槛把这条曲线掰平：开局那一波能抽两三张，往后每张都更贵一点，而三十二张抽完的
 * 时刻**一点没动**（base 是按累计值倒解出来的，见 gemsPerCard）。
 */
export const CARD_COST_GROWTH = 0.06;

/** 抽满 picks 张牌一共要多少个 base。∑(1 + growth × k)，k 从 0 到 picks-1。 */
export const cardCostTotalUnits = (picks: number): number =>
  picks + (CARD_COST_GROWTH * picks * (picks - 1)) / 2;

/** 第 index 张牌（从 0 数起）的门槛。 */
export const cardCost = (base: number, index: number): number =>
  base * (1 + CARD_COST_GROWTH * Math.max(0, index));

/**
 * 技能每升一级，作用距离多多少。
 *
 * 给过 0.1，满级就是 1.4 倍 —— 再叠上等级成长和范围牌，末波的横扫大到半个屏幕，人还没走到
 * 脸前就没了，位置感整个垮掉。压到 0.04（满级 1.16 倍）：升级仍然看得出扫得更开，但不再把
 * "要贴到多近才砍得到"这件事抹平。
 */
export const SKILL_LEVEL_REACH = 0.04;

/*
 * 碎片的两条规矩，所有招式一视同仁：
 *
 *   **多少片看打中了多少人。** 破空一直是这么干的 —— 它没有中心那一蓬，碎片全从真正死掉
 *   的人身上出，所以砍空了就安安静静，砍进人堆就炸一片。别的招式不是：回旋只要圈里有人就炸
 *   一大蓬，一级那个二十单位的小圈里碰到两三个人也照炸；横扫反过来，满级一刀砍倒一大片人
 *   却没有任何中心的爆炸。现在两边都按人数给。
 *
 *   **甲片甩多远看练到几级。** 和掀飞距离同一条规则（见 LAUNCH_LEVEL_FLOOR）：一级掉在脚边，
 *   满级撕得满地都是。数量不跟等级走 —— 数量说的是"死了几个人"，那是一件客观的事。
 */

/** 中心那一蓬：每多一个死者给到满量的几成。封顶 1，也就是十六个人给满。 */
export const BLAST_PER_ENEMY = 0.06;

/**
 * 打死的人被掀飞多远，倍数。一级是下面这个数，满级是 1。
 *
 * 以前无论几级都是 1 —— 也就是说一级的招式掀得和满级一样远。而击飞是这个尺寸下
 * 最读得出来的反馈（见 character.ts 顶上那段：一个人只有二十来个像素高，人堆里眼睛能
 * 捕捉到的只有**位移**），那它就是升级最该被看见的地方之一。
 *
 * **跟着伤害倍率走，而不是另接一个等级参数。** “打得越疼掀得越远”本身就是一条玩家
 * 不用学就能读懂的规则，而伤害倍率本来就只由等级决定（见 skillDamageScale）。
 *
 * 飞多远是 `水平速度 × 滞空时间`，而滞空时间跟着起跳速度走、起跳速度又吃 force^0.35，
 * 所以距离实际按 force^1.35 走：0.55 下来是满级的四成五。高度只降到八成 ——
 * 一级的招式仍然把人掀翻了，只是掀不到那么远。
 */
export const LAUNCH_LEVEL_FLOOR = 0.55;

/**
 * 把伤害倍率折回成击飞倍数。见 LAUNCH_LEVEL_FLOOR。
 *
 * @param scale 这一招的伤害倍率（skillDamageScale 的返回值）。1 = 一级。
 */
export function launchForce(scale: number): number {
  return LAUNCH_LEVEL_FLOOR + (1 - LAUNCH_LEVEL_FLOOR) * skillTier(scale);
}

/** 一级时碎片甩出多远，倍数。满级是 1。见上面那段。 */
export const DEBRIS_LEVEL_FLOOR = 0.55;

/** 碎片甩多远。@param scale 这一招的伤害倍率。1 = 一级。 */
export function debrisReach(scale: number): number {
  return DEBRIS_LEVEL_FLOOR + (1 - DEBRIS_LEVEL_FLOOR) * skillTier(scale);
}

/**
 * 把伤害倍率折回成"这一招练到了几成"。0 = 一级，1 = 满级。
 *
 * 不另接一个等级参数：每一条结算路径都已经在传这个倍率了，而它本来就只由等级决定。
 */
function skillTier(scale: number): number {
  const span = SKILL_LEVEL_DAMAGE * (SKILL_MAX_LEVEL - 1);
  return span > 1e-6 ? Math.min(1, Math.max(0, (scale - SKILL_DAMAGE_BASE) / span)) : 1;
}
export const SKILL_LEVEL_MP_DISCOUNT = 0.08;

/**
 * 技能每升一级，这一招的伤害和出手频率各变多少。
 *
 * 以前升级只动作用距离和法力开销 —— 一个满级横扫和一级横扫砍在人身上是一样疼的，于是升级
 * 只能靠"扫得更远"来体现，而那在人堆里几乎看不出来。
 *
 * 伤害那一条是**这一局能不能走到后期秒怪的主力**：角色等级从 1 级到 25 级才涨 2.5 倍，而敌人血
 * 一局就涨一截。没有技能等级这一条，"前期多砍几下、后期一刀一个"那条交叉曲线根本交不上。
 * 0.35 × 4 = 满级两倍多，配上属性牌和等级正好把末波的杂兵压进一刀。
 *
 * 频率那一条乘在**冷却**上，不是乘在攻击速度上：挥击动作本身的长度是角色属性，把它也压短
 * 的话，满级的人会挥出一串看不清的残影。冷却只是"下一招要等多久"，压它是安全的。
 */
/**
 * 一级的伤害倍率。
 *
 * 以前是 1（也就是"一级就是基准"），现在抬到 1.2 —— 开局的手感太轻。
 * **满级那一档没动**：每级的增量从 0.35 降到 0.3，1.2 + 0.3×4 仍然是 2.4。
 * 曲线变平了一点，但两头都在原处 —— 只是不再把前三级过得那么惨。
 */
export const SKILL_DAMAGE_BASE = 1.2;
export const SKILL_LEVEL_DAMAGE = 0.3;
export const SKILL_LEVEL_RATE = 0.09;

/**
 * 被动技能每升一级，那一包加成放大多少。满级（5 级）就是两倍。
 *
 * 被动没有"作用距离"也没有"法力开销"，上面那两个旋钮在它身上一个都拧不动 —— 不单给它一条，
 * 玩家把护身技升到五级会得到一个什么都没变的技能，而它明明占着八分之一的升级预算。
 */
export const SKILL_LEVEL_PASSIVE = 0.25;

export const skillPassiveScale = (level: number): number =>
  1 + SKILL_LEVEL_PASSIVE * (Math.max(1, Math.min(level, SKILL_MAX_LEVEL)) - 1);

export const skillReachScale = (level: number): number =>
  1 + SKILL_LEVEL_REACH * (Math.max(1, Math.min(level, SKILL_MAX_LEVEL)) - 1);

export const skillMpScale = (level: number): number =>
  1 - SKILL_LEVEL_MP_DISCOUNT * (Math.max(1, Math.min(level, SKILL_MAX_LEVEL)) - 1);

export const skillDamageScale = (level: number): number =>
  SKILL_DAMAGE_BASE + SKILL_LEVEL_DAMAGE * (Math.max(1, Math.min(level, SKILL_MAX_LEVEL)) - 1);

/** 乘在冷却上，所以是个小于 1 的数。满级大约是原来的三分之二。 */
export const skillRateScale = (level: number): number =>
  1 - SKILL_LEVEL_RATE * (Math.max(1, Math.min(level, SKILL_MAX_LEVEL)) - 1);

// ---------------------------------------------------------------- 环绕流星（磐石）

/**
 * 磐石那几颗绕着人转的流星。
 *
 * 它是第一个**有画面、会打人**的护身技：别的三个护身技全是一包看不见的属性加成，而那类东西
 * 玩家是感觉不到自己拿到了什么的。流星换个方向解决同一件事 —— 它一直在那儿转，你随时看得见
 * 自己带着它。
 *
 * 轨道半径按施放者的攻击范围折算：武将那一档三十来个单位，正好在他自己的平砍圈里侧一点，
 * 读作"贴着身边转"而不是"在远处绕"。用倍数不用绝对值的理由和技能表里的 reach 一样。
 */
export const ORB_ORBIT_REACH = 0.85;
/** 转多快，弧度每秒。一圈两秒半上下 —— 快到有速度感，慢到看得清有几颗。 */
export const ORB_SPIN = 2.5;
/** 撞人判定半径，世界单位。比流星画出来的那个球大一点，宁可宽。 */
export const ORB_HIT_RADIUS = 9;
/**
 * 同一个人被撞之后多久才能再被撞到，秒。
 *
 * 这一条是这一招强度的**唯一**旋钮：轨道上站着的人一秒被扫过好几次，没有免疫窗口的话它就是
 * 一个贴身秒杀。0.55 秒配 2.5 弧度每秒，等于一个人站着不动最多被同一颗流星连撞两次。
 */
export const ORB_HIT_GAP = 0.55;

/**
 * 罩在身上的那两个壳子（金钟罩、天地法相）多久结算一次，秒。
 *
 * 以前它们是**每帧**结算的。场上每一个人都一碰就死，所以这件事一直没暴露 —— 直到首领出现：
 * 他不会一下就死，于是站在罩里每秒挨六十下，一眼就没了。
 *
 * 更糟的是它还**跟帧率走**：144 赫兹的机器上这两招比 60 赫兹疼一倍多。给了间隔之后，伤害速率
 * 变成一个写出来的数，而不是"这台机器一秒跑多少帧"。
 *
 * 比磐石的 0.55 快一截：流星是扫过去的，而这两个是"你站在我的壳子里"。
 */
export const AURA_HIT_GAP = 0.35;
/** 撞一下算几档伤害。2 = 和技能同档（见 SKILL_DAMAGE_PER_POWER）。 */
export const ORB_POWER = 2;

// ---------------------------------------------------------------- 掉落

/**
 * 敌人死亡掉金币的概率，剩下的都掉灵石。
 *
 * 1/50 是故意压低的：金币是**跨局**的货币，一局里掉几百枚的话商店那一侧的定价就没法做了。
 */
export const COIN_DROP_CHANCE = 1 / 50;

/**
 * 敌人掉一件药或符的概率，四种分这一份（按 data/pickups.ts 里的权重）。
 *
 * 1/300，比金币（1/50）低一档。先按金币那个量级试过，太多了：离线跑三分钟就有三格摞到上限
 * 九件，之后一直在掉、一直被挡回去。快捷栏一旦长期是满的，"要不要现在按药"就不再是个决定 ——
 * 而那正是这四格存在的全部理由。
 *
 * 现在的量级是二十来秒一件。一局下来一百多件，够用、又不至于溢出，每一件掉下来都还算个事。
 */
/** 篝火砸开的那一件掉在哪里的散开半径，世界单位。 */
export const CAMPFIRE_DROP_SPREAD = 14;

// ---------------------------------------------------------------- 玩家

/**
 * 奔跑速度是走路速度的几倍。
 *
 * 1.875 不是随便定的：它让基准角色的 32 正好变成 60，也就是接数据层之前那两个写死的常量
 * （PLAYER_SPEED / PLAYER_RUN_SPEED）。换句话说双锤武将一级时的手感和以前**一模一样**，
 * 这一层加进来没有偷偷改掉基准。
 */
export const RUN_MULTIPLIER = 1.875;

// ---------------------------------------------------------------- 组合工具

/** 把成长表按等级摊进基础属性。等级 1 就是原样。 */
export function applyGrowth(base: UnitStats, growth: StatGrowth, level: number): UnitStats {
  const steps = Math.max(0, Math.min(level, MAX_LEVEL) - 1);
  const out = { ...base };
  for (const key of Object.keys(growth) as (keyof UnitStats)[]) {
    out[key] = base[key] + (growth[key] ?? 0) * steps;
  }
  return out;
}

/**
 * 把若干份乘算加成合到属性上。
 *
 * 同一项上的多个来源是**相加再乘一次**（1 + a + b），不是连乘 —— 连乘会让两个 +50% 变成
 * +125%，玩家算不出自己身上到底有多少加成。
 */
export function applyBonuses(stats: UnitStats, ...bonuses: StatBonus[]): UnitStats {
  const sum: StatBonus = {};
  for (const bonus of bonuses) {
    for (const key of Object.keys(bonus) as (keyof UnitStats)[]) {
      sum[key] = (sum[key] ?? 0) + (bonus[key] ?? 0);
    }
  }
  const out = { ...stats };
  for (const key of Object.keys(sum) as (keyof UnitStats)[]) {
    out[key] = stats[key] * (1 + (sum[key] ?? 0));
  }
  return out;
}

/** 加成表按等级摊开：bonus + perLevel × (等级 − 1)。被动技能用。 */
export function scaleBonus(bonus: StatBonus, perLevel: StatBonus, level: number): StatBonus {
  const steps = Math.max(0, Math.min(level, MAX_LEVEL) - 1);
  const out: StatBonus = { ...bonus };
  for (const key of Object.keys(perLevel) as (keyof UnitStats)[]) {
    out[key] = (out[key] ?? 0) + (perLevel[key] ?? 0) * steps;
  }
  return out;
}
