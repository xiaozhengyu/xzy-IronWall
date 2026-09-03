import { Assets, Rectangle, Texture } from 'pixi.js';
import { ITEM_SHEET } from './catalog';
import type { ItemDef } from './itemDef';

/**
 * 物品精灵表：加载一次，按 frame 切出每件东西的贴图。
 *
 * 只加载一张图而不是一件一个文件：物品会有七八十件，几十个请求换不来任何好处，而一张表
 * 还顺带保证了所有物品是同一个人、同一套色板、同一个时间画出来的 —— 这正是上一版用代码
 * 画时最难保住的东西。
 *
 * 切出来的 Texture 缓存住。它们共用同一块 source，只是各自框了一个矩形，所以缓存的是
 * 一点点元数据，不是几十份像素。
 */
export class ItemSheet {
  private source: Texture | null = null;
  private readonly frames = new Map<string, Texture>();

  /** 加载完成、可以取贴图了。 */
  get ready(): boolean {
    return this.source !== null;
  }

  /**
   * 加载精灵表。
   *
   * **图不在也不算错**：这个工程本来一张图都不加载，物品表是后补的，画好之前
   * public/items.png 根本不存在。让它在启动时抛异常，等于没画完图就进不去游戏。所以这里
   * 吞掉失败，ready 保持 false，图鉴那边显示一行提示。
   */
  async load(url = ITEM_SHEET): Promise<boolean> {
    try {
      const texture = await Assets.load<Texture>(url);
      // 像素图必须最近邻。默认的线性插值会把每一件东西的边糊掉，而整个画面又要再放大
      // 一次，糊上加糊。
      texture.source.scaleMode = 'nearest';
      this.source = texture;
      return true;
    } catch {
      this.source = null;
      return false;
    }
  }

  /** 这件物品的贴图。表还没加载、或者 frame 超出了图的范围，都返回 null。 */
  textureOf(def: ItemDef): Texture | null {
    const source = this.source;
    if (!source) return null;

    const hit = this.frames.get(def.id);
    if (hit) return hit;

    const { x, y, w, h } = def.frame;
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > source.width || y + h > source.height) {
      return null;
    }

    const cut = new Texture({ source: source.source, frame: new Rectangle(x, y, w, h) });
    this.frames.set(def.id, cut);
    return cut;
  }
}
