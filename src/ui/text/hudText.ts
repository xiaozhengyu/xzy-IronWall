import './hudText.css';
import { HUD_TEXT_EN } from './hudText.en';
import type { HudLocale, HudMessages, HudTextKey, HudTextParams } from './hudText.types';
import { HUD_TEXT_ZH_CN } from './hudText.zh-CN';

const BUNDLES: Record<HudLocale, HudMessages> = {
  'zh-CN': HUD_TEXT_ZH_CN,
  en: HUD_TEXT_EN,
};

type Binding = {
  element: HTMLElement;
  attribute?: string;
  key: HudTextKey;
  params?: () => HudTextParams;
};

/** HUD 文案的唯一入口；新增语言时只需增加语言文件并注册到 BUNDLES。 */
export class HudText {
  private locale: HudLocale;
  private readonly bindings: Binding[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(locale: HudLocale = 'zh-CN') {
    this.locale = locale;
  }

  /** 当前是哪一档。界面上那一排语言按钮要靠它决定哪个高亮。 */
  get current(): HudLocale {
    return this.locale;
  }

  setLocale(locale: HudLocale): void {
    if (locale === this.locale) return;
    this.locale = locale;
    this.refresh();
    for (const listener of this.listeners) listener();
  }

  value(key: HudTextKey, params: HudTextParams = {}): string {
    return BUNDLES[this.locale][key].replace(/\{(\w+)\}/g, (token, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : token);
  }

  bindText(element: HTMLElement, key: HudTextKey, params?: () => HudTextParams): void {
    this.bindings.push({ element, key, params });
    element.textContent = this.value(key, params?.());
  }

  bindAttribute(element: HTMLElement, attribute: string, key: HudTextKey,
    params?: () => HudTextParams): void {
    this.bindings.push({ element, attribute, key, params });
    element.setAttribute(attribute, this.value(key, params?.()));
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  refresh(): void {
    for (const binding of this.bindings) {
      const value = this.value(binding.key, binding.params?.());
      if (binding.attribute) binding.element.setAttribute(binding.attribute, value);
      else binding.element.textContent = value;
    }
  }
}

export type { HudLocale, HudTextKey, HudTextParams } from './hudText.types';
