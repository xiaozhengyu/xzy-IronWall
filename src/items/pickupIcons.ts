import pillHpUrl from '../../assets/hud/item/pill/pill-01.png';
import pillMpUrl from '../../assets/hud/item/pill/pill-03.png';
import charmSwiftUrl from '../../assets/hud/item/talisman/talisman-01.png';
import charmWardUrl from '../../assets/hud/item/talisman/talisman-04.png';
import pillHpOverTimeUrl from '../../assets/hud/item/pill/pill-05.png';
import pillMpOverTimeUrl from '../../assets/hud/item/pill/pill-07.png';
import charmRageUrl from '../../assets/hud/item/talisman/talisman-06.png';
import charmGaleUrl from '../../assets/hud/item/talisman/talisman-02.png';
import charmAegisUrl from '../../assets/hud/item/talisman/talisman-08.png';
import charmMagnetUrl from '../../assets/hud/item/talisman/talisman-09.png';
import charmFortuneUrl from '../../assets/hud/item/talisman/talisman-10.png';
import { Assets, type Texture } from 'pixi.js';

/**
 * 药和符用哪张图。**地上那一件和快捷栏那一格是同一张**，不另画。
 *
 * 和 data/pickups.ts 分开是被迫的，也是对的：战斗那一侧要读掉落表，而它得能在 node 里空跑
 * 验数（tools/ 下那些离线脚本），png 一进去 esbuild 就没有 loader 了。所以数据那边只有 id，
 * 图在这里按 id 配。
 *
 * 掉在地上的那一件走的也是这张图（Scene 拿它建精灵），所以玩家在草地上看到的和快捷栏里数着
 * 的是同一个东西 —— 这正是"不用自己绘制、直接用 icon"的意思。
 */
export const PICKUP_ICONS: Record<string, string> = {
  'potion-hp': pillHpUrl,
  'potion-mp': pillMpUrl,
  // 慢慢回那两种另给一张图：和一口闷的那两种是不同的东西，图一样的话地上躺着的时候分不出。
  'potion-hp-over-time': pillHpOverTimeUrl,
  'potion-mp-over-time': pillMpOverTimeUrl,
  'charm-swift': charmSwiftUrl,
  'charm-ward': charmWardUrl,
  'charm-magnet': charmMagnetUrl,
  /*
   * 商店独有的四张。各用一张没人用过的符篓图。
   *
   * 写在这里而不是商店自己再配一份：这一张表同时给快捷栏、地上那件、小地图和结算页
   * 供图。商店跟着用同一份，**买的时候看到的图和进去之后快捷栏里那一格就是同一张** ——
   * 否则玩家要把"我买的那个"和"栏里这个"对上号，而这两个本来就是一件东西。
   */
  'charm-rage': charmRageUrl,
  'charm-gale': charmGaleUrl,
  'charm-aegis': charmAegisUrl,
  'charm-fortune': charmFortuneUrl,
};

export const pickupIcon = (id: string): string => PICKUP_ICONS[id] ?? pillHpUrl;


/**
 * 药和符的贴图。**必须先 load 再用。**
 *
 * 这是个踩过的坑：Pixi v8 的 `Texture.from(url)` **不是加载器**，它只在缓存里按 id 找，找不到
 * 就抛。写成那样的后果是每一帧 draw 都抛一次异常 —— 画面定住，而战斗其实还在跑，看着就是
 * "进游戏卡住了"。这个工程里所有贴图都走 `Assets.load`（见 items/renderer.ts 的 ItemSheet），
 * 这里也一样。
 *
 * 加载失败不算错，和 ItemSheet 同一个取向：拿不到图就不画图标，脚下那圈光环照旧，玩家仍然
 * 看得见地上有东西、也照样捡得起来。一张图没画好不该让人进不去游戏。
 */
const textures = new Map<string, Texture>();

export async function loadPickupTextures(): Promise<void> {
  await Promise.all(Object.entries(PICKUP_ICONS).map(async ([id, url]) => {
    try {
      const texture = await Assets.load<Texture>(url);
      // 像素图必须最近邻：整帧画完还要再放大一次，平滑过的图标在一片硬像素里一眼就是外来的。
      texture.source.scaleMode = 'nearest';
      textures.set(id, texture);
    } catch {
      // 这一件没图，画不出来就不画。
    }
  }));
}

/** 这一件的贴图。还没加载好、或者那张图不在，都返回 null。 */
export const pickupTexture = (id: string): Texture | null => textures.get(id) ?? null;

/**
 * 这一件的 `<img>`。小地图是一张普通的 2D 画布，它画不了 Pixi 的 Texture。
 *
 * 和上面那份 Texture 是同一个 url 的两种壳：战场上那一层走 Pixi（要和整帧一起被放大成像素），
 * 小地图走 canvas 的 drawImage。共用一个 url 就够了，浏览器只会真的下载一次。
 *
 * 没加载完就返回 null，调用方跳过这一件 —— 小地图上少一个标记，比抛一个异常好。
 */
const images = new Map<string, HTMLImageElement>();

export function pickupImage(id: string): HTMLImageElement | null {
  let image = images.get(id);
  if (!image) {
    image = new Image();
    image.src = pickupIcon(id);
    images.set(id, image);
  }
  return image.complete && image.naturalWidth > 0 ? image : null;
}
