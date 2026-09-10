import { PlayerPresets } from './battle';
import type { SkillId } from './skills';

/**
 * 备战界面上能选的出战角色。
 *
 * 和 PlayerPresets 的分工：那张表是**画成什么样**（一份 UnitDef，八个都在，包括杂兵和弓手
 * 这些本来就是给调试用的形象）；这张表是**能选谁上场**，多出来的是名字、定位、一句玩法介绍
 * 和一套默认技能 —— 全是界面上要读的东西，一个都不影响战斗。
 *
 * 所以这里只挑三个：双锤武将、骑士、披风剑士。三个人的轮廓在人堆里一眼分得开（双锤最宽、
 * 骑士有盾、剑士有披风），这是选人界面唯一真正要求的东西。想加人就往这张表里加一条，
 * 界面自己会长出来。
 *
 * **一个数值都没有。** 生命、法力、等级在界面上一律显示 `—` —— 见 doc/游戏流程.txt：这一版
 * 只串流程，摆出来的数字迟早会和真正的数值对不上，而对不上的数字比没有数字更糟。
 */
export interface HeroDef {
  id: string;
  /**
   * 在 PlayerPresets 里的下标。换角色最终就是 battle.setPreset(preset) 这一句 ——
   * 界面不知道 UnitDef 是什么，它只知道选中的是第几号形象。
   */
  preset: number;
  name: string;
  /** 一句定位，列表里跟在名字下面。 */
  tagline: string;
  /** 一句玩法介绍，右栏用。 */
  blurb: string;
  /**
   * 这个角色默认带的技能。
   *
   * 顺序无所谓：装进去的时候按 skills.ts 里各自的 category 分流（自动攻击单选、护身单选、
   * 发射可多带、主动技依次占 Q/W/E/R），规则在 SkillLoadout 那一边，这里只写"带哪几个"。
   */
  skills: SkillId[];
}

export const Roster: HeroDef[] = [
  {
    id: 'warlord',
    preset: 0,
    name: '双锤武将',
    tagline: '近身横扫',
    blurb: '两柄重锤扫开身前一片，站在人堆中间也能把人堆推开。',
    skills: ['sweep', 'lunge', 'aegis', 'ironBody'],
  },
  {
    id: 'knight',
    preset: 7,
    name: '骑士',
    tagline: '持盾破阵',
    blurb: '一手剑一手盾，靠回旋清开贴身的人，再顶着盾冲进下一堆。',
    skills: ['spin', 'lunge', 'dharma', 'ironBody'],
  },
  {
    id: 'swordsman',
    preset: 1,
    name: '披风剑士',
    tagline: '远程破空',
    blurb: '出手最远的一个：一道破空推出去，路过的都倒，自己不用挤进人堆。',
    skills: ['wave', 'heavenSplit', 'skyArrow', 'aegis', 'ironBody'],
  },
  {
    id: 'rider',
    // PlayerPresets 里的 lancer，见 battle.ts 那张表。
    preset: 10,
    name: '骠骑将军',
    tagline: '马上长枪',
    blurb: '唯一骑马的一个：坐在鞍上比谁都高，枪够得也最远，靠冲进去再冲出来打。',
    // 突进配长枪：这个角色的打法就是"冲过去、扎一下、再冲出来"，所以两个位移技都带上。
    skills: ['sweep', 'lunge', 'heavenSplit', 'aegis', 'ironBody'],
  },
];

/** 这个角色长什么样。界面画头像和模型预览都从这里取。 */
export function heroUnitDef(hero: HeroDef) {
  return PlayerPresets[hero.preset].make();
}

export function heroById(id: string): HeroDef {
  return Roster.find((hero) => hero.id === id) ?? Roster[0];
}
