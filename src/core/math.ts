// 从 overlord (MonoGame) 移植：那边用 Microsoft.Xna.Framework 的 Vector2/Vector3，
// 这里用普通对象加自由函数。人物一帧要算几十个关节点，所以所有函数都返回新对象，
// 不做原地修改 —— 可读性优先，等真的成为瓶颈时再改成写入目标对象的形式。

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const V3_ZERO: Vec3 = { x: 0, y: 0, z: 0 };
export const V3_UNIT_X: Vec3 = { x: 1, y: 0, z: 0 };
export const V3_UNIT_Y: Vec3 = { x: 0, y: 1, z: 0 };
export const V3_UNIT_Z: Vec3 = { x: 0, y: 0, z: 1 };

export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len3 = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const lenSq3 = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;

export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** 零向量退化成 +Z，和 overlord 的 Normalize 保持一致 —— 武器方向默认朝上。 */
export const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a);
  return l > 1e-5 ? mul3(a, 1 / l) : { x: 0, y: 0, z: 1 };
};

export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul2 = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len2 = (a: Vec2): number => Math.sqrt(a.x * a.x + a.y * a.y);
export const lenSq2 = (a: Vec2): number => a.x * a.x + a.y * a.y;

export const norm2 = (a: Vec2): Vec2 => {
  const l = len2(a);
  return l > 1e-5 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
};

export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const smoothStep = (t: number): number => t * t * (3 - 2 * t);
export const easeOut = (t: number): number => {
  const u = 1 - t;
  return 1 - u * u * u;
};
export const frac = (v: number): number => v - Math.floor(v);

/** 把 t 在 [from, to] 内映射到 0..1，区间外截断。 */
export const segment = (t: number, from: number, to: number): number =>
  clamp((t - from) / Math.max(to - from, 1e-4), 0, 1);

export const TWO_PI = Math.PI * 2;
export const PI_OVER_2 = Math.PI / 2;
