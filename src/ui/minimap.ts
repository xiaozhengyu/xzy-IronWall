import type { Battle } from '../game/battle';
import type { Field } from '../game/field';
import type { Camera } from '../render/camera';

const CANVAS_SIZE = 256;
const TERRAIN_SIZE = 192;

/** 小地图内部视野倍率：1 显示整张地图，数值越大，玩家附近显示得越近。 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function viewCenter(target: number, span: number, extent: number): number {
  if (span >= extent) return extent * 0.5;
  return clamp(target, span * 0.5, extent - span * 0.5);
}

/**
 * 独立于 Pixi 战场的轻量 Canvas 小地图。
 *
 * 地形只在第一次绘制时烘一张低分辨率底图；玩家、敌人和镜头框逐帧覆盖。这样即便场上有上千
 * 个敌人，也不会为了小地图再跑一遍地形渲染器。
 */
export class Minimap {
  readonly canvas = document.createElement('canvas');

  private readonly context: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement | null = null;
  private terrainField: Field | null = null;
  private innerZoom = 1;

  constructor(zoom: number) {
    this.canvas.className = 'hud-minimap-canvas';
    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;
    this.canvas.setAttribute('aria-hidden', 'true');

    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is required for the minimap');
    this.context = context;
    this.zoom = zoom;
  }

  get zoom(): number {
    return this.innerZoom;
  }

  set zoom(value: number) {
    this.innerZoom = clamp(Number.isFinite(value) ? value : 1, MIN_ZOOM, MAX_ZOOM);
  }

  /** 按倍率缩放内部视野。factor > 1 放大，factor < 1 缩小。 */
  zoomBy(factor: number): void {
    if (factor > 0) this.zoom = this.innerZoom * factor;
  }

  draw(field: Field, battle: Battle, camera: Camera): void {
    if (this.terrainField !== field) this.bakeTerrain(field);

    const ctx = this.context;
    const size = CANVAS_SIZE;
    const radius = size * 0.5;
    const worldSize = Math.max(field.width, field.height);
    const span = worldSize / this.innerZoom;
    const centerX = viewCenter(battle.player.x, span, field.width);
    const centerY = viewCenter(battle.player.y, span, field.height);
    const left = centerX - span * 0.5;
    const top = centerY - span * 0.5;
    const scale = size / span;
    const mapX = (worldX: number): number => (worldX - left) * scale;
    const mapY = (worldY: number): number => (worldY - top) * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0c110e';
    ctx.fillRect(0, 0, size, size);

    if (this.terrain) {
      const paddingX = (worldSize - field.width) * 0.5;
      const paddingY = (worldSize - field.height) * 0.5;
      const sourceScale = TERRAIN_SIZE / worldSize;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        this.terrain,
        (left + paddingX) * sourceScale,
        (top + paddingY) * sourceScale,
        span * sourceScale,
        span * sourceScale,
        0,
        0,
        size,
        size,
      );
    }

    // 场地边界。拉近后它自然移出圆形裁剪区，不会额外占画面。
    ctx.strokeStyle = 'rgba(225, 205, 137, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mapX(0) + 0.5, mapY(0) + 0.5, field.width * scale - 1, field.height * scale - 1);

    // 当前主画面的世界范围，便于判断小地图倍率和实际视野的关系。
    ctx.strokeStyle = 'rgba(245, 231, 181, 0.42)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(
      mapX(camera.x - camera.halfW),
      mapY(camera.y - camera.halfH),
      camera.halfW * 2 * scale,
      camera.halfH * 2 * scale,
    );
    ctx.setLineDash([]);

    // 敌人统一进一条路径再填充，避免上千个点各自触发一次 Canvas fill。
    const enemyRadius = clamp(0.9 + this.innerZoom * 0.16, 1, 2.1);
    ctx.beginPath();
    for (const enemy of battle.minimapEnemyPositions()) {
      const x = mapX(enemy.x);
      const y = mapY(enemy.y);
      if (x < -enemyRadius || y < -enemyRadius || x > size + enemyRadius || y > size + enemyRadius) continue;
      ctx.moveTo(x + enemyRadius, y);
      ctx.arc(x, y, enemyRadius, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(207, 58, 48, 0.88)';
    ctx.fill();

    this.drawPlayer(mapX(battle.player.x), mapY(battle.player.y), battle.player.facing);

    // 内圈暗角既压住圆形裁剪边缘，也让贴边标记不和金框抢层次。
    const vignette = ctx.createRadialGradient(radius, radius, radius * 0.55, radius, radius, radius);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.82, 'rgba(0, 0, 0, 0.05)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.46)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  private drawPlayer(x: number, y: number, facing: number): void {
    const ctx = this.context;
    const length = 10;
    const width = 5.5;
    const cos = Math.cos(facing);
    const sin = Math.sin(facing);
    const sideX = -sin;
    const sideY = cos;

    ctx.save();
    ctx.shadowColor = 'rgba(255, 229, 121, 0.92)';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(x + cos * length, y + sin * length);
    ctx.lineTo(x - cos * 4 + sideX * width, y - sin * 4 + sideY * width);
    ctx.lineTo(x - cos * 1.5, y - sin * 1.5);
    ctx.lineTo(x - cos * 4 - sideX * width, y - sin * 4 - sideY * width);
    ctx.closePath();
    ctx.fillStyle = '#f6df84';
    ctx.fill();
    ctx.strokeStyle = '#35230e';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  private bakeTerrain(field: Field): void {
    const terrain = document.createElement('canvas');
    terrain.width = TERRAIN_SIZE;
    terrain.height = TERRAIN_SIZE;
    const ctx = terrain.getContext('2d');
    if (!ctx) return;

    const image = ctx.createImageData(TERRAIN_SIZE, TERRAIN_SIZE);
    const worldSize = Math.max(field.width, field.height);
    const paddingX = (worldSize - field.width) * 0.5;
    const paddingY = (worldSize - field.height) * 0.5;

    for (let py = 0; py < TERRAIN_SIZE; py++) {
      const worldY = ((py + 0.5) / TERRAIN_SIZE) * worldSize - paddingY;
      for (let px = 0; px < TERRAIN_SIZE; px++) {
        const worldX = ((px + 0.5) / TERRAIN_SIZE) * worldSize - paddingX;
        const offset = (py * TERRAIN_SIZE + px) * 4;
        if (worldX < 0 || worldY < 0 || worldX > field.width || worldY > field.height) {
          image.data[offset + 3] = 0;
          continue;
        }

        const material = field.terrain.sample(worldX, worldY);
        const shade = clamp(0.88 + material.shade * 0.07, 0.78, 1);
        const water = material.water;
        const forest = material.forest * (1 - water);
        const dirt = material.dirt * (1 - water) * (1 - forest);
        const grass = Math.max(0, 1 - water - forest - dirt);

        image.data[offset] = Math.round((water * 31 + forest * 31 + dirt * 101 + grass * 67) * shade);
        image.data[offset + 1] = Math.round((water * 74 + forest * 64 + dirt * 83 + grass * 91) * shade);
        image.data[offset + 2] = Math.round((water * 88 + forest * 38 + dirt * 48 + grass * 48) * shade);
        image.data[offset + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    this.terrain = terrain;
    this.terrainField = field;
  }
}
