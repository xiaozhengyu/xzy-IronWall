# Validation: Developer Console

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Open console | 开发环境开始游戏，按 F1 | 战斗暂停并显示四组开发者控制项；关闭后从原时刻继续 |
| Get skill | 在技能区点击一个未装备技能，再点击已装备技能 | 技能按现有分类/槽位规则装备或卸下，装备时显示满级状态 |
| Get item | 选择聚灵符或其他道具，数量设为 1-9，点击立即获取 | 快捷栏出现对应数量；满格时不丢失并显示失败反馈 |
| Lock HP | 受伤后开启锁定生命，再继续承受伤害；关闭锁定 | 开启期间生命保持开启瞬间的值；关闭后伤害正常生效 |
| Lock MP | 消耗蓝量前开启锁定蓝量，再施放耗蓝技能；关闭锁定 | 开启期间蓝量保持锁定值；关闭后技能消耗正常生效 |
| Resource controls | 点击补满生命、补满蓝量和无敌 | 对应资源立即变化；无敌只影响伤害，不改变技能/道具逻辑 |
| Existing debug controls | 使用跳波次、敌人数、自动攻击、天气、清场和倒下重开 | 原有调试操作仍可用，面板收纳后行为不变 |
| Reset | 开启 HP/MP 锁定和无敌后清场重来，再开始下一局 | 下一局所有锁定和无敌均关闭 |
| Production boundary | 执行生产构建并打开构建产物 | F1 不显示 Developer Console，Developer Console UI、CSS 和 DebugBridge 不进入产物；Battle 共享类中保留的旧调试 API 没有可达入口 |

## Automated Checks

- `npm run build`
- `git diff --check`
- 如新增可独立测试的调试状态函数，补充对应的无浏览器状态测试。

## Visual and Performance Checks

- 浏览器中确认面板分组、控件反馈和暂停遮罩不遮挡关键战斗 HUD。
- 确认关闭调试面板后，战斗循环和 HUD 更新恢复正常。
- 本次不修改渲染算法，不要求 `npm run figures`。
- 本次不改变敌群模拟算法，不要求 `npm run bench`；若控制台增加大量实时统计，再补性能检查。

## Regression Checklist

- [ ] 正式构建不包含开发者控制台入口。
- [ ] 技能装备、技能槽位和技能冷却规则不变。
- [ ] 道具堆叠、快捷栏容量和使用逻辑不变。
- [ ] 伤害、蓝量消耗、回血回蓝和暂停/重开流程保持正确。
- [ ] 聚灵符及上一项未提交改动不被覆盖。

## Evidence

已完成：`npm run build`、`git diff --check`；浏览器中确认 F1 面板、技能立即装备、聚灵符发放、HP/MP 锁定和清场重置；浏览器错误日志为空。生产构建检查确认开发者控制台的 UI 文案、CSS 标记和 F1 入口未进入产物。
