# 参与自控绘图台

欢迎提出计算、界面或课堂使用反馈，也欢迎补充可复现的算例。通过 [问题入口](https://github.com/Larryhul/control-plots/issues/new/choose) 选择对应模板。分享链接可直接恢复传递函数、增益、视图等参数。

## 本地运行与测试

目录根部的 `index.html` 可以直接打开。浏览器测试使用本地 HTTP 服务模拟 GitHub Pages 的 `/control-plots/` 路径，命令会自动启动服务。需要 Node.js 24。

```bash
npm ci
npm test
npx playwright install
npm run test:browser
```

只运行一个浏览器时，可用 `npm run test:browser -- --project=firefox`。Linux 上首次安装浏览器可用 `npx playwright install --with-deps`。

GitHub 检查使用 Playwright 官方镜像运行三个浏览器引擎。升级 `@playwright/test` 时，同步更新 `.github/workflows/checks.yml` 中的镜像版本。

修复数值判断时，在 `test/control.test.cjs` 加入产生差异的算例，并注明可复核的解析值、教材来源或参考软件结果。修改交互时，在 `e2e/` 补充对应的用户操作。Pull Request 中写出用户能看到的变化和复现方式。

## 发版

1. 更新 `CHANGELOG.md` 和 `package.json` 版本，同时刷新 `index.html` 里的资源版本。运行 `npm install --package-lock-only` 同步锁定文件。
2. 确认待发布提交的数值测试和浏览器矩阵通过。将其推送到 `main` 后，由 GitHub Pages 自动发布。
3. 打开 [公开站点](https://larryhul.github.io/control-plots/) 核对当前版本。用课堂练习、手机调参、既有分享链接和导出验收基本功能。
4. 为已验证提交创建与版本一致的 Git 标签和 [GitHub Release](https://github.com/Larryhul/control-plots/releases)，发布说明可取自更新记录。
