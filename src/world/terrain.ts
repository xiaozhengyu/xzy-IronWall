import { clamp, lerp, v2 } from '../core/math';
import { type Rgba, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import { ShapeBatch } from '../render/shapeBatch';
import { type Weather, shadowed } from './weather';

/**
 * 野战场地面。移植自 overlord 的 TerrainScene。
 *
 * 一张粗网格上存四层权重（土、水、林、明暗），渲染时双线性插值取样，所以路沿、水岸和
 * 林地边缘都不会露出存它们的那张网格。取样点选中哪种材质、以及那种材质的哪一档色阶，
 * 都是**对有序阈值做硬切**而不是混合 —— 于是每条材质边界上是一条互相穿插的像素带，
 * 而不是一道渐变。这和人物身上"两个平涂值加一个硬边台阶"是同一条原则：台阶能在像素
 * 网格上活下来，渐变不能。
 *
 * 和 overlord 最大的一处不同是**地面被烘成一张纹理**，不是每帧重画。overlord 每帧往
 * 深度缓冲里灌三万多个地面色块，那条路在 WebGL 这边走不通（每帧重建 Graphics 几何）。
 * 好在地面是静态的：整片场地一次性算成一张 RGBA 像素图，之后每帧只是一个精灵。色块的
 * 大小换算成纹素，最近邻放大之后和逐块绘制的结果逐像素相同。
 */

// ---------------------------------------------------------------- 调色

/**
 * 每种材质三档色阶，由暗到亮 —— 这正是人物使用的语言（ShapeBatch.sphere 就是从同一个
 * 角落打光的三段色带）。用连续渐变铺的地面垫在他们下面会像另一种媒介；用三档台阶铺的
 * 地面读起来和他们是同一张画。
 */
const GRASS_RAMP: Rgba[] = [rgb(54, 82, 45), rgb(73, 103, 59), rgb(97, 131, 68)];
const DIRT_RAMP: Rgba[] = [rgb(99, 84, 56), rgb(126, 106, 72), rgb(152, 132, 96)];
const FOREST_RAMP: Rgba[] = [rgb(33, 56, 37), rgb(45, 74, 47), rgb(61, 94, 58)];
/** 暗的一端是池心的深水，不是阴影 —— 水靠深度读，不靠光。 */
const WATER_RAMP: Rgba[] = [rgb(42, 70, 84), rgb(56, 88, 92), rgb(76, 108, 101)];

const TUFT_LIGHT = rgb(116, 152, 78);
const TUFT_BASE = rgb(44, 66, 39);
const STONE_SHADE = rgb(96, 95, 90);
const STONE_LIGHT = rgb(140, 138, 130);

/** 吹积起来的雪比躺着的雪亮，水洼比湿地面暗。 */
const SNOW_DRIFT: Rgba[] = [rgb(214, 222, 230), rgb(232, 238, 244), rgb(246, 250, 254)];
const PUDDLE_INK = rgb(52, 70, 82);
const PUDDLE_RIM = rgb(88, 104, 108);


/**
 * 树种。每种是一套叶色（深/中/亮）、一套树皮色、一个树冠剖面和几个比例。
 *
 * 混种是林子看起来像林子的关键。一片全是同一棵树的森林读作图案，而不是植被 —— 眼睛
 * 立刻会发现那是复制粘贴。三四种颜色和轮廓都不同的树混在一起，同样的密度就读作树林。
 */
interface TreeSpecies {
  dark: Rgba;
  mid: Rgba;
  light: Rgba;
  /** 冬色。混向白会得到灰绿，看着像病了；两个手挑的调色板之间没有难看的中点。 */
  winterDark: Rgba;
  winterMid: Rgba;
  winterLight: Rgba;
  bark: Rgba;
  barkLit: Rgba;
  /** 树冠剖面：每段是 (相对高度, 宽度系数, 横向偏移)。 */
  crown: [number, number, number][];
  /** 树冠最宽处相对树高。 */
  width: number;
  /** 树干占树高的比例。桦木大半是杆，杉木几乎没有杆。 */
  trunk: number;
  /** 树高倍率。 */
  scale: number;
}

/** 阔叶：直立的冠，最常见的一种。 */
const UPRIGHT_CROWN: [number, number, number][] = [
  [1.0, 0.26, 0.12],
  [0.8, 0.66, 0.14],
  [0.58, 0.8, 0.02],
  [0.34, 0.68, -0.06],
  [0.12, 0.84, 0.0],
  [0.0, 0.46, -0.04],
];

/** 橡树：更团、更沉的冠，顶上偏向一侧。 */
const LUMPY_CROWN: [number, number, number][] = [
  [1.0, 0.2, -0.05],
  [0.84, 0.58, 0.06],
  [0.62, 0.92, -0.04],
  [0.4, 0.76, 0.1],
  [0.18, 0.95, -0.02],
  [0.0, 0.52, 0.04],
];

/**
 * 杉木：一圈圈向上收窄的裙摆。它不需要任何特殊分支 —— 所谓塔形就是一条锯齿形的宽度
 * 剖面，每一层比下一层窄、并且盖住下一层的肩。这一点在加第六种图元之前值得先确认。
 */
const CONIFER_TIERS: [number, number, number][] = [
  [1.0, 0.06, 0],
  [0.77, 0.32, 0],
  [0.75, 0.16, 0],
  [0.53, 0.46, 0],
  [0.51, 0.26, 0],
  [0.29, 0.6, 0],
  [0.27, 0.36, 0],
  [0.05, 0.74, 0],
  [0.0, 0.62, 0],
];

const SPECIES: TreeSpecies[] = [
  // 阔叶
  {
    dark: rgb(28, 52, 32), mid: rgb(48, 80, 44), light: rgb(76, 114, 58),
    winterDark: rgb(40, 54, 52), winterMid: rgb(78, 94, 92), winterLight: rgb(158, 168, 168),
    bark: rgb(56, 44, 33), barkLit: rgb(84, 66, 46),
    crown: UPRIGHT_CROWN, width: 0.68, trunk: 0.46, scale: 1,
  },
  // 橡树：矮而宽
  {
    dark: rgb(28, 52, 32), mid: rgb(48, 80, 44), light: rgb(76, 114, 58),
    winterDark: rgb(40, 54, 52), winterMid: rgb(78, 94, 92), winterLight: rgb(158, 168, 168),
    bark: rgb(56, 44, 33), barkLit: rgb(84, 66, 46),
    crown: LUMPY_CROWN, width: 0.84, trunk: 0.38, scale: 0.95,
  },
  // 秋橡：一片林子里几棵变色的树，比什么都更能说明这是植被不是图案
  {
    dark: rgb(58, 42, 27), mid: rgb(92, 69, 37), light: rgb(128, 100, 52),
    winterDark: rgb(54, 48, 42), winterMid: rgb(94, 86, 74), winterLight: rgb(160, 154, 142),
    bark: rgb(56, 44, 33), barkLit: rgb(84, 66, 46),
    crown: LUMPY_CROWN, width: 0.84, trunk: 0.38, scale: 0.95,
  },
  // 杉木：塔形，最高
  {
    dark: rgb(22, 44, 36), mid: rgb(36, 64, 46), light: rgb(56, 92, 58),
    winterDark: rgb(28, 42, 46), winterMid: rgb(56, 74, 76), winterLight: rgb(142, 156, 160),
    bark: rgb(56, 44, 33), barkLit: rgb(84, 66, 46),
    crown: CONIFER_TIERS, width: 0.62, trunk: 0.2, scale: 1.15,
  },
  // 桦木：细高，浅色树干 —— 深色林子里那几道白杆是最跳的东西
  {
    dark: rgb(44, 68, 40), mid: rgb(72, 102, 50), light: rgb(108, 140, 66),
    winterDark: rgb(46, 58, 54), winterMid: rgb(84, 98, 90), winterLight: rgb(160, 168, 160),
    bark: rgb(118, 116, 106), barkLit: rgb(154, 152, 140),
    crown: UPRIGHT_CROWN, width: 0.44, trunk: 0.62, scale: 0.9,
  },
];

/** 灌木。长在林子边缘 —— 一排树干硬碰开阔草地读作一堵墙，边上的杂木丛才让它成为林缘。 */
const SCRUB_DARK = rgb(36, 62, 38);
const SCRUB_MID = rgb(56, 88, 50);
const SCRUB_LIGHT = rgb(84, 118, 62);
const SCRUB_WINTER = rgb(84, 98, 92);

/** 岩石三套色，一冷一暖一偏蓝。 */
const ROCK: [Rgba, Rgba, Rgba][] = [
  [rgb(64, 66, 66), rgb(102, 103, 100), rgb(146, 145, 138)],
  [rgb(72, 64, 58), rgb(112, 101, 90), rgb(156, 143, 126)],
  [rgb(58, 62, 70), rgb(92, 97, 108), rgb(132, 138, 150)],
];

/** 倒木。 */
const TIMBER_DARK = rgb(74, 58, 42);
const TIMBER_MID = rgb(104, 84, 60);
const TIMBER_LIGHT = rgb(132, 112, 84);

/**
 * 有序的 4x4 阈值矩阵。按**色块索引**取值而不是按屏幕像素，所以图案锚在地面上，
 * 镜头平移时它不会跟着爬。
 */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// ---------------------------------------------------------------- 尺度
//
// 全部以世界单位计，而一个人是 19 个单位高 —— 所有这些数字都该按"这相当于几个人"来读。

/**
 * 一块地面色块的边长。
 *
 * 5 的时候一块色块有十五个缓冲像素宽，而人才三十七像素高 —— 明暗一跳，整片地读成棋盘格
 * 而不是地面。地面是烘进纹理的，调细几乎不要钱（只有一次烘焙的开销），所以取 3。
 */
const PATCH = 3;

/**
 * 明暗成团的两个八度，世界单位。粗的大约是一个半人高的斑，中的约一人高。
 *
 * 中间那层不能小于色块的三四倍，否则相邻色块之间就在跳档，成团会退化成逐块的噪点 ——
 * 那正是"地面看着像棋盘格"的来源，而不是色块本身太大。
 */
const GRAIN_COARSE = 30;
const GRAIN_MID = 14;
const GRAIN_FINE = 5;

/**
 * 地面上那些"躺着的东西"的散布间距。比 overlord 稀（那边是 17 和 8.5）：那边每帧能画
 * 三万个图元，这边一整个人才六十几个，草丛必须省着放。
 */
const DETAIL_SPACING = 14;

/**
 * 树的间距。比细节格宽得多，因为树是地标不是纹理：林子要密到能挡住视线，又要疏到能看见
 * 里面站着的人。
 */
const TREE_SPACING = 38;
type TreePlacement = Readonly<{ x: number; y: number; roll: number; species: TreeSpecies }>;

/**
 * 其余散布物的间距，全部按 overlord 的取值。
 *
 * 三个数字说的是三件不同的事：灌木密（13）是纹理，石头疏（80）是地标 —— 一队人穿过场地
 * 会经过两三块，够告诉你走到哪儿了又不至于把地堵满；倒木更疏（62）因为它是唯一躺平的
 * 东西，多了就成了满地木条。
 */
const BUSH_SPACING = 13;
const BOULDER_SPACING = 80;
const LOG_SPACING = 62;
const TREE_HEIGHT = 30;
/** 树干挡路的半径。人能走进树冠下面，但撞得到树干。 */
const TRUNK_RADIUS = TREE_HEIGHT * 0.075;

/**
 * 四边树墙的厚度，占场地短边的比例。
 *
 * 从 7% 提到 11%。7% 的问题不在于薄，在于**它比玩家能贴到的距离还薄**：走位边界只在
 * 场边留了十二个单位，人一贴到边上，身后那点树全在他脚下，画面外缘直接是空的 —— 一堵
 * 硬边，而不是一片望不到头的林子。现在走位边界退到 EDGE_MARGIN（六十几个单位），树墙
 * 得比它厚出一截，人贴到底的时候身后才还剩一层树。
 *
 * 上限仍然卡在"边界是个框，不是地图本身"：11% 四条边吃掉每根轴的 22%，中间还剩九百多个
 * 单位、四十多个人宽的空场。第一版试过的 14% 就是从这条线上翻过去的。
 */
const BORDER_FRACTION = 0.11;

/**
 * 一张图上"人为摆过"的那几处东西：场院、水塘、往场内探的林子，加上四边树墙有多厚。
 *
 * 单独拿出来是为了让"加一张地图"不只是换一个随机种子。种子只改噪声 —— 明暗成团、边界毛糙、
 * 树的抖动 —— 换个种子的地图**布局是一模一样的**：同一处左上角的场院、同一片右下角的水塘。
 * 玩家一眼就认出那是同一块地换了个名字。真正让两张图不一样的是这几块东西摆在哪儿、有多大，
 * 以及边上那圈林子有多厚（它决定这张图是开阔还是逼仄）。
 *
 * 位置和尺寸一律写成**场地的比例**，不是世界单位：这样同一份布局套在 1200 见方和 1600 见方
 * 的地上都还是同一张图的样子，而不是一张被裁掉一半的图。圆角半径是例外，它是世界单位 ——
 * 那是一条边有多圆，和场地多大无关。
 */
export interface TerrainLayout {
  /** 土地：场院、踩出来的路口。圆角矩形，因为有直边的地读作**人为的**。 */
  dirt: { x: number; y: number; hw: number; hh: number; r: number }[];
  /** 水塘。空数组就是这张图上没有水。每一处自带一圈岸（自动加宽出来的一层土）。 */
  ponds: { x: number; y: number; hw: number; hh: number; r: number }[];
  /** 往场内探的林子。它们的作用是把树墙的内缘啃出缺口，别摆太大。 */
  groves: { x: number; y: number; r: number }[];
  /** 四边树墙的厚度，占场地短边的比例。见 BORDER_FRACTION。 */
  border: number;
}

/** 演武荒原那一份 —— 也就是接这个结构之前写死在 generate 里的那几个数。 */
export const DEFAULT_LAYOUT: TerrainLayout = {
  dirt: [
    // 左上角一块场院
    { x: 0.24, y: 0.24, hw: 0.15, hh: 0.11, r: 46 },
    // 正中间一小块，给开阔地一个落脚点
    { x: 0.5, y: 0.5, hw: 0.07, hh: 0.05, r: 26 },
  ],
  // 右下角的池塘。
  ponds: [{ x: 0.74, y: 0.72, hw: 0.13, hh: 0.1, r: 52 }],
  groves: [
    { x: 0.12, y: 0.7, r: 0.115 },
    { x: 0.86, y: 0.28, r: 0.1 },
  ],
  border: BORDER_FRACTION,
};

/** 材质边界切得多陡。存的场是按整片地图的比例羽化的，这个值把过渡带压到几个色块宽。 */
const EDGE_HARDNESS = 5.5;

/** 积雪和水洼切得多陡。比材质边界硬得多，因为它们被切的那个场本身平滑得多。 */
const PATCH_HARDNESS = 11;

/**
 * 一片积雪或者一洼水会聚在哪儿。跟着地图一次生成，所以它们属于这块地，不会随天气来回跳。
 * 雪堆是方的、水不是：雪靠着东西堆起来，而一洼水没有角。
 */
interface WeatherPatch {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  cos: number;
  sin: number;
  boxy: boolean;
}

/** 采样结果。复用同一个对象：地面烘焙要跑十几万次，每次分配一个对象是不必要的垃圾。 */
interface Material {
  dirt: number;
  water: number;
  forest: number;
  shade: number;
}

export interface BakedGround {
  /** RGBA 像素，一个纹素就是一块地面色块。 */
  data: Uint8Array;
  texWidth: number;
  texHeight: number;
}

export class Terrain {
  readonly width: number;
  readonly height: number;

  private readonly cols: number;
  private readonly rows: number;
  private readonly cellSize: number;
  private readonly seed: number;
  private readonly layout: TerrainLayout;

  private readonly dirt: Float32Array;
  private readonly water: Float32Array;
  private readonly forest: Float32Array;
  private readonly shade: Float32Array;
  /** 静态地形每格只计算一次树木（空格也缓存），绘制和碰撞共用。 */
  private readonly treeCells: (TreePlacement | null | undefined)[] = [];
  private readonly treeCols: number;
  private readonly treeRows: number;

  private readonly scratch: Material = { dirt: 0, water: 0, forest: 0, shade: 0 };

  private readonly drifts: WeatherPatch[] = [];
  private readonly puddles: WeatherPatch[] = [];

  /**
   * @param width/height 场地尺寸，世界单位。横向矩形就是 width > height。
   * @param layout       这张图上摆了什么（场院、水塘、林子、树墙厚度）。种子只改噪声，
   *                     布局才是让两张图长得不一样的东西 —— 见 TerrainLayout。
   * @param cellSize     材质网格的格子边长。格子是正方的，所以矩形场地上的水塘和林地
   *                     不会被拉长 —— 这是把网格按比例分成固定列数最容易踩的坑。
   */
  constructor(width: number, height: number, seed = 1337, layout: TerrainLayout = DEFAULT_LAYOUT, cellSize = 24) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.layout = layout;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.seed = seed;
    this.treeCols = Math.ceil(width / TREE_SPACING);
    this.treeRows = Math.ceil(height / TREE_SPACING);

    const n = (this.cols + 1) * (this.rows + 1);
    this.dirt = new Float32Array(n);
    this.water = new Float32Array(n);
    this.forest = new Float32Array(n);
    this.shade = new Float32Array(n);

    this.generate();
    this.placeWeatherPatches();
  }

  /**
   * 四边树墙的厚度，世界单位。
   *
   * 走位边界要按它退让 —— 这两个数必须一起看，所以把它露出来，而不是让 Field 自己
   * 再拍一个百分比。
   */
  get borderWidth(): number {
    return Math.min(this.width, this.height) * this.layout.border;
  }

  private index(x: number, y: number): number {
    return y * (this.cols + 1) + x;
  }

  /**
   * 挑出积雪堆和水洼的位置。跟着地图一次生成，所以它们属于这块地 —— 雪化了再下，还是
   * 堆在同样的地方，那才像地形而不像每次重掷的随机噪声。
   */
  private placeWeatherPatches(): void {
    const make = (count: number, boxy: boolean, out: WeatherPatch[], salt: number): void => {
      for (let i = 0; i < count; i++) {
        const cx = this.hash01(i * 7 + salt, salt) * this.width;
        const cy = this.hash01(salt, i * 11 + salt) * this.height;
        // 已经是水面的地方不用再积水。
        if (this.sample(cx, cy).water > 0.4) continue;
        const r = 60 + this.hash01(i + salt, i - salt) * 130;
        const squash = 0.5 + this.hash01(i * 3 + salt, i * 5) * 0.7;
        const angle = this.hash01(i * 13, i * 17 + salt) * Math.PI;
        out.push({ cx, cy, rx: r, ry: r * squash, cos: Math.cos(angle), sin: Math.sin(angle), boxy });
      }
    };
    make(26, true, this.drifts, 4211);
    make(30, false, this.puddles, 8663);
  }

  /**
   * 一个点在这组斑块里陷得多深，-1..1（正数在里面）。grow 让斑块从自己的中心长出来，
   * 于是积雪是铺开的，而不是整片一起淡入。
   */
  private coverage(set: WeatherPatch[], worldX: number, worldY: number, grow: number): number {
    let best = -1;
    for (const p of set) {
      const dx = worldX - p.cx;
      const dy = worldY - p.cy;

      // 先用一个轴对齐包围盒挡掉绝大多数。取两个半径里大的那个，对任何旋转角都是安全
      // 的上界。少了这一步，每个纹素都要和全部斑块算一遍旋转和开方 —— 三十万纹素乘三十
      // 个水洼是九百万次，整片重烘要一百五十毫秒，摊到八帧仍然是每帧一整个预算。
      const reach = (p.rx > p.ry ? p.rx : p.ry) * grow;
      if (dx < -reach || dx > reach || dy < -reach || dy > reach) continue;

      const lx = (dx * p.cos + dy * p.sin) / Math.max(p.rx * grow, 1);
      const ly = (-dx * p.sin + dy * p.cos) / Math.max(p.ry * grow, 1);
      // 方的用切比雪夫距离，圆的用欧氏距离。
      const d = p.boxy ? Math.max(Math.abs(lx), Math.abs(ly)) : Math.hypot(lx, ly);
      const inside = 1 - d;
      if (inside > best) best = inside;
      if (best > 0.6) break;
    }
    return clamp(best, -1, 1);
  }

  /**
   * 只在边界附近用世界锚定的噪声把轮廓推进推出。
   *
   * "注意边缘"就是一片积雪和一张贴纸的全部差别。从草地上干净切出来的椭圆是有人画的形状；
   * 同一个椭圆的轮廓被推进推出几个百分点，才是雪碰巧停在那儿的地方。噪声只在离边界五分之
   * 一半径以内求值 —— 别处答案不可能变，而那是绝大多数的点。
   */
  private ragged(inside: number, worldX: number, worldY: number, salt: number): number {
    if (inside < -0.36 || inside > 0.36) return inside;
    return (
      inside +
      (this.octave(worldX, worldY, 34, salt) - 0.5) * 0.24 +
      (this.octave(worldX, worldY, 13, salt + 71) - 0.5) * 0.11
    );
  }

  /**
   * 靴子能踩起水花的水：浅水塘，加上雨积出来的临时水洼。脚步特效用它决定是溅水还是留印。
   */
  standingWater(worldX: number, worldY: number, weather: Weather): number {
    const water = this.sample(worldX, worldY).water;
    if (weather.wetness <= 0.05) return water;
    const inside = this.coverage(this.puddles, worldX, worldY, 0.4 + weather.wetness * 0.75);
    const puddle = clamp((inside + 0.08) * 5, 0, 1) * weather.wetness;
    return Math.max(water, puddle);
  }

  // ---------------------------------------------------------------- 生成

  /**
   * 铺一块方场：四边围一圈树墙当边界，左上一块土场院、右下一个池塘、正中一小块空地。
   *
   * 全部用世界单位定位和量尺寸，不用归一化坐标。归一化在正方形上碰巧没问题，但一旦有人
   * 把场地改成矩形，同一个"半径 0.1"在两个轴上就是不同的距离，池塘会被拉成椭圆 ——
   * 那种走形很难看出来是坐标系的问题，所以从一开始就不给它机会。
   */
  private generate(): void {
    const w = this.width;
    const h = this.height;

    // 圆角矩形，全部按场地比例摆位、按世界单位量尺寸。布局从 TerrainLayout 来。
    //
    // 用圆角矩形而不是圆斑：一块有直边的地读作**人为的**（踩出来的场院、挖出来的池子），
    // 而椭圆读作自然形成的。两者都对，但一张全是椭圆的图会显得没有人待过。
    const dirtPatches = this.layout.dirt.map((d) => ({
      x: w * d.x, y: h * d.y, hw: w * d.hw, hh: h * d.hh, r: d.r,
    }));
    // 池塘，每一处连着一圈岸。
    const ponds = this.layout.ponds.map((p) => ({
      x: w * p.x, y: h * p.y, hw: w * p.hw, hh: h * p.hh, r: p.r,
    }));

    /**
     * 四边的树墙。
     *
     * 场地是有边界的，而一条看不见的墙是最糟糕的边界 —— 人贴上去停住，画面里却什么都没有。
     * 沿四边铺一圈密林，边界就变成了**看得见的东西**：走不过去，因为那是林子。
     *
     * 这一圈是纯林地权重，不参与"中间留出开阔地"的削减 —— 它就是要密到底。
     *
     * 厚度见 BORDER_FRACTION。它和 Field.edgeMargin（走位边界）是一对：树墙必须比人能走到
     * 的地方更靠外，人贴到边上时身后才还有树。
     */
    const border = this.borderWidth;

    for (let gy = 0; gy <= this.rows; gy++) {
      const wy = gy * this.cellSize;
      for (let gx = 0; gx <= this.cols; gx++) {
        const wx = gx * this.cellSize;
        const edgeNoise = this.continuousNoise(wx / w, wy / h) * 4;

        // 水：圆角矩形的池子，多处取最深的那一处。
        let water = 0;
        let banked = 0;
        for (const pond of ponds) {
          water = Math.max(
            water,
            roundedRect(wx + edgeNoise, wy + edgeNoise * 0.7, pond.x, pond.y, pond.hw, pond.hh, pond.r, 26),
          );
          // 岸：同一个形状放大一圈，减掉水面本身。
          banked = Math.max(
            banked,
            roundedRect(wx + edgeNoise, wy + edgeNoise * 0.7, pond.x, pond.y, pond.hw + 34, pond.hh + 30, pond.r + 20, 30),
          );
        }
        const bank = clamp(banked - water, 0, 1);

        let dirt = 0;
        for (const d of dirtPatches) {
          dirt = Math.max(dirt, roundedRect(wx + edgeNoise, wy + edgeNoise, d.x, d.y, d.hw, d.hh, d.r, 24));
        }
        dirt = Math.max(dirt, bank * 0.8);
        dirt *= 1 - water;

        // 林地：四边的树墙，加上角上几处往里探的林子。
        const toEdge = Math.min(wx, wy, w - wx, h - wy) + edgeNoise * 2.5;
        let forest = clamp((border - toEdge) / Math.max(border * 0.55, 1), 0, 1);
        forest = forest * forest * (3 - 2 * forest);

        // 往场内探的几片，让树墙的内缘不是一条直线。刻意小 —— 它们是把边界啃出缺口的，
        // 不是另外的林子。
        for (const f of this.layout.groves) {
          const fx = w * f.x;
          const fy = h * f.y;
          const fr = w * f.r;
          forest = Math.max(forest, this.irregularBlob(wx, wy, fx, fy, fr, fr * 0.9, fx * 0.01));
        }

        forest *= 1 - dirt * 0.9;
        forest *= 1 - water;

        const i = this.index(gx, gy);
        this.water[i] = clamp(water, 0, 1);
        this.forest[i] = clamp(forest, 0, 1);
        this.dirt[i] = clamp(dirt, 0, 1);
        this.shade[i] = this.continuousNoise(wx / w, wy / h);
      }
    }
  }

  private continuousNoise(x: number, y: number): number {
    return (
      Math.sin(x * 18.7 + y * 7.3 + this.seed * 0.011) * 0.55 +
      Math.sin(x * 6.1 - y * 15.9 + this.seed * 0.023) * 0.25 +
      Math.sin(x * 31.3 + y * 27.1 - this.seed * 0.007) * 0.2
    );
  }

  /** 把一个规则的椭圆按位置扭一下，边缘才不像是用圆规画的。 */
  private irregularBlob(x: number, y: number, cx: number, cy: number, rx: number, ry: number, phase: number): number {
    const warpX = Math.sin((y / this.height) * 31 + phase + this.seed * 0.003) * rx * 0.1;
    const warpY = Math.sin((x / this.width) * 27 - phase + this.seed * 0.004) * ry * 0.1;
    return blob(x + warpX, y + warpY, cx, cy, rx, ry, 0.24);
  }

  // ---------------------------------------------------------------- 取样

  /** 四层一次取完。烘焙每个色块调一次，代价在格子定位上而不是四次插值上。 */
  sample(worldX: number, worldY: number, out: Material = this.scratch): Material {
    const gx = clamp(worldX / this.cellSize, 0, this.cols);
    const gy = clamp(worldY / this.cellSize, 0, this.rows);
    const x0 = Math.min(gx | 0, this.cols - 1);
    const y0 = Math.min(gy | 0, this.rows - 1);
    const tx = gx - x0;
    const ty = gy - y0;

    const a = this.index(x0, y0);
    const b = a + 1;
    const c = this.index(x0, y0 + 1);
    const d = c + 1;

    out.dirt = bilerp(this.dirt, a, b, c, d, tx, ty);
    out.water = bilerp(this.water, a, b, c, d, tx, ty);
    out.forest = bilerp(this.forest, a, b, c, d, tx, ty);
    out.shade = bilerp(this.shade, a, b, c, d, tx, ty);
    return out;
  }

  /** 把一个点拉回场内。 */
  clampToField(x: number, y: number, inset = 0): { x: number; y: number } {
    return {
      x: clamp(x, inset, this.width - inset),
      y: clamp(y, inset, this.height - inset),
    };
  }

  // ---------------------------------------------------------------- 烘焙地面

  /**
   * 把整片场地算成一张 RGBA 图，一个纹素等于一块地面色块。
   *
   * 纹素在**屏幕上**是方的：横向一格 PATCH 个世界单位，纵向一格 PATCH / groundSquash 个
   * ——地面被相机压扁了，所以世界里更高的一块投影下来才是正方形。
   */
  get texWidth(): number {
    return Math.max(1, Math.round(this.width / PATCH));
  }
  get texHeight(): number {
    return Math.max(1, Math.round((this.height * Projection.groundSquash) / PATCH));
  }

  /**
   * 把场地的一段行区间算进给定的 RGBA 缓冲。分段是为了能把重烘摊到几帧里 —— 天气一变
   * 整片地都要重算，一次算完是三十毫秒的卡顿，摊开就看不出来。
   *
   * 云影**不**烘进去：它连续飘动，烘进来就得每帧重烘整张图。它是一个单独的叠加层。
   */
  bakeRows(data: Uint8Array, weather: Weather | null, fromRow: number, toRow: number): void {
    const texWidth = this.texWidth;
    const texHeight = this.texHeight;
    const patchW = this.width / texWidth;
    const patchH = this.height / texHeight;
    const m = this.scratch;

    const y1 = Math.min(toRow, texHeight);
    for (let py = Math.max(0, fromRow); py < y1; py++) {
      const wy = (py + 0.5) * patchH;
      for (let px = 0; px < texWidth; px++) {
        const wx = (px + 0.5) * patchW;
        const c = this.patchColor(wx, wy, px, py, m, weather);
        const o = (py * texWidth + px) * 4;
        data[o] = c.r;
        data[o + 1] = c.g;
        data[o + 2] = c.b;
        data[o + 3] = 255;
      }
    }
  }

  /** 一次烘完整片。启动时用；运行中改天气走 bakeRows 分段。 */
  bakeGround(weather: Weather | null = null): BakedGround {
    const texWidth = this.texWidth;
    const texHeight = this.texHeight;
    const data = new Uint8Array(texWidth * texHeight * 4);
    this.bakeRows(data, weather, 0, texHeight);
    return { data, texWidth, texHeight };
  }

  /**
   * 一块地面：哪种材质，以及那种材质的哪一档色阶。
   *
   * 两个选择都是对有序阈值做硬切，不是混合 —— 于是每条材质边界上是一条互相穿插的像素带
   * 而不是一道渐变。纯 Bayer 是最忠实的做法，但它 4x4 的点阵一旦过渡带宽过几个色块就会
   * 读成印刷网点；掺进世界锚定的噪声换来一条毛糙的边。Bayer 那一半留在色块索引上（穿插
   * 是屏幕空间的活儿，必须在相邻块之间变化），噪声那一半锚在世界上（一段边界的毛糙程度
   * 属于那块地，不属于镜头）。
   */
  private patchColor(worldX: number, worldY: number, px: number, py: number, m: Material, weather: Weather | null): Rgba {
    this.sample(worldX, worldY, m);

    const cut = dither(px, py) * 0.62 + this.octave(worldX, worldY, GRAIN_FINE, 7717) * 0.38;

    let ramp = GRASS_RAMP;
    if (steepen(m.forest, EDGE_HARDNESS) > cut) ramp = FOREST_RAMP;
    if (steepen(m.dirt * (1 - m.forest * 0.45), EDGE_HARDNESS) > cut) ramp = DIRT_RAMP;
    if (steepen(m.water, EDGE_HARDNESS) > cut) ramp = WATER_RAMP;

    let tone: number;
    if (ramp === WATER_RAMP) {
      // 深度，不是光照：池心是色阶暗的那一端。
      tone = clamp(1.08 - m.water, 0, 1);
    } else {
      tone = clamp(0.5 + m.shade * 0.22 + this.clumps(worldX, worldY) * 0.44, 0, 1);
    }

    // 色阶那一步是硬切，不抖动。抖动该花在材质边界上 —— 两块平涂需要在几个像素里互相
    // 穿插；铺满整个表面就是在每一对色阶之间放一层棋盘格，地面会变成一片雪花。纹理靠
    // 上面的成团噪声来给。
    const step = quantize(tone, ramp.length);
    if (!weather) return ramp[step];

    // 开阔水面不积雪。它只在边缘结冰，那一点点 exposure 就是干这个的；一片和田野一样
    // 上白的水塘是地图上一个白窟窿。
    const exposure = ramp === WATER_RAMP ? 0.18 : 1;
    let c = weather.grade(ramp[step], exposure);

    // 积雪堆和水洼：天气**聚集**起来的地方，不只是给地面换个色。用和材质同一个抖动阈值
    // 切边，所以它们的边缘由同样互相穿插的像素构成，读作地面的一部分而不是铺在上面的贴图。
    if (ramp !== WATER_RAMP) {
      if (weather.snowCover > 0.02 && this.drifts.length > 0) {
        const inside = this.coverage(this.drifts, worldX, worldY, 0.42 + weather.snowCover * 0.72);
        if (steepen(0.5 + this.ragged(inside, worldX, worldY, 6113) * 1.4, PATCH_HARDNESS) > cut) {
          c = SNOW_DRIFT[quantize(tone, SNOW_DRIFT.length)];
        }
      } else if (weather.wetness > 0.05 && this.puddles.length > 0) {
        const inside = this.coverage(this.puddles, worldX, worldY, 0.4 + weather.wetness * 0.75);
        const pool = this.ragged(inside, worldX, worldY, 20347);
        // 边缘亮一档，这是唯一能让一洼水不读作地上一个洞的东西。
        if (steepen(0.5 + pool * 1.4, PATCH_HARDNESS) > cut) {
          c = steepen(0.5 + (pool - 0.09) * 1.4, PATCH_HARDNESS) > cut ? PUDDLE_INK : PUDDLE_RIM;
        }
      }
    }

    return c;
  }

  /**
   * 成团的明暗噪声，世界锚定。两个八度：粗的那层给大块的明暗，中间那层打散它。
   * 掉一个八度时喂它的均值而不是重新归一化 —— 归一化会把和分布从钟形拉回近似均匀，
   * 再被后面的拉伸推向两端，远看就是一片吵闹的花斑。
   */
  private clumps(worldX: number, worldY: number): number {
    let v = this.octave(worldX, worldY, GRAIN_COARSE, 9173) * 0.58;
    v += this.octave(worldX, worldY, GRAIN_MID, 517) * 0.42;
    return clamp((v - 0.5) * 2.9, -1, 1);
  }

  /**
   * 平滑插值的值噪声，不是对格子做哈希。
   *
   * 分块的版本会闪：一块色块只取一个点，色调随后被硬量化，于是取样点越过格子边界的
   * 瞬间整块会跳一整档。插值之后小移动只带来小变化，量化器把它吞掉，只在真正的边界
   * 附近才留下变化。
   */
  private octave(worldX: number, worldY: number, size: number, salt: number): number {
    const fx = worldX / size;
    const fy = worldY / size;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);

    let tx = fx - x0;
    let ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);

    const a = this.hash01(x0 + salt, y0 - salt);
    const b = this.hash01(x0 + 1 + salt, y0 - salt);
    const c = this.hash01(x0 + salt, y0 + 1 - salt);
    const d = this.hash01(x0 + 1 + salt, y0 + 1 - salt);

    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }

  /** 确定性的哈希：不用存表，而且永远不会跟着镜头滚动。 */
  private hash01(x: number, y: number): number {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(this.seed, 1013904223)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) & 0xffffff) / 0x1000000;
  }

  // ---------------------------------------------------------------- 每帧画的东西

  /**
   * 躺在地上的细节：草丛、石子、落叶。
   *
   * 按一个抖动过的格子散布，占据概率跟着粗噪声走 —— 于是标记聚集在地面本来就亮的地方、
   * 在暗处稀疏。均匀散布会读成盖在画面上的排线，而不是长在特定位置的东西，那正是一片
   * 田野和一层纹理的区别。
   */
  drawDetail(
    shapes: ShapeBatch,
    weather: Weather,
    camX: number,
    camY: number,
    rootX: number,
    rootY: number,
    scale: number,
    halfW: number,
    halfH: number,
  ): void {
    const cell = DETAIL_SPACING;
    const mark = cell * 0.14;

    // 一个标记在屏幕上不足一个多像素时，整层不画。
    //
    // 这是 overlord 原本就有的一条（`if (onScreen < 1.2f) return;`），我第一次移植时漏了 ——
    // 因为那时缩放是固定的，看不出来。加上滚轮缩放之后它立刻变成硬需求：拉到全景时可视
    // 范围有一千六百多个世界单位见方，按十四单位的间距就是五万多个格子，每个格子还要
    // 采样一次材质。那不是画得慢，那是直接卡死。
    const onScreen = mark * scale;
    if (onScreen < 1.2) return;

    const minX = Math.max(0, Math.floor((camX - halfW) / cell));
    const maxX = Math.min(Math.ceil(this.width / cell), Math.ceil((camX + halfW) / cell));
    const minY = Math.max(0, Math.floor((camY - halfH) / cell));
    const maxY = Math.min(Math.ceil(this.height / cell), Math.ceil((camY + halfH) / cell));
    const m = this.scratch;

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        // 在自己的格子里抖开，否则散布会读成它出身的那张网格。
        const wx = (cx + 0.18 + this.hash01(cx + 842, cy) * 0.64) * cell;
        const wy = (cy + 0.18 + this.hash01(cx, cy + 888) * 0.64) * cell;

        const lush = this.octave(wx, wy, GRAIN_COARSE, 9173);
        if (this.hash01(cx + 811, cy - 811) > 0.55 * (0.35 + lush * 1.3)) continue;

        this.sample(wx, wy, m);
        if (m.water > 0.45) continue;

        const s = v2(rootX + (wx - camX) * scale, rootY + (wy - camY) * Projection.groundSquash * scale);
        // 用屏幕行取深度，不是一个固定常数：草丛要和站在它中间的人按同样的规则排序。
        const depth = s.y * Projector.DEPTH_PER_ROW - 6;
        const roll = this.hash01(cx - 811, cy + 811);

        const shade = weather.cloudShade(wx, wy);
        if (m.dirt > 0.5) stone(shapes, s, mark * scale, roll, depth, weather, shade);
        else if (m.forest > 0.5) litter(shapes, s, mark * scale, roll, depth, weather, shade);
        else tuft(shapes, s, mark * scale, roll, depth, weather, shade, wx, wy);
      }
    }
  }

  /**
   * 一个散布格子里有没有树，有的话在哪。
   *
   * 绘制和碰撞共用这一个函数。位置仍由原来的哈希和地形决定，首次查询后缓存；地形在
   * 构造后不再改变，因此无需每只怪物、每个碰撞子步都重新采样同一片森林。
   */
  treeAt(cellX: number, cellY: number): TreePlacement | null {
    if (cellX < 0 || cellY < 0 || cellX >= this.treeCols || cellY >= this.treeRows) return null;
    const index = cellY * this.treeCols + cellX;
    const cached = this.treeCells[index];
    if (cached !== undefined) return cached;
    const tree = this.computeTreeAt(cellX, cellY);
    this.treeCells[index] = tree;
    return tree;
  }

  private computeTreeAt(cellX: number, cellY: number): TreePlacement | null {
    const cell = TREE_SPACING;
    const x = (cellX + 0.15 + this.hash01(cellX + 5501, cellY) * 0.7) * cell;
    const y = (cellY + 0.15 + this.hash01(cellX, cellY + 5501) * 0.7) * cell;
    if (x < 0 || y < 0 || x > this.width || y > this.height) return null;

    const m = this.sample(x, y, { dirt: 0, water: 0, forest: 0, shade: 0 });
    // 只长在林地里，而且边缘要稀 —— 一条笔直的树干线撞上开阔草地会读成一堵墙。
    if (m.forest < 0.35 || m.water > 0.2) return null;
    if (this.hash01(cellX + 71, cellY - 71) > m.forest * 0.9) return null;

    // 树种也从哈希里取，所以它和位置一样是"这块地固有的"，不会每帧重掷。
    // 权重不均：阔叶最多，秋橡最少 —— 一片林子里几棵变了色的树是点缀，一半变色就是秋天了。
    const pick = this.hash01(cellX * 31 + 5, cellY * 17 - 5);
    const species =
      pick < 0.38 ? SPECIES[0] : pick < 0.6 ? SPECIES[1] : pick < 0.68 ? SPECIES[2] : pick < 0.87 ? SPECIES[3] : SPECIES[4];

    return { x, y, roll: this.hash01(cellX * 3 + 17, cellY * 5 - 17), species };
  }

  /** 一个点附近所有挡路的树干。只查周围几个散布格。 */
  treesNear(x: number, y: number, reach: number, out: { x: number; y: number; radius: number }[]): void {
    const cell = TREE_SPACING;
    const span = Math.ceil((reach + TRUNK_RADIUS) / cell) + 1;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let gy = cy - span; gy <= cy + span; gy++) {
      for (let gx = cx - span; gx <= cx + span; gx++) {
        const t = this.treeAt(gx, gy);
        if (!t) continue;
        if (Math.abs(t.x - x) > reach + TRUNK_RADIUS || Math.abs(t.y - y) > reach + TRUNK_RADIUS) continue;
        out.push({ x: t.x, y: t.y, radius: TRUNK_RADIUS });
      }
    }
  }

  /**
   * 林缘的灌木、开阔地的巨石、倒在地上的圆木。
   *
   * 和树共用一套做法：位置由哈希算出、不存表，所以画在哪就是撞在哪。三种东西各有自己的
   * 间距和落地条件 —— overlord 把这个叫 ScatterAffinity，一个道具"愿意长在什么地方"是
   * 它定义的一部分，而不是撒的时候临时判断的。
   */
  drawScatter(
    shapes: ShapeBatch,
    weather: Weather,
    camX: number,
    camY: number,
    rootX: number,
    rootY: number,
    scale: number,
    halfW: number,
    halfH: number,
  ): void {
    const m = this.scratch;
    const toScreen = (wx: number, wy: number) =>
      v2(rootX + (wx - camX) * scale, rootY + (wy - camY) * Projection.groundSquash * scale);

    const sweep = (
      cell: number,
      salt: number,
      minPixels: number,
      accept: (x: number, y: number, mat: Material, roll: number) => boolean,
      draw: (s: { x: number; y: number }, roll: number, x: number, y: number) => void,
    ): void => {
      // 和草丛同一条规矩：小到亚像素就整层不画。拉远看全景时这几层加起来是几万个格子。
      if (cell * 0.35 * scale < minPixels) return;

      const minX = Math.max(0, Math.floor((camX - halfW - cell) / cell));
      const maxX = Math.min(Math.ceil(this.width / cell), Math.ceil((camX + halfW + cell) / cell));
      const minY = Math.max(0, Math.floor((camY - halfH - cell * 2) / cell));
      const maxY = Math.min(Math.ceil(this.height / cell), Math.ceil((camY + halfH + cell) / cell));

      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const x = (cx + 0.15 + this.hash01(cx + salt, cy) * 0.7) * cell;
          const y = (cy + 0.15 + this.hash01(cx, cy + salt) * 0.7) * cell;
          if (x < 0 || y < 0 || x > this.width || y > this.height) continue;
          this.sample(x, y, m);
          if (m.water > 0.2) continue;
          const roll = this.hash01(cx * 7 + salt, cy * 11 - salt);
          if (!accept(x, y, m, roll)) continue;
          draw(toScreen(x, y), roll, x, y);
        }
      }
    };

    // 灌木：林缘。不是"林地权重高的地方"，而是"权重在中间的地方" —— 林子深处是树，
    // 开阔地是草，只有那条过渡带上才有杂木。这一条是让树墙的内缘看起来不像一堵墙的关键。
    sweep(
      BUSH_SPACING,
      12007,
      1.6,
      (_x, _y, mat, roll) => mat.forest > 0.12 && mat.forest < 0.72 && roll < 0.5,
      (s, roll, x, y) => bush(shapes, s, scale, roll, s.y * Projector.DEPTH_PER_ROW, weather, weather.cloudShade(x, y), x, y),
    );

    // 巨石：开阔地。
    sweep(
      BOULDER_SPACING,
      61403,
      1.4,
      (_x, _y, mat, roll) => mat.forest < 0.2 && mat.dirt < 0.5 && roll < 0.4,
      (s, roll, x, y) => boulder(shapes, s, scale, roll, s.y * Projector.DEPTH_PER_ROW, weather, weather.cloudShade(x, y)),
    );

    // 倒木：林缘，和灌木同一带。
    sweep(
      LOG_SPACING,
      44921,
      2,
      (_x, _y, mat, roll) => mat.forest > 0.1 && mat.forest < 0.8 && roll < 0.4,
      (s, roll, x, y) => fallenLog(shapes, s, scale, roll, s.y * Projector.DEPTH_PER_ROW, weather, weather.cloudShade(x, y)),
    );
  }

  /**
   * 林地里的树。
   *
   * 画在和人物同一个批次里，所以它们按屏幕行和人互相排序 —— 人能走到树后面去。这也是
   * 树必须每帧画、不能烘进地面纹理的原因：烘进去的树是地上的一块图案，人会从它身上踩过去。
   */
  drawTrees(
    shapes: ShapeBatch,
    weather: Weather,
    camX: number,
    camY: number,
    rootX: number,
    rootY: number,
    scale: number,
    halfW: number,
    halfH: number,
  ): void {
    const cell = TREE_SPACING;
    const minX = Math.max(0, Math.floor((camX - halfW - cell) / cell));
    const maxX = Math.min(Math.ceil(this.width / cell), Math.ceil((camX + halfW + cell) / cell));
    const minY = Math.max(0, Math.floor((camY - halfH - cell * 2) / cell));
    const maxY = Math.min(Math.ceil(this.height / cell), Math.ceil((camY + halfH + cell) / cell));

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const t = this.treeAt(cx, cy);
        if (!t) continue;
        const s = v2(rootX + (t.x - camX) * scale, rootY + (t.y - camY) * Projection.groundSquash * scale);
        tree(shapes, s, scale, t.roll, t.species, s.y * Projector.DEPTH_PER_ROW, weather, weather.cloudShade(t.x, t.y), t.x, t.y);
      }
    }
  }
}

// ---------------------------------------------------------------- 图元

/** 几片叶子从一个基点立起来。竖直方向不压扁 —— 地面平面被压扁了，从它上面立起来的东西没有。 */
function tuft(
  shapes: ShapeBatch,
  s: { x: number; y: number },
  mark: number,
  roll: number,
  depth: number,
  weather: Weather,
  shade: number,
  worldX: number,
  worldY: number,
): void {
  // 矮。第一版画了差不多一格高、从共同基点岔开的叶片，那个尺度下读作一个 V，田野看着
  // 像被划花了。两三个像素直着立起来就是一丛草的全部。
  let h = mark * (0.9 + roll * 0.8);

  // 雪下的草越来越短，直到没有。从白地里戳出来的草是最能暴露"这层白是假的"的东西。
  h *= 1 - weather.snowCover * 0.9;
  if (h < 0.8) return;

  const bend = weather.sway(worldX, worldY, h);
  const tone = (c: Rgba) => shadowed(weather.grade(c, 0.7), shade);

  shapes.rect(s, 1.6, 1, 0, tone(TUFT_BASE), depth - 1);
  shapes.bar(s, v2(s.x + (roll - 0.5) * 0.9 + bend.x, s.y - h + bend.y), 0.9, tone(TUFT_LIGHT), depth);
  if (roll > 0.62) {
    shapes.bar(
      v2(s.x + 1, s.y),
      v2(s.x + 1 + bend.x * 0.66, s.y - h * 0.66 + bend.y * 0.66),
      0.9,
      tone(GRASS_RAMP[2]),
      depth - 0.5,
    );
  }
}

/** 一块石头，和其它一切被同一个角落的光照着。 */
function stone(
  shapes: ShapeBatch,
  s: { x: number; y: number },
  mark: number,
  roll: number,
  depth: number,
  weather: Weather,
  shade: number,
): void {
  const r = mark * (0.35 + roll * 0.3);
  const tone = (c: Rgba) => shadowed(weather.grade(c, 0.75), shade);
  shapes.ellipse(s, r, r * Projection.groundSquash, 0, tone(STONE_SHADE), depth);
  if (r >= 1.2) {
    const L = ShapeBatch.LIGHT_DIR;
    shapes.ellipse(
      v2(s.x + L.x * r * 0.3, s.y + L.y * r * 0.3),
      r * 0.62,
      r * 0.62 * Projection.groundSquash,
      0,
      tone(STONE_LIGHT),
      depth + 0.01,
    );
  }
}

/** 落叶：平铺在地上，所以和地面一样被压扁。 */
function litter(
  shapes: ShapeBatch,
  s: { x: number; y: number },
  mark: number,
  roll: number,
  depth: number,
  weather: Weather,
  shade: number,
): void {
  const r = mark * (0.5 + roll * 0.4);
  const base = roll < 0.5 ? FOREST_RAMP[0] : FOREST_RAMP[2];
  shapes.ellipse(s, r, Math.max(r * Projection.groundSquash, 0.5), 0, shadowed(weather.grade(base, 0.8), shade), depth);
}

/**
 * 一棵树：树干，加上按剖面堆起来的树冠。
 *
 * 树冠是一叠横带而不是一个圆球，理由和头是一叠平板一样：一个上了明暗的球在像素网格上
 * 会糊成一团，而堆叠的硬边横带能读出体积。
 */
function tree(
  shapes: ShapeBatch,
  s: { x: number; y: number },
  scale: number,
  roll: number,
  sp: TreeSpecies,
  depth: number,
  weather: Weather,
  cloud: number,
  worldX: number,
  worldY: number,
): void {
  const h = TREE_HEIGHT * sp.scale * (0.82 + roll * 0.36) * Projection.heightSquash * scale;

  // 树冠最宽处由树种决定。overlord 里那个宽度系数是**半宽**（它的 Bands 按半宽展开），
  // 照抄成全宽会让树瘦一半，读成一丛小灌木而不是一棵树。
  const width = h * sp.width;
  const trunkTop = h * sp.trunk;

  // 树底下的影子。没有它，树看着像浮在草上。
  shapes.ellipse(s, width * 0.3, width * 0.3 * Projection.groundSquash, 0, rgba(0, 0, 0, 64), depth - 8);

  const bark = (c: Rgba) => shadowed(weather.grade(c, 0.25), cloud);
  shapes.bar(s, v2(s.x, s.y - trunkTop), Math.max(1, width * 0.13), bark(sp.bark), depth);
  shapes.bar(v2(s.x + 1, s.y), v2(s.x + 1, s.y - trunkTop * 0.92), Math.max(1, width * 0.05), bark(sp.barkLit), depth + 0.01);

  // 树冠整体随风摆。摆幅按到根部的高度缩放，所以树干几乎不动、冠顶动得最多 —— 这是一棵
  // 立着的树和一块贴纸的区别。
  const sway = weather.sway(worldX, worldY, h * 0.5);

  // 树冠：由下往上堆，每一带自己的宽度和横向偏移。三档色阶按高度分配 —— 顶上受光、
  // 底下背光，和人物身上用的是同一盏灯。雪不是混向白（那会得到灰绿），而是在夏冬两套
  // 手挑的颜色之间取值。
  const bandH = Math.max(1, (h - trunkTop) * 0.26);
  for (let i = sp.crown.length - 1; i >= 0; i--) {
    const [ty, bw, ox] = sp.crown[i];
    const bandY = s.y - trunkTop - (h - trunkTop) * ty;
    const bandW = width * bw;
    const summer = ty > 0.72 ? sp.light : ty > 0.3 ? sp.mid : sp.dark;
    const winter = ty > 0.72 ? sp.winterLight : ty > 0.3 ? sp.winterMid : sp.winterDark;
    const color = shadowed(weather.season(summer, winter), cloud);
    // 越靠上摆得越多。
    const lean = sway.x * (0.25 + ty * 0.9);
    shapes.rect(v2(s.x + ox * width + lean, bandY), bandW, bandH, 0, color, depth + 0.02 + i * 0.001);
  }
}

/**
 * 灌木：两团叠在一起的矮丛。
 *
 * 长在林缘 —— 一排树干硬碰开阔草地读作一堵墙，而边上散着的杂木丛才让它成为林缘。这是
 * 整个散布系统里唯一按"林地权重的梯度"而不是按权重本身放的东西。
 */
function bush(
  shapes: ShapeBatch,
  s: { x: number; y: number },
  scale: number,
  roll: number,
  depth: number,
  weather: Weather,
  cloud: number,
  worldX: number,
  worldY: number,
): void {
  const h = 5.4 * (0.75 + roll * 0.5) * Projection.heightSquash * scale;
  const w = h * 1.25;
  const tone = (c: Rgba) => shadowed(weather.season(c, SCRUB_WINTER), cloud);
  const sway = weather.sway(worldX, worldY, h);

  shapes.ellipse(s, w * 0.5, w * 0.5 * Projection.groundSquash, 0, rgba(0, 0, 0, 52), depth - 6);
  shapes.ellipse(v2(s.x + sway.x * 0.4, s.y - h * 0.42), w * 0.5, h * 0.55, 0, tone(SCRUB_MID), depth);
  shapes.ellipse(v2(s.x + w * 0.22 + sway.x * 0.6, s.y - h * 0.66), w * 0.3, h * 0.4, 0, tone(SCRUB_LIGHT), depth + 0.01);
  shapes.ellipse(v2(s.x - w * 0.24 + sway.x * 0.3, s.y - h * 0.3), w * 0.26, h * 0.34, 0, tone(SCRUB_DARK), depth + 0.005);
}

/**
 * 巨石：三个切面。
 *
 * 石头长在开阔地上，不长在林子里 —— 林子里的石头看不见，却挡住一条没人看得出被挡住的
 * 路；而平地上的石头是地标，也是一个能靠住侧翼的东西。
 */
function boulder(
  shapes: ShapeBatch,
  s: { x: number; y: number },
  scale: number,
  roll: number,
  depth: number,
  weather: Weather,
  cloud: number,
): void {
  const pal = ROCK[Math.floor(roll * ROCK.length) % ROCK.length];
  const h = 9 * (0.6 + roll * 0.8) * Projection.heightSquash * scale;
  const w = h * 1.5;
  const tone = (c: Rgba) => shadowed(weather.grade(c, 0.9), cloud);

  shapes.ellipse(s, w * 0.6, w * 0.6 * Projection.groundSquash, 0, rgba(0, 0, 0, 60), depth - 6);
  // 底面暗、朝上的面亮，中间那道硬边就是石头的棱。
  shapes.ellipse(v2(s.x, s.y - h * 0.3), w * 0.5, h * 0.62, 0, tone(pal[0]), depth);
  shapes.ellipse(v2(s.x - w * 0.06, s.y - h * 0.44), w * 0.42, h * 0.48, 0, tone(pal[1]), depth + 0.01);
  const L = ShapeBatch.LIGHT_DIR;
  shapes.ellipse(
    v2(s.x + L.x * w * 0.14, s.y - h * 0.5 + L.y * h * 0.16),
    w * 0.24,
    h * 0.26,
    0,
    tone(pal[2]),
    depth + 0.02,
  );
}

/**
 * 倒木：躺在地面平面里的一根横线。
 *
 * 它是唯一一件明确躺平的散布物，而这正是它的作用 —— 一根横躺的圆木告诉眼睛"地面是一个
 * 平面"，别的东西都在告诉眼睛"这里立着一样东西"。
 */
function fallenLog(
  shapes: ShapeBatch,
  s: { x: number; y: number },
  scale: number,
  roll: number,
  depth: number,
  weather: Weather,
  cloud: number,
): void {
  const len = 9 * (0.8 + roll * 0.6) * scale;
  const thick = Math.max(1.5, 2.6 * scale * (0.7 + roll * 0.5));
  // 躺在地面上，所以它的朝向跟着地面平面被压扁。
  const angle = (roll * 2 - 1) * 0.9;
  const dx = Math.cos(angle) * len;
  const dy = Math.sin(angle) * len * Projection.groundSquash;
  const tone = (c: Rgba) => shadowed(weather.grade(c, 0.6), cloud);

  const a = v2(s.x - dx * 0.5, s.y - dy * 0.5);
  const b = v2(s.x + dx * 0.5, s.y + dy * 0.5);
  shapes.capsule(a, b, thick, tone(TIMBER_DARK), depth);
  shapes.bar(v2(a.x, a.y - thick * 0.22), v2(b.x, b.y - thick * 0.22), thick * 0.55, tone(TIMBER_MID), depth + 0.01);
  shapes.bar(v2(a.x, a.y - thick * 0.4), v2(b.x, b.y - thick * 0.4), thick * 0.2, tone(TIMBER_LIGHT), depth + 0.02);
  // 断面：一头一个浅色圆盘，圆木才有粗细。
  shapes.disc(a, thick * 0.5, tone(TIMBER_LIGHT), depth + 0.03);
}

// ---------------------------------------------------------------- 小工具

function bilerp(layer: Float32Array, a: number, b: number, c: number, d: number, tx: number, ty: number): number {
  return lerp(lerp(layer[a], layer[b], tx), lerp(layer[c], layer[d], tx), ty);
}

/**
 * 圆角矩形的权重场，边缘羽化。
 *
 * 用的是标准的圆角矩形有向距离：把点折到第一象限，减去内矩形的半宽半高，取正部分的
 * 长度再减圆角半径。一个公式同时覆盖四条边、四个角和内部，不需要分情况。
 */
function roundedRect(
  x: number,
  y: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  radius: number,
  feather: number,
): number {
  const r = Math.min(radius, Math.min(halfW, halfH));
  const qx = Math.abs(x - cx) - (halfW - r);
  const qy = Math.abs(y - cy) - (halfH - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  const d = outside + inside - r;
  const t = clamp(-d / Math.max(feather, 0.001), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 一个椭圆形的权重场，边缘按 width（占半径的比例）羽化。 */
function blob(x: number, y: number, cx: number, cy: number, rx: number, ry: number, width: number): number {
  const dx = (x - cx) / Math.max(rx, 0.001);
  const dy = (y - cy) / Math.max(ry, 0.001);
  const distance = Math.sqrt(dx * dx + dy * dy);
  const t = clamp((1 + width - distance) / Math.max(width * 2, 0.001), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 把权重绕中点拉陡，压窄抖动能穿插的那条带。 */
function steepen(value: number, hardness: number): number {
  return clamp(0.5 + (value - 0.5) * hardness, 0, 1);
}

/** 值到色阶下标，余数交给阈值决定。 */
function quantize(value: number, levels: number): number {
  const f = value * (levels - 1);
  const step = Math.floor(f);
  return clamp(f - step > 0.5 ? step + 1 : step, 0, levels - 1);
}

function dither(x: number, y: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}
