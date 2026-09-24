# Design: Developer Console

## Gameplay Rules

- 控制台只在 `import.meta.env.DEV` 为真时可打开；正式构建中 F1 入口、Developer Console UI 和 DebugBridge 由 Vite/Tree Shaking 移除。Battle 中已有调试 API 不作为生产入口，保留在共享战斗类中以兼容当前架构。
- 技能列表复用 `Skills` 数据和现有分类规则。点击已装备技能时卸下，点击未装备技能时装备并设置为 `SKILL_MAX_LEVEL`；不绕过主动槽、攻击技、护身技和发射技的容量/互斥规则。
- 道具选择复用 `Pickups`，数量限制为 1-9，并调用 `Battle.grantItems()`。快捷栏满或无法容纳时沿用 `acceptsItem()` 规则，同时在控制台显示结果。
- “锁定生命”和“锁定蓝量”分别记录开启瞬间的当前值。每帧更新时在正常战斗模拟完成后恢复对应值；关闭后不再写回。无敌作为独立开关，阻止正常伤害但不影响蓝量消耗。
- 新开一局时清除 HP/MP 锁定值、无敌状态和控制台临时状态；技能装备和道具仍按现有 `Battle.reset()` / `grantItems()` 语义处理。

## Card Tester

- F1 卡牌区用一个分组选择框呈现所有普通属性卡的合法随机幅度、当前可获取的技能卡、当前可升级的技能卡和金币 +30/+50 卡。
- 属性卡测试绕过正常抽卡次数和同类卡上限，但卡牌效果本身仍走 `HudCardPicker` 连接的 `HudCardHooks`；临时的测试应用不会增加抽卡轮次、已选计数或 `statTaken`。
- 技能获取/升级选项按当前 `Battle` 技能状态动态生成；应用仍调用 `obtainSkill` / `upgradeSkill`，遵守技能槽位、类别互斥和等级上限。
- 金币选项始终展示，并调用真实 `onGoldCard` 回调写入 `Profile`。F1 卡牌区常驻提示这一操作修改存档，重开本局不会撤销。
- 控制台刷新时重新生成技能选项，避免技能获取、升级或装备变化后保留过期选项。

## State and Data

- 新增 `DeveloperConsole` 的 UI 状态：选中道具 ID、发放数量、最近一次操作反馈。
- 扩展 DEV-only `DeveloperConsoleBridge`：读取当前卡牌测试选项，并按稳定 offer key 应用指定卡牌。
- `HudCardPicker` 提供 DEV 测试用的完整 offer 列表与效果派发入口；该入口复用正式卡牌 hooks，但不改动正常奖励状态。
- `Battle` 新增调试状态：`debugHpLock`、`debugMpLock`、`debugInvincible`，或等价的封装结构；状态不写入 Profile。
- `Battle` 提供最小调试接口：设置/清除资源锁定、切换无敌、补满资源、发放道具；已有技能和战斗调试接口保持兼容。
- 不新增技能、道具或存档数据表；技能和道具列表均从现有数据源生成。

## Runtime Flow

1. 开发者按 F1，`main.ts` 打开 Developer Console 并暂停战斗。
2. 控件事件通过 `DebugBridge` 回到 `main.ts`，再调用 `Battle` 的公开调试方法；卡牌测试通过 `HudCardPicker` 的正式 effect hooks 派发，UI 不直接修改角色或快捷栏状态。
3. `Battle.update()` 在伤害、技能和资源模拟后应用调试锁定，确保锁定不会被下一帧的正常逻辑覆盖。
4. `main.ts` 每帧读取 Battle 的调试状态和物品/技能快照，更新控件状态与操作反馈。
5. 关闭面板后恢复战斗；F1 入口、调试桥和调试控件在生产构建中不可达。

## Module Impact

- `src/ui/developerConsole.ts`: 独立的调试面板、控件和反馈。
- `src/ui/developerConsole.css`: 面板布局、分组和状态样式。
- `src/ui/menu.ts`: 保留菜单外壳和 F1 生命周期，移交调试区域给新组件。
- `src/main.ts`: 连接 Developer Console 与 Battle，保持 DEV 边界。
- `src/game/battle.ts`: 增加调试状态、资源锁定和统一调试方法。
- `src/game/skillLoadout.ts`、`src/data/pickups.ts`: 仅复用现有数据/规则，除非类型接口需要最小扩展。
- `docs/decisions/AI_CHANGELOG.md`: 记录实现后的逻辑变化和验证证据。

## Edge Cases

- 玩家死亡、自动重开、手动清场重来和新局开始都必须清除资源锁定与无敌。
- 锁定开启时，手动补满或技能升级改变上限不应让锁定值变成非法值；写回时夹在当前最大值范围内。
- 道具发放失败不能扣减任何存档补给，也不能静默删除物品。
- 暂停或调试面板打开期间不推进战斗计时；关闭面板后从同一时刻继续。
- 技能规则拒绝装备时，面板要保持原状态并显示失败原因。
- 金币卡测试通过真实持久化回调，选项文案和分组必须明确提示“会写入存档”。
- F1 卡牌测试不得改变正式奖励进度；关闭控制台或清场不会回滚卡牌效果，金币同理持久保留。
- 生产构建不能通过键盘、DOM 或未摇树的字符串入口打开调试控制台。

## Design Risks

调试功能容易侵入正式玩法。如果将调试字段散落在 UI 或多个战斗分支中，后续增加“锁定经验、固定掉落、慢速模拟”等功能会产生不可控的状态组合。因此第一期集中由 Battle 持有临时调试状态，UI 只调用明确的方法；若控制台继续增长，再把接口整理为 typed debug command，而不是让 UI 直接读写内部字段。
