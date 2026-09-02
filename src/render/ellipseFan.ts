/**
 * 椭圆展开成扇形时的段数和采样表。
 *
 * 单独一个文件，是因为**两边都要用同一份**：线上是 PrimitiveMesh 写顶点缓冲，离线是
 * tools/preview.ts 自己光栅化出对照图。这两处一旦各写一份公式，出的图就和游戏里画的不是
 * 同一个东西了 —— 而那张对照图存在的全部意义就是"看见线上会是什么样"。
 *
 * 这个文件不依赖 Pixi，所以 node 里的离线工具能直接 import。
 */

/**
 * 半径多大给多少段，封顶 32。
 *
 * 沿用 Pixi buildCircle 的公式 ceil(2.3 × √(rx+ry)) × 4，不是砍到最省。离线逐像素比过：
 * 段数压到 6/8/12 那一档时，有 0.8% 的像素和原来不同（都在圆的边缘）；照这个公式走，差异
 * 降到 0.1%。
 *
 * 敢用大段数是因为三角形本身不要钱 —— 满屏一千人也就三十几万个三角形，GPU 根本不在乎。
 * 真正会疼的是每段一次 cos/sin，那笔开销由下面的查表消掉了。
 */
export function ellipseSegments(rx: number, ry: number): number {
  const n = Math.ceil(2.3 * Math.sqrt(rx + ry)) * 4;
  return n < 6 ? 6 : n > 32 ? 32 : n;
}

/**
 * 单位圆的采样表，按段数缓存。
 *
 * 不查表的话，八千多个椭圆乘二十来段就是每帧二十万次 cos/sin —— 那笔钱比它省下的三角形贵
 * 得多。段数只有十来种取值，表一次建好就一直用。
 */
const tables = new Map<number, Float32Array>();

export function unitCircle(n: number): Float32Array {
  let t = tables.get(n);
  if (!t) {
    t = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      t[i * 2] = Math.cos(a);
      t[i * 2 + 1] = Math.sin(a);
    }
    tables.set(n, t);
  }
  return t;
}
