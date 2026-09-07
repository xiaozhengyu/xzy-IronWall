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
  completedBosses?: number;
  totalBosses?: number;
}

/** 纯显示的怪物波次面板；数据接入只需调用三个 set 方法。 */
export class HudWavePanel {
  readonly frame: HudFrame;
  readonly root: HTMLElement;

  private readonly title = document.createElement('div');
  private readonly timer = document.createElement('time');
  private readonly bossTrack = document.createElement('div');
  private readonly text: HudText;
  private wave = 1;
  private countdown = 0;
  private completedBosses = 0;
  private totalBosses = 0;

  constructor(text: HudText, options: HudWavePanelOptions = {}) {
    this.text = text;
    this.frame = new HudFrame({
      skin: 'frame1',
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
    this.bossTrack.className = 'hud-wave-boss-track';
    this.bossTrack.setAttribute('role', 'img');
    this.frame.content.append(header, this.timer, this.bossTrack);

    this.setWave(options.wave ?? 12);
    this.setCountdown(options.countdown ?? 30);
    this.setBossProgress(options.completedBosses ?? 3, options.totalBosses ?? 7);
    text.onChange(() => this.refreshText());
  }

  setWave(wave: number): void {
    this.wave = Math.max(1, Math.floor(Number.isFinite(wave) ? wave : 1));
    this.refreshText();
  }

  setCountdown(seconds: number): void {
    this.countdown = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    this.refreshText();
  }

  setBossProgress(completed: number, total: number): void {
    this.totalBosses = Math.max(0, Math.min(12, Math.floor(Number.isFinite(total) ? total : 0)));
    this.completedBosses = Math.max(0,
      Math.min(this.totalBosses, Math.floor(Number.isFinite(completed) ? completed : 0)));
    this.bossTrack.replaceChildren();
    for (let index = 0; index < this.totalBosses; index++) {
      if (index > 0) this.bossTrack.appendChild(this.createBossConnector(index < this.completedBosses));
      const diamond = document.createElement('img');
      diamond.className = 'hud-wave-diamond';
      diamond.src = index < this.completedBosses ? diamondCompleteUrl : diamondEmptyUrl;
      diamond.alt = '';
      diamond.draggable = false;
      this.bossTrack.appendChild(diamond);
    }
    if (this.totalBosses > 0) {
      this.bossTrack.appendChild(this.createBossConnector(this.completedBosses === this.totalBosses));
    }
    this.bossTrack.appendChild(createHudIcon('skull', 'hud-wave-boss-skull'));
    this.refreshText();
  }

  private createBossConnector(completed: boolean): HTMLSpanElement {
    const connector = document.createElement('span');
    connector.className = `hud-wave-boss-connector hud-wave-boss-connector--${completed ? 'complete' : 'pending'}`;
    connector.setAttribute('aria-hidden', 'true');
    return connector;
  }

  private refreshText(): void {
    const time = `${Math.floor(this.countdown / 60).toString().padStart(2, '0')}:${(this.countdown % 60)
      .toString().padStart(2, '0')}`;
    this.title.textContent = this.text.value('waveTitle', { wave: this.wave.toString().padStart(2, '0') });
    this.timer.textContent = time;
    this.timer.setAttribute('aria-label', this.text.value('nextWaveCountdown', { time }));
    this.bossTrack.setAttribute('aria-label', this.text.value('bossProgress', {
      completed: this.completedBosses,
      total: this.totalBosses,
    }));
  }
}
