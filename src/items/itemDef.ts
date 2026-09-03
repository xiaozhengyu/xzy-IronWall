/**
 * 一件物品是精灵表上的一块。
 *
 * 之前这里是一套图元语言（disc / ellipse / bar / capsule / sphere / ring），物品靠代码
 * 一笔一笔摆出来。放弃它的理由很直接：画得不够好。人物那套图元能成立，是因为人物是同一具
 * 骨架换比例和配色，几十个数调对了就全对；而七十多件物品各是各的形状，没有可复用的骨架，
 * 等于用代码画七十多张互不相干的画 —— 那是画笔干的活，不是代码干的活。
 *
 * 所以物品改成贴图，由人画。这个文件只剩"一件物品是什么"这一件事。
 */

export type ItemCategory = 'food' | 'material' | 'gear' | 'weapon' | 'treasure' | 'misc';

/** 精灵表上的一块，单位是精灵表自己的像素。 */
export interface ItemFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ItemDef {
  /** 稳定的编号。和参考图里的行列对得上，比如 'item1-0203' 是第一张图第 2 行第 3 个。 */
  id: string;
  /** 中文名。图鉴和以后的背包里显示的就是它。 */
  name: string;
  category: ItemCategory;
  /** 这件东西在精灵表里的位置。 */
  frame: ItemFrame;
}
