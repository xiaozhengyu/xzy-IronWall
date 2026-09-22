# Design: 小地图显示设置

## Layout Rule

- `Hud` 将小地图和资源面板拆到两个独立容器。
- `.hud-minimap-dock` 使用 `left: 2.2%`、`top: 1.6%` 锚定左上角。
- 资源面板使用独立的 `.hud-currency-dock`，继续使用右上角原有边距和宽度。
- HUD 不再创建或渲染 `pauseHint` 提示节点；相关 CSS 和文案键一并移除。
- 小地图仍由 `MINIMAP_SETTINGS.size` 控制尺寸，内部 `Minimap` 逻辑不变。

## Player Settings

- `Profile.settings.minimap` 是布尔值，默认 `true`。
- 旧存档加载时通过默认设置补齐缺失字段。
- SummaryScreen 在现有 ESC 设置区增加“小地图”开/关两态按钮。
- `main.ts` 负责持久化、同步 SummaryScreen 和 `Hud.setMinimapVisible()`。

## Runtime Flow

1. 应用启动时从 Profile 读取小地图显示设置。
2. Main 将设置传给 Hud，初始化小地图可见状态。
3. 玩家在 ESC 页面切换开关；Profile 保存新值。
4. Hud 立即切换小地图容器的 `hidden` 状态。
5. `Hud.draw()` 只在小地图可见时调用 `Minimap.draw()`。

## Module Impact

- `src/ui/hud.ts`, `src/ui/hud.css`: 拆分 HUD 容器、调整左下角布局和绘制条件。
- `src/game/profile.ts`: 增加小地图显示设置和旧存档补齐。
- `src/ui/summary.ts`, `src/main.ts`: 增加开关、持久化和运行时同步。
- `src/ui/text/hudText.types.ts`, `hudText.zh-CN.ts`, `hudText.en.ts`: 增加设置文案。
- `docs/spec/minimap-display/`: 记录需求、设计和验证。
- `docs/decisions/AI_CHANGELOG.md`: 记录实质性逻辑变化。

## Edge Cases

- 关闭小地图不会影响相机、战斗模拟或小地图下次打开时的内部缩放值。
- 左上角小地图与中央波次面板分别占据两侧空间，不共享资源面板容器。
- 在暂停、结算或备战页切换开关不会启动战斗更新。
- 旧存档保持原有设置，只有新字段按默认值补齐。
