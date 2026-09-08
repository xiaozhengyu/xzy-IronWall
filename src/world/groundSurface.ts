import { BufferImageSource, Sprite, Texture } from 'pixi.js';
import { clamp } from '../core/math';
import { Projection } from '../render/projection';
import type { Terrain } from './terrain';
import { Weather } from './weather';

/**
 * 地面的两个图层，以及它们为什么必须分开。
 *
 *   底图  —— 材质、色阶、积雪堆、水洼。慢变：雪要十几秒才积满。烘成一张纹理，天气跨过
 *            档位时**分帧重烘**。
 *   云影  —— 连续飘动，一刻不停。烘不了，做成一张很小的叠加纹理，每帧重传，正片叠底。
 *
 * 分界线是"变得有多快"。把云影塞进底图意味着每帧重烘整张三十万像素的图；把积雪做成
 * 叠加层则会丢掉抖动切边 —— 而那条互相穿插的像素带正是雪看起来长在地里而不是盖在上面
 * 的全部原因。两件事各自走对了路。
 */

/**
 * 底图分几帧烘完。
 *
 * 晴天整片三十毫秒，雨雪天要多跑积水/积雪的覆盖判定，贵一倍多。按最贵的那种算，十六片
 * 让每帧稳定在两三毫秒以内 —— 分片的意义就是让最坏情况也看不出卡顿，而不是让平均情况好看。
 */
const BAKE_SLICES = 16;

/**
 * 天气量化到多少档才触发重烘。雪从零积到满走十几秒，二十五档意味着每半秒重烘一次，
 * 而每次重烘摊在十六帧里 —— 眼睛看到的是连续变白。
 */
const WEATHER_STEPS = 25;

/** 云稀到这个程度就当没有 —— 精灵收起来，那张图也不必再算。 */
const CLOUD_MIN = 0.01;

/**
 * 云影贴图多久重算一次，毫秒。
 *
 * 格点是 17×17 铺满整个视口的，一格三十几个世界单位宽，而云飘过一格要好几秒 —— 每帧重算
 * 一遍是拿一千多次 sin 和一次贴图上传去换一个看不出来的差别。三十赫兹的代价是镜头移动时
 * 影子最多贴着屏幕滑半格间隔的距离，而这张图本来就是线性采样的一团软斑，看不出边。
 */
const CLOUD_INTERVAL = 1000 / 30;

/** cloudsAt 取这个值表示"没云、已经清干净了"，云一回来它自然满足重算条件。 */
const CLOUDS_IDLE = Number.NEGATIVE_INFINITY;

export class GroundSurface {
  readonly sprite: Sprite;
  /** 云影叠加层，正片叠底压在底图上。 */
  readonly shadowSprite: Sprite;

  private readonly terrain: Terrain;
  private readonly weather: Weather;

  private readonly data: Uint8Array;
  private readonly source: BufferImageSource;
  private readonly texWidth: number;
  private readonly texHeight: number;

  private readonly shadowData: Uint8Array;
  private readonly shadowSource: BufferImageSource;
  private readonly shadowSize: number;

  /** 正在重烘时，下一片从哪一行开始；负数表示没有在重烘。 */
  private bakingRow = -1;
  /** 云影上一次重算是什么时候，毫秒。见 CLOUD_INTERVAL。 */
  private cloudsAt = CLOUDS_IDLE;
  private bakedKey = -1;
  private pendingKey = 0;

  /**
   * @param bakeNow 传 false 就把初始底图留给 bakeInitialSlice 分片烘。
   *
   *        整片一次烘晴天约三十毫秒 —— 单看不算什么，但它发生在第一帧之前，也就是白屏
   *        期间，而慢一点的机器上是这个数的三五倍。摊到加载条上之后，那段时间变成一根
   *        在走的进度条，代价只是构造函数多一个参数。
   */
  constructor(terrain: Terrain, weather: Weather, bakeNow = true) {
    this.terrain = terrain;
    this.weather = weather;

    this.texWidth = terrain.texWidth;
    this.texHeight = terrain.texHeight;
    this.data = new Uint8Array(this.texWidth * this.texHeight * 4);
    if (bakeNow) {
      terrain.bakeRows(this.data, weather, 0, this.texHeight);
      this.bakedKey = this.weatherKey();
    }

    this.source = new BufferImageSource({
      resource: this.data,
      width: this.texWidth,
      height: this.texHeight,
      scaleMode: 'nearest',
      alphaMode: 'premultiply-alpha-on-upload',
    });
    this.sprite = new Sprite(new Texture({ source: this.source }));

    // 云影的格点很粗（十几乘十几），但它要平滑地压在地面上，所以这一张用线性采样 ——
    // 这是整个画面里唯一不该硬边的东西：云影本来就没有边。
    this.shadowSize = Weather.latticeSize;
    this.shadowData = new Uint8Array(this.shadowSize * this.shadowSize * 4);
    this.shadowSource = new BufferImageSource({
      resource: this.shadowData,
      width: this.shadowSize,
      height: this.shadowSize,
      scaleMode: 'linear',
      alphaMode: 'premultiply-alpha-on-upload',
    });
    this.shadowSprite = new Sprite(new Texture({ source: this.shadowSource }));
    this.shadowSprite.blendMode = 'multiply';
  }

  /** 天气状态量化成一个整数键。变了就意味着底图要重烘。 */
  private weatherKey(): number {
    const snow = Math.round(this.weather.snowCover * WEATHER_STEPS);
    const wet = Math.round(this.weather.wetness * WEATHER_STEPS);
    return snow * (WEATHER_STEPS + 1) + wet;
  }

  /** 初始底图分成几片。加载条按这个数报进度。 */
  static readonly INITIAL_SLICES = BAKE_SLICES;

  /**
   * 烘初始底图的第 i 片（0 到 INITIAL_SLICES-1）。构造时传了 bakeNow=false 才需要调。
   *
   * 和运行中改天气走的那条分片重烘是同一个 bakeRows，区别只在于谁来推进度：那边由 update
   * 每帧推一片，这边由加载条推 —— 加载时还没有帧。
   */
  bakeInitialSlice(i: number): void {
    const slice = Math.ceil(this.texHeight / BAKE_SLICES);
    this.terrain.bakeRows(this.data, this.weather, i * slice, (i + 1) * slice);
    if (i >= BAKE_SLICES - 1) {
      this.bakedKey = this.weatherKey();
      this.source.update();
    }
  }

  /**
   * 每帧调。必要时推进一片重烘，并刷新云影。
   *
   * @param camX/camY 镜头中心的世界坐标，云影的格点铺在镜头周围。
   */
  update(camX: number, camY: number, halfW: number, halfH: number): void {
    // 重烘：一次一片。中途天气又变了也不重启 —— 让当前这一遍烘完，下一遍自然跟上，
    // 否则天气连续变化时永远烘不完第一遍。
    if (this.bakingRow < 0) {
      const key = this.weatherKey();
      if (key !== this.bakedKey) {
        this.bakingRow = 0;
        this.pendingKey = key;
      }
    }
    if (this.bakingRow >= 0) {
      const slice = Math.ceil(this.texHeight / BAKE_SLICES);
      this.terrain.bakeRows(this.data, this.weather, this.bakingRow, this.bakingRow + slice);
      this.bakingRow += slice;
      if (this.bakingRow >= this.texHeight) {
        this.bakingRow = -1;
        this.bakedKey = this.pendingKey;
      }
      this.source.update();
    }

    // 云影。格点直接来自 Weather，这里只是把它变成一张能贴的图。
    //
    // 没云就整段不做：晴天是默认档，那张图整个是白的，layout 里精灵本来也收着（同一个
    // CLOUD_MIN），算了也没人看。
    //
    // 但"没云"的第一帧还得再跑一次 prepareClouds：草、树、篝火每帧都在问 weather.cloudShade，
    // 而那个函数读的是 prepareClouds 写下的强度。不清零的话，云散了以后整片林子会一直留着
    // 最后那一档影子。跑完把 cloudsAt 记成 CLOUDS_IDLE，之后彻底停手 —— 而云一回来，这个
    // 值自然满足下面的重算条件，不用等间隔。
    if (this.weather.cloudiness <= CLOUD_MIN) {
      if (this.cloudsAt === CLOUDS_IDLE) return;
      this.weather.prepareClouds(camX - halfW, camY - halfH, camX + halfW, camY + halfH);
      this.cloudsAt = CLOUDS_IDLE;
      return;
    }

    const now = performance.now();
    if (now - this.cloudsAt < CLOUD_INTERVAL) return;
    this.cloudsAt = now;

    this.weather.prepareClouds(camX - halfW, camY - halfH, camX + halfW, camY + halfH);
    const lattice = this.weather.cloudLattice;
    for (let i = 0; i < lattice.length; i++) {
      const shade = lattice[i] * this.weather.cloudiness;
      // 正片叠底：阴影就是一个小于 1 的乘数。和 shadowed() 一样朝冷色压 —— 云影是被
      // 天空而不是被太阳照亮的地面，蓝通道掉得最少。
      const k = clamp(shade * 0.34, 0, 1);
      const o = i * 4;
      this.shadowData[o] = Math.round(255 * (1 - k));
      this.shadowData[o + 1] = Math.round(255 * (1 - k * 0.92));
      this.shadowData[o + 2] = Math.round(255 * (1 - k * 0.72));
      this.shadowData[o + 3] = 255;
    }
    this.shadowSource.update();
  }

  /** 把两个精灵摆到镜头下该在的位置。 */
  layout(camX: number, camY: number, rootX: number, rootY: number, scale: number, viewW: number, viewH: number): void {
    this.sprite.width = this.terrain.width * scale;
    this.sprite.height = this.terrain.height * Projection.groundSquash * scale;
    this.sprite.position.set(
      Math.round(rootX - camX * scale),
      Math.round(rootY - camY * Projection.groundSquash * scale),
    );

    // 云影铺满整个视口就够了 —— prepareClouds 正是按视口范围铺的格点，两者必须一致，
    // 否则影子会相对地面滑动。
    this.shadowSprite.width = viewW;
    this.shadowSprite.height = viewH;
    this.shadowSprite.position.set(0, 0);
    this.shadowSprite.visible = this.weather.cloudiness > CLOUD_MIN;
  }
}
