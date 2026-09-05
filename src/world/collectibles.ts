import { v2 } from '../core/math';
import { rgba } from '../render/color';
import { Projection } from '../render/projection';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 地图上的可收集物种类。先只放宝石，但生成、推进和拾取都走这个公共入口；以后金币、经验球
 * 或地图机关掉落不需要再复制一套吸附逻辑。
 */
export type CollectibleKind = 'gem';

export interface CollectibleTarget {
  x: number;
  y: number;
}

interface CollectibleDrop {
  kind: CollectibleKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  phase: number;
  bounces: number;
  resting: boolean;
  pulling: boolean;
  pullSpeed: number;
  trailX: number;
  trailY: number;
}

interface PickupBurst {
  x: number;
  y: number;
  age: number;
  phase: number;
}

const MAX_DROPS = 1800;
const MAX_BURSTS = 96;
const GRAVITY = 260;
const MAGNET_RADIUS = 68;
const MAGNET_DELAY = 0.48;
const COLLECT_DISTANCE = 3.5;
const COLLECT_HEIGHT = 7;
const BURST_LIFE = 0.24;

/**
 * 地图可收集物池。
 *
 * 它不知道经验、金钱或技能，只管理“东西落到地上、靠近玩家后被吸走”这段公共行为。
 * update 的返回值是这一帧收走的数量；当前 Battle 暂时忽略它，以后接数值逻辑时直接消费即可。
 */
export class Collectibles {
  private readonly drops: CollectibleDrop[] = [];
  private readonly visibleDrops: CollectibleDrop[] = [];
  /** 最近一帧可见的掉落物数量，便于性能检查。 */
  drawn = 0;
  private readonly bursts: PickupBurst[] = [];
  private replaceAt = 0;

  get alive(): number {
    return this.drops.length;
  }

  clear(): void {
    this.drops.length = 0;
    this.visibleDrops.length = 0;
    this.drawn = 0;
    this.bursts.length = 0;
    this.replaceAt = 0;
  }

  spawn(kind: CollectibleKind, x: number, y: number): void {
    const angle = Math.random() * Math.PI * 2;
    const speed = 7 + Math.random() * 11;
    const drop: CollectibleDrop = {
      kind,
      x,
      y,
      z: 4 + Math.random() * 3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      vz: 38 + Math.random() * 24,
      age: 0,
      phase: Math.random() * Math.PI * 2,
      bounces: 0,
      resting: false,
      pulling: false,
      pullSpeed: 0,
      trailX: x,
      trailY: y,
    };

    if (this.drops.length < MAX_DROPS) {
      this.drops.push(drop);
      return;
    }

    // 极端情况下地上会有几千个未拾取物。固定容量避免一局跑得越久数组越大；满池后轮换最
    // 早的一格，视觉上仍保持“每次击杀都有一颗刚掉出来”。
    this.drops[this.replaceAt] = drop;
    this.replaceAt = (this.replaceAt + 1) % MAX_DROPS;
  }

  dropGem(x: number, y: number): void {
    this.spawn('gem', x, y);
  }

  update(dt: number, target: CollectibleTarget): number {
    let collected = 0;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;

      if (d.pulling) {
        if (this.pull(d, dt, target)) {
          this.emitBurst(target.x, target.y);
          this.swapRemoveDrop(i);
          collected++;
        }
        continue;
      }

      this.fall(d, dt);
      const dx = target.x - d.x;
      const dy = target.y - d.y;
      if (d.age >= MAGNET_DELAY && dx * dx + dy * dy <= MAGNET_RADIUS * MAGNET_RADIUS) {
        d.pulling = true;
        d.resting = false;
        d.pullSpeed = 34;
        d.z = Math.max(d.z, 2.2);
        d.trailX = d.x;
        d.trailY = d.y;
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].age += dt;
      if (this.bursts[i].age >= BURST_LIFE) this.swapRemoveBurst(i);
    }

    return collected;
  }

  private fall(d: CollectibleDrop, dt: number): void {
    if (d.resting) return;

    d.vz -= GRAVITY * dt;
    d.z += d.vz * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.z > 0) return;

    d.z = 0;
    if (d.bounces === 0 && Math.abs(d.vz) > 15) {
      d.bounces++;
      d.vz = -d.vz * 0.3;
      d.vx *= 0.52;
      d.vy *= 0.52;
      return;
    }

    d.vx = 0;
    d.vy = 0;
    d.vz = 0;
    d.resting = true;
  }

  private pull(d: CollectibleDrop, dt: number, target: CollectibleTarget): boolean {
    const oldX = d.x;
    const oldY = d.y;
    const dx = target.x - d.x;
    const dy = target.y - d.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= COLLECT_DISTANCE) return true;

    // 先轻轻离地，再迅速追上人物。最高速度远大于奔跑速度，所以玩家不会把已触发的宝石甩掉。
    d.pullSpeed = Math.min(300, d.pullSpeed + 720 * dt);
    const step = Math.min(distance, d.pullSpeed * dt);
    d.x += (dx / distance) * step;
    d.y += (dy / distance) * step;
    d.z += (COLLECT_HEIGHT - d.z) * Math.min(1, dt * 11);

    // 这两个点故意落后于宝石，绘制时连成短光尾；目标移动时尾巴也会自然弯向旧位置。
    const follow = Math.min(1, dt * 7);
    d.trailX += (oldX - d.trailX) * follow;
    d.trailY += (oldY - d.trailY) * follow;
    return Math.hypot(target.x - d.x, target.y - d.y) <= COLLECT_DISTANCE;
  }

  private emitBurst(x: number, y: number): void {
    const burst = { x, y, age: 0, phase: Math.random() * Math.PI * 2 };
    if (this.bursts.length < MAX_BURSTS) this.bursts.push(burst);
    else this.bursts[Math.floor(Math.random() * MAX_BURSTS)] = burst;
  }

  private swapRemoveDrop(i: number): void {
    const last = this.drops.length - 1;
    if (i !== last) this.drops[i] = this.drops[last];
    this.drops.pop();
    if (this.drops.length > 0) this.replaceAt %= this.drops.length;
    else this.replaceAt = 0;
  }

  private swapRemoveBurst(i: number): void {
    const last = this.bursts.length - 1;
    if (i !== last) this.bursts[i] = this.bursts[last];
    this.bursts.pop();
  }

  draw(
    shapes: ShapeBatch,
    camX: number,
    camY: number,
    rootX: number,
    rootY: number,
    scale: number,
    depthOf: (worldY: number) => number,
    viewport?: { width: number; height: number },
  ): void {
    const toScreen = (x: number, y: number, z: number) =>
      v2(
        rootX + (x - camX) * scale,
        rootY + ((y - camY) * Projection.groundSquash - z * Projection.heightSquash) * scale,
      );

    const inView = (x: number, y: number, z: number): boolean => {
      if (!viewport) return true;
      const sx = rootX + (x - camX) * scale;
      const sy = rootY + ((y - camY) * Projection.groundSquash - z * Projection.heightSquash) * scale;
      const margin = 9 * scale;
      return sx >= -margin && sx <= viewport.width + margin && sy >= -margin && sy <= viewport.height + margin;
    };
    const visible = this.visibleDrops;
    visible.length = 0;
    for (const d of this.drops) {
      if (inView(d.x, d.y, d.z + 2) || inView(d.x, d.y, 0) ||
          (d.pulling && inView(d.trailX, d.trailY, Math.max(1.4, d.z)))) visible.push(d);
    }
    this.drawn = visible.length;

    for (const d of visible) {
      // 大量静止宝石保留四层宝石轮廓；落地/吸附中的宝石继续完整发光。
      const detailed = visible.length <= 160 || !d.resting || d.pulling || d.age < 2;
      const depth = depthOf(d.y) + 0.25;
      const bob = d.resting ? 1.65 + Math.sin(d.age * 5.4 + d.phase) * 0.38 : 0;
      const displayZ = d.z + bob;
      const at = toScreen(d.x, d.y, displayZ);
      const ground = toScreen(d.x, d.y, 0);
      const pulse = 0.88 + Math.sin(d.age * 7 + d.phase) * 0.12;
      const r = 1.55 * scale * pulse;

      if (detailed) shapes.ellipse(ground, 2.6 * scale, 1.1 * scale, 0, rgba(12, 31, 34, 105), depth - 0.4);
      if (d.resting && detailed) {
        shapes.ellipseRing(
          ground,
          (3.2 + pulse * 0.6) * scale,
          (1.25 + pulse * 0.24) * scale,
          0,
          Math.max(0.55, 0.34 * scale),
          rgba(66, 238, 255, 56),
          depth - 0.35,
          14,
        );
      }

      if (d.pulling) {
        const tail = toScreen(d.trailX, d.trailY, Math.max(1.4, displayZ * 0.72));
        shapes.capsule(tail, at, Math.max(1.2, scale * 0.75), rgba(83, 239, 255, 112), depth - 0.15);
        shapes.disc(at, r * 2.35, rgba(68, 229, 255, 50), depth - 0.1);
      } else if (detailed) {
        shapes.disc(at, r * 1.9, rgba(68, 229, 255, 32), depth - 0.1);
      }

      // 旋转方块在像素尺寸下就是最清楚的宝石轮廓；三层色阶再加一块偏上的白色切面，让它不是
      // 普通蓝色掉落点。轻微摆动只改变切面角度，不会像整颗陀螺一样看不清。
      const angle = Math.PI * 0.25 + Math.sin(d.age * 6.2 + d.phase) * 0.08;
      shapes.rect(at, r * 2.18, r * 2.18, angle, rgba(8, 54, 82, 255), depth);
      shapes.rect(at, r * 1.76, r * 1.76, angle, rgba(34, 205, 236, 255), depth + 0.02);
      shapes.rect(v2(at.x - r * 0.18, at.y - r * 0.22), r * 0.92, r * 0.78, angle, rgba(139, 250, 255, 255), depth + 0.04);
      shapes.disc(v2(at.x - r * 0.28, at.y - r * 0.42), Math.max(0.6, r * 0.22), rgba(241, 255, 255, 245), depth + 0.06);
    }

    for (const burst of this.bursts) {
      if (!inView(burst.x, burst.y, COLLECT_HEIGHT)) continue;
      const t = burst.age / BURST_LIFE;
      const fade = 1 - t;
      const at = toScreen(burst.x, burst.y, COLLECT_HEIGHT);
      const depth = depthOf(burst.y) + 0.7;
      const radius = (1.5 + t * 5.5) * scale;
      shapes.disc(at, radius * 0.7, rgba(107, 244, 255, Math.round(72 * fade)), depth);
      shapes.ellipseRing(
        at,
        radius,
        radius,
        0,
        Math.max(0.7, scale * 0.5 * fade),
        rgba(210, 255, 255, Math.round(220 * fade)),
        depth + 0.02,
        16,
      );
      for (let k = 0; k < 4; k++) {
        const angle = burst.phase + (Math.PI * 2 * k) / 4;
        const inner = radius * 0.35;
        const outer = radius * (0.8 + 0.2 * fade);
        shapes.bar(
          v2(at.x + Math.cos(angle) * inner, at.y + Math.sin(angle) * inner),
          v2(at.x + Math.cos(angle) * outer, at.y + Math.sin(angle) * outer),
          Math.max(0.7, scale * 0.42 * fade),
          rgba(235, 255, 255, Math.round(230 * fade)),
          depth + 0.04,
        );
      }
    }
  }
}
