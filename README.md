# 自控绘图台

**[打开自控绘图台](https://larryhul.github.io/control-plots/)**

[![项目检查](https://github.com/Larryhul/control-plots/actions/workflows/checks.yml/badge.svg)](https://github.com/Larryhul/control-plots/actions/workflows/checks.yml)
[![MIT License](https://img.shields.io/github/license/Larryhul/control-plots)](LICENSE)

输入开环传递函数后拖动 K 滑块，根轨迹、频域图与闭环阶跃响应会同步更新。网页无需注册，传递函数和曲线在浏览器中计算。

- **根轨迹**（180° / 0°），含渐近线、分离点、与虚轴交点、稳定的 K 范围
- **Bode 图**（精确曲线 + 渐近折线），标注截止频率 ωc、相角裕度 γ、穿越频率 ωx、幅值裕度 h
- **Nyquist 图**（奈氏曲线）与 P / Z / R
- **Nichols 图**（对数幅相曲线）
- **闭环单位阶跃响应**及超调量、峰值时间、调节时间

## 课堂练习

| 练习 | 观察目标 |
| --- | --- |
| [找临界增益](https://larryhul.github.io/control-plots/#n=1&d=s%28s%2B1%29%28s%2B2%29&k=6&view=rl) | 将 K 从 5 调到 7，观察闭环极点在 K = 6 时经过虚轴。 |
| [读 Bode 裕度](https://larryhul.github.io/control-plots/#n=1&d=s%28s%2B1%29%28s%2B2%29&k=1&view=bode&w=1.4142135623730951) | 相角达到 −180° 时，幅值为 −15.56 dB，对应幅值裕度 15.56 dB。 |
| [比较阶跃超调](https://larryhul.github.io/control-plots/#n=1&d=s%28s%2B2%29&k=1&t=12&view=step) | 将 K = 1 加入对比，再改为 K = 4，观察响应出现超调。 |

教师可参考 [课堂使用指南](docs/classroom.md) 组织投影演示和学生练习。遇到显示或计算问题时，可通过 [GitHub Issues](https://github.com/Larryhul/control-plots/issues) 反馈。附上分享链接和预期结果，方便复现。

## 操作与对比

- 右侧直接调节增益和传递函数。延迟、仿真时长与负增益在“仿真设置”中调整。K 支持 0，正增益滑块采用对数刻度。
- 桌面参数面板随页面滚动保持可用，默认同页显示全部曲线。点击图表右上角可放大，再次点击返回总览。
- 手机上可直接打开课堂练习。滚动到曲线时，底部会显示 K 输入框和滑块，传递函数面板按需展开。
- 悬停或点击频域图，Bode、Nyquist、Nichols 同步标出对应频率，也可在 ω 输入框中直接指定。
- 点击“加入对比”保存当前系统，再调整参数可查看实线与虚线的差异。
- 分享链接保存增益、正负号、延迟、仿真时长、图表视图、联动频率及对比模型，兼容原有链接。
- “导出”菜单支持 PNG 图片和带 UTF-8 BOM 的 CSV，按当前视图导出，总览包含全部图表与完整计算结果。
- 五类图均有关键点标注和图下要点。展开「计算过程」可对照当前数值查看判断方法和表格。
- 根轨迹以角弧提示各方向，角度从正实轴逆时针量起。零点入射射线和沿轨迹进入零点的方向相差 180°。
- Nyquist 图的端点角按正频率支路读。有限终点同时显示靠近射线角和沿曲线指向终点的入射角。
- 按 Tab 进入图表。方向键读点，Shift 加方向键平移，+ / − 缩放，Home 复位。根轨迹按 Enter 选择增益。
- 完整数值位于“详细计算结果”，网站菜单提供深浅色切换和使用帮助。

## 输入格式

分子、分母分别填写，两种写法都可以：

| 写法 | 例子 |
| --- | --- |
| 表达式 | `s(s+1)(0.5s+1)`、`s^2+2s+5`、`10(s+2)` |
| 降幂系数表 | `1 3 2 0` 表示 s³+3s²+2s |

开环传递函数为 `K · N(s)/D(s) · e^(−τs)`，闭环按单位负反馈计算（特征方程 `D + K·N = 0`）。
延迟 τ 计入 Bode、Nyquist、Nichols 三种频域图。根轨迹、闭环极点和稳定 K 区间采用 τ = 0 模型，界面各处均标注该条件。阶跃响应在 τ = 0 时提供。

无延迟系统按闭环极点判定稳定性。极点全部位于左半平面为渐近稳定。虚轴极点均为单根且其余极点在左半平面时标为临界。右半平面极点或虚轴重根均判为不稳定。

分子与分母同阶时，闭环最高次项抵消的正增益单独作为稳定区间边界，并标为奇异增益。幅值交越由 `|K·N(jω)|² = |D(jω)|²` 求出，绘图采样用于呈现曲线。负实轴交点包括直流边界。含延迟模型的相角交越采用数值搜索。开环存在虚轴极点时，完整的奈氏路径还需要绕开这些极点。

## 本地预览

```bash
python -m http.server 8765
```

然后打开 <http://localhost:8765>。也可以直接双击 `index.html`。

## 发布与维护

本站使用 HTML、CSS 和原生 JavaScript，部署时可直接在 GitHub Pages 选择 `main` 分支的根目录。

使用 Node.js 24 运行 `npm test` 核对教材和边界算例。推送与 Pull Request 会运行数值和浏览器检查。浏览器矩阵覆盖桌面 Chromium、Firefox、WebKit 及两种手机模拟配置。测试和发版步骤见 [贡献指南](CONTRIBUTING.md)，历次改动见 [更新记录](CHANGELOG.md)。

项目代码和文档采用 [MIT 许可证](LICENSE)。随附的 DM Sans 字体采用 [SIL Open Font License 1.1](assets/fonts/OFL.txt)。

## 目录结构

```
index.html      页面
style.css       样式（自动适配深色模式）
js/math.js      复数、多项式、求根（Aberth 法）、表达式解析
js/control.js   根轨迹、频率特性、裕度、阶跃响应等算法
js/plot.js      Canvas 绘图组件（缩放 / 平移 / 悬停）
js/app.js       界面逻辑
test/           教材和数值边界算例
e2e/            浏览器、触屏与键盘回归
```
