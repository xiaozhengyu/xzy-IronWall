import { clamp } from '../core/math';
import { FootstepEffects } from '../effects/footsteps';
import { GroundSurface } from '../world/groundSurface';
import { Props } from '../world/props';
import { DEFAULT_LAYOUT, Terrain, type TerrainLayout } from '../world/terrain';
import { Weather } from '../world/weather';
import type { Character } from './character';
import type { MapLandmark, ResolvedMapLandmark } from '../data/mapTypes';

/**
 * 打仗的那块地：地形、天气、营地、烘好的地面、留在地上的脚印。
 *
 * 和 Battle 的分界线是**变不变**，不是"是不是世界的一部分"。这里的东西在一局里基本是常量
 * （天气慢变、脚印是纯装饰），Battle 那边的东西每帧都在生死。分开之后，加地图元素只要动
 * 这个文件，加战斗规则只要动那个文件，两边都不用读对方。
 */
export class Field {
  readonly width: number;
  readonly height: number;

  readonly terrain: Terrain;
  readonly weather: Weather;
  readonly props: Props;
  readonly landmarks: readonly ResolvedMapLandmark[];
  readonly start: { x: number; y: number };
  /**
   * 地面分两层，分界线是"变得有多快"。
   *
   *   底图  —— 材质、色阶、积雪、水洼。慢变，烘成一张纹理，天气跨档时分帧重烘。
   *   云影  —— 连续飘动，每帧重传一张很小的图，正片叠底压上去。
   *
   * 草丛、石子、落叶**没有**烘进去，虽然它们确实不会变。原因是分辨率：地面纹理一个纹素是
   * 三个世界单位，而一丛草才两个单位宽、六个缓冲像素高 —— 比一个纹素还小。要烘它们得把纹理
   * 放大三十倍，整片场地就是一亿像素、四百兆显存。它们留在每帧的批次里还有两个好处：能随风
   * 摆、能被雪压短，也能和站在草里的人正确排序。代价是每帧一千多个图元，约等于二十个人。
   */
  readonly ground: GroundSurface;
  readonly footsteps = new FootstepEffects();

  /**
   * 人能走到离场地边缘多近，世界单位。
   *
   * 这个数不是随手定的。镜头被夹在场内（不然边上会露出场外的虚空），所以人越靠近边界，他在
   * 屏幕上就越贴边 —— 人离边界多少个世界单位，屏幕上就只剩多少乘缩放的像素。而人是从脚下
   * **往上**画的，顶边因此最吃亏：脚离屏幕顶只有 margin × groundSquash 那么远，身子却要往上
   * 长一整个身高。旧值是 12，于是走到顶边脑袋直接被切掉一半。
   *
   * 按"人贴到边界时，头顶之上还要空出一个身高"倒推：
   *
   *     margin × groundSquash ≥ 身高 × 2
   *
   * 身高 = (headZ + headRadius) × heightSquash ≈ 12.4 个单位，于是 margin ≥ 45。取 64，上面
   * 留出的余量正好是那片树墙 —— 人贴到底的时候，他身后还有六十几个单位的林子。
   *
   * 式子里没有 grain：两边都乘同一个缩放，所以从全景拉到特写都成立。
   *
   * 上限是树墙的厚度（terrain.borderWidth，约 132）：再往里退，树墙就会有一大半是玩家永远
   * 走不到的装饰。
   */
  readonly edgeMargin: number;

  /** 初始底图分成几片烘。加载条按这个数报进度。 */
  static readonly BAKE_SLICES = GroundSurface.INITIAL_SLICES;

  constructor(
    width: number,
    height: number,
    seed: number,
    layout: TerrainLayout = DEFAULT_LAYOUT,
    authoredLandmarks: readonly MapLandmark[] = [],
  ) {
    this.width = width;
    this.height = height;
    this.terrain = new Terrain(width, height, seed, layout);
    this.weather = new Weather();
    this.edgeMargin = Math.min(64, this.terrain.borderWidth * 0.75);
    this.landmarks = authoredLandmarks.map((landmark) => ({
      ...landmark,
      x: landmark.x * width,
      y: landmark.y * height,
    }));
    const start = this.landmarks.find((landmark) => landmark.kind === 'start');
    this.start = start ? { x: start.x, y: start.y } : { x: width * 0.5, y: height * 0.5 };

    // 底图先不烘，交给加载条分片烘 —— 理由见 GroundSurface 构造函数上那段注释。
    this.ground = new GroundSurface(this.terrain, this.weather, false);

    // 营地：帐篷和篝火。和树的区别在于**摆**还是**长** —— 树按噪声撒在林地里，营地是人选的
    // 位置，所以它是一个显式列表。
    this.props = new Props();
    if (this.landmarks.some((landmark) => landmark.kind === 'campfire')) {
      this.props.placeAuthored(this.terrain, this.landmarks);
    } else {
      this.props.place(this.terrain, 4);
    }
  }

  /** 烘初始底图的第 i 片。加载期间一片一片调，条才走得起来。 */
  bakeSlice(i: number): void {
    this.ground.bakeInitialSlice(i);
  }

  /** 把一个点夹回人能站的范围。 */
  clampX(x: number): number {
    return clamp(x, this.edgeMargin, this.width - this.edgeMargin);
  }
  clampY(y: number): number {
    return clamp(y, this.edgeMargin, this.height - this.edgeMargin);
  }

  /**
   * 推进天气和脚印。
   *
   * @param actors 场上所有人。脚步是从步态相位的跨越读触地的，所以一步正好一次 ——
   *               走在水里溅水花，走在雪上留脚印。
   */
  update(dt: number, actors: Iterable<Character>, focus: Character | null = null): void {
    this.weather.update(dt);
    this.footsteps.update(actors, dt, this.terrain, this.weather, focus);
  }
}
