/** 远处每秒 10 次决策，分六组错开，近处随时切回逐帧。 */
export const DISTANT_STEP = 0.1;
const GROUPS = 6;
const MAP_SMOOTH_TIME = 0.07;

export class DistantMotion {
  readonly map: { x: number; y: number };
  private lastAt: number;
  private nextAt: number;

  constructor(x: number, y: number, now: number, group: number) {
    this.map = { x, y };
    this.lastAt = now;
    this.nextAt = now + DISTANT_STEP * ((group % GROUPS) + 1) / GROUPS;
  }

  /** 返回本次实际需要模拟的时长；未到该组的更新时间则为 0。 */
  step(now: number, dt: number, near: boolean): number {
    if (dt <= 0 || (!near && now + 1e-9 < this.nextAt)) return 0;
    const elapsed = Math.max(0, now - this.lastAt);
    this.lastAt = now;
    if (now + 1e-9 >= this.nextAt) {
      this.nextAt += Math.max(1, Math.floor((now - this.nextAt + 1e-9) / DISTANT_STEP) + 1) * DISTANT_STEP;
    }
    return elapsed;
  }

  smoothMap(x: number, y: number, blend: number): void {
    this.map.x += (x - this.map.x) * blend;
    this.map.y += (y - this.map.y) * blend;
  }

  static mapBlend(dt: number): number {
    return 1 - Math.exp(-dt / MAP_SMOOTH_TIME);
  }
}
