import diamondCompleteUrl from '../../assets/hud/icon/diamond-complete.png';
import diamondEmptyUrl from '../../assets/hud/icon/diamond-empty.png';
import { HudFrame } from './hudFrame';
import { createHudIcon } from './hudIcons';
import type { HudText } from './text/hudText';
import './hudWavePanel.css';

export interface HudWavePanelOptions {
  className?: string;
  wave?: number;
  countdown?: number;
  clearedWaves?: number;
  totalWaves?: number;
}

/**
 * 怪物波次面板：第几波、距下一波还有多久、整局的波次进度。
 *
 * 倒计时那个数同时也是"本波还剩多久"—— 它们是同一段时间，面板上只该有一个。
 *
 * 下面那排节点原本是给首领画的，现在排的是**波次**：首领个数模板里暂定 0（见 waves.ts 的
 * WaveSpec.bosses），一排空节点什么也不说明，而八波的进度是这一局里唯一一直在走的进度条。
 * 一个节点就是一波，末尾那个骷髅算最后一波 —— 八波是七颗菱形加一个骷髅。
 *
 * 三个 set 方法都自己判重：HUD 每帧都会调，值没变就一个 DOM 节点也不碰。
 */
export class HudWavePanel {
  readonly frame: HudFrame;
  readonly root: HTMLElement;

  private readonly title = document.createElement('div');
  private readonly timer = document.createElement('time');
  private readonly waveTrack = document.createElement('div');
  private readonly text: HudText;
  private wave = 1;
  private countdown = 0;
  private urgent = false;
  private clearedWaves = 0;
  private totalWaves = 0;

  constructor(text: HudText, options: HudWavePanelOptions = {}) {
    this.text = text;
    this.frame = new HudFrame({
      className: options.className,
      label: text.value('wavePanel'),
    });
    this.root = this.frame.root;
    this.frame.content.classList.add('hud-wave-panel-content');
    text.bindAttribute(this.root, 'aria-label', 'wavePanel');

    const header = document.createElement('div');
    header.className = 'hud-wave-header';
    this.title.className = 'hud-text hud-text--pixel hud-wave-title';
    header.append(this.title);

    this.timer.className = 'hud-text hud-text--pixel hud-text--gold hud-wave-timer';
    this.waveTrack.className = 'hud-wave-track';
    this.waveTrack.setAttribute('role', 'img');
    this.frame.content.append(header, this.timer, this.waveTrack);

    this.setWave(options.wave ?? 1);
    this.setCountdown(options.countdown ?? 0);
    this.setWaveProgress(options.clearedWaves ?? 0, options.totalWaves ?? 8);
    text.onChange(() => this.refreshText());
  }

  setWave(wave: number): void {
    const next = Math.max(1, Math.floor(Number.isFinite(wave) ? wave : 1));
    if (next === this.wave) return;
    this.wave = next;
    this.refreshText();
  }

  /**
   * 改成"清完首领还剩多久"那一档：字变红，**上面那行也不再写波号**。
   *
   * 同一个位置换一个颜色，而不是另开一行：这两个倒数不会同时存在（最后一波之后就没有"下一波"
   * 了），而玩家看时间的眼神已经习惯了往那儿扔。
   *
   * 波号也跟着换掉：走到这一步，"第几波"已经不是一个还在动的数了 —— 它永远是最后那一波。
   * 把那一行腾出来写"倒计时"，整个面板就只说一件事：还剩多久。
   */
  setUrgent(on: boolean): void {
    this.timer.classList.toggle('hud-wave-timer--urgent', on);
    if (on === this.urgent) return;
    this.urgent = on;
    this.title.classList.toggle('hud-wave-title--urgent', on);
    this.refreshText();
  }

  /** 秒。面板显示成 mm:ss，所以传进来的小数会向上取整 —— 显示 00:00 时是真的到点了。 */
  setCountdown(seconds: number): void {
    const next = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
    if (next === this.countdown) return;
    this.countdown = next;
    this.refreshText();
  }

  /**
   * 一个节点就是一波，**末尾那个骷髅也是一波** —— 八波是七颗菱形加一个骷髅，不是八颗菱形
   * 再挂一个骷髅。骷髅站的是最后一波的位置，所以走到它就是走到了这一局的终点。
   */
  setWaveProgress(cleared: number, total: number): void {
    const nextTotal = Math.max(0, Math.min(12, Math.floor(Number.isFinite(total) ? total : 0)));
    const nextCleared = Math.max(0,
      Math.min(nextTotal, Math.floor(Number.isFinite(cleared) ? cleared : 0)));
    if (nextTotal === this.totalWaves && nextCleared === this.clearedWaves) return;
    this.totalWaves = nextTotal;
    this.clearedWaves = nextCleared;
    this.waveTrack.replaceChildren();
    // 菱形只画到倒数第二波，最后一波是骷髅本身。
    const diamonds = Math.max(0, this.totalWaves - 1);
    for (let index = 0; index < diamonds; index++) {
      if (index > 0) this.waveTrack.appendChild(this.createTrackConnector(index < this.clearedWaves));
      const diamond = document.createElement('img');
      diamond.className = 'hud-wave-diamond';
      diamond.src = index < this.clearedWaves ? diamondCompleteUrl : diamondEmptyUrl;
      diamond.alt = '';
      diamond.draggable = false;
      this.waveTrack.appendChild(diamond);
    }
    // 走进最后一波，通往骷髅的那一段就亮起来 —— 骷髅点亮的条件是"到了"，不是"打完了"：
    // 末波是打不完的（模板 after: 'hold' 会一直续着出），要等它打完才亮就永远不亮。
    const atLast = this.clearedWaves >= diamonds;
    if (diamonds > 0) this.waveTrack.appendChild(this.createTrackConnector(atLast));
    if (this.totalWaves > 0) {
      this.waveTrack.appendChild(
        createHudIcon('skull', `hud-wave-skull hud-wave-skull--${atLast ? 'reached' : 'pending'}`),
      );
    }
    this.refreshText();
  }

  private createTrackConnector(completed: boolean): HTMLSpanElement {
    const connector = document.createElement('span');
    connector.className = `hud-wave-connector hud-wave-connector--${completed ? 'complete' : 'pending'}`;
    connector.setAttribute('aria-hidden', 'true');
    return connector;
  }

  private refreshText(): void {
    const time = `${Math.floor(this.countdown / 60).toString().padStart(2, '0')}:${(this.countdown % 60)
      .toString().padStart(2, '0')}`;
    this.title.textContent = this.urgent
      ? this.text.value('finalStandTitle')
      : this.text.value('waveTitle', { wave: this.wave.toString().padStart(2, '0') });
    this.timer.textContent = time;
    this.timer.setAttribute('aria-label', this.text.value('nextWaveCountdown', { time }));
    this.waveTrack.setAttribute('aria-label', this.text.value('waveProgress', {
      completed: this.clearedWaves,
      total: this.totalWaves,
    }));
  }
}
