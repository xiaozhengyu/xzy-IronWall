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

/**
 * 一局打完留下来的战绩。
 *
 * **只记总数和最近一局，不记每一局。** 一份存档要活很久，按局追加的话它会一直长，
 * 而玩家在这一屏上要问的只有两件事："我上一局打得怎么样"和"我拿这个人打得怎么样"。
 * 一张按局的流水帐回答不了第二件，而总数两件都回答得了。
 */
export interface HeroRecord {
  /** 打了几局。中途自己退出的也算 —— 那也是一局。 */
  runs: number;
  /** 赢了几局（清完所有首领）。 */
  wins: number;
  kills: number;
  /** 砍掉的首领数。 */
  bosses: number;
  /** 挺了多少伤害（减免之后真正掉的血）。 */
  damageTaken: number;
  /** 打了多久，秒。 */
  time: number;
  coins: number;
  gems: number;
  /** 最远打到第几波。 */
  bestWave: number;
  /** 最近那一局。没打过就是 null。 */
  last: RunRecord | null;
}

/** 一局的战绩。结算那一屏上写的那几个数，原样存一份。 */
export interface RunRecord {
  map: string;
  won: boolean;
  kills: number;
  bosses: number;
  damageTaken: number;
  time: number;
  coins: number;
  gems: number;
  wave: number;
  waves: number;
  /** 打完的时间戳，毫秒。界面上写成"几天前"。 */
  at: number;
}

export interface ProfileData {
  version: number;
  coins: number;
  heroes: Record<string, HeroProgress>;
  /** 每个角色的战绩。老存档里没有，读的时候补一份空的。 */
  records: Record<string, HeroRecord>;
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

function freshRecord(): HeroRecord {
  return {
    runs: 0, wins: 0, kills: 0, bosses: 0, damageTaken: 0,
    time: 0, coins: 0, gems: 0, bestWave: 0, last: null,
  };
}

function freshProfile(): ProfileData {
  const heroes: Record<string, HeroProgress> = {};
  const records: Record<string, HeroRecord> = {};
  for (const hero of Heroes) {
    heroes[hero.id] = freshProgress();
    records[hero.id] = freshRecord();
  }
  return {
    version: 1,
    coins: 0,
    heroes,
    records,
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
      // 存档是上一版写的时候，新加的角色在里面没有记录。补齐而不是整份作废。
      // 战绩那一块是后加的，旧存档里整个不存在 —— 同样补一份空的，不当作版本不匹配。
      profile.data.records ??= {};
      for (const hero of Heroes) {
        if (!profile.data.heroes[hero.id]) profile.data.heroes[hero.id] = freshProgress();
        if (!profile.data.records[hero.id]) profile.data.records[hero.id] = freshRecord();
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

  /** 这个角色的战绩。没打过也给一份空的，界面那边不用写分支。 */
  record(heroId: string): HeroRecord {
    let entry = this.data.records[heroId];
    if (!entry) {
      entry = freshRecord();
      this.data.records[heroId] = entry;
    }
    return entry;
  }

  /**
   * 一局打完，记一笔。
   *
   * 和 addCoins/addExp 分开调：那两条是"带得走的东西"，这一条是"发生过的事"。同一个
   * settleRun 里前后脚调，但它们回答的不是同一个问题，以后商店改金币也不该动到战绩。
   */
  recordRun(heroId: string, run: RunRecord): void {
    const entry = this.record(heroId);
    entry.runs++;
    if (run.won) entry.wins++;
    entry.kills += run.kills;
    entry.bosses += run.bosses;
    entry.damageTaken += run.damageTaken;
    entry.time += run.time;
    entry.coins += run.coins;
    entry.gems += run.gems;
    entry.bestWave = Math.max(entry.bestWave, run.wave);
    entry.last = run;
    this.save();
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
