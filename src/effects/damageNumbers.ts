import { clamp, v2 } from '../core/math';
import { type Rgba, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 从头顶飘上去的扣血数字。
 *
 * 它补的是「这一下有多重」里唯一还缺的那一半。白光说"是他挨了"，碎片说"打碎了"，掀飞说
 * "打飞了"，但三者都不带刻度 —— 平砍和一发大招在画面上只差碎片多少。数字是刻度本身。
 *
 * 三条约束定了这个文件的样子：
 *
 *   **字要有像素感**。所以字模是自己烘的点阵，一个字模像素落在整数个缓冲像素上，跟着
 *   ShapeBatch 走同一条几何路 —— 不贴字体贴图，也不用 DOM 文本。整帧最后要被最近邻放大，
 *   任何非整数的字号都会在放大时抖出毛边，那正是"像素感"最先丢掉的地方。
 *
 *   **描边要自己烘**。画面上那圈暗边是 PixelSurface 在合成时对**整层的剪影**描的，所以数字
 *   压在人身上时，数字和人之间没有边 —— 而那恰恰是最需要边的时候（一个亮字压在亮盔甲上）。
 *   所以字模在烘的时候连描边一起烘：描边是字身按八邻域膨胀一圈再挖掉字身，两者一个像素都
 *   不重叠，于是整个数字可以整体半透明地化掉，而不会在接缝处叠出深浅。
 *
 *   **数字给掀飞让路**。人被掀飞，数字留在挨打的那一点往上飘 —— 跟着尸体飞的数字读作绑在
 *   人身上的标签，而这一下的信息属于"这里发生了什么"，不属于那具正在翻滚的尸体。但"留在
 *   原地"还不够：头顶那一格正是掀飞前半段轨迹扫过的地方，而被打飞的人本身就是这一下最好看
 *   的部分。所以数字往击飞的**反方向**让开一步，再淡入登场（见 BACK_OFF / FADE_IN）。
 *
 * 池子定长、定型数组、一个对象都不分配 —— 一次回旋能同时结算上百人，理由和 Debris 一样。
 */

/** 字模：5 宽 7 高。再窄（3×5）三位数还认得出，四位数就糊成一团；再宽开始像 UI 字体。 */
/** 字与字之间空一列。两边的描边各占一列，所以实际间距是三列，够把相邻两位分开。 */
const GLYPH_GAP = 1;

/**
 * 十个数字的点阵。
 *
 * 手写而不是拿系统字体栅格化：栅格化出来的 7 像素高数字，笔画粗细会随字形飘（"1" 细、
 * "8" 糊），而点阵字每一笔都正好一像素，十个字放在一起才是一套。
 */
const DIGIT_ROWS: readonly string[][] = [
  ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], // 0
  ['00100', '01100', '00100', '00100', '00100', '00100', '01110'], // 1
  ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], // 2
  ['11111', '00010', '00100', '00010', '00001', '10001', '01110'], // 3
  ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], // 4
  ['11111', '10000', '11110', '00001', '00001', '10001', '01110'], // 5
  ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], // 6
  ['11111', '00001', '00010', '00100', '01000', '01000', '01000'], // 7
  ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], // 8
  ['01110', '10001', '10001', '01111', '00001', '00010', '01100'], // 9
];

/** 一段连续的横向像素：字模第 y 行、从 x 起、w 个宽。画出来就是一个矩形。 */
interface Run {
  x: number;
  y: number;
  w: number;
}

interface Glyph {
  /** 字身。按行切成横条 —— 一个 "0" 是 8 个矩形，而不是 13 个像素方块。 */
  fill: Run[];
  /** 描边。膨胀一圈再挖掉字身，所以和 fill 一个像素都不重叠。 */
  edge: Run[];
  /**
   * 这个字自己多宽多高，字模像素。
   *
   * 数字和拉丁字母都是 5×7，而汉字是 13×11 —— 一个汉字在 5×7 下只剩一团黑，它就是需要
   * 那么大。排版因此不能再假设每个字一般宽，每个字自己报尺寸。
   */
  w: number;
  h: number;
}

/** 把一行按"这一格亮不亮"切成横条。 */
function rowRuns(y: number, lit: (x: number) => boolean, x0: number, x1: number, out: Run[]): void {
  let start = -1;
  for (let x = x0; x <= x1; x++) {
    const on = x < x1 && lit(x);
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      out.push({ x: start, y, w: x - start });
      start = -1;
    }
  }
}

/** 烘一个字模：字身横条 + 描边横条。模块加载时跑一次，十个字。 */
function bake(rows: readonly string[]): Glyph {
  const h = rows.length;
  const w = rows[0].length;
  const on = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && rows[y][x] === '1';

  const fill: Run[] = [];
  for (let y = 0; y < h; y++) rowRuns(y, (x) => on(x, y), 0, w, fill);

  // 八邻域膨胀：斜角也得有边，否则 "7" 的折角上会漏一个缺口，亮字压在亮甲上就断了。
  const edge: Run[] = [];
  for (let y = -1; y <= h; y++) {
    rowRuns(
      y,
      (x) => {
        if (on(x, y)) return false; // 字身自己不算描边，两者不重叠
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) if (on(x + dx, y + dy)) return true;
        }
        return false;
      },
      -1,
      w + 1,
      edge,
    );
  }
  return { fill, edge, w, h };
}

/**
 * 数字前面那个符号的点阵。和十个数字**同一套烘法**（同宽同高、同样自己带描边），所以它们
 * 并排站着时笔画粗细和基线是一样的 —— 换成别的画法，符号会立刻读作"贴上去的一个装饰"。
 *
 *   加号   立刻回了多少：+384 血、+41 蓝。数是绝对值。
 *   乘号   百分比加成：×18 就是那一项乘了 1.18。加号在这里是错的 —— "+18" 会被读成回了
 *          十八点，而符是按比例加的，差着一个数量级。
 *
 * 两个符号占中间五行、满五列：数字是七行高的，符号照着七行画会比数字还高一头（它没有数字
 * 那种上下收窄的字形），而只占三行又缩成一个小点。五行正好和数字的"腰"齐平。
 */
const SIGN_ROWS: readonly string[][] = [
  ['00000', '00100', '00100', '11111', '00100', '00100', '00000'], // +
  ['00000', '10001', '01010', '00100', '01010', '10001', '00000'], // ×
  // −。和加号同宽同高、横杠落在同一行，两个牌子叠着看时数字不会错行。
  ['00000', '00000', '00000', '11111', '00000', '00000', '00000'], // −
];

/**
 * 带前缀的字母。只烘拼得出 HP / MP / SPD / ATK 这四个牌子的那几个。
 *
 * 为什么要有：用一颗药飘出一个绿数字，玩家知道是好事却不知道好在哪儿 —— 回的是血还是蓝？
 * 那一张符加的是速度还是攻击？颜色只分得出"好事/坏事"，分不出是哪一项。
 *
 * 用拉丁字母而不是中文：这是一套 5×7 的位图字模，一个汉字在这个尺寸下只剩一团黑。
 */
const LETTER_ROWS: Record<string, readonly string[]> = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
};

/**
 * 汉字牌子的点阵，13×11。
 *
 * 不是手画的：用 SimHei 在 13 像素上栅格对齐地栅格化一次，把点阵拉回来写死在这儿。数字那十个字模是
 * 手画的（笔画粗细才均匀），而汉字手画不现实 —— “蓝”里的草字头加监，一笔一笔摆像素摆不出来。
 *
 * **13 是下限。** 11 像素下“蓝”和“速”已经糊成一团，试过。所以汉字牌子比旁边的数字高一截 ——
 * 这是点阵字的硬约束，不是排版失误。英文那一套（HP / MP / SPD / ATK）仍然是 5×7，和数字一般高。
 */
const CN_ROWS: Record<string, readonly string[]> = {
  '血': [
    '0000001000000',
    '0000001000000',
    '0001111111110',
    '0001001010010',
    '0001001010010',
    '0001001010010',
    '0001001010010',
    '0001001010010',
    '0001001010010',
    '0001001010010',
    '0011111111111',
  ],
  '蓝': [
    '0011111111111',
    '0000010001000',
    '0000000010000',
    '0001010010000',
    '0001010011111',
    '0001010100100',
    '0001010100100',
    '0001111111110',
    '0001001010010',
    '0001001010010',
    '0011111111111',
  ],
  '速': [
    '0011000010000',
    '0001111111111',
    '0000011111111',
    '0000010010001',
    '0011010010001',
    '0001011111111',
    '0001000110100',
    '0001001010010',
    '0001010010001',
    '0001100010000',
    '0010011111111',
  ],
  '攻': [
    '0000000010000',
    '0011111100000',
    '0000100111111',
    '0000100100010',
    '0000101100010',
    '0000100010100',
    '0000100010100',
    '0000111001100',
    '0011100001100',
    '0000000110110',
    '0000001000001',
  ],
};

const GLYPHS: readonly Glyph[] = DIGIT_ROWS.map(bake);
const SIGNS: readonly Glyph[] = SIGN_ROWS.map(bake);
const LETTERS = new Map<string, Glyph>(
  Object.entries(LETTER_ROWS).map(([key, rows]) => [key, bake(rows)]),
);
const CN_GLYPHS = new Map<string, Glyph>(
  Object.entries(CN_ROWS).map(([key, rows]) => [key, bake(rows)]),
);

/**
 * 牌子用哪一种文字。
 *
 * 现在整个游戏是中文的，所以默认中文。英文那一套字模是现成的 —— 以后接了语言开关，
 * 调一次 setDamageNumberLanguage('en') 就切过去了，不用动任何调用方。
 */
export type DamageNumberLanguage = 'zh' | 'en';
let language: DamageNumberLanguage = 'zh';
export function setDamageNumberLanguage(next: DamageNumberLanguage): void {
  language = next;
}

/** 四个牌子各自的中文字。 */
const CN_LABEL: Record<string, string> = { HP: '血', MP: '蓝', SPD: '速', ATK: '攻' };

/** 一个牌子拆成几个字模。中文一个字，英文两到三个字母。 */
function labelGlyphsOf(label: string): Glyph[] {
  if (language === 'zh') {
    const glyph = CN_GLYPHS.get(CN_LABEL[label] ?? '');
    return glyph ? [glyph] : [];
  }
  return [...label].map((ch) => LETTERS.get(ch)).filter((g): g is Glyph => !!g);
}

/** 可以挂在数字前面的牌子。只有这几个 —— 字模里只烘了拼得出它们的字母。 */
export type DamageNumberLabel = 'HP' | 'MP' | 'SPD' | 'ATK';

/** 数字前面挂什么。0 = 什么都不挂（打人那些数字本来就不带符号）。 */
export type DamageNumberSign = 'none' | 'plus' | 'times' | 'minus';
const SIGN_INDEX: Record<DamageNumberSign, number> = { none: -1, plus: 0, times: 1, minus: 2 };

/**
 * 池子容量。
 *
 * 一次回旋能同时杀上百人，但一百个数字同时飘在画面上已经读不成数字了 —— 它变成一片噪点。
 * 96 是"最狠的一下也基本全炸得出来"和"数字还是数字"之间的位置。满了直接丢新的，和碎片
 * 同一条策略：少一个数字没人数得出来。
 */
const CAPACITY = 96;

/** 活多久。够看清，又不至于上一轮还挂在天上时下一轮已经打出来了。 */
const LIFE = 0.78;
/** 到这个进度才开始化掉。一路变淡的数字有一半时间是看不清的。 */
const FADE_FROM = 0.55;

/** 往上飘多少个世界单位。人高 19，所以一次大约飘出半个身位。 */
const RISE = 11;
/** 左右各飘多少 —— 只为让同一堆里连着炸出来的几个数字不叠在一条竖线上。 */
const DRIFT = 4;

/**
 * 往击飞的反方向让开多少个世界单位。
 *
 * 人是从落点往外飞的，所以反方向那一侧**一定**是空出来的 —— 这不是赌一个方向，是跟着这一下
 * 自己的方向走。7 个单位约等于三分之一个身位：够把数字从飞行轨迹上挪开，又还贴着挨打的那
 * 个人，不至于读成旁边另一个人头上的数。
 */
const BACK_OFF = 7;

/**
 * 淡入多久，秒。
 *
 * 这是"压一点点时间"的柔和版：硬压 0.12 秒再瞬间亮起，数字自己会读成闪了一下；淡入则是
 * 那一段时间里画面上根本没有它，最爆的定格 + 起飞那几帧干干净净，等人飞开了字才浮出来。
 *
 * 淡入期间**位置不动**（见 draw 里的 riseT）：一边淡入一边上飘的话，字浮出来时已经飘到半空，
 * 和挨打的那个人对不上了。
 */
const FADE_IN = 0.13;

/** 头顶再往上一点点，别贴着头皮。头顶本身在 18.3（headZ 15.8 + headRadius 2.5）。 */
const HEAD_Z = 20.5;

/** 常规一下：上白下琥珀。竖直渐变是让点阵字读作"打出来的数字"而不是 UI 标签的关键一笔。 */
const TOP = rgb(255, 250, 232);
const BOTTOM = rgb(255, 186, 74);
/** 重击：同样的白起手，落到血橙。色相和常规那档拉得开，余光里就分得出轻重。 */
const CRIT_TOP = rgb(255, 252, 244);
const CRIT_BOTTOM = rgb(255, 96, 42);

/*
 * 回血、回蓝、上符各一套。上缘亮、下缘是色相 —— 这是这套数字一贯的画法：亮的那一头负责在
 * 人堆里被看见，色相那一头负责说明这是什么。
 *
 * **回血回蓝直接取血条和蓝条的颜色**（hudPlayerPanel.css 里那两条渐变：#e14e45→#9d1819 和
 * #278bf2→#1257b6）。先给过一版绿色的回血，错了：屏幕上没有任何别的东西是绿的，玩家看到一个
 * 绿数字只知道"是个好事"，不知道好在哪儿。而血条就在左上角一直亮着 —— 飘出来的数和那条槽
 * 同色，它说明什么就不用再猜了。
 *
 * 取的是两条渐变的**亮端**（#e14e45 / #278bf2），不是暗端。先按暗端试过一版，出图一看就废了：
 * 那一档深红压在人堆那种偏红的底色上几乎糊没，而血条本身是贴在左上角的深色槽里才读得出来，
 * 飘字没有那个槽。上缘再各自往白里提一档，于是这两个数在草地和人堆两种底上都跳得出来，色相
 * 仍然是血条蓝条那两个色。
 */
const HEAL_TOP = rgb(255, 236, 232);
const HEAL_BOTTOM = rgb(225, 78, 69);
const MANA_TOP = rgb(226, 241, 255);
const MANA_BOTTOM = rgb(39, 139, 242);
const BUFF_TOP = rgb(255, 250, 230);
const BUFF_BOTTOM = rgb(226, 170, 255);

/**
 * 砍在首领身上的那一档。
 *
 * 末波一刀下去几十个数字同时飘起来，首领那一串和杂兵长得一模一样就淡掉了 —— 而它恰好是玩家
 * 唯一真正要看的那一串（他要砍十来刀，得知道砍动了没有）。给一个全场没别人用的金色，字也大一截。
 */
const BOSS_TOP = rgb(255, 252, 222);
const BOSS_BOTTOM = rgb(255, 156, 30);

const STYLE_COLORS = [
  [TOP, BOTTOM],
  [CRIT_TOP, CRIT_BOTTOM],
  [HEAL_TOP, HEAL_BOTTOM],
  [MANA_TOP, MANA_BOTTOM],
  [BUFF_TOP, BUFF_BOTTOM],
  [BOSS_TOP, BOSS_BOTTOM],
] as const;

const STYLE_INDEX: Record<DamageNumberStyle, number> = {
  damage: 0, crit: 1, heal: 2, mana: 3, buff: 4, boss: 5,
};
/** 描边色。和 PixelSurface 那圈合成描边同一个色温，数字才像和画面烘在一起。 */
const EDGE = rgb(24, 18, 16);

/**
 * 数字压在场上所有东西之上，连降水也压过 —— 读数被谁挡住都等于没有，而人堆里随便一具站得
 * 更靠下的尸体、或者一场雨，都能把它吃掉。为什么是 DEPTH_OVERLAY 而不是随手一个大数，见
 * 那个常量自己的注释。
 */
const DEPTH_EDGE = Projector.DEPTH_OVERLAY + 20000;
const DEPTH_FILL = DEPTH_EDGE + 2;

/** 拆位用的暂存，最多六位。每帧几十个数字，不该为这个分配数组。 */
const digits = new Int32Array(6);

/**
 * 这个数是什么颜色的。
 *
 * 加进来是因为用药那一下也要飘一个数，而"回了三百八十四点血"和"打掉了三百八十四点血"读起来
 * 必须是两件事 —— 同一个橙色数字往头顶一飘，玩家第一反应是自己挨了一下。
 */
export type DamageNumberStyle = 'damage' | 'crit' | 'heal' | 'mana' | 'buff' | 'boss';

export interface DamageNumberOptions {
  crit?: boolean;
  /** 不给就按 crit 定（真 = crit，假 = damage）。 */
  style?: DamageNumberStyle;
  /** 这个人被掀飞的去向。数字往它的反方向让开一步，见 BACK_OFF。 */
  dirX?: number;
  dirY?: number;
  /** 从多高冒出来，世界单位。默认头顶。 */
  z?: number;
  /**
   * 数字前面挂一个符号。
   *
   * 打人那些数字不挂 —— 屏幕上飘的十有八九是伤害，给它加一个"−"只是给每一个数字都加一列
   * 噪点。挂符号的是那几种少见的：回血回蓝挂加号，百分比加成挂乘号。
   */
  sign?: DamageNumberSign;
  /** 数字前面再挂一个牌子，说明变的是哪一项。见 DamageNumberLabel。 */
  label?: DamageNumberLabel;
  /**
   * 跟着玩家走。
   *
   * 打人那些数字是**钉在落点上**的：那一下发生在那个地方，人走开了它也该留在原地。而回血
   * 回蓝是发生在**玩家身上**的，他一边跑一边回，数字钉在原地就成了掉在地上的一串数。
   *
   * 以后还会有持续回血、持续回蓝的药，那时候是每跳一次飘一个 —— 一串数字拖在身后的话，
   * 玩家根本分不清哪个是这一跳的。
   */
  follow?: boolean;
}

export class DamageNumbers {
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly z = new Float32Array(CAPACITY);
  private readonly drift = new Float32Array(CAPACITY);
  private readonly age = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly value = new Int32Array(CAPACITY);
  private readonly crit = new Uint8Array(CAPACITY);
  /** 1 = 跟着玩家走，x/y 每帧由锚点加下面那个偏移算出来。 */
  /** 数字前面那个牌子。null = 不挂。用数组而不是定长数组：一局里带牌子的不过几十个。 */
  private readonly label: (string | null)[] = new Array(CAPACITY).fill(null);
  private readonly follow = new Uint8Array(CAPACITY);
  /** 前缀符号的下标，255 = 不挂。用 Uint8 是为了和别的字段一样是定型数组。 */
  private readonly sign = new Uint8Array(CAPACITY);
  private readonly offX = new Float32Array(CAPACITY);
  private readonly offY = new Float32Array(CAPACITY);

  private count = 0;

  /** 场上还飘着几个。 */
  get alive(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  /**
   * 在 (x, y) 的头顶弹一个数字出来。
   *
   * @param options.crit      重击：字放大一倍、颜色更烫、活得久一点。
   * @param options.dirX/dirY 这个人被掀飞的去向（不用是单位向量，这里自己归一）。给了就往
   *                          它的反方向让开一步，把飞行轨迹让出来；不给就原地起。
   * @param options.z         从多高冒出来，世界单位。默认头顶。
   */
  spawn(x: number, y: number, value: number, options: DamageNumberOptions = {}): void {
    if (this.count >= CAPACITY) return;
    const i = this.count++;
    const crit = options.crit ?? false;
    // 反方向让开。方向是零向量（贴脸打的那种）时不让，随机漂移仍然会把它错开。
    const dx = options.dirX ?? 0;
    const dy = options.dirY ?? 0;
    const len = Math.hypot(dx, dy);
    this.x[i] = len > 1e-4 ? x - (dx / len) * BACK_OFF : x;
    this.y[i] = len > 1e-4 ? y - (dy / len) * BACK_OFF : y;
    // 回血回蓝那几种从更高一点冒出来：玩家自己身上一直有伤害数字在飘，同一个高度会混进去。
    const style = options.style ?? (crit ? 'crit' : 'damage');
    this.z[i] = options.z ?? (STYLE_INDEX[style] >= STYLE_INDEX.heal ? HEAD_Z + 6 : HEAD_Z);
    this.drift[i] = (Math.random() - 0.5) * 2 * DRIFT;
    this.age[i] = 0;
    this.life[i] = FADE_IN + LIFE * (crit ? 1.25 : 1) * (0.9 + Math.random() * 0.2);
    this.value[i] = Math.max(0, Math.round(value));
    this.crit[i] = STYLE_INDEX[style];
    const sign = SIGN_INDEX[options.sign ?? 'none'];
    this.sign[i] = sign < 0 ? 255 : sign;
    this.label[i] = options.label ?? null;
    this.follow[i] = options.follow ? 1 : 0;
    // 跟随的那些错开一点点再出来：同一刻回血又回蓝，两个数字叠在一起就只看得见一个。
    this.offX[i] = options.follow ? (Math.random() - 0.5) * 9 : 0;
    this.offY[i] = options.follow ? (Math.random() - 0.5) * 5 : 0;
  }

  /**
   * @param anchorX/anchorY 玩家这一帧在哪儿。带 follow 的数字每帧重新挂到他身上。
   */
  update(dt: number, anchorX = 0, anchorY = 0): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.swapRemove(i);
        continue;
      }
      if (this.follow[i]) {
        this.x[i] = anchorX + this.offX[i];
        this.y[i] = anchorY + this.offY[i];
      }
    }
  }

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.z[i] = this.z[last];
    this.drift[i] = this.drift[last];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.value[i] = this.value[last];
    this.crit[i] = this.crit[last];
    this.label[i] = this.label[last];
    this.follow[i] = this.follow[last];
    this.sign[i] = this.sign[last];
    this.offX[i] = this.offX[last];
    this.offY[i] = this.offY[last];
  }

  /**
   * @param camX/camY   镜头中心的世界地面坐标
   * @param rootX/rootY 那一点画在缓冲的哪个像素上
   * @param scale       每世界单位多少缓冲像素（grain）
   */
  draw(shapes: ShapeBatch, camX: number, camY: number, rootX: number, rootY: number, scale: number): void {
    // 一个字模像素占几个缓冲像素。**只取整数**，而且不跟着 grain 连续变：字模像素一旦落在
    // 半个缓冲像素上，最近邻放大就会把同样粗的笔画放成一粗一细。放到三倍颗粒度才跳一档。
    const base = Math.max(1, Math.min(4, Math.round(scale / 3)));

    for (let i = 0; i < this.count; i++) {
      const age = this.age[i];
      const life = this.life[i];
      const t = age / life;
      // 上飘从淡入结束才开始算 —— 淡入这一段人还在飞，数字定在原地浮出来。
      const riseT = clamp((age - FADE_IN) / Math.max(life - FADE_IN, 1e-4), 0, 1);
      // 起手窜得快、末尾几乎停住。匀速上升读作一个飘走的气球，而这一下是被打出来的。
      const ease = 1 - (1 - riseT) * (1 - riseT);
      const fadeIn = clamp(age / FADE_IN, 0, 1);
      const fadeOut = t < FADE_FROM ? 1 : 1 - (t - FADE_FROM) / (1 - FADE_FROM);
      const alpha = Math.round(255 * fadeIn * fadeOut);
      if (alpha <= 3) continue;

      const wx = this.x[i] + this.drift[i] * ease;
      const wz = this.z[i] + RISE * ease;
      /*
       * 字号分三档。
       *
       *   重击      两倍。全场最烫的那一下，本来就该压过别的一切。
       *   首领      1.8 倍。他要砍十来刀，而这一串是玩家判断"砍动了没有"的唯一依据。
       *   回血回蓝  1.6 倍。它一局只出现几十次，而且是**玩家自己按出来的** —— 他按下去那一刻
       *             正等着看发生了什么。和满地一样大的伤害数字混在一起就等于没飘。
       *   其余      一倍。
       */
      const style = this.crit[i];
      const px = base * (
        style === STYLE_INDEX.crit ? 2
          : style === STYLE_INDEX.boss ? 1.8
            : style >= STYLE_INDEX.heal ? 1.6 : 1);

      // 拆位。低位先出，画的时候倒着走。
      let v = this.value[i];
      let n = 0;
      do {
        digits[n++] = v % 10;
        v = Math.floor(v / 10);
      } while (v > 0 && n < digits.length);

      /*
       * 摆字：牌子 → 符号 → 数字（高位在前）。
       *
       * 符号和牌子都是这一串里的**字**，不是挂在外面的装饰 —— 所以它们和数字排在同一行上，
       * 按各自的宽度依次推过去。宽度不再统一：汉字牌子是 13×11，数字是 5×7。
       */
      const sign = this.sign[i] === 255 ? null : SIGNS[this.sign[i]];
      const label = this.label[i];
      const line: Glyph[] = label ? [...labelGlyphsOf(label)] : [];
      if (sign) line.push(sign);
      for (let d = n - 1; d >= 0; d--) line.push(GLYPHS[digits[d]]);
      if (line.length === 0) continue;

      // 高矮不一时**底对齐**：牌子比数字高一截，顶对齐的话数字会吊在半空中。
      let maxH = 0;
      let cells = 0;
      for (const g of line) {
        if (g.h > maxH) maxH = g.h;
        cells += g.w;
      }

      // 整串的左上角，**取整到缓冲像素**。这一步是像素感的全部：不取整的话每帧的亚像素
      // 位置都不同，笔画会在上升途中自己抖起来。
      const spanX = (cells + (line.length - 1) * GLYPH_GAP) * px;
      const sx = Math.round(rootX + (wx - camX) * scale - spanX * 0.5);
      const sy = Math.round(
        rootY + ((this.y[i] - camY) * Projection.groundSquash - wz * Projection.heightSquash) * scale - maxH * px,
      );

      const [top, bottom] = STYLE_COLORS[this.crit[i]] ?? STYLE_COLORS[0];
      const edge = rgba(EDGE.r, EDGE.g, EDGE.b, Math.round(alpha * 0.88));

      // 一行一个颜色：整串上白下暖，而不是每个字各渐变各的。渐变按整串的高度铺，
      // 所以矮一截的数字取的是渐变下半段 —— 它们本来就坐在下半段上。
      const rowTint: Rgba[] = [];
      for (let r = 0; r < maxH; r++) {
        const k = maxH > 1 ? r / (maxH - 1) : 0;
        rowTint.push(
          rgba(
            Math.round(top.r + (bottom.r - top.r) * k),
            Math.round(top.g + (bottom.g - top.g) * k),
            Math.round(top.b + (bottom.b - top.b) * k),
            alpha,
          ),
        );
      }

      let gx = sx;
      for (const glyph of line) {
        const drop = maxH - glyph.h;
        const gy = sy + drop * px;
        // 描边先铺，字身压上去。两者不重叠，所以整体化掉时接缝处不会叠深。
        for (const run of glyph.edge) this.blit(shapes, gx, gy, run, px, edge, DEPTH_EDGE);
        for (const run of glyph.fill) {
          this.blit(shapes, gx, gy, run, px, rowTint[drop + run.y] ?? rowTint[0], DEPTH_FILL);
        }
        gx += (glyph.w + GLYPH_GAP) * px;
      }
    }
  }

  /** 一条横条 —— 字模里一段连续的像素，画出来是一个轴对齐矩形。 */
  private blit(
    shapes: ShapeBatch,
    gx: number,
    gy: number,
    run: Run,
    px: number,
    color: Rgba,
    depth: number,
  ): void {
    const w = run.w * px;
    shapes.rect(v2(gx + run.x * px + w * 0.5, gy + run.y * px + px * 0.5), w, px, 0, color, depth);
  }
}
