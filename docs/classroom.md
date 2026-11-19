# 课堂使用指南

[打开自控绘图台](https://larryhul.github.io/control-plots/)。教师可在投影上选择单幅图，学生可在手机上打开同一条练习链接。打开单幅图时，参数区仍可调节增益。

## 三个练习

| 练习 | 操作 | 预期观察 |
| --- | --- | --- |
| [找临界增益](https://larryhul.github.io/control-plots/#n=1&d=s%28s%2B1%29%28s%2B2%29&k=6&view=rl) | 依次输入 K = 5、6、7。 | 稳定、临界、不稳定。K = 6 时有一对虚轴单根。 |
| [读 Bode 裕度](https://larryhul.github.io/control-plots/#n=1&d=s%28s%2B1%29%28s%2B2%29&k=1&view=bode&w=1.4142135623730951) | 在 φ = −180° 处读取幅值。 | 幅值约 −15.56 dB，对应幅值裕度约 15.56 dB。 |
| [比较阶跃超调](https://larryhul.github.io/control-plots/#n=1&d=s%28s%2B2%29&k=1&t=12&view=step) | 把 K = 1 加入对比，再改为 K = 4。 | K = 1 的曲线接近单调。K = 4 的曲线出现约 16.3% 超调。 |

可用 [双原点极点算例](https://larryhul.github.io/control-plots/#n=1&d=s%5E2-1&k=1&t=4&view=step) 对照第一个练习。此时闭环特征式为 s²，阶跃响应随 t²/2 增长，页面显示「不稳定」。

## 上课前核对

- 在实际投影设备上打开单幅根轨迹图。调节 K 时，确认能同时看到完整曲线和读数。字体偏小时，可使用浏览器缩放并查看单图。
- 在学生使用的 iPhone Safari 或安卓 Chrome 打开练习。点选练习，滚到曲线旁用增益栏调参，再重新打开分享链接确认参数复现。
- 用键盘按 Tab 进入图表。方向键读点，Shift 加方向键平移，+ / − 缩放，Home 复位。根轨迹按 Enter 选定增益。

课后可记录练习是否完成、使用设备和遇到的具体困难。通过 [课堂使用反馈](https://github.com/Larryhul/control-plots/issues/new?template=classroom.yml) 提交，便于复现和改进。
