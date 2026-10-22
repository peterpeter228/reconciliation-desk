# dot 独立真实浏览器复核（2026-10-22）

## 环境与边界（Verified）

- 普通用户 UID/GID 1000；Playwright Core 1.57.0（环境自带，未加入生产依赖），系统 Chromium；`chromiumSandbox: true`，未使用 `--no-sandbox`。
- 执行环境的 shell 子进程不能创建浏览器 socket，首次诊断失败并保留。通过本云计算机的原生 Terminal 启动测试；项目目录共享，`/tmp` 不共享。未操作用户电脑、QBO、账户、公共站点、部署或对外端口。
- Vite preview 只绑定 `127.0.0.1:4173`；启动脚本结束后停止自己创建的服务。`chrome://sandbox` 的实际结果为 Namespace、PID namespaces、Network namespaces、Seccomp-BPF、TSYNC 均 Yes，页面文字为 adequately sandboxed。
- 上传通过可见按钮/标签触发 Playwright `filechooser` 事件，再通过原生 chooser 的 `setFiles` 选择合成文件。没有直接设置隐藏 input、注入应用状态或修改 localStorage。键盘专项同样用 Enter 激活文件选择器；它不是人工逐键输入 OS 路径的证明。

## 原始 Claude 快照独立复跑

产物：`evidence/dot-followup-20261022/browser/claude-snapshot/`。命令入口：`bash evidence/dot-followup-20261022/browser/run-snapshot.sh`。原始 harness 仅适配本机 Chromium 与已安装 Playwright 路径。

- 29 项原始检查实际 28 PASS / 1 FAIL；不是 29/29。唯一 FAIL 是 reviewer HTML 下载后 `file://` 导航被浏览器管理策略以 `ERR_BLOCKED_BY_ADMINISTRATOR` 拒绝，复核归类 **BLOCKED（环境）**。HTML 字节已下载，内容标题、日志号及无 script 断言通过；未把该文件改用其他路线加载以绕过限制。
- 实际下载 `RD8C9256AC39_BETA_NOT_POSTED.csv` SHA-256：`b2db0b58fab32b688fdc7a4c6c456808a1aa98a87ad866d39290ebb73d118d49`，与原始证据一致。
- 原始报告的 `CONSOLE-errors` 为 none，页面观察到 27 个去重请求，HTTP host 仅 `127.0.0.1:4173`。

注意：沿用的 browser harness 会逐项记录 FAIL，但进程可正常退出 0。判定依据必须是 JSON / run.log 的逐项状态，不能把 exit-code.txt 的 0 当作全部通过。

## 网络观察的精确范围

`page.on('request')` 捕获挂载监听器页面的请求，`console` / `pageerror` 捕获这些页面的应用错误。它不是操作系统抓包，不覆盖浏览器后台服务、未挂监听器的 chrome://sandbox、file:// viewer，也不能证明 worker 内部每一个网络请求均被捕获。此测试支持“被观察的应用页面未发现外发”，**不支持“整台计算机只有 loopback 网络”或绝对零外发**。

## 补充验收的解释边界

- 两个真实标签页专项使用同一浏览器 context、同一 origin、共享存储；从保存的复核项目重新验证原文件，并在每页重新建立/批准方案，再并发点击导出。没有直接调用导出内部函数。
- PDF 专项测试主应用 Exports → Evidence summary 的可见打印入口和 Chromium 打印渲染器。它不规避被拒绝的本地 reviewer HTML，也不宣称已验证 OS 原生打印对话框。
- 720px CSS viewport 是 1440px 200% 等效布局检查，不是浏览器缩放 UI 的直接操作。
- 无受支持的屏幕阅读器集成：**BLOCKED**，AX tree 或键盘测试不能冒充屏幕阅读器验收。
- 所有 fixture 均为合成；CSV 导出不是入账。UF worksheet 是人工工作底稿，不是 QBO Payment/Deposit 验收。

## 最终功能矩阵（当前代码独立执行）

主报告 `browser/final/browser-results.json`，实际 Chromium 155.0.8059.79。完整扩展运行 36 项：34 PASS、1 原始 FAIL（本地 HTML 浏览策略限制，归类 BLOCKED）、1 BLOCKED（屏幕阅读器）。这不是原始 29/29；29 项原始检查仍 28 PASS + 1 环境阻断。另行视觉 QA 发现打印版式缺陷，独立记录，不被上述生成成功状态掩盖。

| 检查 | 原始运行结果 | 产物/说明 |
|---|---|---|
| ENV-sandbox | PASS | Sandbox Status  /  Layer 1 Sandbox	Namespace  /  PID namespaces	Yes  /  Network namespaces	Yes  /  Seccomp-BPF sandbox	Yes  /  Seccomp-BPF sandbox supports TSYNC	Yes |
| UI-landing-states-scope | PASS | Demo and own-files entry points are separate |
| FLOW-import-validate | PASS | three CSVs validated with explicit scope |
| FLOW-processor-evidence | PASS | processor settlement added and recalculated |
| FLOW-engine-case | PASS | settlement fee difference on $10,000.00 gross; QB bank leg recognized (not listed as missing) |
| FLOW-build-draft-from-parsed-files | PASS | exactly Dr fee 900 / Cr clearing 900 from parsed CSV files |
| FLOW-export-bytes | PASS | RD8C9256AC39_BETA_NOT_POSTED.csv + RD8C9256AC39_BETA_NOT_POSTED.csv.manifest.json; 2 balanced lines, no bank leg; manifest EXPORTED_NOT_POSTED |
| FLOW-repeat-export-blocked | PASS | button disabled; guidance names the journal number and what to check |
| DELIVERABLE-reviewer-summary | FAIL | page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR at file:///workspace/scratch/c01bd6fe117d/reconciliation-dot-20261022/evidence/dot-followup-20261022/browser/final/case-summary-case-6c217a84f3f1a1de1e58f7d3.html |
| PRIVACY-save-notice | PASS | save notice warns that the project contains financial rows |
| DUP-stale-project-blocked | PASS | pre-export project copy shows the browser-recorded export |
| SRC-reopened-unverified | PASS | reopened project marks all 4 sources unverified |
| SRC-reverified-originals | PASS | all 4 originals re-parsed to identical saved rows |
| SRC-wrong-file-rejected | PASS | non-matching file rejected with explanation |
| SAVE-state-visible | PASS | unsaved status visible after an edit |
| SAFE-replace-confirmation | PASS | demo did not replace unsaved real workspace; Keep workspace retained it |
| ERR-malformed-project | PASS | concise error; workspace and unsaved protection retained |
| SAFE-beforeunload | PASS | browser beforeunload prompt shown and dismissing it kept the page |
| XLSX-native-controls-preserved | PASS |   /    /    /    /    /    /    /    /    /    /    /  Sheet1!H9: H7+H8 · CONSISTENT · stored 900 · independent cents 90000  /  Sheet1!I9: I7+I8 · CONSISTENT · stored 900 · independent cents 90000  /  Sheet1!H10: H9 · CONSISTENT · stored 900 · independent cents 90000  /  Sheet1!I10: I9 · CONSISTENT · stored 900 · independent cents 90000  /  TRANSACTION_SCOPE_ONLY Validated complete journal groups only. This report does not prove company/account-period coverage, a cleared balance, or a month-end close. |
| XLSX-native-provenance | PASS | txn 145 from group row; posting physical rows 7/8; original XLSX SHA-256 unchanged |
| XLSX-native-reverify | PASS | native XLSX + CSV originals re-parsed (worker) to identical saved rows |
| A11Y-keyboard-order | PASS | Skip to workspace → Reconciliation Desk home → Desk → Import → Exports → Stays in this browser → Import files → Load demo → Try a sample month |
| A11Y-zoom-200 | PASS | 720px CSS viewport (1440px at 200%): {"scrollWidth":720,"innerWidth":720} |
| MOBILE-landing | PASS | {"scrollWidth":390,"innerWidth":390} |
| MOBILE-desk-status-and-evidence | PASS | {"scrollWidth":390,"innerWidth":390} |
| MOBILE-case-review-next-step | PASS | {"scrollWidth":390,"innerWidth":390} |
| MOBILE-exports-page | PASS | {"scrollWidth":390,"innerWidth":390} |
| EXTRA-two-real-tabs-same-case-export | PASS | Two actual pages, shared storage and Web Locks; one winner, 2 downloads total |
| EXTRA-print-main-app-PDF | PASS | Visible Evidence summary Print / Save as PDF control, Chromium print renderer produced PDF; native print dialog not asserted |
| EXTRA-screen-reader | BLOCKED | No supported screen reader integration in this environment; accessibility tree is not screen reader acceptance. |
| EXTRA-keyboard-complete-import | PASS | Tab/Shift-free sequential Tab, Enter, Space, arrow keys, typing; visible file picker activated with Space; native chooser files selected; full import to Reconciliation complete. Native chooser path selection automated by FileChooser.setFiles. |
| EXTRA-native-GL-native-style.csv | PASS | 4 parsed rows; saved project and screenshot for independent edge inspection |
| EXTRA-native-GL-supplemented.csv | PASS | 4 parsed rows; saved project and screenshot for independent edge inspection |
| EXTRA-UF-full-click-flow | PASS | Complete UF import/evidence/review/payments flow: CANDIDATE → REVIEWED_INSTRUCTIONS worksheet; never accounting import and no QBO write. |
| NET-runtime-egress | PASS | hosts=127.0.0.1:4173; 55 distinct requests |
| CONSOLE-errors | PASS | none |

### 重试与根因透明说明

- `final/first-attempt-results.json` / `first-attempt-run.log` 保留首次补充运行：打印等待 screen-visible 的 `.print-summary` 超时。该容器设计为仅 print media 显示，因此修正 harness 等待 DOM attached，再通过实际 Chromium PDF 渲染验证；没有放松产品会计断言。
- Enter 激活文件选择器时，ST 成功、第二个已聚焦的 QB 选择器超时。`supplement/run.log` 和 `keyboard-before-QuickBooks.png` 保存失败与可见焦点。根因未确定，不能断言产品事件缺陷，也不能宣称 Enter 全流程通过。
- 标准 Space 激活文件按钮的完整键盘导入通过，证据 `keyboard-space/run.log`、`keyboard-space/keyboard-complete-import.png`，并在完整扩展运行复跑通过。测试使用 Tab 找到每个控件、Enter 导航/提交、Space 文件按钮/复选框、方向键 select、键盘输入。原生 chooser 文件路径由 Playwright FileChooser.setFiles 选择，此边界明确保留。
- 首次 PDF 生成 PASS，视觉布局 FAIL：`supplement/pdf-page1.png` 中固定绿色 Skip to workspace 覆盖表格。新的具名真实浏览器测试 `PRINT-navigation-hidden` 在 `print-before-fix/print-results.json` 稳定 FAIL，随后 `print-before-fix-style/computed-style.json` 记录 print 样式。禁止把“PDF 文件有效”改写为“版式无问题”。

### 实际业务链路证据

- `final/RD8C9256AC39_BETA_NOT_POSTED.csv` 与原始快照 SHA-256 同为 `b2db0b58fab32b688fdc7a4c6c456808a1aa98a87ad866d39290ebb73d118d49`。只两条平衡分录：Dr Merchant Processing Fees 900 / Cr ServiceTitan Clearing 900，不重复借记银行。manifest 的时间戳不做字节比对。
- `final/concurrent-tab0.png` / `concurrent-tab1.png`：两个真实标签页并发 UI 点击，同一会计案例只有一个 tab 下载 CSV+manifest，总计 2 个文件。不是两个无共享存储 context，也不是 jsdom 锁模拟。
- 原生列合成 GL：`final/native-style.csv-mapping.png`、`native-style.csv-result.png`、`native-style.csv.review.json`；4 行正常解析，但主要案例 ST→QB CANDIDATE、QB→Bank ABSENT、ST→Bank CONFIRMED，保守阻断正确。
- 补充身份列后：`final/supplemented.csv-mapping.png`、`supplemented.csv-result.png`、`supplemented.csv.review.json`；4 行正常解析，主要案例三个边 CONFIRMED，UI 显示 Verified three-way，但仍要求完整 expense/duplicate-fee review。没有把补列误当完成账务验收。
- UF：`final/uf-candidate.json` → `final/uf-reviewed.json`，状态 CANDIDATE → REVIEWED_INSTRUCTIONS，`importEligible:false`、`missingEvidence:[]`。`final/uf-full-click-reviewed.png` 记录实际完整输入。仅合成人工工作底稿，未登录、写入或验证任何 QBO 公司。

## F-10 基线真实浏览器复现

基线 42d677e 使用 Vite-only 构建（不冒充 baseline typecheck），命令/结果在 `baseline-vite-build.txt`。原生 Terminal 启动有界可见 Chromium、沙箱启用、127.0.0.1:4174。`f10-baseline/baseline-browser.json` 记录浏览器自然 favicon 请求带来的 console 404，location.url 精确为 `http://127.0.0.1:4174/favicon.ico`；`baseline-landing.png` 保存页面。没有用脚本主动请求 favicon 伪造复现。最终运行 consoleErrors 为空。

## 可复现 harness 评估

现有 harness 的业务断言可保留；本轮执行锁定环境已安装 Playwright Core **1.57.0**，Chromium **155.0.8059.79**。运行脚本和全部输入已保存在 `evidence/dot-followup-20261022/browser/`。当前脚本的 Node/Playwright/仓库绝对路径是本环境适配，迁移时必须显式更换为受控工具目录，不能称任意机器一键重跑。建议独立测试工具目录单独锁文件固定 playwright-core 1.57.0 与浏览器版本，不向生产 dependencies 加 Playwright。浏览器沙箱不能启动时停止并标 BLOCKED，不增加 --no-sandbox。原始历史证据保持原位。

## 打印新缺陷：真实浏览器红→绿，已完成

- 修复前：`print-before-fix-style/computed-style.json` 为 `display:block / visibility:visible / position:fixed`；具名 `PRINT-navigation-hidden` FAIL。`supplement/pdf-page1.png` 显示绿色导航遮挡表格，原件未覆盖。
- UI lane 仅修改 print media 的隐藏导航选择器，保留屏幕 skip-link 及焦点规则；静态回归由该 lane 独立记录。
- 修复后在重新构建的生产 bundle 上运行同一 `qa-print-regression.mjs`：`print-after-fix/print-results.json` 的 `PRINT-navigation-hidden` PASS，`computed-style.json` 的 display 为 **none**，consoleErrors 为空。
- 最终 PDF：`evidence/dot-followup-20261022/browser/print-after-fix/evidence-summary.pdf`。Poppler 确认为 2 页 A4、PDF 内无 JavaScript；`pdf-text.txt` 不含 Skip to workspace。已实际打开并检查 `page-1.png` 和 `page-2.png`：导航遮挡消失，表格/分页表头及源文件 SHA 列表可读、无文字重叠或裁切。
- 功能矩阵 36 项是在最后这条 print-only CSS 修复之前运行；修复后执行的是针对打印入口、print computed style 和 PDF 两页的定向复验，不将其冒充又一次完整 36 项重跑。
- 最终边界：主应用 PDF 生成与本合成案例版式 **PASS**；被管理策略拒绝的本地 reviewer HTML 浏览/打印依然 **BLOCKED**；原生 OS 打印对话框 **NOT RUN**；屏幕阅读器 **BLOCKED**。Enter 文件选择器变体仍保留失败记录，Space 完整键盘导入已通过。
