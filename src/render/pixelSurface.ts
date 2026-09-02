import { Container, type Renderer, RenderTexture, Sprite } from 'pixi.js';

/**
 * 像素网格量化那一步：所有东西先画进一张很小的 render target，再用最近邻整数倍放大到窗口。
 * 移植自 overlord 的 Rendering.PixelSurface。
 *
 * 单位画在一张独立的透明层上，合成时先把这张层按四个方向各偏移一像素、染黑叠一遍，再把
 * 原色的那张压上去 —— 于是层上所有东西都被描了一圈一像素的暗边。整支军队只多五个 quad，
 * 所以描边是一次合成通道，而不是逐个单位去描。
 */
export class PixelSurface {
  private static readonly OUTLINE_OFFSETS = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  /** 地面等不需要描边的东西画在这里。 */
  readonly ground = new Container();
  /** 单位画在这里：整体会被描一圈暗边。 */
  readonly units = new Container();

  /** 像素缓冲的尺寸，也是世界坐标的可视范围。 */
  width = 0;
  height = 0;

  private dpr = 0;

  private base!: RenderTexture;
  private layer!: RenderTexture;
  private readonly composite = new Container();
  private readonly outlineSprites: Sprite[] = [];
  private layerSprite!: Sprite;

  /** 挂到 stage 上的那个精灵：放大后的整帧。 */
  readonly view = new Sprite();

  private readonly renderer: Renderer;
  private pixelScale: number;
  private readonly outlineColor: number;
  private readonly outlineAlpha: number;

  constructor(renderer: Renderer, scale = 4, outlineColor = 0x101216, outlineAlpha = 0.55) {
    this.renderer = renderer;
    this.pixelScale = scale;
    this.outlineColor = outlineColor;
    this.outlineAlpha = outlineAlpha;
  }

  /** 一个缓冲像素占多少个物理像素 —— 也就是画面的颗粒度。 */
  get scale(): number {
    return this.pixelScale;
  }

  set scale(value: number) {
    if (value === this.pixelScale) return;
    this.pixelScale = value;
    this.width = 0; // 逼迫下一次 resize 重建
  }

  /**
   * 按窗口尺寸重建缓冲。首帧和每次 resize 都要调。
   *
   * @param dpr 设备像素比。缓冲按**物理**像素来定尺寸、放大系数按 CSS 像素来算，这样一个
   *            缓冲像素正好落在整数个物理像素上。按 CSS 像素定尺寸的话，在 125% 缩放的
   *            屏幕上每个"像素"会时宽时窄 —— 那是像素画最典型的抖动。
   */
  resize(cssWidth: number, cssHeight: number, dpr = 1): void {
    const w = Math.max(1, Math.ceil((cssWidth * dpr) / this.pixelScale));
    const h = Math.max(1, Math.ceil((cssHeight * dpr) / this.pixelScale));
    if (w === this.width && h === this.height && dpr === this.dpr) return;

    this.width = w;
    this.height = h;
    this.dpr = dpr;

    this.base?.destroy(true);
    this.layer?.destroy(true);

    this.base = RenderTexture.create({ width: w, height: h, scaleMode: 'nearest', antialias: false });
    this.layer = RenderTexture.create({ width: w, height: h, scaleMode: 'nearest', antialias: false });

    this.composite.removeChildren();
    this.outlineSprites.length = 0;
    for (const [dx, dy] of PixelSurface.OUTLINE_OFFSETS) {
      const s = new Sprite(this.layer);
      s.position.set(dx, dy);
      s.tint = this.outlineColor;
      s.alpha = this.outlineAlpha;
      this.outlineSprites.push(s);
      this.composite.addChild(s);
    }
    this.layerSprite = new Sprite(this.layer);
    this.composite.addChild(this.layerSprite);

    this.view.texture = this.base;
    this.view.scale.set(this.pixelScale / dpr);
  }

  /** 画一帧：地面 → 单位层 → 带描边合成回底图。 */
  render(): void {
    this.renderer.render({ container: this.ground, target: this.base, clear: true });
    this.renderer.render({ container: this.units, target: this.layer, clear: true });
    this.renderer.render({ container: this.composite, target: this.base, clear: false });
  }

  destroy(): void {
    this.base?.destroy(true);
    this.layer?.destroy(true);
  }
}
