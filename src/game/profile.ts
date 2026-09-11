/**
 * 跨局存档：金币、每个角色各自的等级与经验、已经解锁的主动技。
 *
 * 这是整个工程里第一份**离开这一局还活着**的数据。分界线画在这里：
 *
 *   灵石   一局之内的东西。收满一轮弹一次三选一，这一局结束就清零，不写进存档。
 *   金币   跨局的东西。一局打完加进总数，后面的商店拿它消费。
 *   等级   跨局的东西，而且**每个角色各记各的** —— 练满的双锤武将不该让第一次上手的骑士
 *          直接满级。存档里按角色 id 开键，加一个新角色不用动这里。
 *
 * 存在 localStorage 里。读不出来就当作一份全新的存档，不报错也不弹窗：存档丢了最多是从头
 * 练，而一个打不开的游戏比一份空存档糟得多。
 */

import { MAX_LEVEL, expToNextLevel } from '../data/balance';
import { Heroes } from '../data/heroes';

const STORAGE_KEY = 'ironwall.profile.v1';

/**
 * 一个角色的进度。
 *
 * **没有技能。** 技能是一局之内的东西：每一局都从一个自动攻击技加一双靴子开始，别的靠场上
 * 收灵石抽牌拿，打完就清（见 game/skillLoadout.ts 的 startRun）。存档里留下的只有练出来的
 * 等级，以及跨局的家底金币 —— 后者以后由商店换成永久的属性。
 */
export interface HeroProgress {
  level: number;
  /** 当前这一级已经攒了多少经验，不是累计值。经验条直接画它。 */
  exp: number;
}

export interface ProfileData {
  version: number;
  coins: number;
  heroes: Record<string, HeroProgress>;
  /** 上次选的角色和地图，回到备战界面时停在原处。 */
  lastHero: string;
  lastMap: string;
}

/** 一次升级里发生了什么。界面拿它弹提示。 */
export interface LevelUpResult {
  levels: number;
  level: number;
}

function freshProgress(): HeroProgress {
  return { level: 1, exp: 0 };
}

function freshProfile(): ProfileData {
  const heroes: Record<string, HeroProgress> = {};
  for (const hero of Heroes) heroes[hero.id] = freshProgress();
  return {
    version: 1,
    coins: 0,
    heroes,
    lastHero: Heroes[0].id,
    lastMap: 'proving',
  };
}

/**
 * 存档。
 *
 * 每次写都整份序列化 —— 这份数据只有几百字节，为它做增量写入不值得，而且整份写保证磁盘上
 * 永远是一个自洽的快照。
 */
export class Profile {
  private data: ProfileData;

  constructor(data: ProfileData = freshProfile()) {
    this.data = data;
  }

  /**
   * 从 localStorage 读。读不出来、解析不了、或者版本对不上都退回一份新的。
   *
   * 无痕窗口和禁用站点数据的浏览器里连读都会抛，所以整段包在 try 里。存档不是这个游戏能不能
   * 跑起来的前提。
   */
  static load(): Profile {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Profile();
      const parsed = JSON.parse(raw) as Partial<ProfileData>;
      if (parsed.version !== 1) return new Profile();
      const profile = new Profile({ ...freshProfile(), ...parsed } as ProfileData);
      // 存档是上一版写的时候，新加的角色在里面没有记录。补齐而不是整份作废。
      for (const hero of Heroes) {
        if (!profile.data.heroes[hero.id]) profile.data.heroes[hero.id] = freshProgress();
      }
      return profile;
    } catch {
      return new Profile();
    }
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // 写不进去就算了。这一局照常能打完，只是下次打开回到上一个存档点。
    }
  }

  get coins(): number {
    return this.data.coins;
  }

  /** 一局打完把这一局收的金币并进总数。以后商店那边会有对应的 spend。 */
  addCoins(amount: number): void {
    if (amount <= 0) return;
    this.data.coins += Math.floor(amount);
    this.save();
  }

  /**
   * 花钱。余额不够就什么也不做，返回 false。
   *
   * 商店模块还没有，先把这个口留在这里 —— 花钱这件事只该有一个出口，散在各个界面里迟早会
   * 出现一处忘了 save 的。
   */
  spendCoins(amount: number): boolean {
    if (amount <= 0 || this.data.coins < amount) return false;
    this.data.coins -= amount;
    this.save();
    return true;
  }

  progress(heroId: string): HeroProgress {
    let entry = this.data.heroes[heroId];
    if (!entry) {
      entry = freshProgress();
      this.data.heroes[heroId] = entry;
    }
    return entry;
  }

  level(heroId: string): number {
    return this.progress(heroId).level;
  }

  /**
   * 给这个角色加经验，够了就升级。
   *
   * 一次可能连升几级 —— 打首领或者一局结束一次性结算时都会发生，所以是循环而不是一个 if。
   * 返回这次升了几级，没升就是 0。
   */
  addExp(heroId: string, amount: number): LevelUpResult {
    const entry = this.progress(heroId);
    if (amount <= 0 || entry.level >= MAX_LEVEL) return { levels: 0, level: entry.level };
    entry.exp += amount;
    let levels = 0;
    while (entry.level < MAX_LEVEL) {
      const need = expToNextLevel(entry.level);
      if (entry.exp < need) break;
      entry.exp -= need;
      entry.level++;
      levels++;
    }
    // 满级之后经验不再累计，进度条停在满格。
    if (entry.level >= MAX_LEVEL) entry.exp = 0;
    this.save();
    return { levels, level: entry.level };
  }

  get lastHero(): string {
    return this.data.lastHero;
  }

  get lastMap(): string {
    return this.data.lastMap;
  }

  remember(heroId: string, mapId: string): void {
    this.data.lastHero = heroId;
    this.data.lastMap = mapId;
    this.save();
  }
}
