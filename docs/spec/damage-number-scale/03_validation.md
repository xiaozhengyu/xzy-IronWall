# Validation: 伤害数字缩放

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Default zoom | 使用默认视野攻击普通敌人和首领 | 数字大小、位置和层级与改动前一致 |
| Zoom in | 连续滚轮放大视野并攻击多个敌人 | 数字保持可读且不随视野继续变大，敌群仍可观察 |
| Zoom out | 连续滚轮缩小视野并攻击敌人 | 数字不会缩小到无法辨认 |
| Same target hits | 对同一个高血量敌人连续使用普通攻击或持续技能 | 多次命中合并成一个数字，总值随命中累加，不出现连续堆叠 |
| Dense combat | 使用范围技能同时命中大量敌人 | 普通数字自动减少，暴击和首领数字仍优先出现 |
| Offset | 放大视野后攻击密集敌群 | 伤害数字从人物头顶上方和击飞反方向出现，不压在人物身体上 |
| Display toggles | 在 ESC 设置区依次关闭伤害、回血、回蓝、增益、升级 | 对应数字立即消失，其他类别仍显示，战斗数值正常更新 |
| Persistence | 修改显示开关后刷新页面并重新进入战斗 | 五类开关保持上次选择，旧存档也能补齐默认值 |
| Style hierarchy | 触发普通伤害、暴击、首领伤害和回血/回蓝 | 各类型仍保持现有相对字号差异 |
| Camera movement | 放大视野后移动角色并持续攻击 | 数字位置、上飘和淡出正常，不出现跳动或脱离命中点 |

## Automated Checks

- `npm run build`
- `npm run figures`
- `git diff --check`

## Regression Checklist

- [ ] 伤害值和战斗结算不变。
- [ ] 数字颜色、描边、淡入淡出和上飘速度不变。
- [ ] 暂停、重开和胜负结算不会残留数字。
- [ ] 技能演示界面中的伤害数字仍可正常绘制。

## Evidence

- `npm run build`：通过。
- `npm run figures`：通过，已检查 `.preview-damage.png` 中的普通、暴击、首领和回复数字。
- `git diff --check`：通过。
- 本地开发页可启动并进入游戏菜单；浏览器自动化接口无法可靠注入滚轮和键盘动作，因此缩放及密集战斗场景需在本地手动复核。
- 本次新增的偏移、设置开关和持久化场景需在本地手动复核。
