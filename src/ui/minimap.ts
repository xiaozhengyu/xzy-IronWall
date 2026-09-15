import type { Battle } from '../game/battle';
import type { Field } from '../game/field';
import type { Camera } from '../render/camera';
import fireIconUrl from '../../assets/hud/icon/fire.png';
import skullIconUrl from '../../assets/hud/icon/skull.png';
import { pickupImage } from '../items/pickupIcons';

const CANVAS_SIZE = 256;
const TERRAIN_SIZE = 192;

/** 小地图内部视野倍率：1 显示整张地图，数值越大，玩家附近显示得越近。 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

/**
 * 敌人点层多久重画一次，毫秒。
 *
 * 这是这张图上唯一按人数增长的开销：上千个怪，每帧一次遍历加一千次 arc。而这一层表达的
 * 是"哪一片有多密"，不是准星 —— 12 赫兹足够，眼睛读的是那团红斑的形状，不是某一个点。
 *
 * 点层烘在自己的画布上，并记下烘的那一刻对应的世界矩形；贴回来时按镜头差值整体平移，
 * 所以玩家跑动时这一层跟着平滑地移，只是层里的人比实际位置旧最多 83 毫秒 —— 换算到
 * 这张 256 像素的图上不足半个像素。玩家箭头不在这一层里，仍然逐帧画。
 */
const ENEMY_LAYER_INTERVAL = 1000 / 12;

/**
 * 药和符在小地图上画多大，画布像素。
 *
 * 14 看着大（这张图才 256 见方），但小了就白画：这些图标本身是十几像素的像素画，缩到八像素
 * 之后一瓶药和一张符长得一模一样，而"那边是什么"正是这个标记唯一要说的事。地上一次也就躺
 * 十几件，不会糊住地图。
 */
const PICKUP_MARKER = 14;
/** 贴边那一圈往里收多少，免得图标被外面那道金框切掉半个。 */
const PICKUP_EDGE_INSET = 3;
/** 篝火和首领那两个标记有多大。比药的图标大一圈：药是已经掉在地上的一件东西，而这两样是“你该往哪儿走”，它得先被看到。 */
const LANDMARK_SIZE = 9;

/**
 * 篝火和骷髅头那两张图。模块加载时建一次，不到位就这一帧不画。
 *
 * 和药符图标同一个取向（见 items/pickupIcons.ts）：图没好不该让小地图报错，也不该拿一个占位方块顶着。
 */
const loadIcon = (url: string): HTMLImageElement => {
  const image = new Image();
  image.src = url;
  return image;
};
const fireIcon = loadIcon(fireIconUrl);
const skullIcon = loadIcon(skullIconUrl);

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

  /** 敌人点层，以及它烘的那一刻对应的世界矩形。见 ENEMY_LAYER_INTERVAL。 */
  private enemyLayer: HTMLCanvasElement | null = null;
  private enemyContext: CanvasRenderingContext2D | null = null;
  private enemyLeft = 0;
  private enemyTop = 0;
  private enemyScale = 0;
  private enemyAt = -Infinity;

  /**
   * 内圈暗角的渐变。坐标只跟画布尺寸有关，而画布尺寸是常量，所以建一次就够 ——
   * 每帧 new 一个 CanvasGradient 是纯粹的白扔。
   */
  private readonly vignette: CanvasGradient;

  constructor(zoom: number) {
    this.canvas.className = 'hud-minimap-canvas';
    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;
    this.canvas.setAttribute('aria-hidden', 'true');

    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is required for the minimap');
    this.context = context;
    const radius = CANVAS_SIZE * 0.5;
    this.vignette = context.createRadialGradient(radius, radius, radius * 0.55, radius, radius, radius);
    this.vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    this.vignette.addColorStop(0.82, 'rgba(0, 0, 0, 0.05)');
    this.vignette.addColorStop(1, 'rgba(0, 0, 0, 0.46)');
    this.zoom = zoom;
  }

  get zoom(): number {
    return this.innerZoom;
  }

  set zoom(value: number) {
    this.innerZoom = clamp(Number.isFinite(value) ? value : 1, MIN_ZOOM, MAX_ZOOM);
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

    // 敌人点层。整层贴回来，位移取整：贴到半个像素上会被插值糊掉，而这些点只有一两像素宽。
    this.refreshEnemies(battle, left, top, scale);
    if (this.enemyLayer) {
      const smoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        this.enemyLayer,
        Math.round((this.enemyLeft - left) * scale),
        Math.round((this.enemyTop - top) * scale),
      );
      ctx.imageSmoothingEnabled = smoothing;
    }

    this.drawPickups(battle, mapX, mapY, radius);
    this.drawLandmarks(field, battle, mapX, mapY, radius);
    this.drawPlayer(mapX(battle.player.x), mapY(battle.player.y), battle.player.facing);

    // 内圈暗角既压住圆形裁剪边缘，也让贴边标记不和金框抢层次。
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  /**
   * 把所有敌人重新烘进点层。到点了才做，见 ENEMY_LAYER_INTERVAL。
   *
   * 缩放变了也要立刻重烘：贴回来那一步只平移不缩放，比例对不上就整层错位。
   */
  private refreshEnemies(battle: Battle, left: number, top: number, scale: number): void {
    const now = performance.now();
    if (this.enemyLayer && scale === this.enemyScale && now - this.enemyAt < ENEMY_LAYER_INTERVAL) return;

    if (!this.enemyContext) {
      const layer = document.createElement('canvas');
      layer.width = CANVAS_SIZE;
      layer.height = CANVAS_SIZE;
      const context = layer.getContext('2d');
      if (!context) return; // 拿不到就退回"不画敌人"，别把整张小地图拖下水。
      this.enemyLayer = layer;
      this.enemyContext = context;
    }

    const ctx = this.enemyContext;
    const size = CANVAS_SIZE;
    ctx.clearRect(0, 0, size, size);

    // 统一进一条路径再填充，避免上千个点各自触发一次 Canvas fill。
    const enemyRadius = clamp(0.9 + this.innerZoom * 0.16, 1, 2.1);
    ctx.beginPath();
    for (const enemy of battle.minimapEnemyPositions()) {
      const x = (enemy.x - left) * scale;
      const y = (enemy.y - top) * scale;
      if (x < -enemyRadius || y < -enemyRadius || x > size + enemyRadius || y > size + enemyRadius) continue;
      ctx.moveTo(x + enemyRadius, y);
      ctx.arc(x, y, enemyRadius, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(207, 58, 48, 0.88)';
    ctx.fill();

    this.enemyLeft = left;
    this.enemyTop = top;
    this.enemyScale = scale;
    this.enemyAt = now;
  }

  /**
   * 地上还没捡的药和符。
   *
   * 圈里的画在它该在的位置上，**圈外的贴到边上**，贴的仍然是那件东西自己的图标 —— 不是箭头。
   * 箭头只能说"那边有东西"，而这一栏真正要回答的是"那边有什么，值不值得跑一趟"：地上同时
   * 躺着一瓶血和一张符时，箭头把两者说成了同一件事。
   *
   * 图标一律画满不缩小，贴边的那些也一样：小地图上一个八像素的东西再按距离缩就读不出是什么
   * 了。远近由位置交代，是什么由图交代，两件事不抢同一个通道。
   */
  private drawPickups(
    battle: Battle,
    mapX: (worldX: number) => number,
    mapY: (worldY: number) => number,
    radius: number,
  ): void {
    battle.collectibles.refreshPickupMarkers();
    const markers = battle.collectibles.pickupMarkers;
    if (markers.length === 0) return;

    const ctx = this.context;
    const size = PICKUP_MARKER;
    const half = size * 0.5;
    // 贴边那一圈压在暗角里侧一点，免得图标被金框切掉半个。
    const edge = radius - half - PICKUP_EDGE_INSET;
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    for (const marker of markers) {
      const image = pickupImage(marker.id);
      if (!image) continue; // 图还没加载好，这一件这一帧不画。
      let x = mapX(marker.x);
      let y = mapY(marker.y);
      const dx = x - radius;
      const dy = y - radius;
      const dist = Math.hypot(dx, dy);
      if (dist > edge) {
        // 贴到圆周上，方向不变 —— 玩家照着这个方向跑就能碰到它。
        const k = edge / (dist || 1);
        x = radius + dx * k;
        y = radius + dy * k;
        // 贴边的加一圈底，免得压在地形上读不出轮廓。
        ctx.fillStyle = 'rgba(8, 12, 10, 0.62)';
        ctx.beginPath();
        ctx.arc(x, y, half + 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.drawImage(image, Math.round(x - half), Math.round(y - half), size, size);
    }

    ctx.imageSmoothingEnabled = smoothing;
  }

  /**
   * 篝火和首领。两样东西现在是药的全部来源（见 battle.ts 的掉落），而“要去哪儿”是个真问题 ——
   * 不标在图上的话，玩家只能漫无目的地走，那就不是路线而是碰运气了。
   *
   * 两者都贴边，和地上那些药一个画法：超出小地图的就按方向压到圆周上，照着跑就能碰到。
   */
  private drawLandmarks(
    field: Field,
    battle: Battle,
    mapX: (worldX: number) => number,
    mapY: (worldY: number) => number,
    radius: number,
  ): void {
    const ctx = this.context;
    const edge = radius - LANDMARK_SIZE - PICKUP_EDGE_INSET;
    const put = (wx: number, wy: number, draw: (x: number, y: number) => void): void => {
      let x = mapX(wx);
      let y = mapY(wy);
      const dx = x - radius;
      const dy = y - radius;
      const dist = Math.hypot(dx, dy);
      if (dist > edge) {
        const k = edge / (dist || 1);
        x = radius + dx * k;
        y = radius + dy * k;
      }
      ctx.fillStyle = 'rgba(8, 12, 10, 0.62)';
      ctx.beginPath();
      ctx.arc(x, y, LANDMARK_SIZE + 1.5, 0, Math.PI * 2);
      ctx.fill();
      draw(x, y);
    };

    // 两个标记都用现成的 icon（fire.png / skull.png）缩到小地图尺寸。用图而不是画：玩家在别处
    // 已经见过这两张图，同一张图在小地图上再出现一次，不需要再认一遍。
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    const size = LANDMARK_SIZE * 2;
    const half = size * 0.5;

    // 砸掉的篝火不标 —— 图上还标着一个已经没了的点，比不标还糟。
    if (fireIcon) {
      for (const fire of field.props.burning) {
        put(fire.x, fire.y, (x, y) => ctx.drawImage(fireIcon, Math.round(x - half), Math.round(y - half), size, size));
      }
    }
    if (skullIcon) {
      for (const boss of battle.bossPositions) {
        put(boss.x, boss.y, (x, y) => ctx.drawImage(skullIcon, Math.round(x - half), Math.round(y - half), size, size));
      }
    }

    ctx.imageSmoothingEnabled = smoothing;
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
