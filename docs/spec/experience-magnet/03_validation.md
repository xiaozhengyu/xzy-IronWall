# Validation: 聚灵符

## Manual Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Normal use | 通过首领或篝火获得聚灵符，使用道具 | 快捷栏扣除一件，效果条显示 15 秒，场上宝石、金币和药符开始向玩家吸附 |
| Existing drops | 使用前让多类掉落物落地并远离玩家，再使用聚灵符 | 已经落地的三类掉落物也会进入吸附流程 |
| New drops | 聚灵符生效期间击杀敌人或破坏篝火 | 新掉落物同样自动吸附 |
| Expiry | 等待效果条归零后保持不动 | 新掉落物恢复普通拾取范围，未完成吸附的掉落物不会消失 |
| Full item slots | 先占满四个快捷栏，再让药符进入无限吸附范围 | 药符因容量规则留在地上；宝石和金币仍可被收取 |
| Reset and defeat | 开启效果后重开或结束一局，再开始下一局 | 下一局没有残留无限拾取范围或效果条 |

## Automated Checks

- `npm run build`
- `git diff --check`

## Visual and Performance Checks

- 浏览器中确认聚灵符图标与地面掉落图标、快捷栏图标一致。
- 浏览器中确认效果条倒计时可见，且三类掉落物的吸附光尾正常。
- 不需要运行 `npm run figures`；本次不修改程序化渲染。
- 不需要运行 `npm run bench`；本次不改变敌群模拟或几何算法。

## Regression Checklist

- [ ] 普通拾取范围和现有属性卡仍然生效。
- [ ] 药符快捷栏容量、堆叠和使用失败保护不变。
- [ ] 暂停、重开、胜利和失败流程不保留效果状态。
- [ ] 中文和英文文案均能显示。

## Evidence

记录 `npm run build`、`git diff --check` 输出，并在本地浏览器完成上述正常使用、效果结束和重开场景。
