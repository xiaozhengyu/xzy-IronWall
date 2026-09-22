# Validation: 小地图显示设置

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Position | 开始游戏并观察 HUD | 小地图位于左上角，资源面板仍在右上角，中央波次面板不被遮挡 |
| Pause hint removed | 进入战斗并观察左上角 | 不再显示“按 ESC 暂停”提示文字 |
| Hide | 按 ESC，关闭“小地图”，继续游戏 | 小地图立即消失；资源面板和其他 HUD 保持正常 |
| Show | 再次打开“小地图”开关 | 小地图恢复到左下角，标记和当前位置正常 |
| Persistence | 修改开关后刷新页面并重新进入战斗 | 小地图继续保持上次选择 |
| Legacy save | 使用没有 `minimap` 字段的旧存档启动 | 小地图默认显示，其他设置不丢失 |

## Automated Checks

- `npm run build`
- `git diff --check`

## Visual and Performance Checks

- `npm run figures`，确认程序化渲染未受 HUD 改动影响。
- 浏览器中确认左下角布局和 ESC 开关交互。
- 关闭小地图后确认 `Minimap.draw()` 不再运行。

## Regression Checklist

- [ ] 资源面板仍位于右上角。
- [ ] 小地图内部缩放、玩家、敌人和地标标记不变。
- [ ] 小地图开关不会影响战斗模拟和相机控制。
- [ ] 中文和英文设置文案均可显示。

## Evidence

记录 `npm run build`、`npm run figures` 和 `git diff --check` 输出，并在本地浏览器完成位置、隐藏、恢复和持久化场景。
