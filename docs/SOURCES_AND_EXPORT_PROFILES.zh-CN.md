# 研究证据与导出适配附录

**产品：** 3-Way Deposit & Clearing Reconciliation Desk  
**核验日期：** 2026-10-21  
**用途：** 为 PRD、字段映射器、会计规则与兼容性验收提供来源和实施边界。  
**适用范围：** 美国公司、USD、ServiceTitan、QuickBooks Online US / QuickBooks Desktop US，以及银行活动文件。其他国家版本、多币种、税务和收入确认不在自动调账范围。

## 0. 如何阅读本附录

来源编号在本文件中唯一。`S` 为 ServiceTitan，`Q` 为 QuickBooks，`B` 为银行，`F` 为融资机构，`C` 为竞品或目标客户。编号是文档引用键，不是外部系统 ID。所有 URL 均可点击。

### 0.1 本轮取得了什么证据

本轮核验了公开官方帮助文档、银行公开指南和有关产品的官网。研究采用多轮检索和正文阅读；检索请求的结果数量不等于去重后、完整读完、独立验证的来源数量，因此不把检索数量当研究质量指标。

**本轮没有登录 ServiceTitan、QBO、QBD 或银行的真实客户账户，也没有获得真实三方导出文件，没有执行目标版本的财务软件导入。** 文档来源可确认产品行为和部分字段；真实账户的报告配置、套餐、版本、字段、同步模式以及导入结果仍需按本附录验收。

用户给出的 G0 案例及需求是产品设计输入。**本轮未收到对应 Reddit 原帖 URL、完整上下文或原始三方文件，不能独立确认 $20k/$50k 案例的具体因果，也不能宣称已经复现该客户问题。** 开发包中的数据是明确标注的合成 fixture，不能作为外部客户成功案例使用。

### 0.2 四种证据等级

| 标记 | 含义 | 能做什么 |
|---|---|---|
| `DOCUMENTED` | 官方页面明确描述字段或行为 | 编写适配器与验收用例；仍检查账户配置 |
| `CONFIGURATION_DEPENDENT` | 官方功能存在，但依账户、支付通道、报告模板或版本 | 保存配置 profile；不默认套用 |
| `CANDIDATE_PROFILE` | 常见列名/布局候选，本轮没有真实客户文件验证 | 供映射建议与合成测试，不宣称认证兼容 |
| `UNVERIFIED` | 没有足够资料，或来源互有冲突 | 明示缺证据，保留待核实状态 |

### 0.3 对原始产品假设的修正

| 原始假设 | 本轮结论 | 工程后果 |
|---|---|---|
| ST 通常只向 QB 导出批次汇总 JE | 默认 Payment→Undeposited Funds、按支付类型 JE、JE Summary/Touchless 都存在；不能把某案例配置推广到所有客户 | 必填 `export_mode` 或先探测后确认；不能只实现一种 QB 凭证形态 |
| 所有 Batch Number 可以相互匹配 | Processor batch 与 ST accounting/export batch 明确不同 | `accounting_batch_id`、`processor_batch_id`、`deposit_id` 分开，保留 ID namespace |
| 刷卡固定 T+2 至 T+5 | 官方文档存在卡 1–2、ACH 3–5 营业日等说明，且有 cutoff/周末/假期差异 | 时间窗是 processor profile 参数，不是硬编码金融事实 |
| 退款总要手动 unpost/塞批 | 存在 Automated Refunds；manual/legacy 路径仍可能遗漏 | 按实际记录状态诊断，不按“退款”词直接命中 |
| 导出后改动必然永久不同步 | 原 invoice 通常锁定，正确更正是 adjustment；某些 exported payment 可在权限下 unapply | 需要导出快照、调整/审计事件与对端缺失证据 |
| GreenSky 一般净扣固定费率 | 官方 Merchant FAQ 描述逐月费用账单；客户合同可能不同 | `fee_mode=netted\|separate_invoice\|unknown`；品牌不能决定扣费方式 |
| 手续费/贴息入负债或费用都可以 | 费用、应付费用和待收回 reserve 是不同经济性质 | 不能通过凑平余额选择科目；必须根据既有分录与凭证 |
| 三个文件就能确诊所有六原因 | 多种原因在三份摘要上可有相同表现 | 支持补充凭证；保留 suspected/insufficient_evidence |
| HVAC Bridge 只做导出前核查 | 官网还有 post-export verification | 差异定位集中在银行、clearing、文件输入及证据交付 |
| 三家银行有标准 CSV 列结构 | **没有经本轮验证、覆盖各自所有商业账户和渠道的统一官方 schema** | 明确 sample profiles，逐文件识别 header、符号、粒度与账户 |

## 1. ServiceTitan：已证实的字段与报告语义

### 1.1 官方明确列出的列

以下列是报告文档明确列出的字段，不表示用户的自定义报告一定全部存在。用户文件缺列时必须降级或阻断相关诊断，不能由 LLM 补造。

| 报告 / 来源 | 官方列名 | 粒度和解析规则 |
|---|---|---|
| All Payments `[S01]` | `Payment Type`; `Payment Method`; `Payment Amount`; `Amount Allocated`; `Credit Remaining`; `Batch Number`; `Payment Status`; `Transaction Status`; `Payment Date`; `Customer Name` | 收款报告；Payment Amount 与发票分配额不同；Payment Status 与支付处理状态不同 |
| Pending Export—Payments `[S02]` | `Batch`; `Export ID`; `Paid On`; `ID`; `Customer`; `Memo`; `Method`; `Amount`; `All` | 只列 posted 且尚未成功 export 的交易；不能当完整月度收款源 |
| Pending Export—Invoices `[S02]` | `Batch`; `Export ID`; `Invoiced On`; `ID`; `Customer`; `Location`; `Subtotal`; `Disc./Fees`; `Tax`; `Total`; `All` | invoice 粒度；不允许将 Total 当 payment gross |
| Invoices template `[S03]` | `Invoice #`; `Job #`; `Job Type`; `Invoice Status`; `Total`; `Balance`; `Invoice Date`; `Customer Name`; `Location Address` | 默认字段；可添加其他字段；过滤日期口径可变 |
| Accounting Detail / Cash Receipts `[S04]` | `Payment Account`; `Qty`; `Debits`; `Credits`; `Date` | 汇总粒度；不能从金额汇总恢复 payment IDs |
| TSYS/Elavon Settlement `[S05]` | `Batch Date`; `Batch Number`; `Net Deposit`; `Number of Debits`; `Amount of Debits`; `Number of Credits`; `Amount of Credits`; `Deposit Amount`; `Deposit Date`; `Hold Amount` | settlement batch 粒度；可加 Merchant ID；Net Deposit 不计 hold |
| TSYS 下钻 `[S05]` | `Transaction Date`; `Transaction Code`; `Amount`; `Authorization Code`; `Transaction Reference`; `Auth Amount`; `Voided`; `Invoice`; `Payment Batch Number`; `Customer`; `Technician Name` | 连接 processor transaction、invoice 和 ST payment batch |
| QBD Transactions Reconciliation `[S07]` | `Id (ST)`; `Number (ST)`; `Transaction Date (ST)`; `Business Unit (ST)`; `Batch Name (ST)`; `Name (ST)`; `Total (ST)`; `Job Number (ST)`; `Project Number (ST)`; `Transaction Type (ST)`; `Export Status (ST)`; `Reference Number`; `Transaction Date`; `Class`; `Name`; `Total`; `Reconciliation Status`; `Message` | ST↔QBD 双边比对，只显示 batched transactions；不等于三方现金闭环 |

**必须处理的特殊语义：**

- `[S02]` 的 `Export ID` 按该报告说明用于展示导出错误；不能直接认作 QB transaction ID。
- `[S05/S06]` 的 `Batch Number` 是处理商分配的批次；`Payment Batch Number` 才用于关联 ST 会计批次。
- `[S05]` 的 `Net Deposit` 不考虑 hold；`Deposit Amount` 代表实际存款量。没有 hold/fee 明细时不能把差额全视为费用。
- `[S01/S03]` 发票总额、收款总额、发票分配额是三种量。若文件按 invoice allocation 拆行，重复出现的 Payment Amount 只能计一次。
- `[S03]` 可以按 Invoice Date、Completion Date、Creation Date、Start Date、Last Paid On Date 等不同口径过滤。上传必须记录 `filter_basis`。
- `[S07]` QBD Memo 可包含 ST batch ID/name；只能按已验证格式提取，不按任意数字猜 ID。

### 1.2 常见候选别名：没有统一必备保证

| Canonical 意图 | 允许向用户建议的别名 | 限制 |
|---|---|---|
| payment identifier | `Payment ID`, `Payment #`, `ID`, `Transaction ID` | `ID` 必须根据 report type 确认；可能是 invoice ID |
| accounting batch | `Batch`, `Batch Number`, `Batch #`, `Batch Name` | 先确认 namespace；名称不是必然唯一 ID |
| accounting timing | `Batch Post Date`, `Post Date`, `Exported On`, `Batch Close Date` | 不假设这些列一定存在；close/post/export 三种事件不能互换 |
| invoice link | `Invoice #`, `Invoice Number`, `Invoice`, `ID` | 一笔 payment 可关联多张 invoice；不能把 invoice 当 payment 主键 |
| collected gross | `Payment Amount`, `Amount`, `Gross Amount` | 必须确认是收款，不是 invoice total、授权金额或汇总计数 |
| paid net | `Deposit Amount`, `Net Amount`, `Net Deposit` | 名称不足以证明是否含 hold/fee/refund；按来源配置语义 |
| account mapping | `GL Account Code`, `GL Account`, `Account`, `Payment Account` | 同一列可能包含付款类型+科目，不应自动猜 COA |
| organization | `Business Unit`, `BU`, `Class` | BU 不总等于法律实体；不可跨实体聚合 |
| exported state | `Export Status`, `Payment Status`, `Invoice Status`, `Sync Status` | 需区分 payment/invoice、bypassed 和 per-record export error |

### 1.3 来源登记：ST

| 编号 | 官方来源 | 已证实结论与适用边界 |
|---|---|---|
| S01 | [All Payments report](https://help.servicetitan.com/docs/all-payments-report) | 文档列出默认付款字段；区分付款金额、已分配额、未分配余额和处理状态。配置与权限会影响可见性。 |
| S02 | [Pending Export Report Guide](https://help.servicetitan.com/docs/pending-export-report-guide) | 支持 CSV/XLSX；posted 但未成功 exported 的 invoice/payment 才进入；成功后不再出现。该表不保证全月完整。 |
| S03 | [Invoices report template](https://help.servicetitan.com/docs/invoices-report-template) | 提供发票号、金额、余额和日期等默认列；允许定制列及不同日期筛选。发票报告不能替代收款报告。 |
| S04 | [Accounting Detail Legacy Report](https://help.servicetitan.com/docs/accounting-detail-report) | 现金收款、收入和 AR 的 section 具有不同粒度和借贷语义；可导 CSV/XLSX。未证实存在包罗全部所需列的统一 Accounting Batch Report。 |
| S05 | [TSYS/Elavon Settlement report](https://help.servicetitan.com/docs/tsys-settlement) | 有实际存款、hold 和下钻关系；筛选按 processor batch date；不覆盖支票/ACH。文档一处 debit/credit 示例与 FAQ 冲突，解析须用交易代码和控制总额确认。 |
| S06 | [Match TSYS Payment Batches to QuickBooks Online Deposits](https://help.servicetitan.com/docs/match-tsys-payment-batches-to-quickbooks-online-deposits) | 明确 processor batch 不等于 export batch；可下钻原 payment/refund、invoice 和 ST Payment Batch Number，作为跨系统关系证据。 |
| S07 | [Transactions Reconciliation Report—QBD](https://help.servicetitan.com/v1/docs/transactions-reconciliation-report-qbd) | 原生双边报告已有 Match、Variance、Missing、Exception 分类；QBD Memo 可含 batch ID/name。仅 batched 数据不是完整银行对账。 |
| S08 | [Overview of the payments process](https://help.servicetitan.com/docs/overview-of-the-payments-process) | 默认付款记借 UF、贷 AR，再通过 deposit 记借银行、贷 UF。手动 bypass 不等于 QB 已入账。会计批次可能晚于银行清算，日期窗不能压过明确凭证。 |
| S09 | [Set up payment types](https://help.servicetitan.com/docs/set-up-payment-types-in-servicetitan) | Payment 与 Journal Entry 是可配置路径；融资费示例借费用、贷 AR。必须检查费用是否已经在 ST 正确记录及导出。 |
| S10 | [Configure journal entries](https://help.servicetitan.com/v1/docs/configure-journal-entries) | 可按 cadence、payment type、BU 配置 JE Summary 等路径；改配置仅影响以后。Touchless 与传统 payment-type JE 不是同一兼容功能。 |
| S11 | [Financing fees/buydown workflow](https://help.servicetitan.com/docs/finance-feesbuydown-recommended-workflow) | 专用流程分开 finance fee expense 与 other-current-liability clearing，将客户应收转到融资公司；QBO credits 需应用到 invoice。禁止把该流程的负债 clearing 泛化到所有清算账户。 |
| S12 | [Manage Adyen Autobatching fees](https://help.servicetitan.com/docs/manage-adyen-autobatching-fees) | Adyen 有 daily-net fees；QB 非 JE 模式在原 payment deposit 中添加费用行。文中 QBD 限制针对这套 JE integration，不等于所有 QBD payment-type JE 都不支持。 |
| S13 | [Create a refund adjustment invoice and issue a refund](https://help.servicetitan.com/docs/create-a-refund-adjustment-invoice-and-issue-a-refund) | 手动退款需要匹配的负服务/负付款并导出；Automated Refunds 启用后可自动创建相关记录，不能一律称需要 unpost。 |
| S14 | [Create an adjustment invoice](https://help.servicetitan.com/docs/create-an-adjustment-invoice) | 已导出的原 invoice 通常不能直接改删，通过 adjustment 更正；原 Total 可保持不变，因此比对必须覆盖调整记录。 |
| S15 | [Reconcile Payments & Deposits](https://help.servicetitan.com/docs/reconcile-payments-deposits-1) | 教程提供卡和 ACH 的不同结算时效；提醒检查逐条 sync errors，批次 Exported 不保证每条完整同步。仅凭未达无法断言 hold。 |
| S16 | [Set up automated refund workflow](https://help.servicetitan.com/docs/set-up-automated-refund-workflow) | 账户配置与权限决定是否启用；按原因、方式生成相应会计记录，支持已应用及未应用付款退款。 |
| S17 | [Refunds FAQ](https://help.servicetitan.com/docs/refunds-faq) | Exported payment 在特定权限下可 unapply，用户需使会计软件同步；unbatched refund 可在 QB 手工记并 bypass，或在 ST batch/export。 |
| S18 | [Batch, post, and export transactions](https://help.servicetitan.com/docs/batch-post-and-export-transactions) | 区分 batched、posted、exported；页面部分措辞对 unpost 限制不完全一致，实施以账户模式、状态及支持确认优先，产品不自动修改源系统。 |
| S19 | [Touchless Integration overview](https://help.servicetitan.com/docs/touchless-integration-overview) | 新模式把多种交易的财务分录同步到会计系统，不能用旧 manual-batch 假设解释全部客户；厂商时效声明不是本产品 SLA。 |
| S20 | [Export journal entries to QuickBooks Desktop](https://help.servicetitan.com/docs/export-journal-entries-to-quickbooks-desktop) | 支付类型可配置为 JE，常用于退款、融资费或坏账；该事实与 Adyen integration 的 QBD 限制需要区分语境。 |

## 2. QuickBooks：报告结构与导入规范

### 2.1 官方明确字段与能力

| 来源 / 场景 | 已证实字段或能力 | 工程限制 |
|---|---|---|
| QBO General Ledger `[Q01]` | 可添加 `Debit`, `Credit`, `Cleared` 并按 Account 过滤 | 新旧报告界面有差别；优先完整借贷行；单一 Amount 列须确认账户方向 |
| QBO export `[Q02]` | 报告可 Export to Excel | 不能承诺每份报告原生提供 CSV；接收 XLSX 及另存 CSV |
| QBD cash receipts journal `[Q03]` | `Type`, `Date`, `Num`, `Memo`, `Clr`, `Split`, `Amount` | `Split` 为多对方科目标记时不是 transaction ID，也不是金额 |
| QBD source/targets `[Q04/Q05]` | source 可是汇总，targets 是明细；Transaction Journal 展示凭证关系 | 不能把 parent total 与 child lines 双算；来源之一为加版说明，US 仍需目标版本验证 |
| QBD Deposit Detail `[Q06]` | 展示关联交易；与 Check Detail 字段不同，Deposit Detail 没有 Paid Amount | 这是关系证据，不是可不加区分汇总的 GL |
| QBO JE CSV `[Q07]` | `Journal No.`, `Journal Date`, `Account Name`, `Journal/Description`, `Debits`, `Credits` | 需检查客户账号确有 Import Data > Journal Entries，并使用目标账号下载的 sample 验证 |
| QBD IIF `[Q10/Q11]` | ASCII 制表符文本；交易区有 `!TRNS`, `!SPL`, `!ENDTRNS` | **IIF 不是 CSV**；导入不自动链接原 payments/deposits |

### 2.2 候选报告别名：必须由实际文件验证

| Canonical 字段 | 候选别名 | 不可省略的校验 |
|---|---|---|
| posted_date | `Date`, `Transaction date`, `Transaction Date` | 账套 locale、会计日期口径、非过账单据剔除 |
| transaction_type | `Transaction Type`, `Type` | JE/Deposit/Payment 与 Invoice/Estimate/PO 分开 |
| reference | `Num`, `No.`, `Reference Number`, `Journal No.` | 不是全局唯一；同号多行可能是一张凭证 |
| party | `Name`, `Customer`, `Vendor` | 原文保留在本地；脱敏不改变链接关系 |
| description | `Memo/Description`, `Memo`, `Description` | ID 提取必须有模板；不执行表内指令 |
| account | `Account`, `Account Name`, `Account full name` | 完整 Parent:Subaccount 路径；不按相似度自动创建科目 |
| counter_account | `Split`, `Item split account` | `-SPLIT-`/`SPLIT` 只是占位，不是实际科目 |
| debit / credit | `Debit`, `Debits`, `Credit`, `Credits` | 每行至多一个正边；零/空值解释一致 |
| signed_amount | `Amount`, `Total` | Amount 可能是交易总额而非目标账户 posting；不能替代完整借贷 |
| clearing_status | `Clr`, `Cleared`, `Reconciled Status` | 不同导出编码含义先确认；银行 feed “For review”不代表 GL 已过账 |
| running_balance | `Balance`, `Running Balance` | 期初/期末/合计行仅做控制，不作为交易 |

### 2.3 QBO JE 出口契约

目标账号确认支持后，可使用下列映射字段生成候选文件：

```csv
Journal No.,Journal Date,Account Name,Journal/Description,Debits,Credits
RD2609001,09/30/2026,Merchant Financing Fees,Approved fee for batch B042,900.00,
RD2609001,09/30/2026,ServiceTitan Clearing,Approved fee for batch B042,,900.00
```

约束：

- 同一 journal 的各行使用同号同日期；正数 debit/credit，一行单边，二位小数，每张借贷相等。
- 科目必须来自已确认 COA，子科目使用完整路径。不能让 LLM 以“常识”生成会计科目名。
- `Name`、Class、Location 等只有目标账户要求且模板验证后追加。v1 自动出口排除 A/R、A/P、税费及工资科目，避免未实现的对象关联。
- 已有 journal number、既有 fee posting、相同 evidence 的重复 proposal 都必须检查。不得建议关闭重复保护以强行导入。
- 工程分片可取最多 900 数据行且不拆 journal；这只是保守产品限制，不宣称是 JE 专属官方上限。
- 下载后状态为 `exported_proposal`；只有再次读取目标 GL 并核对结果后才成为 `posted_verified`。
- 预览 CSV 可以转义公式前缀；正式 import CSV 对危险科目名/ID 阻断并要求映射，不能随意加引号前缀改变实际科目名。

### 2.4 QBD IIF 出口契约

用真实 TAB 分隔；以下可视示例中的 `\t` 在生成文件中必须变为制表符：

```text
!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO
!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO
!ENDTRNS
TRNS\tGENERAL JOURNAL\t09/30/2026\tMerchant Financing Fees\t\t\t900.00\tRD2609001\tApproved batch fee
SPL\tGENERAL JOURNAL\t09/30/2026\tServiceTitan Clearing\t\t\t-900.00\tRD2609001\tApproved batch fee
ENDTRNS
```

这是工程候选模板，**不是已通过真实 QBD 导入的认证样例**。只有完成客户相同 US Windows 版本、公司备份副本的 dry run 后，才开放对应 profile 的可导入标记。

- 不存在的 `ACCNT` 可能产生意外新 Bank account，因此必须 COA 白名单预检。
- 仅允许已测字符集、短稳定 DOCNUM、既有科目；拒绝 TAB/换行注入。
- 采用新版有校验的导入路径；不要跳过错误检查。
- QBD 可部分成功。重试只包含失败凭证，不能整包重导。
- IIF 不自动建立 payment/invoice/deposit links。UF 分支因此默认输出操作底稿，不声称余额 JE 能消除全部未存款对象。
- QBD 的任意 journal CSV 没有本轮证实的通用直接 GL 导入契约。CSV 是审阅底稿；若接第三方导入器，必须建立独立、明确命名的 adapter。

### 2.5 来源登记：QB

| 编号 | 官方来源 | 已证实结论与适用边界 |
|---|---|---|
| Q01 | [Create a report that shows debits and credits](https://quickbooks.intuit.com/learn-support/en-us/help-article/profit-loss-reports/create-report-shows-debits-credits-transaction/L1zvqNX0e_US_en_US) | QBO General Ledger 可显示借贷和 cleared 信息；据实际报表界面定制，不声称固定 CSV 字段顺序。 |
| Q02 | [Export reports to Excel](https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/export-reports-excel-quickbooks-online/L7iAoP97n_US_en_US) | 官方支持 Excel 导出；应用同时接收 XLSX 和用户另存 CSV。 |
| Q03 | [Create a cash receipts journal report](https://quickbooks.intuit.com/learn-support/en-us/help-article/customize-reports/create-cash-receipts-journal-report/L7RBPOBI3_US_en_US) | 给出 QBD Type、Date、Num、Memo、Clr、Split、Amount 等字段；适用于指定报告配置，不代表所有 QB 报告统一 schema。 |
| Q04 | [Understand reports—source and targets](https://quickbooks.intuit.com/learn-support/en-ca/help-article/business-reports/understand-reports/L6mJBjn2h_CA_en_CA) | 解释 source/target 的汇总与明细结构；页面为加拿大版本，可作设计参考，不能替代 US 目标版测试。 |
| Q05 | [Transaction Journal report in QBD](https://quickbooks.intuit.com/learn-support/en-us/help-article/transaction-reports/view-transaction-journal-report-quickbooks-desktop/L944aaidk_US_en_US) | Transaction Journal 以 accrual 展示账户关系，也可能显示非过账单据的信息；不能见借贷列就断言 GL 已过账。 |
| Q06 | [Check and Deposit Detail reports](https://quickbooks.intuit.com/learn-support/en-us/help-article/accounts-receivable-reports/use-check-deposit-detail-reports-show-transaction/L0Lbizj8s_US_en_US) | 两类 detail reports 展示关联但字段不同；应作为链路证据解析，避免父子行重复求和。 |
| Q07 | [Import journal entries into QuickBooks Online](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US) | 当前 US 帮助文档支持 JE CSV，列出映射字段与导入步骤；未给完整套餐资格矩阵，需目标账号检查，不能写成所有套餐保证支持。 |
| Q08 | [Match online bank transactions](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/match-online-bank-transactions-quickbooks-online/L6qyw0PvP_US_en_US) | Bank feed 下载待审核不等于 books 入账；Categorize 与 Match 的会计作用不同，不能凭 feed 存在就再做或不做银行分录。 |
| Q09 | [Common questions about importing data](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/common-questions-importing-data-quickbooks-online/L4OYJRFdj_US_en_US) | 通用导入指引可帮助设置保守文件分片；不应将通用限制误写为 JE 专属已验证硬上限。 |
| Q10 | [IIF overview, import kit, sample files and headers](https://quickbooks.intuit.com/learn-support/en-us/help-article/list-management/iif-overview-import-kit-sample-files-headers/L5CZIpJne_US_en_US) | IIF 的文本结构、交易 headers 和样例工具来源；本轮未下载并实机验证其 journal sample，编码和版本限制仍需验证。 |
| Q11 | [Export, import and edit IIF files](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/export-import-edit-iif-files/L56LT9Z0Q_US_en_US) | IIF 导入前需备份，不自动建立交易链接，跨国家版本有兼容边界；不把 IIF 能入账等同业务对象已清理。 |
| Q12 | [Improved IIF import in QuickBooks 2019 and later](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/improved-iif-import-quickbooks-2019-later/L1K3ZQDX9_US_en_US) | 有数据校验及失败文件机制；可部分成功，重导需按结果记录去重，而非重复导入整包。 |
| Q13 | [Import and export data in QBD](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-export-data-quickbooks-desktop/L9KS42UxP_US_en_US) | 通用 CSV/Excel/IIF 能力不等于任意 journal CSV 可直入 GL；本产品 desktop 导入适配以实测 IIF 为准。 |

## 3. 融资、费用和 AJE：避免“金额相等但账务错误”

### 3.1 费用模式不能由品牌推断

| 编号 | 官方来源 | 本轮结论 |
|---|---|---|
| F01 | [GreenSky Merchant FAQ](https://www.greensky.com/merchant-faq/) | 官方 FAQ 描述按交易收费、前月费用逐月开票，并给出授权后的放款时效。因此不能写成所有 GreenSky 交易都在 payout 净扣 9%；具体合同与结算单优先。 |
| F02 | [GreenSky Solar Merchant Training](https://www.greensky.com/docs/core/training/gscp_solar_merchant_training.pdf) | 特定培训将融资成本作为商户经营成本，反对向融资客户单独加收。它不是所有产品、合同、GAAP 分类的完整规则，不能替代会计政策判断。 |

### 3.2 $10,000→$9,100 示例的必要前提

仅当费用凭证确认 $900 已净扣，且现有收款为 `Dr ST Clearing 10,000 / Cr A/R 10,000` 时，以下模板才成立。示例不决定收入确认、不改变税务，不自动处理客户定金负债。

| QB 已有状态 | 应有动作 | 禁止动作 |
|---|---|---|
| 银行到账尚未记入 GL | 借 Bank 9,100；借 Financing Fee Expense 900；贷普通 ST Clearing 10,000 | 若只有 bank feed 待审核，不能把它当已经入账 |
| 已借 Bank 9,100、贷 Clearing 9,100 | 只借 Fee Expense 900、贷 Clearing 900 | 再借 Bank 9,100，造成重复现金 |
| 已正确拆费并贷 Clearing 10,000 | 不生成 AJE | 同一费用再记一次 |
| 入账错记 Revenue，且 ST 已确认收入 | 生成需要人工批准的重分类底稿，附原凭证 | 把改收入分类当默认通用模板 |
| 费用另行开票/扣款 | settlement 与 fee invoice/payment 分别核对 | 净额匹配里再扣一次费用 |
| $900 是可收回 hold/reserve | 保留应收/限制资金等需会计确认的分类 | 自动费用化、write-off 或强行清零 |
| 目标为 Undeposited Funds，原 Payment 对象仍待 deposit | 默认给出 Bank Deposit 选原 Payment + fee 负数行的操作底稿 `[S12]` | 声称 JE 清总账就等于 deposit 对象已全部关闭 |

余额检查必须保留：`ending = opening + debits − credits`。缺期初余额或范围不全，只能称“所上传活动范围对账”，不能称整月 clearing 已结清。三个系统的总额相等也可能隐藏相互抵消的错账，必须保存逐组和逐边 residual。

## 4. 三家银行：候选布局及官方证据范围

> **不存在本轮已确认的三家银行统一“标准 CSV”。以下候选布局不能当银行官方认证文件契约。Chase Connect 与普通商业网银、BoA Small Business 与 CashPro、Wells Fargo 各账户/下载渠道可能不同。真实 sample 验证是上线 gate。**

### 4.1 官方已确认的能力

| 编号 | 官方来源 | 确认可用范围 |
|---|---|---|
| B01 | [J.P. Morgan Connect Account Activity guide](https://www.jpmorgan.com/content/dam/jpmorgan/documents/cb/connect/cc_quickguide_account_activity.pdf) | 2026 年版指南说明活动可按日期、金额、类型等查询并导 CSV/PDF/Excel；未给覆盖全部商业账户的固定 CSV 列序。 |
| B02 | [Chase Commercial Online Account Activity guide](https://www.chase.com/content/dam/chaseonline/en/legacy/content/secure/sso/document/cco_account_activity_quick_reference-lores.pdf) | 支持 CSV；搜索若筛选支票，导出才包含 check number 的说明，证明列可能随查询改变；文档属于旧渠道。 |
| B03 | [BoA Small Business Transaction Reporting FAQ](https://www.bankofamerica.com/smallbusiness/online-banking/faqs/transaction-reporting/) | 可查已过账支票、deposit slips 等；processing transaction 与已入账不同。本页未提供统一 CSV schema。 |
| B04 | [Wells Fargo Business Account Activity](https://www.wellsfargo.com/biz/online-banking/deposit-details/) | 可按交易类型、日期、金额查询；支持下载至 spreadsheet/财务软件；通常默认 90 天，更长范围依账户可用性。 |
| B05 | [Wells Fargo Account Activity FAQ](https://www.wellsfargo.com/help/online-banking/activity-faqs/) | 明确 Comma Delimited ASCII/Spreadsheet 下载路径；没有在公开说明中确认所有账户固定五列或是否始终无 header。 |

### 4.2 候选适配器，必须由样本验收

| Profile 名称 | 候选列 / 结构 | 必须检查 |
|---|---|---|
| `chase_checking_candidate_v1` | `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #` | 金额符号；余额是否存在；Type 是银行代码或自然语言；check/slip 列可缺；不要混入 ACH payment upload 格式 |
| `boa_checking_candidate_v1` | `Date,Description,Amount,Running Bal.` | metadata/summary 前导行；日期格式；末行合计；与 CashPro 另设 profile |
| `wells_headerless_candidate_v1` | 五个位置：日期、signed amount、占位、占位、描述 | 第一行可能是真交易；不得丢弃；不假定有 Type、Balance、check number 或 FITID |
| `generic_bank_signed_amount_v1` | 日期 + 描述 + signed amount | 正负方向需确认；银行入账与出账都保留，退款/收费可能为负数 |
| `generic_bank_debit_credit_v1` | 日期 + 描述 + debit + credit | 单行双边同时非零阻断；账户类型与符号映射明确后才能归一 |

合成 `chase_bank.csv` 只能称 **Chase-style fixture**。它不会证明 Chase 真实文件可以零配置导入，也不证明商户描述一定包含 payout/batch reference。

银行 CSV 的日期、描述和金额未必形成唯一键。同一天同额同描述可能是两笔真实交易。缺 transaction ID 时，基于文件哈希和原始行号检测“重传同一行”；跨文件重复只能提出候选并通过覆盖范围、邻接行和余额信息确认，不能盲删。

### 4.3 $50k 混合存款的物理真实性

对一条银行 ACH GreenSky 入账，不能凭时间接近就把办公室纸质支票混进其 subset。可接受的证明路径是：

1. 有 deposit slip，证明融资机构的**纸质净额支票**与其他办公室支票组成同一实物存款；或
2. 银行文件明确是 day-summary，补充交易级文件证明多个银行交易属于该汇总；或
3. 将多条独立银行交易显示为一个 reconciliation group，仍保留每条真实银行行。

如果三条都不成立，只能展示候选/残差。`same bank account + same date + sums equal` 不足以证明跨通道组合真实。

## 5. 竞品与目标客户：可说与不可说

| 编号 | 来源 | 核验结果 | 对外表述边界 |
|---|---|---|---|
| C01 | [HVAC Bridge / ServiceTitan](https://www.hvac-bridge.com/integrations/servicetitan) | Solo $49/月、Team $99/月；ST early access、逐户 onboarding；invoice review、QBO export、post-export verification | 可以说公开产品重心是发票工作流；不能说只做导出前，不能把未列出银行/QBD写成绝对不支持 |
| C02 | [HVAC Bridge homepage](https://www.hvac-bridge.com/) | 有 bookkeeper workflow、每客户独立 connections/rules/history、合作伙伴折扣及扩展计划 | 多账套不是独占差异；成熟功能与页面规划分开，不把其全部路线图当已实测 |
| C03 | [Books and Trucks](https://booksandtrucks.com/) · [Pricing](https://booksandtrucks.com/pricing) · [About](https://booksandtrucks.com/about) | 服务美国 trade shops；官网 QBO 起价 $599/月，ST方案起价 $995/月并含每月 ST↔QB reconciliation | 是符合画像的潜在 design partner，尚无本产品购买、合作或背书证据；官网展示的匹配效果是其自报 |
| C04 | [8 Figure Finance](https://8figurefinance.com/) | CPA/accounting/bookkeeping/CFO 服务定位已证实 | 本轮主页证据不足以确认其专门使用 ST 或专注 HVAC；触达前应进一步资格验证 |

价格和功能为 2026-10-21 的公开页面观察，后续对外发布前应复核。产品的 $199/$79/$199 价格是待实验的商业假设，不是通过市场调研证明的最优定价。

## 6. 入库文件质量、粒度与证据检查清单

以下是可直接转成 importer validator 和验收测试的契约。`BLOCK` 为不能进入自动匹配；`DEGRADE` 为可做活动对账但关闭某些结论/导入；`WARN` 为保留上下文待审。

### 6.1 公司、账户、会计期间

| 检查 | 通过条件 | 失败动作 |
|---|---|---|
| 公司身份 | 三方文件属于已确认同一法律实体/账套；BU不代替entity | BLOCK，避免跨客户金额碰撞 |
| 币种 | 金额同为USD；未夹杂FX/多币种 | BLOCK未实现币种；不能按同面额匹配 |
| 银行账户 | 每份文件对应单一已确认账户，或每行可可靠分账户 | BLOCK跨账户聚合 |
| 日期范围 | 输入范围、month-end、as-of date、后续观察窗明确 | DEGRADE，禁止把边界缺数据判为资金丢失 |
| 会计基础 | QB accrual/cash以及ST filter_basis留证 | DEGRADE，不混用不同口径总额 |
| Clearing类型 | 普通clearing/UF/专用liability workflow明确且COA映射确认 | BLOCK自动AJE，仍可出差异底稿 |
| 期初期末 | 对目标账户有opening/closing control；缺少则明确活动范围 | DEGRADE，不宣称整月余额已结清 |
| 已关账期间 | 日期不越过lock，或有会计批准的调整期 | BLOCK该日期出口，不自动回填旧期 |

### 6.2 文件与行

| 检查 | 通过条件 | 失败动作 |
|---|---|---|
| 格式/容量 | 允许CSV/XLSX；扩展名与内容一致；大小/行数/解压体积在限额内 | BLOCK；拒绝macro/zip bomb/伪装类型 |
| 编码/分隔符 | 明确UTF-8/受支持encoding、quote/delimiter正确 | BLOCK异常行，不默默截断或替换字符 |
| 表头探测 | 前导title/meta可跳过，headerless第一行保留 | BLOCK不确定header；交互确认 |
| 多sheet | 每个sheet说明数据类型/粒度；不默认合并全部sheet | WARN并选择；避免summary+detail双算 |
| 日期解析 | 明确US月日或ISO；Excel日期系统一致 | BLOCK歧义；不要让LLM猜03/04 |
| 金额解析 | decimal字符串→整数分；括号/千分位/负号可逆 | BLOCK无法解析值；不用float累加 |
| 非交易行 | 标题、subtotal、grand total、opening balance分类留存 | 不纳入交易求和；用于control totals |
| source lineage | `file_sha256+sheet+row_number`稳定，原始行与归一结果均可追溯 | BLOCK失去来源的自动决定 |
| 重复导入 | 同文件/同原行幂等；跨文件重复保留候选证据 | 不按相同金额日期盲删真实交易 |
| 公式/注入 | 读取值不执行公式；显示字符串转义；正式import字段白名单 | BLOCK可执行/恶意字段；不把表内指令发成模型任务 |
| 控制总额 | 解析后的笔数/分金额与报告footer或用户确认一致 | BLOCK大差异，显示缺行与误算原因 |

### 6.3 粒度与链接

| 检查 | 通过条件 | 失败动作 |
|---|---|---|
| ST payment vs allocation | payment主键可去重，allocation仅作为关系/已应用金额 | BLOCK以invoice total替代payment的现金匹配 |
| batch层级 | processor/accounting/deposit IDs各自命名空间明确 | BLOCK不同命名空间直接join |
| QB posting行 | 明确目标账户的真实借贷；summary/targets分层 | DEGRADE只有transaction summary，关闭fee已入账结论 |
| Bank Feed与GL | 入账状态从GL/transaction detail取证 | feed待审不得作为已记Bank凭证 |
| 退款/chargeback | 有符号与事件类型，保留已退和已入账两种状态 | 未确认前不按净差命中退款原因 |
| fee包含关系 | netted/separate invoice、gross/fee/hold关系明确 | rate命中只作候选，关闭自动费用AJE |
| 可消耗性 | 每个真实payment/ledger allocation/bank amount只能消耗其可用余额一次 | BLOCK双重匹配/超额分配 |
| 多解 | 有同额竞争组合时展示替代证据 | `multiple_candidates`，不能依顺序贪婪确认 |
| 跨通道混合 | 同一deposit凭证或明确bank汇总关系支持 | 无证据不混融资ACH、刷卡和纸质支票 |

## 7. 六原因的最低证据门槛

| 原因 | 可以确诊的证据 | 仅凭三文件常见可输出状态 | 禁止推断 |
|---|---|---|---|
| 结算跨期 | 可信payout/reference对应后续bank结算，或处理商明确待结算记录 | `expected_in_transit` / `date_window_candidate` | 月末缺bank就称丢失或hold |
| 净扣手续费/贴息 | 费用/放款凭证+精确金额关系+QB未重复记费 | `fee_candidate` | 费率落在1.5–3.8%/5–15%就视为已证实 |
| 未入批退款 | 成功退款/负payment记录+batch/export遗漏+覆盖范围完整 | `refund_evidence_needed` | 任意短款都叫退款 |
| 导出后调整未同步 | export快照或时间+后续adjustment/audit事件+对端缺对应更正 | `post_export_variance` | 金额不同就称ST软件bug |
| 系统外收款 | 银行/办公室收据或deposit slip+完整ST搜索+经授权人员核实 | `unattributed_bank_credit` | ST没匹配就自动记收入 |
| Processor hold | 对应payout的Hold Amount、保留金statement或processor通知 | `overdue_unexplained` | 超过5天自动确诊冻结 |

六类规则不是现实的全部异常。必须额外容纳 `unknown`、`incomplete_coverage`、`duplicate_import`、`multiple_candidates`、`export_error`、`chargeback`、`bank_return`、`interaccount_transfer`、`loan_or_owner_funding` 等。证据不足时，正确输出是下一条要补的证据和负责人。

## 8. 上线前必须取得的真实样本证据

1. 至少一份去标识化 ST Payments/批次导出，确认 payment 粒度与实际 header；如混用 processor settlement，另保存其 profile。
2. 同一账套、同一期间的 QB clearing GL，含目标账户完整借贷、期初期末和报告过滤信息；UF 模式加 payment/deposit 关系样本。
3. 同一账户的真实银行 CSV/XLSX，确认 headerless/metadata/正负方向/重复交易处理。
4. 至少一张实际费用或hold凭证，验证净额、另行开票、reserve 的分类不会混淆。
5. QBO target-account sample 与实际导入入口验证；QBD 相同版本备份副本 dry run，记录成功、失败、partial success和重试结果。
6. 对比导入前后 GL、同一 AJE 编号、clearing残余与银行余额；仅“导入成功”不足以通过财务验收。

未满足上述要求时，可以交付标明合成数据的 Demo、只读差异报告和待批准的调整底稿；不应宣称所有 ST/QB/银行账户生产兼容或已完成真实客户月结。
