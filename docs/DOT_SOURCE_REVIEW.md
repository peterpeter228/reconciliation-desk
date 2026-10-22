# dot 独立复核：F-01 / F-04 / F-05 / F-06

日期：2026-10-22。仅合成数据、本地源码和测试。未连接真实账簿、未调用付费模型、未合并 main。

## 结论与范围

| 修复 | 结论 | A：42d677e 基线 | B：独立临时副本变异 | C：对抗变体与最终代码 |
|---|---|---|---|---|
| F-01 | 修改后合并（原修复必要；附加防御性状态绑定） | reopened normalized rows 仍可生成草案；隔离 F05 后具名测试报 promise resolved | 删除 proposalFromCase 的 sourceTrustBlocker 拒绝行，F01 baseline 测试红；恢复绿 | 同字节改变解析语义重解析会拒绝；增加 session-only verification digest，绑定文件类型、解析选项、规范行、manifest、公司/银行、demo 上下文。见 source-verification.ts:35–70、117–129 |
| F-04 | 修改后合并 | 已有银行存款时仍给 REVIEWED_INSTRUCTIONS；重复 Payment 不提示 | 将 caseRows 改为空，具名“stays a candidate when the GL already…”测试红；恢复绿 | 不相关银行 GL 行不触发冲突；新增发现：OTHER_CASE 随意标签原可隐藏费用活动。现要求不同 BOUND case、实际交易归属、已知文档/源 SHA 和 reviewer，且本案行不可排除。case-adapter.ts:108–142、410–431 |
| F-05 | 修改后合并 | 真实解析器多个 mapping versions 拼接超过 240，Zod too_big | 将 mappingSetVersion 改回 join，F05 baseline 红；恢复绿 | digest 从无文件归属的版本集合改为每文件 hash/kind/mapping/options/物理行解析与映射版本，重新分配映射会改变批准 payload，复用旧批准导出被拒绝。case-adapter.ts:78–105、349 |
| F-06 | 合并核心 guard；导入同名校验由主任务补充 | 未配置 QB bank account 的 CANDIDATE 边仍生成草案 | 禁用 CONFIRMED guard，F06 baseline 红；恢复绿 | 实际 bank leg → CONFIRMED；逐项会计确认 → CONFIRMED；只有 clearing split semantics → SUPPORTED 且不能 draft。case-adapter.ts:176–182；engine/edges.ts:220–260 |

F-01 重要限制：新增直接状态变异测试证明旧 hash-only 结构缺乏变更检测，不等于证明用户可通过界面任意改内存绕过。已读 addEvidenceEntries：原实现 clone/append 且跳过重复文件哈希；未证实正常补证流程能改掉已验证源行。故新增绑定定位为防御性完整性加固，不把它写成已证实的 P1 可利用安全漏洞。新导入的补充证据由 app 负责人采用 markSourceVerified 为刚解析的内容建立绑定，不额外要求重复上传。

F-05 同样区分：mapping-set-v1 原先是“版本集合”的摘要，不能唯一表达文件→映射归属，这是可重复的完整性缺口；旧映射交换在真实 UI 中可能已由重新计算/撤销批准防住，本报告不声称完成界面端到端利用。

F-04 OTHER_CASE 来源是可编辑 reviewedFacts，但本轮新反例在领域函数层注入事实；浏览器端填写路径由主任务统一验收。不能把领域测试称为浏览器验证。

## 运行证据

证据目录：evidence/dot-followup-20261022/source-review/。

1. A 基线复现：已有独立 worktree ../reconciliation-dot-baseline-20261022 指向 42d677e。仅复制合成 fixtures 和测试，不改 baseline src。命令：
   - ./node_modules/.bin/vitest run tests/dot-source-review/acceptance.test.ts → 3 failed，日志 baseline-F01-F05-F06.txt。
   - ./node_modules/.bin/vitest run tests/claude-review/ui-safety.test.tsx -t 'F-04' → 2 failed / 13 skipped，日志 baseline-F04.txt。
   - F01/F06 在基线中把 versions.mapping 设为短字符串，专为避免 F05 已知长度缺陷先拦截；不删除会计前置事实，也不把两个 defect 互相遮蔽算通过。
2. 新反例先红：npx vitest run tests/dot-source-review/guards.test.ts → 6 failed / 1 passed，new-findings-red.txt。修复后同命令 → 7 passed，new-findings-green.txt。
3. B 变异：python3 evidence/dot-followup-20261022/source-review/mutations.py。脚本复制 src/tests/config 到 TemporaryDirectory，使用共享只读依赖链接；每次变异只发生在临时副本，每次恢复并重跑。四项 mutation exit=1，restored exit=0，详细具名测试见 mutation-Fxx-red/restored.txt 与 mutation-results.json。保留的 restored SHA 对应当时加固版（之后仅补了 options 摘要与测试），不是宣称最终提交 SHA。
4. C 最终定向回归：npx vitest run tests/dot-source-review → 15 passed / 3 files，adversarial-final-corrected.txt。
5. 较早 expanded 回归包含原 Claude fixes：4 files / 24 passed，green-expanded.txt。
6. 诚实保留中间失败：adversarial-final.txt/typecheck.txt 记录一次辅助函数导出替换未成功和测试夹具多余 validation_errors 属性。均已纠正，后续 15/15 定向绿；完整最终 typecheck/全套验收以主任务汇总日志为准，不把旧错误日志标成当前通过。

Vitest 日志时间来自执行机本地时区（较 UTC +9），本报告日期按任务 UTC 日期；不要把 18:xx 误当另一轮运行。

## 会计保守性是否过度阻断

Verified（代码、合成反例）：
- unrelated full-month bank 行不在 g.qb_ids，F04 不阻断合法 UF 案。
- 全月费用科目活动如果没有可核实 OTHER_CASE 归属，UF 会继续候选。这是明确的防重复费用要求，不应凭“看起来不相关”自动放行。
- SUPPORTED clearing split 没有独立看到银行腿；缺失信息为 QB_BANK_LEG_OR_ITEMIZED_ACCOUNTANT_CONFIRMATION。ALGORITHM_SPEC.zh-CN.md §5.3、§8 明确仅 supported 不授予 AJE 导入资格。因此 F06 阻断正确，不能为降低操作负担改成允许 SUPPORTED。
- itemized confirmation 可以使引擎边 CONFIRMED；但 fee-only builder 另要求完整过账账簿及已有净额银行腿。边确认本身不自动满足所有导出条件，本轮不扩张该会计政策。
- parser version 变化引起 provenance 差异时，会明确提示“different parser version. Re-import the original files”。不升级旧项目的会计信任是可接受的保守兼容策略；调查仍可继续。
- synthetic demo reopen 保留原豁免，输出 syntheticOnly 标记；改回 real 后必须验证。新 binding 也包含 isDemo，demo 状态建立的 verification 不能直接带到 real。

Inferred / 未证明：
- 所有真实导出格式可用、所有浏览器可用、真实客户不会误映射，均无本报告证据。
- 源文件重解析证明“这些字节在这些人工选项下得到这些行”，不认证源系统、人工映射判断或会计复核者身份；会计仍须审核实际报表范围与语义。
- 本轮没有执行 QuickBooks 写入或真实财务账户验证。

## 新问题清单

| ID | 严重性与性质 | 修复/回归 | 剩余限制 |
|---|---|---|---|
| DOT-S01 | 中，防御性状态完整性 | verifiedBindings + 四个状态变异反例 | 未证实实际 UI 改内存路径；不是安全认证机制 |
| DOT-S02 | 中，批准摘要归属不完整 | per-file mapping digest；交换版本更改摘要；旧批准拒绝；顺序重排保持稳定 | 重开项目本来就失效批准；无权限认证能力 |
| DOT-S03 | 中，UF fee 冲突可被无凭据 OTHER_CASE 标签排除 | provenOtherCase 且当前 case 优先；具名 unsupported OTHER_CASE 测试先红后绿 | 仅领域函数回归，完整 UI 由主验收覆盖 |

本报告修改仅源码 source-verification.ts/case-adapter.ts、独立测试、经主任务授权的原 F05 期望值更新和本目录证据。文件哈希、导出 CSV 确定性与最终集成结果见主任务报告；映射摘要变化预期改变 manifest/proposal payload，不应改变稳定 journal ID 或 CSV 数值。

### 最终补验（代码冻结后）

- npm run typecheck → exit 0，typecheck-final.txt。
- npx vitest run tests/dot-source-review → 17/17 PASS，adversarial-17-final.txt。
- 新增同哈希、不同 parseOptions 的第二文件反例：markSourceVerified 只绑定首个上下文，另一上下文仍未验证，最终 fail closed。
- 新增 serialize → open 的 demo 导出：CSV 文件名仍以 SYNTHETIC 开头、manifest.synthetic_only=true；改为 real 后再次 serialize/open，草案被 original source gate 拒绝。此证据覆盖实际 serializer/restore/export 函数，不只是 trust helper。
- 之前夹具缺 bank_account_id 的类型错误也已补正；以上最终 tsc 为实际纠正后结果。
