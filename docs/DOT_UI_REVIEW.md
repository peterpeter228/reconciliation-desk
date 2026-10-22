# dot 独立复核：工作区与导出安全

2026-10-22。仅合成输入；本页组件测试是 jsdom；后续浏览器实测证据单独注明，不混同为组件测试。审查基线 42d677e；先读 1516938 的源码差异，再核对旧报告和原始 red-before-fix.txt/browser-results.json。主报告负责集成真实浏览器结果。

## Verified：A–D 逐项结论

证据根目录：`evidence/dot-followup-20261022/ui-review/`。`run-baseline.py <42d677e worktree>` 可重跑 A；`run-mutations.py` 在 `/tmp/reconciliation-ui-mutations` 中复制源码、测试并链接已安装依赖，逐项变异后恢复，**没有修改共享工作区源码**。每个 B 都有具名测试、变异 exit=1、恢复 exit=0，见 `mutation-results.json` 及对应 red/restored 日志。

| F | A：基线复现 | B：独立变异 | C：对抗与剩余限制 | D |
|---|---|---|---|---|
| F-02 | baseline-red：未保存工作无确认、demo 携带真实上下文复核事实；新增 pending/cancel 测试在基线失败 | 移除 guard 条件，`keeps import promise pending` 红 | Keep、关闭、Esc、背景点击均保留旧工作；确认后等 worker；同一 render tick 连续请求不会遗留未完成 Promise | **修改后合并**。`src/app.tsx:77–102,212–221,713–744` 的 guardReplace/cancelReplace/runFiles/确认框。修复原分支的过早 resolve 及覆盖 pending request 的新问题 |
| F-03 | `F03 prior export shows journal search and fresh GL review before any correction` 在基线红：缺三步路径 | 删除搜索 journal number 的关键指引，具名测试红 | 明示下载失败不等于从未导入，先查日志号再重导 GL；没有新增 UNKNOWN 重新导出路径 | **修改后合并**。`src/components/CaseReview.tsx:343–355` priorJournals 提示保留操作路径，但将“不会生成第二份”绝对表述改为有历史时阻断，并说明本地防重限制 |
| F-07 | `F07 unsaved edit installs unload protection and cancel keeps it` 在基线红 | 撤销 beforeunload listener，具名测试红 | 撤销替换后依旧 dirty、可编辑并有卸载保护；原分支 runFiles 未等待决定的缺陷见新问题 | **修改后合并**。`src/app.tsx:78–86,212–221` dirty effect 和 Promise 生命周期 |
| F-08 | 最初旧测试被 F-05 mappingVersion 长度问题提前挡住，不能算防重复现；显式单一合成 mapping 元数据隔离后，第一份 CSV 成功下载，旧副本没有本浏览器重复导出阻断，见 baseline-F08-isolated-red | 删除 reserveExport 的 existing 判定，`serialized reservation refuses duplicate and releasing undelivered reservation allows retry` 红 | 精确标签匹配；大小写、空白、拼写变化不匹配；无存储报告 persisted=false；序列锁下双请求仅一成功，未下载预留可释放。这不是两真实标签页验收 | **修改后合并**。`src/review/export-register.ts:37–39,102–113` 保留 exact key；`src/app.tsx:771–783` Privacy 与 `src/components/CaseReview.tsx:349–352` 文案补齐风险，不静默 lowercase 合并公司身份 |
| F-09 | 基线缺 reviewer summary 按钮，具名 UI 测试红；并非声称基线已有 HTML 的 XSS | 撤掉 escapeHtml，`escapes every hostile summary field into inert text and warns of financial information` 红 | 公司、银行、文件、复核人、备注、文档名、blocker、generatedAt 注入 img/onerror/引号/&，解析后无 script/img/iframe/object/embed/onerror 属性；CSP default-src none 保留；补摘要自身及按钮旁财务信息提醒 | **修改后合并**。`src/export/case-summary.ts:11–15,102`；`src/components/CaseReview.tsx:367–370` 下载区提示 |
| F-10 | 基线显式 favicon 断言红；浏览器 lane 随后在 42d677e 实际捕获 `/favicon.ico` 404 控制台错误，见 `../browser/f10-baseline/baseline-browser.json` | 移除 data:, 图标，`F10 explicitly suppresses the implicit network favicon request` 红 | 静态验证和真实浏览器基线 404 分别留证；data:, 不新增外部 icon 请求目标 | **合并**。`index.html:1`。基线真实 404 已复现；修复后控制台状态仍以完整浏览器矩阵为准 |

## 新发现、先红后绿

1. **DOT-UI-01 / P2：runFiles 在确认前 resolve。** 原分支 `if (workspace && dirty) resolve()` 让调用方认为导入已经完成。`new-defect-red.txt` 两个具名测试失败，修复后 `replacement-green.txt` 6/6。现在取消时 resolve，确认时等 worker 结束才 resolve。注意 ImportPage 当前只是 await onRun，未发现其后另有进度状态更新；因此“可导致未来调用者状态错乱”是推断，不夸大成已实测的可见按钮异常。
2. **DOT-UI-02 / P2：第二个待确认请求覆盖第一个 Promise。** 在修复 DOT-UI-01 后增加同 tick 两次 onRun 测试，`superseded-red.txt` 失败。同步 ref 记录当前待确认操作，后请求先 settle 被替代的前请求；`superseded-green.txt` 7/7。旧 workspace 不运行、不改变。
3. **DOT-UI-03 / P2：本地防重文案范围过大。** exact companyKey 对标签变化无保护，无 Web Locks 时没有跨 tab 原子性，清站点数据、换浏览器/设备也丢失保护。UI 如实说明；不把字符串规范化冒充稳定公司身份。只改注册键为 lowercase 还不能稳定 company-dependent case/action ID，并可能误合不同实体。
4. **DOT-UI-04 / P2：摘要隐私提醒缺失。** 旧 HTML 内有 company/reviewer/财务信息但没有信息保管提示。`summary-warning-red.txt` 先失败；修复摘要和下载入口提示后通过。转义本身未发现绕过。

并行来源绑定修复的 app 集成：addEvidenceEntries 不再只继承 verifiedHashes；保留完整 restoredSources，并对刚从原始字节解析出的新增文件调用 markSourceVerified，写入精确绑定。既不让旧来源凭哈希冒认新映射，也不无端要求当前会话新证据再次上传。来源绑定测试归主报告另一 lane。

## 可重复命令与证据解释

```sh
npm test -- tests/dot-ui-review
npm test -- tests/dot-ui-review tests/claude-review/ui-safety.test.tsx
python3 evidence/dot-followup-20261022/ui-review/run-baseline.py ../reconciliation-dot-baseline-20261022
python3 evidence/dot-followup-20261022/ui-review/run-mutations.py
npm run typecheck
```

- baseline-red 包含预期失败，不是验收通过；F08 隔离脚本只改测试 fixture 的 mapping version 元数据，不改生产代码或财务行，并保留首次受其他缺陷干扰的失败说明。
- 旧 Claude 的 red-before-fix.txt 中同样可看到 mappingVersion 长度错误；旧 F08 红测试未必独立证明重复导出，不能照抄红→绿结论。
- 所有 HTML 攻击值都是合成值，DOMParser 仅用于检查解析结构，不是浏览器脚本执行测试。
- mutation logs 恢复绿只覆盖所列目标测试，不替代完整回归。完整回归、浏览器、真实账户验收由主报告分别列示。
- 没有改 UNKNOWN 导出阻断、没有对外写入、没有付费模型调用、没有 main 合并。

## Inferred / 尚未建立

真实多标签页锁行为、原生文件选择器、打印/PDF、完整键盘操作不由本页 jsdom 覆盖。F10 的真实浏览器基线 404 已由 browser lane 补充，见上述证据。上述能力以独立浏览器矩阵为准；浏览器受阻时必须写 BLOCKED，不升级本页 PASS。

最终本 lane 执行：`final-green.txt` 4 文件 / 30 测试 PASS（15 个本轮 UI 测试 + 15 个原有组件回归）；`typecheck.txt` PASS。早先集成中的 typecheck 临时失败保留于执行历史，不作为最终状态。

## 后续真实浏览器发现：PRINT-01

浏览器 lane 的实际 PDF 首页面显示 `Skip to workspace` 固定导航层覆盖表格。新增具名 `PRINT-01 hides the keyboard skip link only in print while retaining screen focus access`，先运行静态样式回归失败（`ui-review/print-red.txt`），再仅在 `src/styles.css:2797` 的既有 `@media print` 隐藏列表添加 `.skip-link`，回归通过（`print-green.txt`）。屏幕端 `.skip-link` 与 `:focus` 规则不变。此测试验证 CSS 合约，不冒充真实打印；实际 computed visibility / PDF 前后验证由 browser lane 留证。修复没有改变财务数据或屏幕键盘可访问性。
