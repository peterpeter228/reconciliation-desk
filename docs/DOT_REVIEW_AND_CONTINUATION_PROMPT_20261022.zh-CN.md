# 给 dot：独立复核 Claude Code 的修复分支，并完成剩余任务

> 使用方式：在 `reconciliation-desk` 仓库中完整读取本文件后执行。不要只返回计划。你的任务是**审查 Claude Code 的工作而不是为它背书**，然后在授权边界内完成剩余事项，交付可接手的中文报告。原提示词 `docs/CLAUDE_CODE_REVIEW_AND_COMMERCIAL_READINESS_20261022.zh-CN.md` 的所有边界与授权要求继续有效。

## 0. 决策目标

本轮最终要回答三件事：
1. Claude Code 的每项修复（F-01…F-10）是 **合并 / 修改后合并 / 拒绝**？各自依据什么证据？
2. 修复后，哪条用户流程真正可交付；哪些阻断是正确的，哪些属于新引入的过度阻断？
3. 剩余事项中哪些已完成，哪些因缺授权只完成到“准备好、未执行”？

不以测试数量、文档篇幅或“看起来完整”作为完成标准。

## 1. 恢复真相：从原始材料开始，不从报告开始

- 远端分支 `review/claude-code-independent-20261022`，记录时 HEAD 为 `d5964ce`，基于 `42d677e`。运行时重新 fetch；若有新提交，审查差异。不要自动合并 main，不强推，不覆盖他人工作。
- 先读**代码差异**，再读报告：`git log --oneline 42d677e..origin/review/claude-code-independent-20261022`，逐提交 `git show`。源码修复在 `1516938`，测试在 `3f5ef28`，其余为文档和证据。
- 原始证据：`evidence/claude-review-20261022/`。重点看实际下载字节、`browser/after/export-sha256.txt`、`browser-results.json`、`qa-run.mjs`、`red-before-fix.txt`，不要只看 README 的结论。
- Claude Code 的报告（`docs/CLAUDE_CODE_INDEPENDENT_REVIEW_20261022.zh-CN.md`、`docs/HANDOFF_TO_DOT.md`、`docs/COMMERCIAL_VALIDATION_PLAN_20261022.zh-CN.md`）只当待核实的说法。它们已区分 Verified 与 Inferred；你要逐条核对 Verified 是否真的有证据。

## 2. 逐项复核修复（每项都要做 A–D）

对 F-01、F-02、F-03、F-04、F-05、F-06、F-07、F-08、F-09、F-10 分别做：

- **A. 基线复现**：`git worktree add <scratch> 42d677e`，在基线上用合成输入复现问题（单元、jsdom 或真实浏览器任选其一，按问题性质选）。复现不了就如实记录，并说明该修复是否还有必要。
- **B. 变异检查**：在修复分支上临时撤掉该修复的关键行，确认至少一个**具名**测试变红，然后恢复。测试不变红，说明覆盖不足：补测试，或把结论降级。
- **C. 对抗变体**：主动尝试绕过修复。至少检查下面这些已知薄弱点：
  - F-01：能否通过其他字段、重命名文件、同字节不同 parseOptions、补充证据流程（`addEvidenceEntries` 对 `verifiedHashes` 的继承）、或 demo/真实切换绕过重新验证？parser 版本升级后旧项目必然无法验证，这个行为是否可接受、提示是否清楚？
  - F-05：`mapping-set-v1:<digest>` 是否仍唯一绑定每份文件的映射？旧批准是否不可能被复用？
  - F-06：要求 QB→Bank 边为 CONFIRMED。`src/engine/edges.ts` 中，银行腿或逐项会计确认会得到 CONFIRMED，仅凭 `clearing_split_semantics_confirmed` 只得到 SUPPORTED。判断后者被挡是正确的保守处理还是过度阻断，并给出依据。导入页新字段与 clearing 同名时会怎样？
  - F-02/F-07：`runFiles` 在弹出确认框时立即 resolve，导入页的按钮/进度状态是否因此错乱？撤销替换后能否继续原工作？
  - F-08：导出登记以用户填写的公司标签哈希为键，换个拼写或大小写即可绕过；不支持 Web Locks 的浏览器只能尽力而为；清除站点数据会丢失。评估这些剩余风险是否在 UI 和文档中如实说明，必要时收紧（例如提示“公司标签变化时不受保护”），但不要宣称绝对防重复。
  - F-04：`ufReviewConflicts` 会不会把合法 UF 案例误判为冲突（例如 GL 中出现与本案无关的银行行）？
  - F-09：HTML 摘要包含公司标签和复核人文字。确认转义完整，并判断“含财务信息”的提醒是否足够。
- **D. 结论**：合并 / 修改后合并 / 拒绝，附文件:行号、复现命令、修复前后输出。

确认属实的新问题：先写一个能稳定失败的测试，再修代码。不得降低断言或伪造夹具。

## 3. 独立重跑验收（不用 Claude Code 的结果代替）

- 在你自己的环境运行：`npm ci --ignore-scripts`、`npm run typecheck`、`npm test`、`npm run test:reference`、`npm run build`、`npm run format:check`、`npm run check:artifacts`、`npm run benchmark:3000`。注意 benchmark 会改写 `evidence/implementation-20261021/benchmark-3000.json`，跑完用 `git checkout` 还原，或先修第 5 节的脚本问题。
- 真实浏览器重跑 `evidence/claude-review-20261022/browser/qa-run.mjs`：`vite preview` 只监听 127.0.0.1；Chrome 保留沙箱、以普通用户运行，**不得 `--no-sandbox`**；上传必须走可见控件 + 原生文件选择器。浏览器起不来时标记 BLOCKED，不得用 jsdom 冒充。
- 通过标准：
  - 29/29 PASS，或对每个 FAIL 给出根因。
  - 下载的 CSV SHA-256 与 `export-sha256.txt` 中的 `b2db0b58…8d49` 一致（内容应是确定性的；manifest 含时间戳，不比对字节）。
  - 运行时网络只有 127.0.0.1，控制台无应用错误。
- 补跑 Claude Code 标为 NOT RUN 的项目：打印/PDF、两个真实标签页同时导出同一案例、UF 在浏览器里的完整点击流程、键盘完成一次完整导入。每项记录 PASS/FAIL/BLOCKED/NOT RUN、步骤、期望与实际。屏幕阅读器若环境不支持，标 BLOCKED。

## 4. 完成剩余任务（按优先级；无需授权的直接做）

1. **原生导出缺口（H5），只做本地可做部分**：用公开 Sample Company 或合成数据，按原生 QBO GL 的真实列结构（无 Role / Linked Deposit ID）测量：从原生导出到形成可复核案例，需要用户补哪些列、多少步、出错点在哪。产出一份带步骤截图的引导方案草案；不得加入按金额猜测的匹配。
2. **全月 clearing 关联负担**：设计并实现“按证据批量关联 OTHER_CASE”。每个批次必须绑定一个已知文档/源文件哈希和明确的交易清单，不得一键全选、不得放松阻断。用演示月数据测量改进前后需要的操作次数。
3. **UNKNOWN 导出的复核恢复路径**：只出设计与原型分支，**不得改变现有导出阻断**，除非 owner 明确批准该会计策略。设计要点：复核人记录“已在账簿中检查日志号”的结果（找到 / 未找到）、附检查用的 GL 报表哈希、保留历史；“未找到”时是否允许重新下载**同一**日志号文件，列为待 owner 决策的选项。
4. **商业验证材料**：在 `docs/COMMERCIAL_VALIDATION_PLAN_20261022.zh-CN.md` 基础上准备 5 次问题访谈的问题单、合成演示脚本和记录模板。**不得发送外联、不得联系任何人。** 方案中 E1–E3 与 E7 已逐页回读（标 ✔），E4、E5、E6、E8、E7b 仍是未核实线索；需要引用时逐页回读并记录访问日期，403 或未能读取的写明。
5. **工程整理**：让 `scripts/benchmark-3000.ts` 的输出路径可配置，默认不再覆盖历史证据；评估把浏览器 harness 纳入可复现脚本的方式（锁定版本、不加入生产依赖）。

## 5. 不可越过的边界（需 owner 单独明确授权）

- 对外联系、访谈、发帖，或处理/传输任何真实客户账簿。
- 连接任何会计/银行账户，或在任何 QBO/QBD 公司（包括公共 Sample Company）执行导入、录入、删除。
- 部署、开放端口、更新 owner-private QA 站点、启用支付/邮件/分析服务。
- 调用 Argon 或其他付费模型；新增付费服务预算为 0。
- 合并 main 或强推。

缺授权的事项准备到可执行为止，在报告中单独列出：目标、范围、后果、需要谁批准。

## 6. 交付物与报告

- 小而清楚的提交，推送到**新的独立分支**（例如 `review/dot-followup-<日期>`），不合并 main。推送前核对 diff 中没有真实客户数据、密钥或凭据。推送后回读远端 SHA，并给出 compare 链接。
- 更新 `docs/HANDOFF_TO_DOT.md`（或改名为通用交接文件，二者择一并说明），新增一份《复核结论》文档：每个 F-xx 的 A–D 结果表、新发现问题清单（ID、严重性、文件:行号、复现、修复、回归测试、剩余限制）、真实浏览器矩阵、剩余事项完成度。
- 报告分开写 **Verified**（每条附命令、产物路径或日志行）与 **Inferred**（原因推断、时间关联、范围词如“全部 / 生产”、近似值）。

最终中文反馈必须回答：
1. 每项修复的结论与证据。哪些被你推翻或修改？
2. 你独立重跑的结果，与 Claude Code 记录不一致之处及原因。
3. 新发现的问题、修复、回归证据。
4. 剩余任务各完成到哪一步；哪些因缺授权停在“准备好、未执行”。
5. 当前分别是否达到：本地可演示、辅助试点可用、真实客户可用、QBO/QBD 验收、需求验证、盈利验证。逐项给依据。
6. 只给一个下一步优先行动及其停止条件；需授权的动作单独列明。
