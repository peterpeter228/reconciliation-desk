# 实际浏览器合成演示

录制日期：2026-10-22；应用源码基准 b4562ed71a9d1877745d79727fd33be0c3301507。所有输入均为合成数据，禁止导入真实会计系统。未登录或写入任何 QuickBooks / ServiceTitan / 银行账户。

## 观看

- `synthetic-demo-slideshow.mp4`：49 秒的实际操作截图讲解，**不是连续录屏**。画面来自本目录 PNG；页眉、页脚是演示字幕，不属于产品 UI。没有配音。
- `01-landing.png` 至 `05-after-export.png`：从本地文件导入、证据复核到费用草案和防重复导出。
- `08-sample-overview.png`、`10-ambiguous.png`：内置合成月份及歧义案例。221 是调查队列条数，不是确定错误数。
- `uf-full-click-reviewed.png`：完整 UF 输入及人工工作底稿状态，页面较长，可放大查看；不是会计系统导入文件。

## 本次实测

`demo-browser-results.json` 中 10 项 PASS、1 项 FAIL。唯一 FAIL 为脚本尝试在内置样本中找到 “Clean match / Verified three-way” 字样，但当前 221 条队列没有这种标签。这是演示脚本的样本假设不成立，不是已证实产品缺陷；没有伪造 clean 截图或修改产品状态掩盖它。

通过内容：浏览器沙箱、入口区分、三个 CSV 校验、补充结算证据、费用案例、两行费用草案、实际 CSV/manifest 下载、重复下载阻断、完整 UF 流程、歧义案例。UF 输出从 CANDIDATE 到 REVIEWED_INSTRUCTIONS，始终 importEligible:false。

费用示例：毛额 10,000，净额 9,100，独立合成凭据证实净扣手续费 900；草案为借手续费 900、贷普通资产清算账户 900，不再借记银行。文件下载状态为 EXPORTED_NOT_POSTED，绝不表示已经入账。

此演示有意使用 “Use my files” 路径导入合成输入以测试正常解析/复核，所以 manifest 中的 synthetic_only 为 false：该字段表示应用路由，不是数据来源真伪证明。目录中的全部数据仍为人工合成。请勿把演示 CSV 导入任何真实公司。

浏览器 Chromium 155.0.8059.79，Playwright Core 1.57.0，普通用户，chromiumSandbox:true；chrome://sandbox 记录在 chrome-sandbox.txt。监听到的应用请求仅为 127.0.0.1:4173，未发现应用 console 错误。这不是操作系统级网络审计。

## 复现与限制

`capture-demo.mjs` 通过可见控件与原生 filechooser 选择合成文件，不注入应用状态、不修改 localStorage。`run-demo.sh` 是本云环境路径适配，只绑定 loopback；迁移机器需调整项目、Node、Playwright 与 Chromium 路径。服务退出时自动停止。输入位于 `../../dot-followup-20261022/browser/inputs/`。

`make-slideshow.py` 使用 ffmpeg 组合真实 PNG，`slideshow-provenance.json` 保留每张源图哈希。

本次不重做全部功能回归；之前混合性能阈值失败、Enter-only 文件选择变体、下载 HTML 管理策略限制、屏幕阅读器未验收仍保留。演示不能证明真实客户适配、会计正确性审计、用户需求或盈利。
