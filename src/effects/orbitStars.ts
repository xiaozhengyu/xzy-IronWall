import { v2 } from '../core/math';
import { rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 磐石那几颗绕着人转的流星。
 *
 * 这是四个护身技里唯一**看得见**的那个。另外三个全是一包属性加成 —— 玩家拿到之后屏幕上什么
 * 都没变，只能靠信那行说明。流星换个方向解决同一件事：它一直在那儿转，你随时看得见自己带着
 * 它，升一级就多一颗，升级的回报也是看得见的。
 *
 * 画法上三件事凑成"一颗贴着地面飞的火球"：
 *
 *   地上一小块影   它是贴着地飞的，不是浮在半空。没有影子的话它读作画在镜头上的一个贴片，
 *                  和场上的人不在一个空间里。
 *   身后一条尾     尾巴指向**轨道的切线反方向**，不是指向玩家。指向玩家的话它读作被一根线
 *                  拴着甩，而不是自己在飞。
 *   核心两层       外面一圈暖橙的晕、里面一点近白的芯。单一个纯色圆点在一地碎片和血里会被
 *                  当成又一片碎片。
 *
 * 位置由 Battle 每帧算好（见 advanceOrbit），这里只管画 —— 打人的那一份和画出来的这一份
 * 读的是同一个角度，不会差半个身位。
 */

/**
 * 核心半径，世界单位。
 *
 * 1.9 的意思是直径四个单位出头，比一颗头大一圈 —— 人的躯干半宽是 2.3 上下，所以它还是比人窄。
 * 两边都碰过：3.4 时整颗球比骑士的盾还大，五颗转起来就是一圈橙色的墙；1.5 时挤进六十个红甲里
 * 又读作又一片碎屑（见 .preview-orbit.png 下排）。它要读作"绕着他飞的几颗火球"。
 */
const CORE = 1.9;
/**
 * 飞在离地多高。抬起来一点才像在飞，贴着地读作滚过去的石头。
 *
 * 10 大致是胸口那一档。原来的 6.5 在空地上没问题，一进人堆就埋进一片腿里了 —— 而玩家需要
 * 看见它的时候恰恰就是人最密的时候。
 */
const LIFT = 10;
/**
 * 尾巴拖过多少弧度，以及分几段采样。
 *
 * 走的是这个工程里第三条**同一种**轨迹：箭的拖尾按飞行时间往回采样，被掀飞的人按环形缓冲里
 * 存的旧坐标连线，流星最省 —— 它在一个圆上匀速转，过去在哪儿直接算得出来（角度减去转过的
 * 那一段），不用存任何历史。
 *
 * 三者的画法是一样的：从头往回连一串胶囊，越往回越淡越细。区别只有颜色 —— 箭是米白、人是
 * 近白、流星是橙。同一种运动感用同一种画法，玩家不用学第三种读法。
 *
 * 0.62 弧度大约是四分之一秒的行程（转速 2.5）。再长尾巴会绕过大半个轨道，读作一个圆环而不是
 * 一颗在飞的东西。
 */
const TAIL_ARC = 0.62;
const TAIL_SAMPLES = 7;

const CORE_HOT = rgba(255, 246, 214, 255);
const CORE_MID = rgba(255, 176, 62, 238);
const CORE_GLOW = rgba(255, 122, 34, 76);
/** 尾巴的色。比核心暗一档、偏红一点 —— 那是烧过之后正在冷的那一截。 */
const TAIL_R = 255;
const TAIL_G = 132;
const TAIL_B = 44;
const SHADOW = rgba(12, 10, 8, 96);

/**
 * @param cx/cy    玩家的世界坐标
 * @param angle    第 0 颗现在转到哪个角度
 * @param count    一共几颗（= 磐石的技能等级）
 * @param radius   轨道半径，世界单位
 * @param toScreen 世界坐标（含离地高度）换算到缓冲像素
 * @param depthOf  某一行的深度。流星和人共用一套排序，所以转到玩家身后时会被他挡住
 */
export function drawOrbitStars(
  shapes: ShapeBatch,
  cx: number,
  cy: number,
  angle: number,
  count: number,
  radius: number,
  scale: number,
  toScreen: (x: number, y: number, z: number) => { x: number; y: number },
  depthOf: (worldY: number) => number,
): void {
  if (count <= 0 || radius <= 0) return;

  const step = (Math.PI * 2) / count;
  const core = CORE * scale;

  for (let i = 0; i < count; i++) {
    const a = angle + step * i;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    const at = toScreen(x, y, LIFT);
    const ground = toScreen(x, y, 0);
    // 深度按流星自己那一行，不按玩家那一行：转到他身后时该被挡住，转到身前时该盖住他的腿。
    const depth = depthOf(y);

    shapes.ellipse(v2(ground.x, ground.y), core * 0.9, core * 0.9 * Projection.groundSquash, 0, SHADOW, depth - 0.3);

    /*
     * 尾巴：沿轨道往回采样，一段一段连过去，越往回越淡越细。
     *
     * 分段而不是一根直胶囊：轨道是弯的，一根直的会从圆心那一侧穿过去，读作一根插在人身上的
     * 棍子。分成七段之后它贴着轨道弯，那才是"飞过的痕迹"。
     */
    let head = at;
    for (let k = 1; k <= TAIL_SAMPLES; k++) {
      const t = k / TAIL_SAMPLES;
      const back = a - TAIL_ARC * t;
      const tail = toScreen(cx + Math.cos(back) * radius, cy + Math.sin(back) * radius, LIFT);
      const fade = 1 - t;
      const alpha = Math.round(170 * fade);
      if (alpha > 3) {
        shapes.capsule(
          v2(head.x, head.y),
          v2(tail.x, tail.y),
          Math.max(0.6, core * (0.26 + fade * 0.42)),
          rgba(TAIL_R, TAIL_G, TAIL_B, alpha),
          depth - 0.1,
        );
      }
      head = tail;
    }

    shapes.disc(v2(at.x, at.y), core * 1.7, CORE_GLOW, depth);
    shapes.disc(v2(at.x, at.y), core, CORE_MID, depth + 0.01);
    shapes.disc(v2(at.x - core * 0.22, at.y - core * 0.26), core * 0.42, CORE_HOT, depth + 0.02);
  }
}

/** 深度按屏幕行换算，和场上所有东西共用一套。抽出来是为了让离线出图也能用同一份。 */
export const orbitDepthPerRow = Projector.DEPTH_PER_ROW;
