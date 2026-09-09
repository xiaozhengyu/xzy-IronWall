import minimapFrameUrl from '../../assets/hud/minimap-frame.png';
import type { Battle } from '../game/battle';
import type { Field } from '../game/field';
import type { Camera } from '../render/camera';
import './hud.css';
import { Minimap } from './minimap';
import { HudProgressBar } from './hudProgressBar';
import { HudCardPicker } from './hudCardPicker';
import { HudFrame } from './hudFrame';
import { createHudButton } from './hudButton';
import { createHudIcon } from './hudIcons';
import { cursorImage } from './cursorImage';
import { HudWavePanel } from './hudWavePanel';
import { HudPlayerPanel } from './hudPlayerPanel';
import { HudQuickbar } from './hudQuickbar';
import { HUD_COOLDOWN_SKILLS, HudCooldownPanel } from './hudCooldownPanel';
import { HudText, type HudLocale } from './text/hudText';
export { createHudButton, type HudButtonOptions, type HudButtonSkin } from './hudButton';
export { HudProgressBar, type HudProgressBarOptions } from './hudProgressBar';
export { HudFrame, type HudFrameOptions, type HudFrameSkin } from './hudFrame';
export { createHudIcon, HUD_ICON_URLS, type HudIconName } from './hudIcons';
export { HudWavePanel, type HudWavePanelOptions } from './hudWavePanel';
export { HudPlayerPanel, type HudPlayerPanelOptions } from './hudPlayerPanel';
export {
  HudQuickbar,
  type HudQuickbarItemUse,
  type HudQuickbarOptions,
  type HudQuickSlotOptions,
} from './hudQuickbar';
export { HudCooldownPanel, type HudTimedEffect } from './hudCooldownPanel';
export { HudText, type HudLocale, type HudTextKey, type HudTextParams } from './text/hudText';

/** HUD 的设计坐标；窗口只缩放整层，不改变组件内部布局。 */
const HUD_DESIGN_WIDTH = 1920;
const HUD_DESIGN_HEIGHT = 1080;

/**
 * 小地图调节集中在这里：size 改整个 HUD 尺寸，zoom 改内部地图视野（1 = 整张地图）。
 * 也可以在 new Hud(host, options) 时覆盖，不必改组件实现。
 */
export const MINIMAP_SETTINGS = {
  size: '11.5%',
  zoom: 1.35,
};

/** 宝石进度只做循环显示，暂不接升级或奖励。 */
export const GEM_PROGRESS_SETTINGS = {
  width: '60%',
  height: '20px',
  gemsPerCycle: 100,
  sideOverhang: 0,
};

export interface HudOptions {
  minimapSize?: string;
  minimapZoom?: number;
  gemProgressWidth?: string;
  gemProgressHeight?: string;
  gemsPerCycle?: number;
  gemProgressSideOverhang?: number;
  requestPause?: () => void;
  locale?: HudLocale;
}

/**
 * 正式游戏 HUD。它挂在固定 16:9 的 gameViewport 里，不属于 ESC 调试菜单。
 *
 * 小地图与宝石进度各自封装为组件，位置在 hud.css、默认参数在本文件中调整。
 */
export class Hud {
  readonly root = document.createElement('div');
  readonly minimapLayer = document.createElement('div');
  readonly minimap: Minimap;
  readonly gemProgress: HudProgressBar;
  readonly playerInfo: HudPlayerPanel;
  readonly waveInfo: HudWavePanel;
  readonly currencyInfo: HudFrame;
  readonly quickbar: HudQuickbar;
  readonly cooldownInfo: HudCooldownPanel;
  readonly cards: HudCardPicker;
  readonly text: HudText;

  /** 灵石收满是否弹卡牌。菜单里可以关掉，关掉就是接这个功能之前的样子。 */
  cardsEnabled = true;

  private readonly combatPanel = new HudFrame({ className: 'hud-combat-panel' });
  private readonly vitals = document.createElement('div');
  private readonly progression = document.createElement('div');
  private readonly minimapDock = document.createElement('div');
  private readonly minimapElement = document.createElement('div');
  private readonly currencyValues = new Map<'gold' | 'energy', HTMLSpanElement>();
  private readonly hudPointer = document.createElement('div');
  private readonly quickbarResizeObserver: ResizeObserver;
  private readonly viewportResizeObserver: ResizeObserver;
  private readonly gemsPerCycle: number;
  private readonly gemProgressSideOverhang: number;
  private lastCollectedGems = 0;
  private lastCollectedCoins = 0;

  constructor(host: HTMLElement, options: HudOptions = {}) {
    this.root.className = 'hud';
    this.root.style.width = `${HUD_DESIGN_WIDTH}px`;
    this.root.style.height = `${HUD_DESIGN_HEIGHT}px`;
    this.text = new HudText(options.locale ?? 'zh-CN');

    this.playerInfo = new HudPlayerPanel(this.text, { className: 'hud-player-info' });
    this.waveInfo = new HudWavePanel(this.text, { className: 'hud-wave-info' });
    this.currencyInfo = this.createCurrencyFrame();
    this.root.appendChild(this.waveInfo.root);
    this.vitals.className = 'hud-combat-vitals';
    this.progression.className = 'hud-resource-progression';
    this.playerInfo.mountSections(this.vitals, this.progression);
    this.currencyInfo.content.appendChild(this.progression);

    this.minimapDock.className = 'hud-minimap-dock';
    const minimapControls = document.createElement('div');
    minimapControls.className = 'hud-minimap-controls';
    const requestPause = () => options.requestPause?.();
    const pauseButton = createHudButton({
      label: this.text.value('pause'),
      icon: 'pause',
      skin: 'button4',
      className: 'hud-minimap-button',
    });
    const settingsButton = createHudButton({
      label: this.text.value('settings'),
      icon: 'settings',
      skin: 'button4',
      className: 'hud-minimap-button',
    });
    pauseButton.addEventListener('click', requestPause);
    settingsButton.addEventListener('click', requestPause);
    this.text.bindAttribute(pauseButton, 'aria-label', 'pause');
    this.text.bindAttribute(settingsButton, 'aria-label', 'settings');
    minimapControls.append(pauseButton, settingsButton);

    this.minimapElement.className = 'hud-minimap';
    this.setMinimapSize(options.minimapSize ?? MINIMAP_SETTINGS.size);
    this.minimap = new Minimap(options.minimapZoom ?? MINIMAP_SETTINGS.zoom);

    const frame = document.createElement('img');
    frame.className = 'hud-minimap-frame';
    frame.src = minimapFrameUrl;
    frame.alt = '';
    frame.draggable = false;

    this.minimapLayer.className = 'hud-minimap-layer';
    this.minimapLayer.setAttribute('aria-hidden', 'true');
    this.minimapLayer.appendChild(this.minimap.canvas);

    this.minimapElement.append(frame, this.minimapLayer);
    this.minimapDock.append(minimapControls, this.minimapElement, this.currencyInfo.root);
    this.root.appendChild(this.minimapDock);
    const cycle = options.gemsPerCycle ?? GEM_PROGRESS_SETTINGS.gemsPerCycle;
    this.gemsPerCycle = Number.isFinite(cycle) ? Math.max(1, Math.floor(cycle)) : GEM_PROGRESS_SETTINGS.gemsPerCycle;
    const sideOverhang = options.gemProgressSideOverhang ?? GEM_PROGRESS_SETTINGS.sideOverhang;
    this.gemProgressSideOverhang = Number.isFinite(sideOverhang) ? Math.max(0, sideOverhang) : 0;
    const gemProgressHeight = options.gemProgressHeight ?? GEM_PROGRESS_SETTINGS.height;
    this.root.style.setProperty('--hud-gem-progress-height', gemProgressHeight);
    this.gemProgress = new HudProgressBar({
      label: this.text.value('gemProgress'),
      className: 'hud-gem-progress',
      width: options.gemProgressWidth ?? GEM_PROGRESS_SETTINGS.width,
      height: gemProgressHeight,
    });
    this.text.bindAttribute(this.gemProgress.root, 'aria-label', 'gemProgress');
    this.gemProgress.setValue(0, this.gemsPerCycle, false);
    this.quickbar = new HudQuickbar(this.text);
    this.combatPanel.content.append(this.vitals, this.quickbar.root);
    this.cooldownInfo = new HudCooldownPanel(this.text);
    this.cards = new HudCardPicker();
    // 被动 CD、血条技能面板、灵石进度条自上而下叠成一列，整列底部对齐。三者的间距和
    // 底部留白只在 .hud-bottom-stack 里写一次，要给主视图让高度也只改那一处。
    const bottomStack = document.createElement('div');
    bottomStack.className = 'hud-bottom-stack';
    bottomStack.append(this.cooldownInfo.root, this.combatPanel.root, this.gemProgress.root);
    this.root.appendChild(bottomStack);
    // 卡牌压在所有 HUD 之上，所以最后挂。
    this.root.appendChild(this.cards.root);
    this.quickbarResizeObserver = new ResizeObserver(() => this.syncGemProgressWidth());

    this.hudPointer.className = 'hud-pointer';
    this.hudPointer.setAttribute('aria-hidden', 'true');
    this.hudPointer.hidden = true;
    const pointerImage = cursorImage();
    if (pointerImage) {
      this.hudPointer.style.width = `${pointerImage.width}px`;
      this.hudPointer.style.height = `${pointerImage.height}px`;
      this.hudPointer.style.backgroundImage = `url(${pointerImage.url})`;
      this.hudPointer.style.transform = `translate(${-pointerImage.hotX}px, ${-pointerImage.hotY}px)`;
    }
    host.appendChild(this.root);
    // 固定在窗口顶层，连 ESC 菜单和画框留边也使用同一枚光标。
    document.body.appendChild(this.hudPointer);
    addEventListener('mousemove', (event) => this.updatePointer(event.clientX, event.clientY));
    document.documentElement.addEventListener('mouseleave', () => this.hidePointer());
    addEventListener('blur', () => this.hidePointer());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.hidePointer();
    });
    this.viewportResizeObserver = new ResizeObserver(([entry]) => {
      if (entry) this.syncViewportScale(entry.contentRect.width, entry.contentRect.height);
    });
    this.viewportResizeObserver.observe(host);
    const viewportRect = host.getBoundingClientRect();
    this.syncViewportScale(viewportRect.width, viewportRect.height);
    this.quickbarResizeObserver.observe(this.quickbar.root);
    this.syncGemProgressWidth();
  }

  private syncViewportScale(width: number, height: number): void {
    const scale = Math.min(width / HUD_DESIGN_WIDTH, height / HUD_DESIGN_HEIGHT);
    this.root.style.setProperty('--hud-scale', String(scale));
  }

  private syncGemProgressWidth(): void {
    // 使用变换前的面板外宽，进度条两端与血条技能面板外沿对齐。
    const width = this.combatPanel.root.offsetWidth;
    if (width > 0) {
      this.gemProgress.root.style.width = `${width + this.gemProgressSideOverhang * 2}px`;
    }
  }

  private createCurrencyFrame(): HudFrame {
    const frame = new HudFrame({
      skin: 'frame1',
      className: 'hud-currency-info',
      label: this.text.value('currencyInfo'),
    });
    this.text.bindAttribute(frame.root, 'aria-label', 'currencyInfo');
    const values: Array<['coin' | 'gem', 'gold' | 'energy', string]> = [
      ['coin', 'gold', '0'],
      ['gem', 'energy', '0'],
    ];
    for (const [icon, label, value] of values) {
      const item = document.createElement('div');
      item.className = 'hud-currency-item';
      this.text.bindAttribute(item, 'aria-label', label);
      item.append(createHudIcon(icon, `hud-currency-icon hud-currency-icon--${icon}`));
      const count = document.createElement('span');
      count.className = 'hud-text hud-text--pixel hud-currency-value';
      count.textContent = value;
      this.currencyValues.set(label, count);
      item.appendChild(count);
      frame.content.appendChild(item);
    }
    return frame;
  }

  setLocale(locale: HudLocale): void {
    this.text.setLocale(locale);
  }

  useItem(index: number): boolean {
    const effect = this.quickbar.consumeItem(index);
    if (!effect) return false;
    this.cooldownInfo.activateTimedEffect(effect);
    return true;
  }

  update(dt: number): void {
    this.cooldownInfo.update(dt);
  }

  /** CSS 长度或百分比，例如 '22.5%'、'240px'。 */
  setMinimapSize(size: string): void {
    this.minimapDock.style.width = size;
  }

  /** 1 显示整张地图；数值越大越靠近玩家。实际值会限制在 1..8。 */
  setMinimapZoom(zoom: number): void {
    this.minimap.zoom = zoom;
  }

  /** 直接跟随真实屏幕坐标；暂停、继续和窗口缩放不重设光标位置。 */
  private updatePointer(clientX: number, clientY: number): void {
    if (!this.hudPointer.style.backgroundImage) return;
    this.hudPointer.hidden = false;
    this.hudPointer.style.left = `${clientX}px`;
    this.hudPointer.style.top = `${clientY}px`;
    document.documentElement.classList.add('game-pointer-active');
  }

  private hidePointer(): void {
    this.hudPointer.hidden = true;
    document.documentElement.classList.remove('game-pointer-active');
  }

  /**
   * 备战界面期间收起来。
   *
   * HUD 上每一格说的都是"这一局打得怎么样"：血、蓝、灵石、波次。选人的时候一局还没开始，
   * 那些数字要么是零要么是上一局留下的，摆着只会让人以为已经在打了。
   */
  setVisible(on: boolean): void {
    this.root.hidden = !on;
  }

  draw(field: Field, battle: Battle, camera: Camera): void {
    this.playerInfo.setHealth(Math.max(0, Math.ceil(battle.player.hp)), battle.player.maxHp);
    // 波次面板：三个数都自己判重，值没变时一个 DOM 节点也不会碰。
    const wave = battle.waveStatus;
    this.waveInfo.setWave(wave.wave);
    this.waveInfo.setCountdown(wave.countdown);
    this.waveInfo.setWaveProgress(wave.cleared, wave.waves);
    for (let index = 0; index < battle.skillLoadout.activeSkillSlots.length; index++) {
      const skillId = battle.skillLoadout.activeSkillSlots[index];
      this.quickbar.setSkill(index, skillId);
      this.quickbar.setSkillCooldown(index,
        skillId ? battle.skillCooldown(skillId) : 0,
        skillId ? battle.skillCooldownDuration(skillId) : 0);
    }
    for (const definition of HUD_COOLDOWN_SKILLS) {
      this.cooldownInfo.setSkillState(definition.id,
        battle.skillLoadout.isEquipped(definition.id),
        battle.skillCooldown(definition.id), battle.skillCooldownDuration(definition.id));
    }
    this.minimap.draw(field, battle, camera);
    if (battle.collectedCoins !== this.lastCollectedCoins) {
      const goldValue = this.currencyValues.get('gold');
      if (goldValue) goldValue.textContent = String(battle.collectedCoins);
      this.lastCollectedCoins = battle.collectedCoins;
    }
    const total = battle.collectedGems;
    if (total !== this.lastCollectedGems) {
      const energyValue = this.currencyValues.get('energy');
      if (energyValue) energyValue.textContent = String(total);
      const sameCycle = Math.floor(total / this.gemsPerCycle) === Math.floor(this.lastCollectedGems / this.gemsPerCycle);
      this.gemProgress.setValue(total % this.gemsPerCycle, this.gemsPerCycle,
        total > this.lastCollectedGems && sameCycle);
      // 跨过一整轮就是"灵石收满"。用 sameCycle 而不是 total % n === 0：一帧可能一次收好
      // 几颗，正好落在整数上的机会并不可靠。
      if (this.cardsEnabled && !sameCycle && total > this.lastCollectedGems) this.cards.show();
      this.lastCollectedGems = total;
    }
  }
}
