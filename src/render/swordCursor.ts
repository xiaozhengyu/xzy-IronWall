import { type Rgba, rgb, rgba } from './color';

/**
 * 准心：一把像素剑，剑尖就是瞄准点。
 *
 * 原来那个准心是四个一像素宽的小方块围成的十字。它在空地上勉强能看见，一到人堆里就没了 ——
 * 草地、红衣、钢刃全是花的，而它只有八个像素而且没有描边。玩家找不到自己的准心，就等于
 * 不知道自己朝哪儿打。
 *
 * 换成剑解决三件事：**体量**、**描边**（任何底色上都切得出来）、**指向**（剑尖是一个点，
 * 十字的中心是一片空）。顺带它也说明了这游戏在干什么。
 *
 * **剑尖指左上、剑柄在右下。** 这是按右手握鼠标来的：绝大多数人的鼠标在身体右侧，指针的
 * "实体"落在指向点的右下方才符合手的方向感 —— 系统箭头指针也是这么摆的。反过来摆会让人
 * 觉得指针在往回指。
 *
 * **矮胖**：刃宽、身短。细长的剑在十六见方里只剩一条线，和场上那些斜着的钢刃混在一起分不
 * 出来；粗短的一把有自己的轮廓，余光扫过去就知道那是准心不是谁的武器。
 *
 * **刃是矩形，只有尖是三角。** 第一版从尖到护手一路在收，两条边不平行 —— 那是匕首的轮廓，
 * 不是剑。现在刃身四格等宽（45 度斜带，两条长边平行），只在最前面两行收成一个点。等宽那
 * 一段才是"剑"读得出来的地方，收尖只需要两行。
 *
 * 像素数据放在这里而不是画它的地方，因为有三个消费者：运行时由 Scene 画进 Graphics（准心
 * 必须压在所有东西之上、不参与深度排序，走不了 ShapeBatch）、离线由 tools/preview.ts 画进
 * ShapeBatch 出对照图、菜单里由 ui/cursorImage.ts 烤成一张 CSS 光标图。数据只有一份。
 */

/**
 * 剑本身，不含描边。'.' 是空。
 *
 * 描边是**算出来的**，不是画出来的（见 OUTLINE_WIDTH）：手画描边意味着每次改形状都要把
 * 一圈 K 重新描一遍，而描边的粗细本来就该是一个可调的数。
 *
 *   L 刃的亮边   S 刃身   G 护手与柄头   H 缠柄
 *
 * 护手是**贴着的两列**（同一行相邻两格），不是错开一格的两条斜线 —— 后者在同一行上隔着
 * 一格空，画出来是两条虚线而不是一根横档。
 */
const SHAPE = [
  '................',
  '................',
  '..L.............',
  '..LSS...........',
  '...LSSS.........',
  '....LSSS........',
  '.....LSSS.......',
  '......LSSSGG....',
  '.......LSGG.....',
  '........GG......',
  '.......GGHH.....',
  '......GG..HH....',
  '...........GG...',
  '...........GG...',
  '................',
  '................',
];

/** 描边有多少格厚。两格 —— 一格的描边在花底色上还是会被咬掉。 */
const OUTLINE_WIDTH = 2;

const COLORS: Record<string, Rgba> = {
  /**
   * 配色刻意**不用**兵器的钢色。
   *
   * 照人物身上那套钢画的话，在人堆里读作"又一把敌人的剑" —— 场上几十个杂兵手里全是同色
   * 同形的斜银刃。准心是 UI 不是场景里的东西，该比场上任何一件武器都亮、都干净。
   */
  L: rgb(248, 251, 255),
  S: rgb(198, 210, 230),
  G: rgb(232, 186, 66),
  H: rgb(104, 72, 44),
};

/** 描边色。近黑但不是纯黑，和人物那圈暗边同一个语气。 */
const OUTLINE: Rgba = rgba(12, 14, 20, 245);

const W = SHAPE[0].length;
const H = SHAPE.length;

/** 每一格最终画什么颜色；null = 透明。索引是 row * W + col。 */
const GRID: (Rgba | null)[] = (() => {
  const filled: boolean[] = new Array(W * H).fill(false);
  const out: (Rgba | null)[] = new Array(W * H).fill(null);

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const ch = SHAPE[r][c];
      const color = COLORS[ch];
      if (!color) continue;
      filled[r * W + c] = true;
      out[r * W + c] = color;
    }
  }

  // 描边：把实心格子往外膨胀 OUTLINE_WIDTH 圈，只填还空着的格子。
  //
  // 第一圈按八邻域（连对角一起吃），之后按四邻域。全用八邻域的话拐角会鼓出一个方块，
  // 一把十六见方的剑上那个方块看得很清楚；混着来得到的是一圈圆角的边。
  let ring = filled.slice();
  for (let step = 0; step < OUTLINE_WIDTH; step++) {
    const next = ring.slice();
    const diagonal = step === 0;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (ring[r * W + c]) continue;
        let touch = false;
        for (let dr = -1; dr <= 1 && !touch; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            if (!diagonal && dr !== 0 && dc !== 0) continue;
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
            if (ring[rr * W + cc]) {
              touch = true;
              break;
            }
          }
        }
        if (touch) {
          next[r * W + c] = true;
          if (!out[r * W + c]) out[r * W + c] = OUTLINE;
        }
      }
    }
    ring = next;
  }

  return out;
})();

export const SWORD_CURSOR = {
  width: W,
  height: H,
  /** 剑尖在图里的格子。准心对准的就是这一格。 */
  hotX: 2,
  hotY: 2,
};

/**
 * 逐格回调，跳过透明的那些。
 *
 * @param px 一格画多大。
 * @param cb 收到的是这一格左上角相对**瞄准点**的偏移，以及颜色。
 */
export function forEachCursorPixel(px: number, cb: (x: number, y: number, color: Rgba) => void): void {
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const color = GRID[r * W + c];
      if (color) cb((c - SWORD_CURSOR.hotX) * px, (r - SWORD_CURSOR.hotY) * px, color);
    }
  }
}
