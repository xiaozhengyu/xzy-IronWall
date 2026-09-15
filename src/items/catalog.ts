import type { ItemDef } from './itemDef';

/**
 * 物品总表。
 *
 * 精灵表放在 public/ 下，所以路径是 '/items.png' 而不是 import 进来的 —— 这张图会随着
 * 补物品一直长，走 public 改图不用重新打包，Vite 也不会把它塞进 assets 哈希名里。
 *
 * 加一件物品就是往下面这张表里加一行：量出它在精灵表里的方框，写上编号和名字。改完按 I
 * 开物品图鉴就能看到，不用重启。
 *
 * 编号沿用参考图的行列：item1-0203 = example/item1.png 第 2 行第 3 个。这样对着参考图
 * 补图时不会漏也不会重。
 */
export const ITEM_SHEET = '/items.png';

/**
 * 还是空的 —— 等精灵表画好再往里填。格式：
 *
 *   { id: 'item1-0101', name: '草莓', category: 'food', frame: { x: 0, y: 0, w: 16, h: 16 } },
 *
 * frame 是精灵表上的像素坐标，不必每件一样大：长剑可以是 16×32，果子可以是 12×12，
 * 图鉴和以后的掉落都按各自的宽高摆，不会拉伸。
 */
export const ItemCatalog: ItemDef[] = [];
