# Design: 聚灵符

## Gameplay Rules

- 道具 ID 为 `charm-magnet`，类型为 `charm`，持续时间为 15 秒。
- 道具加入普通补给池和首领补给池；掉落权重使用现有相对权重体系。
- 使用成功后，Battle 记录一个 15 秒的临时“全场吸附”状态；重复使用时按现有同名临时符规则刷新剩余时间，不叠加范围。
- `Collectibles` 的公共 `pickupRange` 在状态有效期间为 `Infinity`，因此宝石、金币和药符遵循完全相同的吸附规则。
- `MAGNET_DELAY`、吸附速度、药符容量检查和物品满格留地规则保持不变。

## State and Data

- `PickupDef` 增加可选的 `collectibleEffect: 'magnet'` 语义字段。
- `Battle.timedCharms` 复用已有的限时规则状态；不引入新的存档字段。
- `pickupTarget.pickupRange` 每帧根据 `charm-magnet` 是否有效，在 `Infinity` 和玩家属性范围之间切换。
- 新增 `pickupMagnetName`、`pickupMagnetNote` 中英文文案；图标复用未占用的 `talisman-09.png`。

## Runtime Flow

1. 首领或篝火掉落流程从 `Pickups` 选中 `charm-magnet`。
2. `Collectibles` 按现有物理流程落地，并将道具交给 `Battle.takeItem`。
3. 快捷栏使用回调调用 `Battle.applyPickup`；Battle 写入限时状态，HUD 同步显示 15 秒效果条。
4. 每帧更新前，Battle 将公共拾取目标范围设为无限；Collectibles 自动吸附所有允许拾取的掉落物。
5. 计时结束后恢复玩家属性中的普通拾取范围，未被吸附的掉落物继续留场。

## Module Impact

- `src/data/pickups.ts`: 道具定义、掉落池和效果字段。
- `src/game/battle.ts`: 限时效果识别、拾取目标范围和重置流程。
- `src/items/pickupIcons.ts`: 图标映射。
- `src/ui/text/hudText.types.ts`, `hudText.zh-CN.ts`, `hudText.en.ts`: 文案。
- `src/world/collectibles.ts`: 仅更新公共范围注释，保持吸附算法不变。

## Edge Cases

- 玩家死亡或重开时清空 `timedCharms`，不能把无限范围带入下一局。
- 道具使用失败时不扣数量，也不启动计时。
- 快捷栏已满时道具留在场上，不会因为无限范围强制丢失。
- `Infinity` 只作为比较范围使用，不进入 HUD 数值或持久化数据。

## Design Risks

全场吸附会让大量掉落物在同一时间进入移动和收集流程；现有掉落池有容量上限，且吸附流程仍复用同一帧循环，因此不额外创建扫描任务。若试玩中视觉过于拥挤，优先调整持续时间或掉落权重，不改变公共拾取算法。
