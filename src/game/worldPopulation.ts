/** 远处按区域密度补怪；每次只补少量，避免一整片红点同时出现。 */
export const WORLD_REFILL_INTERVAL = 2;
export const WORLD_REFILL_PER_REGION = 2;
/** 全图一轮最多新增 64 只（每秒最多 32 只），各区域轮流获得名额。 */
export const WORLD_REFILL_MAX_BATCH = 64;
const REGION_SIZE = 112;

type Position = Readonly<{ x: number; y: number }>;

export class WorldPopulation {
  private readonly width: number;
  private readonly height: number;
  private readonly spacing: number;
  private readonly cols: number;
  private readonly rows: number;
  private elapsed = 0;
  private cursor = 0;
  private enabled = false;

  constructor(width: number, height: number, spacing: number) {
    this.width = width;
    this.height = height;
    this.spacing = spacing;
    this.cols = Math.max(1, Math.ceil(width / REGION_SIZE));
    this.rows = Math.max(1, Math.ceil(height / REGION_SIZE));
  }

  reset(): void {
    this.elapsed = 0;
    this.cursor = 0;
    this.enabled = true;
  }

  /** spawn 返回新位置，失败返回 null（例如玩家看得见该处、落在障碍里）。 */
  update(
    dt: number,
    read: () => Iterable<Position>,
    room: number,
    spawn: (x: number, y: number) => Position | null,
  ): void {
    if (!this.enabled || dt <= 0) return;
    this.elapsed += dt;
    if (this.elapsed < WORLD_REFILL_INTERVAL) return;
    // 长帧只执行一轮，不补发积攒的多轮刷怪。
    this.elapsed %= WORLD_REFILL_INTERVAL;
    if (room <= 0) return;
    room = Math.min(room, WORLD_REFILL_MAX_BATCH);

    const cellW = this.width / this.cols;
    const cellH = this.height / this.rows;
    const count = this.cols * this.rows;
    const target = Math.max(1, Math.floor(cellW * cellH / (this.spacing * this.spacing)));
    const buckets: Position[][] = Array.from({ length: count }, () => []);
    for (const p of read()) {
      if (p.x < 0 || p.y < 0 || p.x >= this.width || p.y >= this.height) continue;
      const col = Math.floor(p.x / cellW);
      const row = Math.floor(p.y / cellH);
      buckets[row * this.cols + col].push(p);
    }

    // 轮换起点，接近总量保护线时也不会永远只有左上角得到补充。
    const start = this.cursor;
    this.cursor = (start + 1) % count;
    for (let offset = 0; offset < count && room > 0; offset++) {
      const index = (start + offset) % count;
      const col = index % this.cols;
      const row = Math.floor(index / this.cols);
      const bucket = buckets[index];
      let missing = Math.min(WORLD_REFILL_PER_REGION, target - bucket.length, room);
      for (let attempt = 0; missing > 0 && attempt < WORLD_REFILL_PER_REGION * 8; attempt++) {
        const x = (col + 0.05 + Math.random() * 0.9) * cellW;
        const y = (row + 0.05 + Math.random() * 0.9) * cellH;
        let free = true;
        // 查询邻区，避免把新怪刷在旧怪身上或贴着区域分界重叠。
        for (let gy = Math.max(0, row - 1); gy <= Math.min(this.rows - 1, row + 1) && free; gy++) {
          for (let gx = Math.max(0, col - 1); gx <= Math.min(this.cols - 1, col + 1) && free; gx++) {
            for (const p of buckets[gy * this.cols + gx]) {
              if ((p.x - x) ** 2 + (p.y - y) ** 2 < (this.spacing * 0.6) ** 2) {
                free = false;
                break;
              }
            }
          }
        }
        if (!free) continue;
        const enemy = spawn(x, y);
        if (!enemy) continue;
        bucket.push(enemy);
        missing--;
        room--;
        this.cursor = (index + 1) % count;
      }
    }
  }
}
