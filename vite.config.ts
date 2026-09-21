import { defineConfig } from 'vite';

/**
 * 只有一条：产物里的路径必须是相对的。
 *
 * 默认的 `base: '/'` 会让 index.html 引 `/assets/index-xxx.js`，那是"站点根目录"。
 * 自己开服务器看没事，但发布出去的游戏**从来不在根目录上**：itch.io 把它塞进
 * `html-classic.itch.zone/html/<id>/`，CrazyGames 和 Poki 同样是子路径 + iframe，
 * CrazyGames 的技术要求里写死了"只能用相对路径，绝不要用绝对路径"。
 * 路径不改，传上去就是一屏白。
 *
 * `'./'` 让所有 import、图片、音频都按 index.html 所在的目录去找，放在哪一层都能跑。
 */
export default defineConfig({
  base: './',
});
