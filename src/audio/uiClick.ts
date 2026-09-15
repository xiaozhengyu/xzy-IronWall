import { play } from './sfx';

/**
 * 界面上所有按钮的点击声。
 *
 * **一个委托监听器，不是十八个 addEventListener。** 全工程有十八处 `el('button')`，分散在
 * 备战、商店、战绩、结算、卡牌、调试菜单六个文件里。挨个去接的话，接漏一个就少一声，
 * 而且以后每加一个按钮都得记得再接一次 —— 那种"必须记得"的约定迟早会破。挂在 document 上
 * 一次性解决，新按钮天生就有声音。
 *
 * **capture 阶段**：这几块界面里有好几处在自己的处理器里 stopPropagation（卡牌那块幕布、
 * 商店的卡片），冒泡阶段收不全。capture 从上往下走，谁也拦不住。
 *
 * **在 pointerdown 上响，不是 click。**这是第二版：第一版听的是 click，而 click 要等到
 * mouseup 才派发 —— 按下去到听见响，中间隔着玩家自己按键的那段时间（快的几十毫秒，慢的
 * 一两百）。加上素材前面那段空白，两头一凑就是"不跟手"。按钮的声音该在**按下去那一刻**响，
 * 这也是所有游戏的做法。
 *
 * 代价是按下去拖开再松手也会响一声，明明什么都没发生。接受它 —— 那是个罕见动作，
 * 而每一次正常点击都慢半拍是个常见问题。
 *
 * 键盘那条路单独接：pointerdown 对键盘激活（结算屏会主动把焦点放在"继续游戏"上，
 * 按 Enter 就走了）完全不触发。只听 Enter 和空格，且只在按钮自己身上 —— 重复按住不响，
 * 靠 repeat 挡掉。两条路各管各的事件，不会重复响。
 *
 * 禁用的按钮既不触发 pointerdown 的后续也不该响，所以显式判一下 disabled ——
 * click 会自动跳过禁用元素，pointerdown 不会，这是换事件带出来的一处。
 *
 * 不想要声音的按钮加 `data-silent` —— 目前一个都没有，留这个口子是因为以后一定会有
 * （比如音量条上的加减号，按住连点会变成一串噪音）。
 */
export function installUiClickSound(): void {
  const fire = (target: EventTarget | null): void => {
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!button || button.disabled || button.hasAttribute('data-silent')) return;
    play('hud-click');
  };
  addEventListener('pointerdown', (event) => fire(event.target), true);
  addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // 只认焦点真的在按钮上的那一下，否则满屏快捷键都会响。
    if (!(document.activeElement instanceof HTMLButtonElement)) return;
    fire(document.activeElement);
  }, true);
}
