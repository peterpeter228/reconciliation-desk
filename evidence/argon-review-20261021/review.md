以下为针对 Reconciliation Desk 当前实际代码库（checkpoint173）的独立对抗性代码审查报告。本审查仅基于所提供的实际源码及测试文件进行静态分析，未运行任何工具或测试，不声称目标账套导入已获验证，也不建议放宽任何会计门禁。

---

### 一、 已确认的缺陷 (Confirmed Defects)

#### [P0-1] 结算存款明细（Deposit Component）跨越多个银行分拆入账时，引擎错误拒认现金边（False Rejection / 误报控制数冲突）
* **位置**：`src/engine/waterfall.ts` (`addGroup`, 第 38–39 行) 与 `reconcile` 主循环（第 62–66 行）
* **最小复现输入/步骤**：
  1. 准备两笔已过账银行流水 `b1`（`signed_cents: 600_000`, `deposit_id: 'DEP10001'`）和 `b2`（`signed_cents: 400_000`, `deposit_id: 'DEP10001'`），代表同一存款批次 `DEP10001` 被银行分两笔入账（总额 $10,000.00）。
  2. 准备对应的 `DepositComponentEvidence` `c1`（`deposit_reference: 'DEP10001'`, `gross_cents: 1_000_000`, `fee_cents: 0`, `net_cents: 1_000_000`, `bank_amount_cents: 1_000_000`）及关联的 ST 收款 `p1`（`gross_cents: 1_000_000`, `deposit_id: 'DEP10001'`）。
  3. 调用 `reconcile(input)`。
* **影响**：
  * 主循环第 62 行对 `ctx.bank` 逐行遍历，在每次迭代中以单行 `[b]` 调用 `addGroup(strong, [b], true, ...)`（第 66 行）。
  * 在 `addGroup` 内部第 38–39 行，代码将 `c.bank_amount_cents`（$10,000）和 `sumCents(components.map(c => c.net_cents))`（$10,000）与单笔银行流水的 `sumCents(banks.map(b => b.signed_cents))`（$6,000 或 $4,000）直接比对，必然触发 `COMPONENT_BANK_CONTROL_MISMATCH` 与 `INCOMPLETE_DEPOSIT_MANIFEST` 警告，导致 `cashState` 降级为 `CANDIDATE`。
  * 同时，`b1` 和 `b2` 生成的两个 group 共享同一个 `strong` CashUnit（即共享 `st_ids`），在第 96–106 行的并查集冲突检测中被判定为 `competing = true`，双双被打成 `AMBIGUOUS`（`COMPETING_EXCLUSIVE_SOURCE_CLAIMS`），无法完成对账分配。
* **最小修复与测试建议**：
  * **修复**：在 `src/engine/waterfall.ts` 第 62 行遍历银行流水前，先将具有相同非空强存款标识（如 `deposit_id` 匹配 `ev.deposit_components` 或 `u.payout_refs`）的银行流水按存款标识聚合为 `Bank_Deposit_Row[]` 组，再一次性传入 `addGroup(strong, groupedBanks, true, ...)`。
  * **测试**：新增单元测试：同一 `deposit_reference` 对应 2 条 `Bank_Deposit_Row`（金额之和等于 `bank_amount_cents` 及 `net_cents` 之和），验证生成单一 group 且 `ST_BANK_CASH` 为 `CONFIRMED`。

---

#### [P1-1] 处理器结算凭证（SettlementEvidence）未校验 `actual_settlement_date` 与 `scheduled_settlement_date` 的先后逻辑及状态一致性
* **位置**：`src/engine/evidence.ts` (`validatedEvidence`, 第 24–39 行) 与 `src/ingestion/normalize.ts` (`normalizeRow`, 第 73、85 行)
* **最小复现输入/步骤**：
  1. 构造一条 `SettlementEvidence`，设置 `status: 'PENDING'` 或 `'UNKNOWN'`，同时提供 `settlement_reference: 'SET12345'`, `fee_cents: 300`, `net_cents: 9700`, `gross_cents: 10000`, `held_cents: 0`。
  2. 调用 `reconcile(input)`。
* **影响**：
  * `evidence.ts` 第 38 行仅检查 `if (e.status !== 'HELD' && (!e.settlement_reference || e.fee_cents === null || e.net_cents === null))`。当 `status` 为 `'PENDING'` 或 `'UNKNOWN'` 但附带了预计的手续费、净额和参考号时，它通过了校验。
  * 随后在 `src/engine/units.ts` 第 24–25 行：`const s = settlements.find(e => e.payment_id === r.source_payment_id)` 未检查 `s.status === 'SETTLED'`（或 `'REFUNDED'`），直接将 `'PENDING'` 状态的 `s.fee_cents` 累加进 `CashUnit.fees`，并将 `cash_evidenced` 设为 `true`。
  * 而在 `src/engine/diagnostics.ts` 第 40 行：`settlements.some(s => (s.fee_cents ?? 0) > 0 && s.fee_mode === 'NETTED')` 同样未过滤 `s.status === 'SETTLED'`！这导致一条状态仍为 `PENDING` 或 `UNKNOWN` 的结算单被当作已确认的净扣费用凭证，若配合银行流水与确认函，甚至可错误解锁 `fee_aje_draft_eligible = true`（`aje_state = 'DRAFT'`）。
* **最小修复与测试建议**：
  * **修复**：
    1. 在 `src/engine/units.ts` 第 25 行和 `src/engine/diagnostics.ts` 第 40 行，仅当 `s.status === 'SETTLED'`（或针对退款逻辑的 `'REFUNDED'`）时，才承认其确认了最终结算费用与 `cash_evidenced`。
    2. 在 `src/engine/evidence.ts` 第 38 行明确限制各个 `status` 允许的字段组合（例如 `PENDING` 不得确认 `actual_settlement_date`）。
  * **测试**：在 `tests/engine/engine.test.ts` 中构造 `status: 'PENDING'` 但填满 `fee_cents`/`net_cents`/`settlement_reference` 的 `SettlementEvidence`，断言 `g.fees_cents === 0` 且 `g.fee_aje_draft_eligible === false`。

---

#### [P1-2] `verifyProposalInLedger` 在核验重导出的总账时，未要求借贷行属于同一个 `transaction_id`，且未排除同单据号下的多余分录行
* **位置**：`src/export/aje.ts` (`verifyProposalInLedger`, 第 74–84 行)
* **最小复现输入/步骤**：
  1. 获取一个已批准的两行 `FeeProposal` `p`（`journalId: 'RD...'`, 日期 `'2026-09-30'`, 借 `Merchant Financing Fees` 900.00，贷 `ServiceTitan Clearing` 900.00）。
  2. 构造重导出的 `QB_Ledger_Entry[]`：
     * 行 1：`num: p.journalId`, `transaction_id: 'TX-1'`, `posting_date: '2026-09-30'`, `account_full_name: 'Merchant Financing Fees'`, `debit_cents: 90000`, `credit_cents: 0`。
     * 行 2：`num: p.journalId`, `transaction_id: 'TX-2'`（完全不同的另一笔交易，恰巧复用了 `num`），`posting_date: '2026-09-30'`, `account_full_name: 'ServiceTitan Clearing'`, `debit_cents: 0`, `credit_cents: 90000`。
     * （或者：在 `TX-1` 中实际上还有第 3 行和第 4 行，但导出时未包含在 `matches` 的过滤条件外，或两笔不完整交易拼凑出了 `matches.length === 2`）。
  3. 调用 `verifyProposalInLedger(p, rows, manifests)`。
* **影响**：
  * 第 76 行仅按 `r.company_id === p.feeCase.companyId && r.num === p.journalId` 过滤。QuickBooks 中的 `num`（单据编号/DocNum）并不保证全局唯一（甚至在同日不同类型交易或手工编号下可重复）。
  * 如果两笔不同 `transaction_id` 的交易行各自命中了一条 `p.lines`，`verifyProposalInLedger` 会错误返回 `{ verified: true }`，导致未真正成对过账的分录被标记为 `VERIFIED_IN_QB`。
* **最小修复与测试建议**：
  * **修复**：在 `src/export/aje.ts` 第 77 行增加校验：若 `matches` 中存在 `transaction_id`，所有匹配行的 `transaction_id` 必须完全相同（`new Set(matches.map(r => r.transaction_id)).size === 1`），且 `rows` 中具有该 `transaction_id` 的所有过账行集合必须恰好等于 `matches`（防止一笔 4 行分录中有 2 行匹配、另外 2 行因为 `num` 为空而漏过第 76 行过滤）。
  * **测试**：在 `tests/import-export/exports.test.ts` 中构造两行 `transaction_id` 不同的匹配记录，或构造同一 `transaction_id` 下带有第 3 条无 `num` 分录行的记录，断言 `verifyProposalInLedger` 返回 `verified: false`。

---

#### [P1-3] `FeeCase` 校验未验证 `accounts` 中的 `clearing` 和 `bank` 科目名称与已过账总账（`postedGL`）之外的引擎确认函是否一致，且未拦截 `postedGL` 中同一交易包含未归属第三方的混杂借贷行
* **位置**：`src/export/aje.ts` (`validateFeeCase`, 第 36–41 行)
* **最小复现输入/步骤**：
  1. 调用 `createTeachingFeeCase()` 获取基础 `c`（`grossCents: 1_000_000`, `bankNetCents: 910_000`, `confirmedFeeCents: 90_000`）。
  2. 修改 `c.postedGL` 中 `DEMO-DEPOSIT` 交易：除了原有的 `Dr BANK 910,000` 和 `Cr CLEARING 910,000` 外，加入同一 `DEMO-DEPOSIT` 下的另外两行：
     * `Dr AR 90,000`（借应收账款 $900）
     * `Cr CLEARING 90,000`（贷清算账户 $900）
  3. 同时為了让第 41 行的 `clearing` 余额汇总仍为 `90,000`，在 `c.postedGL` 中再加一笔无关交易 `OTHER-TX`（`Dr CLEARING 90,000 / Cr AR 90,000`）。
  4. 调用 `buildFeeProposal(c)`。
* **影响**：
  * `validateFeeCase` 第 38–39 行使用 `sum(c.settlementTransactionId, clearing.id) !== -c.bankNetCents` 检查结算分录。虽然这阻止了对 `clearing.id` 额外冲销，但如果 `DEMO-DEPOSIT` 中包含了针对其他科目的借贷（例如实际上是一笔合并了多笔业务的复合分录：`Dr BANK 910,000 / Cr CLEARING 910,000 / Dr OTHER_EXPENSE 50,000 / Cr AR 50,000`），第 37–39 行全部通过。
  * 更重要的是，第 41 行 `checkedSum(c.postedGL.filter(l => l.accountId === clearing.id)...)` 汇总的是整个 `c.postedGL` 中所有交易的 `clearing.id`，而没有限制只汇总 `[c.receiptTransactionId, c.settlementTransactionId]`！如果 `c.postedGL` 传入了其他交易的过账行，可能掩盖本笔 `[receiptTransactionId, settlementTransactionId]` 自身的清算余量不等于 `confirmedFeeCents` 的问题（尽管第 39 行锁定了两笔交易在 `clearing.id` 上的代数和为 `grossCents - bankNetCents = confirmedFeeCents`，第 41 行若混入其他交易反而语义不清）。
* **最小修复与测试建议**：
  * **修复**：在 `src/export/aje.ts` 第 37–41 行明确要求：`c.postedGL` 中的所有行必须仅属于 `c.receiptTransactionId` 或 `c.settlementTransactionId`（或将第 41 行显式限定在当前 case 的交易集合与整个账户控制数双重校验），且 `settlementTransactionId` 的总借方必须恰好等于 `c.bankNetCents`。
  * **测试**：向 `c.postedGL` 的 `DEMO-DEPOSIT` 注入额外的平衡分录行，断言 `buildFeeProposal` 拒绝生成草案。

---

#### [P2-1] `diagnostics.ts` 中 `UNBATCHED_REFUND` 诊断在多笔未入批退款并存时，错误复用同一张 `AccountingConfirmation`
* **位置**：`src/engine/diagnostics.ts` (`diagnose`, 第 56–62 行)
* **最小复现输入/步骤**：
  1. 在同一个 `CashUnit` / `EngineGroup` 中包含两笔成功的未导出退款 `r1` 和 `r2`（例如通过同一存款单 `deposit_id` 关联到同一组）。
  2. 提供仅针对其中一笔（或仅针对存款单 `deposit_reference`）的 `AccountingConfirmation` `c`（`refund_coverage_confirmed: true, refund_not_recorded: true, batching_due_date: '2026-09-10'`）。
  3. 调用 `reconcile(input)`。
* **影响**：
  * 第 56–62 行的 `for (const refund of st.filter(...))` 循环对每一笔符合条件的退款都会调用一次 `add('UNBATCHED_REFUND', ...)`，导致 `group.diagnoses` 中出现多条重复的 `cause: 'UNBATCHED_REFUND'` 记录。
  * 此外，`AccountingConfirmation` 接口（`src/contracts/engine.ts` 第 70–84 行）没有 `refund_payment_id` 字段，因此第 57 行 `confirmations.find(...)` 无法区分确认函是针对哪一笔具体退款的。
* **最小修复与测试建议**：
  * **修复**：在 `src/engine/diagnostics.ts` 第 56 行，将未导出退款聚合后再调用一次 `add('UNBATCHED_REFUND', ...)`，并且要求所有未导出退款均有对应的 `settlements`（`every`）才可升级为 `CONFIRMED`。
  * **测试**：在同一组内放入 2 笔未入批退款（仅 1 笔有 `status: 'REFUNDED'` 的结算凭证），断言只生成 1 条 `UNBATCHED_REFUND` 诊断且级别不能为 `CONFIRMED`。

---

#### [P2-2] XLSX 解析器在检查 `Relationship` 外部链接时，对属性名大小写及命名空间前缀存在绕过风险
* **位置**：`src/ingestion/xlsx.ts` (`validateXml`, 第 172–174 行)
* **最小复现输入/步骤**：
  1. 构造一个 `.xlsx` 包，在 `xl/_rels/workbook.xml.rels` 中写入带命名空间前缀的标签或属性，例如：
     `<r:Relationship xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships" Id="rId9" r:Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" r:Target="https://evil.example/data" r:TargetMode="External"/>`
  2. 调用 `inspectXlsx(bytes)`。
* **影响**：
  * 在 `walkXml`（第 135、145 行）中，元素名 `name` 被剥离了命名空间前缀（`fullName.split(':').pop()!`），因此 `tag === 'Relationship'` 会命中；**但是** `attrs[key]` 是用原始带前缀的 `key`（如 `r:TargetMode`、`r:Target`、`r:Type`）存入 `attrs` 对象的！
  * 第 144 行的结构性属性别名拦截仅针对 `['row', 'c', 'dimension', 'mergeCell', 'autoFilter', 'workbookPr']`，**不包含** `Relationship`、`Override`、`Default`。
  * 因此在 `validateXml` 第 173 行读取 `attrs.TargetMode`、`attrs.Target`、`attrs.Type` 时，若 XML 使用了 `r:Target="https://..."` 或大小写变体 `targetMode="External"`，`attrs.Target` 为 `undefined`，从而绕过 `validateXml` 的第 173 行检查，直接进入 SheetJS 的 `read(...)`！
* **最小修复与测试建议**：
  * **修复**：在 `src/ingestion/xlsx.ts` 的 `walkXml`（第 144 行）中，禁止在任何元素上使用带冒号前缀的非 `xmlns:` 属性（或将 `attrs` 统一按归一化的小写无前缀 `alias` 暴露给 `validateXml`），并在第 172–178 行使用小写 `tag.toLowerCase()` 与归一化属性键检查 `Relationship`、`Override`、`Default`。
  * **测试**：在 `tests/xlsx/xlsx.test.ts` 中测试带 `r:TargetMode="External"` 或 `targetmode="External"` 的 `Relationship` 节点，断言抛出 `XLSX_EXTERNAL_LINK` 或 `XLSX_XML_UNSUPPORTED`。

---

#### [P2-3] `redact.ts` 的隐私脱敏预览可能泄露非美式格式的敏感数字或短令牌
* **位置**：`src/mapping/redact.ts` (`syntheticMappingPreview`, 第 4–15 行)
* **最小复现输入/步骤**：
  1. 调用 `syntheticMappingPreview(['Custom Col'], [['$9,876.54']], 'ST')`。
* **影响**：
  * 虽然代码将满足正则 `/^\(?-?\$?[\d,]+(?:\.\d{1,2})?\)?$/` 的金额替换为固定的 `'123.45'` / `'-123.45'` / `'(123.45)'`，将其他文本替换为 `'TEXT'`，因此 `sample_rows` 本身不会泄露原始值。
  * **但是**在第 7 行处理表头 `headers` 时：`sensitive.test(h) || h.length > 80 || Object.keys(mapHeaders([h], source).bindings).length === 0 ? 'COLUMN_...' : h`。因为 `mapHeaders([h], source)` 只接受白名单内的已知标准列名（`aliases`），任何不在 `aliases[source]` 中的自定义列名都会使 `bindings` 为空，从而被安全替换为 `COLUMN_n`。这一点设计是安全的。
  * 唯一的小缺陷在于第 13 行的金额正则 `/^\(?-?\$?[\d,]+(?:\.\d{1,2})?\)?$/` 会把類似 `"1,2"` 或 `"99999"`（5位数字，如邮政编码 `90210` 或 4位 PIN `1234`）识别为金额并输出 `'123.45'`，导致列类型提示失真（把邮编/卡号后四位当成金额列）。
* **最小修复与测试建议**：
  * **修复**：在 `src/mapping/redact.ts` 第 13 行复用与 `parseMoney` 一致的严格美式千分位/两位小数正则（或要求必须包含小数点 `.` 或 `$` 符号才归类为金额样例 `'123.45'`，纯整数归为 `'INTEGER_ID'` 或 `'TEXT'`）。
  * **测试**：在 `tests/import-export/privacy.test.ts` 中传入纯 4 位数字 `'1234'`，验证其不会被误标为金额 `'123.45'`。

---

### 二、 潜在风险与边界观察 (Plausible Risks)

1. **`src/engine/edges.ts` (`receiptOptions`, 第 20 行) 批次完整性检查仅检查 `record_type === 'PAYMENT'`**：
   * 第 20 行：`const incomplete = [...batches].some(b => ctx.st.some(r => r.record_type === 'PAYMENT' && r.accounting_batch_id === b && !cash.includes(r)))`。
   * 如果同一个 `accounting_batch_id` 中既包含正向 `PAYMENT` 又包含同批次导出的 `REFUND`（`record_type === 'REFUND'`），由于 `buildUnits`（`src/engine/units.ts` 第 14 行）只将 `r.record_type === 'PAYMENT' && r.accounting_batch_id` 归入 `batch:${r.accounting_batch_id}`，而把带 `accounting_batch_id` 的 `REFUND` 拆成了独立的 `payment:${r.id}` 单元！
   * 这会导致：若 QB 按整个批次（含退款净额）记了一笔 `CLEARING_RECEIPT`，正向收款单元和退款单元各自单独去匹配该 `accounting_batch_id` 时，因为 `incomplete` 没有检查同批次的 `REFUND`，且 `units.ts` 没有把同 `accounting_batch_id` 的 `REFUND` 聚入同一 `batch:` 单元，会导致批次金额不匹配（`ST_QB_VARIANCE` / `CONTRADICTED`）。
   * **建议**：在 `src/engine/units.ts` 第 14 行与 `src/engine/edges.ts` 第 20 行，将具有非空 `accounting_batch_id` 的 `REFUND` 与 `PAYMENT` 一并归入同一个 `batch:${r.accounting_batch_id}` 单元。

2. **`src/ingestion/csv.ts` (`parseMatrix`, 第 68 行) 汇总行排除正则可能误杀正常业务行**：
   * 第 68 行：`first = fields[0]?.trim() ?? ''`，若匹配 `/^(?:TOTAL\b|SUBTOTAL\b|TOTAL FOR\b|BEGINNING BALANCE\b|OPENING BALANCE\b|ENDING BALANCE\b)/i` 则直接作为报表汇总行排除。
   * 如果第一列恰好是 `Customer Name` 或 `Description`（例如客户名叫做 `"Total Comfort Heating & Air"` 或 `"Total Plumbing LLC"`，这在用 ServiceTitan 的暖通/水电承包商中非常常见！），该笔真实交易会被静默当成汇总行排除（仅记录在 `excluded_summary_rows` 中），导致源数据金额缺失且不报错（除非用户配置了 `accountBalances` 控制数）。
   * **建议**：仅当该行的日期列为空/非日期，或仅在非明细字段列匹配汇总标记时才自动排除；若该行拥有合法的 `payment_date` / `posted_date` 和 `source_payment_id`，遇到 `"Total ..."` 应保留或抛出显式警告。

---

### 三、 不成立的怀疑 / 已验证安全的设计 (Unsupported Suspicions)

在对抗性审查中，以下高风险领域经核查确认**当前实现已严密防御，不存在漏洞**：
* **合成样本（Synthetic）绝不伪造三方闭环或可导入分录**：`samples/` 主合成数据集缺少 QB 银行过账腿及费用科目覆盖，实测代码（`synthetic-evidence.test.ts` 第 131–139 行及 `diagnostics.ts` 第 45–51 行）严格将其限制在 `ACTIVITY_BRIDGE` 和 `aje_state: 'INELIGIBLE'`。
* **9% / 3% 费率启发式绝不触发费用确认或 AJE**：`diagnostics.ts` 第 52–55 行仅在无结算凭证时输出 `SUSPECTED`，`group.fees_cents` 保持为 `0`，绝不生成草案。
* **$10,000 / $9,100 / $900 教学案例防误导保护**：`createTeachingFeeCase()`（`src/export/aje.ts` 第 68–71 行）硬编码 `syntheticOnly: true`、导出文件名强制前缀 `SYNTHETIC_DO_NOT_IMPORT_`、分录摘要强制写入 `SYNTHETIC TEACHING ONLY - DO NOT IMPORT TO REAL BOOKS.`。
* **Undeposited Funds (UF) 保护**：`export_mode === 'PAYMENT_TO_UF'` 或 `isUndepositedFunds !== false` 在 `diagnostics.ts` 第 49 行和 `aje.ts` 第 31 行均被严格拦截，仅能通过 `buildUfWorksheet` 生成 `importEligible: false` 的手工操作底稿。
* **批准哈希失效机制（Approval Invalidation）**：`aje.ts` 第 50–62 行将 `feeCase`（含科目、日期、金额、证据引用、源文件哈希、映射与规则版本）、生成行和审核人全部纳入 `payloadHash`，任何单字节篡改均会使 `validateApprovedProposal` 抛错拒绝导出。
* **源预算守恒（Money Conservation）**：`conservation.ts` 严格校验每个源原子（Atom）的分配额不超过源金额且符号一致，E1 与 E3 共享同一 ST 收款时仅在 `allocations` 中消费一次。

---

### 四、 暂缓特性与有益的功能缺口观察 (Deferred Features & Useful Gaps)

1. **前端 UI 与 Worker 编排层尚未合入**：当前仓库包含完整的 `engine`、`ingestion`、`mapping`、`export` 和 Web Worker 客户端封装（`src/workers/*`），待 UI 状态机接入后需重点验证 UI 是否在源文件或映射变更时自动清空已保存的 `FeeProposal` 批准状态。
2. **一笔收款跨多张结算单的分拆适配器（Split Settlement Adapter）**：目前 `src/engine/evidence.ts` 第 55–56 行对同一 `payment_id` 出现多条 `SettlementEvidence` 采取了安全的 Fail-Closed 阻断（`UNSUPPORTED_SPLIT_SETTLEMENT`）。未来若支持分期放款（如按进度放款的融资业务），可在 `AllocationClaim.split_authorization_ref` 基础上扩展显式分拆证据。
3. **跨期释放扣留款（Hold Release）的正向入账桥接**：当前 `units.ts` 支持 `releases_cents` 字段，但 `ingestion/normalize.ts` 第 73 行解析 `PROCESSOR` CSV 时尚未映射 `released_cents` 列，且 `release_coverage_confirmed` 默认设为 `false`（需外部或高级配置确认）。在后续版本中可为处理器释放报表增加专门的列别名映射。