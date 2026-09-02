/**
 * 均匀网格：一帧重建一次，用来把"找附近的人"从 O(n²) 变成 O(n)。
 *
 * 为什么不是 boids 或者 ORCA。
 *
 * 这两个解的都不是这里的问题。ORCA 给每个个体解一次线性规划，求一条"和所有邻居都不会撞"的
 * 速度 —— 它是为"一群人各走各路、互相让开"设计的，而割草的人堆是**所有人扑向同一个点**，
 * 那正好是它的退化情形：一百个人的速度约束互相矛盾，解出来是一圈礼貌地停在外面互相谦让的
 * 人，而不是围上来的暴徒。代价还很高，每人几十微秒，一千二百人直接吃掉整帧。
 *
 * boids 的三项里，对齐和聚拢在这里也是错的 —— 敌人的目标是玩家，不是彼此。真正有用的只有
 * 分离，而分离这个工程本来就有。缺的从来不是算法，是**别再两两比较**：同屏上限能开到 1200，
 * 那是七十二万次比较一帧。
 *
 * 所以这里放的是那件真正缺的东西。格子边长取得比最大交互距离大一点，于是只用看 3x3 九个格；
 * 建表走计数排序，两遍扫完，全程不分配 —— 每帧新建数组的开销在这个量级上比比较本身还贵。
 */
export interface GridAgent {
  x: number;
  y: number;
}

/**
 * 格子数的上限。
 *
 * 人群铺开得再大（缩放拉到全景时敌人能散在几百个单位里），也不让格子数无限涨 —— 超了就
 * 临时把格子加粗。格子比交互距离**大**永远是安全的，只是每格里的候选人多一点；比它小才会
 * 漏判。
 */
const MAX_CELLS = 1 << 16;

export class SpatialGrid {
  /** 这一帧实际用的格子边长。至少是构造时给的那个，人群铺得太开时会临时加粗。 */
  cellSize: number;
  cols = 1;
  rows = 1;

  private baseCellSize: number;
  private minX = 0;
  private minY = 0;

  /** 第 c 格的下标落在 items 的 [cellStart[c], cellStart[c + 1])。 */
  private cellStart = new Int32Array(1);
  /** 填表时每格写到哪儿了。和 cellStart 分开是因为计数排序要保留起点。 */
  private cursor = new Int32Array(0);
  /** 按格子聚在一起的 agent 下标。 */
  private items = new Int32Array(0);

  /**
   * @param cellSize 格子边长的下限。必须 ≥ 最大交互距离，否则只看 3x3 会漏掉边上的人。
   */
  constructor(cellSize: number) {
    this.baseCellSize = cellSize;
    this.cellSize = cellSize;
  }

  /**
   * 改格子边长的下限。交互距离变了就得跟着改 —— 小了会漏判，大了每次查询白扫一堆远处的人。
   */
  setMinCellSize(size: number): void {
    this.baseCellSize = Math.max(1, size);
  }

  colOf(x: number): number {
    const c = ((x - this.minX) / this.cellSize) | 0;
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  rowOf(y: number): number {
    const r = ((y - this.minY) / this.cellSize) | 0;
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  /** 第 (cx, cy) 格里那段下标的起点和终点。调用方自己保证格坐标在范围内。 */
  begin(cx: number, cy: number): number {
    return this.cellStart[cy * this.cols + cx];
  }
  end(cx: number, cy: number): number {
    return this.cellStart[cy * this.cols + cx + 1];
  }

  /** 按格聚好的下标表，配合 begin/end 用。 */
  get indices(): Int32Array {
    return this.items;
  }

  /**
   * 重建。计数排序：数一遍每格几个人，前缀和求出每格的起点，再放一遍。
   *
   * 网格**只盖住这一帧人群的包围盒**，不是整张地图。这一条是性能的关键：清零和前缀和的开销
   * 只跟格子数有关、跟人数无关，铺满 1800x1800 就是五万个格，九十个人的时候光这一项就比
   * 两两比较整个还贵十倍 —— 查表反而成了累赘。人群总是聚在玩家周围的一小片里，按包围盒开
   * 表就把这笔固定开销压回到和人数同一个量级。
   *
   * 三遍线性扫描，稳态下不分配 —— 几个数组只在需要变大时才重开。
   */
  build(agents: readonly GridAgent[]): void {
    const n = agents.length;
    if (n === 0) {
      this.cols = 1;
      this.rows = 1;
      this.cellStart[0] = 0;
      if (this.cellStart.length > 1) this.cellStart[1] = 0;
      return;
    }
    if (this.items.length < n) this.items = new Int32Array(Math.max(n, 64));

    // 包围盒。多留一格，免得贴在上界的人被 colOf 夹到最后一格里去挤成一堆。
    let lo = agents[0].x;
    let hi = lo;
    let loY = agents[0].y;
    let hiY = loY;
    for (let i = 1; i < n; i++) {
      const a = agents[i];
      if (a.x < lo) lo = a.x;
      else if (a.x > hi) hi = a.x;
      if (a.y < loY) loY = a.y;
      else if (a.y > hiY) hiY = a.y;
    }

    this.cellSize = this.baseCellSize;
    let cols = Math.max(1, Math.ceil((hi - lo) / this.cellSize) + 1);
    let rows = Math.max(1, Math.ceil((hiY - loY) / this.cellSize) + 1);
    // 铺得太开就加粗格子，重算一次即可 —— 粗一倍格子数就掉四倍。
    while (cols * rows > MAX_CELLS) {
      this.cellSize *= 2;
      cols = Math.max(1, Math.ceil((hi - lo) / this.cellSize) + 1);
      rows = Math.max(1, Math.ceil((hiY - loY) / this.cellSize) + 1);
    }
    this.minX = lo;
    this.minY = loY;
    this.cols = cols;
    this.rows = rows;

    const cells = cols * rows;
    if (this.cellStart.length < cells + 1) {
      this.cellStart = new Int32Array(cells + 1);
      this.cursor = new Int32Array(cells);
    }
    const start = this.cellStart;
    start.fill(0, 0, cells + 1);

    // 数：先把个数记在 c+1 上，前缀和之后 start[c] 天然就是第 c 格的起点。
    for (let i = 0; i < n; i++) {
      const a = agents[i];
      start[this.rowOf(a.y) * this.cols + this.colOf(a.x) + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];

    this.cursor.set(start.subarray(0, cells), 0);
    for (let i = 0; i < n; i++) {
      const a = agents[i];
      const c = this.rowOf(a.y) * this.cols + this.colOf(a.x);
      this.items[this.cursor[c]++] = i;
    }
  }
}
