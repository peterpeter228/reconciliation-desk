# Reconciliation Desk 独立审查与修复报告（2026-10-22）

审查者：Claude Code（独立于 dot）。分支 `review/claude-code-independent-20261022`，起点 `42d677e`
（= `74ff1fc` + 审查提示词文档）。全部使用合成数据，未连接、未写入任何会计/银行系统，未部署，未调用 Argon
或其他付费模型（提示词 §3 预算为 0）。证据索引与验收矩阵见
[`evidence/claude-review-20261022/README.md`](../evidence/claude-review-20261022/README.md)。

## 1. 结论摘要

**已验证（附证据）**
- 基线 `42d677e` 的自动检查确实全绿：690 TS 测试、33 Python、typecheck/build/format/artifacts/benchmark
  （`evidence/claude-review-20261022/baseline-vitest-42d677e.txt`）。
- 但真实用户路径在基线上走不通：用真实解析出的三份 CSV 走到 “Build supported fee-only draft” 时，界面显示原始 Zod
  JSON `too_big … mappingVersion`，任何三文件真实导入都无法产生会计草案（F-05；真实浏览器截图
  `browser/before/before-01-build-error.png`）。dot 的“正向浏览器通过”使用的是手写归一化行的项目文件
  （`raw_row_sha256` 全为 `aaaa…`、两行共用 physical_row 2、mapping_version `test-1`），不是解析器输出。
- 修复后，同一路径在真实 Chrome（带沙箱）中完成：导入 → 补处理器证据 → 案例 → 事实 → 草案 → 批准 →
  CSV + manifest 下载并读回，仅 Dr 费用 900 / Cr clearing 900，无第二条银行借方（`browser/after/` 29/29 PASS）。
- 最终 720 TS 测试（新增 30 个）+ 33 Python、typecheck/build/format/artifacts 全部通过。

**推断（未独立证实）**
- dot 记录的“一次瞬时回到空白入口”：未复现。一个可能机制是 dev server 在会话中修改源码触发的 HMR 整页重载
  （dot 的记录显示 QA 期间父任务正在改 UI 文案），但没有日志直接证明；不宣称已修复。现已加入未保存提醒和
  beforeunload，并在 `vite preview`（构建产物）上做验收，以降低该类重载造成的损失。

## 2. dot 实现中正确的部分（有证据）

| 方面 | 证据 |
|---|---|
| fee-only 生成器对全量 GL 的严格校验（已有费用、未知关联、部分/冲销、复合结算、UF、重复科目）| `tests/review-workflow/accounting-domain.test.ts` 等在当前分支全部通过；新正向对照 F-00 证明只产生 Dr 费用/Cr clearing |
| 批准绑定精确载荷，重开撤销批准，导出历史不清零 | `tests/review/project.test.ts`；浏览器 `07-stale-copy-blocked.png` |
| 原生 QBO XLSX 四个控制公式保留、不执行、独立重算；物理行 7/8、交易 145 | 浏览器 `XLSX-native-controls-preserved`、`XLSX-native-provenance` PASS（当前代码） |
| CSV/XLSX 安全（宏、外链、ZIP bomb、XML 实体、公式注入中和）| dot 的 `tests/xlsx/*`、`exports.test.ts` 通过 |
| 异步竞态（取消、过期 worker、卸载后不提交）| dot 的 jsdom 测试通过；本次新增锁等待卸载回归 |
| 文档诚实标注 Beta、未导入、非生产 | README / IMPLEMENTATION_LIMITS |

## 3. 问题清单与修复

严重性：P0 阻断交付；P1 可能错账/重复/丢失工作；P2 恢复/可用性；P3 噪声。

| ID | 严重性 | 现象与影响 | 根因（文件） | 修复 | 回归证据（修复前→后） |
|---|---|---|---|---|---|
| F-05 | P0 | 每个真实三文件导入在生成草案时报原始 JSON，实际案例流程无法交付 | `case-adapter.ts` 基线第 271 行 `mapping.join('\|')`：3×80+2=242 字符 > `safeText` 240 上限 | 改为 `mapping-set-v1:<digest>` 绑定全部映射版本；UI 错误改为可读文案 `reviewErrorMessage` | `findings.test.ts` F-00 ZodError→PASS；`fixes.test.ts` F-05；浏览器 before 截图 → after `FLOW-build-draft-from-parsed-files` PASS |
| F-01 | P1 | 重开项目后，归一化行不再与原始字节绑定；完整性哈希无密钥，`isDemo` 可改为 false。改过的项目可产出非合成标记的可导入分录 | `project.ts` 基线 `openProject` 只校验 hash 引用并重算 | 重开后 `restoredSources` 置空（不序列化、strict schema 拒绝伪造该字段）；会计草案与 UF 已复核说明要求逐个重新附上原件并用保存的设置确定性重解析，行与 manifest 完全一致；调查与工作底稿不受影响 | `findings.test.ts` F-01 ×2 红→绿；`fixes.test.ts` 正向重验、篡改行、换文件、伪造验证标记；浏览器 `SRC-*` 4 项 PASS（含 XLSX） |
| F-06 | P1 | 工作台写着 “QB actual bank posting 仍需证据”，生成器却批准以“已过账银行结算”为前提的分录；导入页无法声明 GL 中银行科目 | `import.tsx` 未设置 `qb_bank_account_names`/银行科目角色；生成器未检查 QB→Bank 边 | 导入页新增 “QuickBooks bank account, exact GL name (optional)”；生成器要求 `QB_BANK_SETTLEMENT` 为 CONFIRMED | `findings.test.ts` F-06；浏览器 before `BEFORE-qb-bank-leg` OBSERVED → after `FLOW-engine-case` PASS |
| F-02 | P1 | “Reset sample month / Open project / 重跑导入”无确认即替换带未保存复核事实/导出记录的工作区；旧 review 以 orphan 形式混入新工作区（真实复核人和公司名进入“合成”演示项目文件） | `app.tsx` 基线第 90 行无条件 `initializeReview(next, previous.review)` | `compatibleReview` 仅在同公司、同银行、同 demo/真实上下文时继承；`guardReplace` 确认框（保留/先保存/替换）；替换成功后才清除未保存状态 | `ui-safety.test.tsx` F-02 ×2 红→绿、失败替换保留保护；浏览器 before `BEFORE-demo-replaces-unsaved-work` → after `SAFE-replace-confirmation` |
| F-08 | P1 | 导出历史只存在内存/项目文件：用“导出前保存的项目副本”或第二个标签页可再生成同一案例的第二份分录 | 无持久的导出记录 | 同浏览器导出登记（仅哈希公司键、案例/动作 ID、日志号、时间）；导出前在 Web Locks 中原子“检查+预留”；锁等待期间状态变化则释放预留且不下载 | `ui-safety.test.tsx` F-09、锁等待卸载；`fixes.test.ts` 并发预留只成功一次、存储损坏/拒绝；浏览器 `DUP-stale-project-blocked` |
| F-04 | P1 | UF “已复核说明”未检查 GL 已有该案例银行存款腿、费用科目已有未关联过账、同一 QB Payment 被另一案例占用；金额以“分”的数字框输入 | `CaseReview.tsx` 只拼装复选框事实 | `ufReviewConflicts` 将上述矛盾列为 missing evidence（保持 CANDIDATE）；金额改为 USD 文本并用 `parseMoney` 校验 | `ui-safety.test.tsx` F-04 ×2 红→绿；完整证据合成正向 + 5 个反例 |
| F-03 | P2 | 导出后只显示一句提示，未说明去哪里查、何时停止 | — | 显示日志号与三步核对路径（在 QB 搜日志号 → 重导 GL/Transaction Journal → 若缺失人工处理）；明确本工具不会再生成第二份 | 浏览器 `FLOW-repeat-export-blocked` |
| F-07 | P2 | 无未保存状态、刷新无提醒；保存项目的隐私提示弱 | — | “Unsaved review changes / Saved hh:mm”；beforeunload；保存后提示含财务行需妥善保管 | 浏览器 `SAVE-state-visible`、`SAFE-beforeunload`、`PRIVACY-save-notice` |
| F-09 | P2 | 交付物只有 JSON，接收方难以复核 | — | “Download reviewer summary (HTML)”：范围、来源与字节绑定状态、金额、引擎观察、未核实项、复核人声明（标注为声明）、会计输出、下一步与确认人；全部转义 + 无脚本 CSP | `fixes.test.ts` 转义测试；`browser/after/06-reviewer-summary.png` |
| F-10 | P3 | 控制台 `/favicon.ico` 404 | `index.html` 无图标 | 内联空图标 | 浏览器 `CONSOLE-errors` none |

另外，`import.tsx` 现在保存最终验证解析的完整设置（原生日志公司名、`coverageConfirmed:false`、实际表头行），
否则原生 XLSX 无法在重开后被重新验证（浏览器 `XLSX-native-reverify` PASS）。

## 4. 审查到但未修改的事项

1. **原生导出到会计草案仍有缺口**：引擎只按显式身份（Role、Account Type、Linked Deposit ID、处理器结算）连边，
   不按金额猜测。原生 QBO GL 没有这些列，所以“原生导出→调查工作底稿”可行，“原生导出→fee-only 草案”需要用户补充
   关联列与处理器结算文件。这是正确的保守设计，但决定了当前可交付范围。
2. **全月 clearing 关联负担**：同一 clearing 科目上的每笔其他交易都必须逐笔标注 OTHER_CASE 并给出证据，演示月会列出
   数百项。真实月份的人工成本未测量；下一步应设计“按批量证据关联”而不是放松阻断。
3. 项目完整性哈希无密钥；本地文件可被删除或改写。导出登记是同浏览器尽力而为，不跨浏览器/设备，清除站点数据即丢失；
   无 Web Locks 时退化为单任务内检查。
4. `scripts/benchmark-3000.ts` 固定写入历史证据文件 `evidence/implementation-20261021/benchmark-3000.json`（本次已还原）。
5. Node 22.22.0 对 jsdom 依赖 `w3c-xmlserializer` 报 EBADENGINE（需 ≥22.22.2）；测试仍通过。
6. dot 的 `evidence/handoff-workflow-20261022/fixtures/synthetic-current-case.review.json` 仍可作为合成演示打开
   （`isDemo:true`，输出带 SYNTHETIC 标记）；若把它改成 `isDemo:false`，现在会被要求重新附原件而无法生成分录——这是预期行为。

## 5. 安全与隐私复核

- 运行时网络：真实浏览器记录到的请求只有 `127.0.0.1:4173`（`NET-runtime-egress`）。这不覆盖 Chrome 自身后台流量。
- 新增本地存储只保存哈希公司键、案例/动作 ID、日志号与时间（`fixes.test.ts` 断言无公司名/科目名）。
- 新 HTML 摘要：所有值转义，`default-src 'none'`；XSS 用例通过。
- 公开证据：全部为合成数据或 Intuit 公共 Sample Company 名称；合成导出 CSV 已在证据中重命名为
  `SYNTHETIC_DO_NOT_IMPORT__…`，原字节哈希见 `export-sha256.txt`。未发现密钥或凭据。

## 6. 本次投入与剩余价值

按工具记录：基线测试开始于 08:10 UTC（`baseline-vitest-42d677e.txt` 中 “Start at 16:10:10” CST），最终测试开始于 08:52:05 UTC（`final-vitest.txt`），提交前时间 08:51 UTC；未单独计量各阶段耗时。最高价值的工作是 F-05/F-01/F-06：
它们决定实际案例流程能否成立、产出是否可信。剩余工作中，**真实客户需求证据**的价值高于继续扩展会计场景，
详见 [商业验证方案](COMMERCIAL_VALIDATION_PLAN_20261022.zh-CN.md) 与 [交接](HANDOFF_TO_DOT.md)。

## 7. 协作与模型使用说明

两个 Claude Code 子代理参与：haiku 做测试覆盖映射（只读），sonnet 做公开网页商业调研（除 WebSearch/WebFetch 外还使用了
环境中的 Exa、Parallel 公共搜索工具）。所有用到的子代理结论都由本审查者复核：覆盖缺口用 grep/测试确认，三条关键商业事实
逐页回读。未调用 Argon、Fable advisor 或其他外部付费模型。
