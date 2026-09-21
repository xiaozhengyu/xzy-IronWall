import './hudText.css';
import { HUD_TEXT_EN } from './hudText.en';
import type { HudLocale, HudMessages, HudTextKey, HudTextParams } from './hudText.types';
import { HUD_TEXT_ZH_CN } from './hudText.zh-CN';

const BUNDLES: Record<HudLocale, HudMessages> = {
  'zh-CN': HUD_TEXT_ZH_CN,
  en: HUD_TEXT_EN,
};

/**
 * 把当前语言写回 <html lang>。
 *
 * index.html 里写的是 en，那只是 JS 跑起来之前的占位 —— 而真正的语言是运行时才知道的
 * （跟浏览器走，或者玩家自己改过）。这一行对画面没有任何影响，它是说给读屏和浏览器
 * 听的：中文界面挂着 lang="en"，读屏会用英语发音去念中文。
 */
function syncDocumentLang(locale: HudLocale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}

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

  // 兜底英文：真正的默认值由存档给（见 profile.ts 的 detectLocale），这里只是没人传时的兼职。
  constructor(locale: HudLocale = 'en') {
    this.locale = locale;
    syncDocumentLang(locale);
  }

  /** 当前是哪一档。界面上那一排语言按钮要靠它决定哪个高亮。 */
  get current(): HudLocale {
    return this.locale;
  }

  setLocale(locale: HudLocale): void {
    if (locale === this.locale) return;
    this.locale = locale;
    syncDocumentLang(locale);
    this.refresh();
    for (const listener of this.listeners) listener();
  }

  /**
   * 存档里存下来的那种字符串：**新档存的是文案 key，旧档存的是当时那一版的中文。**
   *
   * 认得出的 key 就翻译，认不出的原样吐回去 —— 战绩里"上一局打的哪张图"是存进档的，
   * 本地化之前存的是"黑石隘口"四个字。为它专门写一次迁移不值得（一条记录而已），
   * 让旧档那一行保持原样就是最合适的处理。
   */
  valueOrRaw(keyOrText: string): string {
    const bundle = BUNDLES[this.locale];
    return Object.hasOwn(bundle, keyOrText) ? bundle[keyOrText as HudTextKey] : keyOrText;
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
