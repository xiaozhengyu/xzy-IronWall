import { Filter, GlProgram, UniformGroup } from 'pixi.js';
import type { WarpLens } from '../effects/warpField';

/**
 * 把整帧画面在几个圆里重采样一遍：黑洞那种扭曲。
 *
 * 这是这个工程里第二个自定义着色器（第一个是 PrimitiveMesh 的顶点批次），而且是唯一一个
 * 做**后处理**的。理由见 effects/warpField.ts 顶上那段：扭曲不能靠多画东西表达，它说的是
 * 已经画完的那块画面本身被拧了一下。
 *
 * 关键的一条：它跑在**放大之前**的小缓冲上。
 *
 * 放大之后再拧看起来更省事（给 stage 上那个精灵挂个滤镜就完了），但那样位移是按屏幕像素
 * 算的，而屏幕上一个"像素"其实是 magnify×magnify 个物理像素的方块 —— 拧出来的边会从方格
 * 变成锯齿状的斜线，整幅画面立刻不像像素画了。在小缓冲上拧，位移的最小单位就是一个游戏
 * 像素，方块还是方块，只是挪了位置。着色器里那句 floor(src) + 0.5 就是干这个的：把取样点
 * 钉在纹素中心，等于强制最近邻，滤镜自己那张中间纹理是不是线性过滤都不影响结果。
 */

/** 和 warpField.ts 的 MAX_LENSES 是同一个数。着色器里是定长循环，不能靠运行时长出来。 */
const LENS_MAX = 4;

/**
 * 顶点着色器抄的是 Pixi 的默认滤镜顶点（它没有导出，只能自带一份）。
 *
 * uOutputFrame / uInputSize / uOutputTexture 由滤镜系统的全局 uniform 组自动绑定，名字不能改。
 */
const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

/**
 * precision **highp** 是必须的，不是保险起见。
 *
 * 这里全程按像素坐标算，1080p 下能到一千多；mediump 只有十位尾数，在那个量级上分辨力大约
 * 是一个像素 —— 而 floor(src) 正好要在这个尺度上取整。用 mediump 的话取样点会随机跳到隔壁
 * 纹素，整个洞里布满闪烁的噪点。
 */
const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

/** xy = 圆心（帧内像素），zw = 横竖半径。 */
uniform vec4 uLens[${LENS_MAX}];
/** x = 强度（正炸负吸），y = 旋进，z = 明暗（正暗负亮），w = 亮边强度。 */
uniform vec4 uLensParam[${LENS_MAX}];
/** x = 亮边压在哪一圈（归一化半径），y = 亮边多锐，z = 那一圈上的折射量。 */
uniform vec4 uLensShape[${LENS_MAX}];
/** 有效区域的像素尺寸。滤镜给的中间纹理通常比这大一圈，取样必须夹在里面。 */
uniform vec2 uFrame;
uniform float uCount;
uniform vec3 uRimTint;

void main(void) {
    vec2 px = vTextureCoord * uInputSize.xy;
    vec2 src = px;
    float tone = 0.0;
    float rim = 0.0;

    for (int i = 0; i < ${LENS_MAX}; i++) {
        if (float(i) >= uCount) break;
        vec4 lens = uLens[i];
        vec2 d = px - lens.xy;
        // 先归一到单位圆再算，椭圆的洞和正圆的球才用同一套数。
        vec2 n = vec2(d.x / lens.z, d.y / lens.w);
        float r = length(n);
        if (r >= 1.0) continue;

        vec4 pm = uLensParam[i];
        float rr = max(r, 0.002);

        // 球面重映射。这是整个效果读作"球"而不是"凹陷"的地方。
        //
        // 取样半径 = r 的某次幂：指数 > 1 时中间被放大、外圈被压成薄薄一层（炸出来），
        // 指数 < 1 时反过来，外面的东西被压向中心（吸进去）。而 pow(1, 任何数) 恒等于 1 ——
        // 也就是说 r = 1 那一圈**一个像素都不动**，球有一条干净的圆边。上一版用的
        // "越靠核心越狠"的钟形衰减没有这条边，所以它只能读成一块被按凹的画面。
        float rs = pow(rr, exp(pm.x));

        // 亮边那一圈：一条窄带。它同时是**亮**的位置和**折射**的位置。
        //
        // 用同一条高斯带驱动两者不是为了省一次 exp，是为了保证扭曲正好压在光圈边缘上。
        // 分开给的话两者会差开一点，画面上就成了"光圈在这儿、扭曲在旁边"，读作两件事。
        //
        // 内部只留很轻的缩放（pow 那一项），真正看得出被拧了的地方在这条带上 —— 球体里面
        // 整片都在动的话，人和草会一起变形，那不是一个球，那是画面坏了。
        float e = (r - uLensShape[i].x) * uLensShape[i].y;
        float band = exp(-e * e);
        rs = max(rs + band * uLensShape[i].z, 0.0);

        // 旋进仍然按钟形收敛：拧是绕着核心发生的事，让它一直拧到边上会把那条圆边搅糊。
        float f = (1.0 - r) * (1.0 - r);
        float turn = pm.y * f;
        float ca = cos(turn);
        float sa = sin(turn);
        vec2 dir = n / rr;
        vec2 rot = vec2(dir.x * ca - dir.y * sa, dir.x * sa + dir.y * ca) * rs;
        src += vec2(rot.x * lens.z, rot.y * lens.w) - d;

        // 明暗是累加的：憋住的时候压暗，炸开的时候提亮，两个洞叠在一起该更亮/更暗。
        tone += f * pm.z;
        // 位置按每个洞自己给 —— 坑贴着内侧（那是被吸进去的东西堆住的地方），
        // 球贴着外壳（那是球面本身）。
        rim = max(rim, band * pm.w);
    }

    // 钉在纹素中心 = 最近邻。见文件顶上那段：这是画面还像不像像素画的分界。
    src = clamp(src, vec2(0.5), uFrame - 0.5);
    vec2 uv = (floor(src) + 0.5) / uInputSize.xy;
    vec4 c = texture(uTexture, uv);

    // 预乘 alpha，所以压暗和加亮都只动 rgb。压暗留一成底：全黑会在人堆里挖出一个纯黑的
    // 洞，那读作画面破了，不是有东西在那儿。
    c.rgb *= 1.0 - clamp(tone, 0.0, 0.9);
    c.rgb += uRimTint * (rim + max(-tone, 0.0)) * c.a;
    finalColor = c;
}
`;

export class WarpFilter extends Filter {
  private readonly lensData = new Float32Array(LENS_MAX * 4);
  private readonly paramData = new Float32Array(LENS_MAX * 4);
  private readonly shapeData = new Float32Array(LENS_MAX * 4);

  constructor() {
    const uniforms = new UniformGroup({
      // 数组要写成 type + size，不能写 array<...>：UniformGroup 的构造器会直接抛。
      uLens: { value: new Float32Array(LENS_MAX * 4), type: 'vec4<f32>', size: LENS_MAX },
      uLensParam: { value: new Float32Array(LENS_MAX * 4), type: 'vec4<f32>', size: LENS_MAX },
      uLensShape: { value: new Float32Array(LENS_MAX * 4), type: 'vec4<f32>', size: LENS_MAX },
      uFrame: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
      uCount: { value: 0, type: 'f32' },
      // 暖金，和回旋那圈冲击环（255,214,124）同一个色系 —— 一招里的东西该看着像一套。
      uRimTint: { value: new Float32Array([0.62, 0.5, 0.26]), type: 'vec3<f32>' },
    });

    super({
      glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'warp-lens' }),
      resources: { warpUniforms: uniforms },
      // 洞不会把画面拉出自己的圆外，所以不需要给滤镜留边；留了反而会让中间纹理变大。
      padding: 0,
      // 缓冲本来就是最终的像素网格，再乘一次分辨率等于又把它放大了一遍。
      resolution: 1,
      antialias: 'off',
    });
  }

  /**
   * 把这一帧的洞写进 uniform。
   *
   * @param frameW/frameH 有效画面的尺寸，缓冲像素。取样要夹在这个矩形里 —— 滤镜分配的中间
   *                      纹理往往更大，越界取到的是没画过的透明区，洞边上会啃出一圈黑。
   */
  setLenses(lenses: readonly WarpLens[], frameW: number, frameH: number): void {
    const count = Math.min(lenses.length, LENS_MAX);
    for (let i = 0; i < count; i++) {
      const lens = lenses[i];
      const o = i * 4;
      this.lensData[o] = lens.x;
      this.lensData[o + 1] = lens.y;
      // 半径不能是零，着色器里要拿它做除数。
      this.lensData[o + 2] = Math.max(lens.rx, 1);
      this.lensData[o + 3] = Math.max(lens.ry, 1);
      this.paramData[o] = lens.strength;
      this.paramData[o + 1] = lens.swirl;
      this.paramData[o + 2] = lens.tone;
      this.paramData[o + 3] = lens.rim;
      this.shapeData[o] = lens.rimAt;
      this.shapeData[o + 1] = lens.rimSharp;
      this.shapeData[o + 2] = lens.edge;
      this.shapeData[o + 3] = 0;
    }

    const uniforms = this.resources.warpUniforms.uniforms as {
      uLens: Float32Array;
      uLensParam: Float32Array;
      uLensShape: Float32Array;
      uFrame: Float32Array;
      uCount: number;
    };
    uniforms.uLens.set(this.lensData);
    uniforms.uLensParam.set(this.paramData);
    uniforms.uLensShape.set(this.shapeData);
    uniforms.uFrame[0] = frameW;
    uniforms.uFrame[1] = frameH;
    uniforms.uCount = count;
  }
}
