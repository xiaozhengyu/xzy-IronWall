import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import type { BloodstainMark } from '../game/battle';
import type { Terrain } from '../world/terrain';
import { Projection } from './projection';

/** 纹理分块，击杀只重传有新血迹的那几块。 */
const CHUNK_SIZE = 128;

interface BloodstainChunk {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
  source: BufferImageSource;
  sprite: Sprite;
  hasPixels: boolean;
}

/**
 * 本局的地面血迹缓存。
 *
 * 不把标记画进每帧 ShapeBatch：击杀只在低分辨率 RGBA 地图的局部块上添像素，再上传被改动的
 * 块。血迹因此和敌人对象的生命周期脱开，而且击杀数增加不会让每帧图元跟着增长。
 */
export class BloodstainLayer {
  readonly container = new Container();

  private readonly chunks = new Map<number, BloodstainChunk>();
  private mapWidth = 0;
  private mapHeight = 0;
  private texWidth = 0;
  private texHeight = 0;
  private patchWidth = 0;
  private patchHeight = 0;

  /** 地图切换时旧纹理尺寸不能复用；同一张地图的新一局则保留块对象、清空像素。 */
  setTerrain(terrain: Terrain): void {
    if (this.mapWidth !== terrain.width || this.mapHeight !== terrain.height
      || this.texWidth !== terrain.texWidth || this.texHeight !== terrain.texHeight) {
      this.destroyChunks();
    } else {
      this.clear();
    }
    this.mapWidth = terrain.width;
    this.mapHeight = terrain.height;
    this.texWidth = terrain.texWidth;
    this.texHeight = terrain.texHeight;
    this.patchWidth = terrain.width / terrain.texWidth;
    this.patchHeight = terrain.height / terrain.texHeight;
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /** 一次批量烘入本帧所有击杀，并且每个脏块只更新一次纹理。 */
  addMany(marks: readonly BloodstainMark[]): void {
    if (this.texWidth <= 0 || this.texHeight <= 0 || marks.length === 0) return;
    const dirty = new Set<BloodstainChunk>();
    for (const mark of marks) this.stamp(mark, dirty);
    for (const chunk of dirty) {
      chunk.source.update();
      chunk.hasPixels = true;
      chunk.sprite.visible = true;
    }
  }

  /** 新的一局：清空所有已用块，保留块与 GPU 资源供下一局复用。 */
  clear(): void {
    for (const chunk of this.chunks.values()) {
      if (!chunk.hasPixels) continue;
      chunk.data.fill(0);
      chunk.source.update();
      chunk.hasPixels = false;
      chunk.sprite.visible = false;
    }
  }

  /** 和 GroundSurface 使用同一套相机投影，将已烘好的块贴回世界地面。 */
  layout(camX: number, camY: number, rootX: number, rootY: number, scale: number): void {
    if (this.patchWidth <= 0 || this.patchHeight <= 0) return;
    for (const chunk of this.chunks.values()) {
      if (!chunk.hasPixels) continue;
      // Terrain and GroundSurface use map coordinates from (0, 0) to (width, height).
      // Keep the chunk origin in that same coordinate system.
      const worldX = chunk.x * CHUNK_SIZE * this.patchWidth;
      const worldY = chunk.y * CHUNK_SIZE * this.patchHeight;
      chunk.sprite.width = chunk.width * this.patchWidth * scale;
      chunk.sprite.height = chunk.height * this.patchHeight * Projection.groundSquash * scale;
      chunk.sprite.position.set(
        Math.round(rootX + (worldX - camX) * scale),
        Math.round(rootY + (worldY - camY) * Projection.groundSquash * scale),
      );
    }
  }

  private stamp(mark: BloodstainMark, dirty: Set<BloodstainChunk>): void {
    if (mark.x < 0 || mark.x >= this.mapWidth || mark.y < 0 || mark.y >= this.mapHeight) return;
    const centerX = Math.floor(mark.x / this.patchWidth);
    const centerY = Math.floor(mark.y / this.patchHeight);
    let seed = mark.seed >>> 0;
    const random = (): number => {
      seed = (Math.imul(seed || 1, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const radius = Math.max(2, Math.min(6, Math.round((mark.radius / this.patchWidth) * 0.75)));

    // 中心血洼：边缘刻意不均匀，缩到 1:1 纹理里仍然读成像素斑而非规则圆。
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        const distance = (x * x) / (radius * radius) + (y * y) / (radius * radius);
        if (distance > 1 || (distance > 0.5 && random() < 0.24)) continue;
        this.paintPixel(centerX + x, centerY + y, distance < 0.28, dirty);
      }
    }

    // 零散飞溅，半径随兵种体型变化，随机种子随击杀序号变化，回放和重绘都不会抖动。
    const droplets = 3 + Math.floor(random() * 5);
    for (let i = 0; i < droplets; i++) {
      const angle = random() * Math.PI * 2;
      const distance = radius * (1.25 + random() * 1.8);
      const x = centerX + Math.round(Math.cos(angle) * distance);
      const y = centerY + Math.round(Math.sin(angle) * distance);
      this.paintPixel(x, y, random() > 0.72, dirty);
      if (random() > 0.68) this.paintPixel(x + (random() > 0.5 ? 1 : -1), y, false, dirty);
    }
  }

  private paintPixel(x: number, y: number, center: boolean, dirty: Set<BloodstainChunk>): void {
    if (x < 0 || x >= this.texWidth || y < 0 || y >= this.texHeight) return;
    const chunkX = Math.floor(x / CHUNK_SIZE);
    const chunkY = Math.floor(y / CHUNK_SIZE);
    const chunk = this.chunkAt(chunkX, chunkY);
    const localX = x - chunkX * CHUNK_SIZE;
    const localY = y - chunkY * CHUNK_SIZE;
    const offset = (localY * chunk.width + localX) * 4;
    const oldAlpha = chunk.data[offset + 3];
    const alpha = center ? 172 : 124;

    // 重叠血迹加深，但透明层保持稀薄，避免一段时间后整张地面变成不透光的红块。
    if (oldAlpha === 0) {
      chunk.data[offset] = center ? 150 : 184;
      chunk.data[offset + 1] = center ? 22 : 40;
      chunk.data[offset + 2] = center ? 32 : 48;
      chunk.data[offset + 3] = alpha;
    } else {
      chunk.data[offset] = Math.min(chunk.data[offset], center ? 132 : 164);
      chunk.data[offset + 1] = Math.min(chunk.data[offset + 1], center ? 20 : 30);
      chunk.data[offset + 2] = Math.min(chunk.data[offset + 2], center ? 30 : 38);
      chunk.data[offset + 3] = Math.min(230, oldAlpha + 18);
    }
    dirty.add(chunk);
  }

  private chunkAt(x: number, y: number): BloodstainChunk {
    const key = y * Math.ceil(this.texWidth / CHUNK_SIZE) + x;
    const old = this.chunks.get(key);
    if (old) return old;

    const width = Math.min(CHUNK_SIZE, this.texWidth - x * CHUNK_SIZE);
    const height = Math.min(CHUNK_SIZE, this.texHeight - y * CHUNK_SIZE);
    const data = new Uint8Array(width * height * 4);
    const source = new BufferImageSource({
      resource: data,
      width,
      height,
      scaleMode: 'nearest',
      alphaMode: 'premultiply-alpha-on-upload',
    });
    const sprite = new Sprite(new Texture({ source }));
    // Normal alpha preserves the red hue; multiply turned these low-channel blood colors nearly black.
    sprite.blendMode = 'normal';
    sprite.alpha = 0.74;
    sprite.visible = false;
    const chunk: BloodstainChunk = { x, y, width, height, data, source, sprite, hasPixels: false };
    this.chunks.set(key, chunk);
    this.container.addChild(sprite);
    return chunk;
  }

  private destroyChunks(): void {
    for (const chunk of this.chunks.values()) chunk.sprite.texture.destroy(true);
    this.chunks.clear();
    this.container.removeChildren();
  }
}
