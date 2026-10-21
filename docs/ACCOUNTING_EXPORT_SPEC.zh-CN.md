# 会计处理与 QuickBooks 导入规格
版本：1.0 · 核验日期：2026-10-21 · 产品：3-Way Deposit & Clearing Reconciliation Desk

本文约束会计分支、分录批准、文件序列化和目标账套验收。它与主 PRD、canonical.ts 和 core.py 配合使用。下述分录以 USD、权责发生制、现有普通资产类清算账户为示例；具体收入确认政策及已锁定期间由账套会计决定。本文不将数学凑平视为会计确认。

## 1. 上线边界

18 小时版的自动调账出口仅覆盖一个狭窄情形：

> 已确认 ST 收款进入普通 ST Clearing；银行净额已在 QB 记 Dr Bank / Cr Clearing；结算凭证证明正数差额全为本批次已净扣的手续费；费用尚未入账；完整过账账簿证明该批次对应清算余量恰好等于该费用；会计批准后导出 Dr Fee Expense / Cr Clearing。

其余情形可以展示候选与底稿，不得套用此模板自动生成已批准分录。尤其：

- UF 的付款与存款关联不由一笔普通 JE 保证；
- Processor hold 不能当费用冲销；
- ST 未导出/退款未入批/同步异常，可能需要修正源系统工作流；
- 银行 Feed 待审核行不证明已过账；
- 银行到账不是收入确认的唯一证据；
- Brand=GreenSky 不证明净扣模式。

这里的“自动生成”是指生成待审查或已由授权会计批准的文件；产品不连接 QuickBooks，不执行导入，不把下载状态记作已过账。

## 2. 三种余额分别验证

### 2.1 ST 实际收款

使用 actual payment / refund 金额，不使用发票总额替代。允许一笔 payment 应用于多个 invoice，也允许同一 invoice 分次付款。聚合前先确认 row_grain，不能把 Payment Application 的重复原付款额重复计入。

统一定义：

- G：正向收款 gross 之和，不含退款；
- R：退款绝对值之和；
- F：结算凭证确认的本次净扣费用；
- H：本次新增、尚未释放的扣留金额；
- L：本次释放的此前扣留金额；
- X：有独立收据/结算说明证明的系统外收款；
- J：有证据的其他有符号调整。

预期银行净额：

B_expected = G - R - F - H + L + X + J

如果内部 ST_Payment_Record.gross_cents 对退款使用负数，则 G 必须只汇总正收款；R 另取退款绝对值。禁止 sum(all signed gross) 后再次减 R。

### 2.2 QB Clearing 总账

逐个科目验证：

C_end[a] = C_begin[a] + sum(debit[a]) - sum(credit[a])

报告含多个科目时，每个科目保留期初/期末与覆盖范围。银行、清算、应收、费用的余额不能加成一个总数再声称“平了”。多个清算账户也不能互相抵消。

分录汇总导出时，只有实际落在目标 clearing account 的 posting lines 用于清算勾稽。Journal 总额、银行借方和清算贷方不能重复计数。

缺期初余额时，界面标签为“本次活动对账”；不得显示“月结余额已核实”。缺期末官方控制数时，显示“计算余额，未与 QB 报告期末核对”。

### 2.3 银行实际资金

只按已 posted 的银行流水核实到账。pending、value date 和 posting date 单独保存。

一笔 bank credit 可以对应多个 ST 收款或多个批次；反之，一笔 ST 批次可能分次支付。后者需要金额分配和余量，不得把整条源记录复用于多个已接受组。

银行摘要里的商户词只用于候选索引，不构成完整收入归属证明。

## 3. $10,000 / $9,100 / $900 分支表

假设服务已按企业政策确认收入、客户应收已存在，且 ST 付款已经实际导出形成：

| 科目 | 借方 | 贷方 |
|---|---:|---:|
| ServiceTitan Clearing | 10,000.00 | |
| Accounts Receivable | | 10,000.00 |

这一步需要 GL 证据；不能因 ST export_status 显示 EXPORTED 就推断 QuickBooks 必然存在同额分录。

### 情形 A：QB 尚未记录银行到账

前提：完整 QB 银行及清算明细证明不存在同一结算入账，结算凭证明确 $900 净扣费。

| 科目 | 借方 | 贷方 |
|---|---:|---:|
| Operating Bank | 9,100.00 | |
| Merchant Financing Fee Expense | 900.00 | |
| ServiceTitan Clearing | | 10,000.00 |

此为完整 settlement proposal。18 小时参考代码不自动提供这个分支；正式应用如实现，需独立检查银行未过账证据，不能仅依赖某个布尔值来自 UI。

如果该银行流水已经在 Bank Feed 中，导入之后会计应 Match 已创建记录，而非再 Categorize 成另一笔记录。[QB05]

### 情形 B：QB 已记净额到 Clearing，费用遗漏

已存在：

| 科目 | 借方 | 贷方 |
|---|---:|---:|
| Operating Bank | 9,100.00 | |
| ServiceTitan Clearing | | 9,100.00 |

本产品狭窄自动模板：

| 科目 | 借方 | 贷方 |
|---|---:|---:|
| Merchant Financing Fee Expense | 900.00 | |
| ServiceTitan Clearing | | 900.00 |

结果：本批次清算余量归零，不新增银行借方。禁止再生成一次 $9,100 银行入账。

### 情形 C：QB 已完整拆费

现有分录已含 Dr Bank 9,100 + Dr Fee 900 / Cr Clearing 10,000。

结果：标记已对平，无 AJE。即使 ST gross 与 bank net 不等，也不是一个待修复账务错误。

### 情形 D：银行被记入收入

若已存在 Dr Bank 9,100 / Cr Revenue 9,100，而 ST 发票收入已经记账，可能重复收入。

理论重分类示例为 Dr Revenue 9,100 + Dr Fee 900 / Cr Clearing 10,000，但不得默认输出；必须证明原收入确实重复、科目和税费处理正确、会计期间允许。首版显示“需要核实原入账科目”，让会计修改原交易或批准专门重分类底稿。

### 情形 E：费用另行开票

GreenSky 官方 FAQ 当前说明商户费用对上月交易按月开票，到账通常在客户授权后两个营业日。因此单凭品牌不支持 $10,000 → $9,100 的推断。[GS01]

若资金全额到账：

| 业务 | 借方 | 贷方 |
|---|---|---|
| 放款到账 | Bank 10,000 | Clearing 10,000 |
| 按政策确认商户费发票 | Fee Expense 900 | Accounts Payable 900 |
| 支付商户费 | Accounts Payable 900 | Bank 900 |

若费用直接从银行扣取，可是 Dr Fee Expense / Cr Bank。系统应把该扣款与 fee invoice 关联，避免同时净扣一次又记独立费用一次。

### 情形 F：扣除额实际为可收回 reserve

如果结算凭证显示 $900 是风险 reserve、非费用，通常需要保留对支付通道的权利。底稿可提出 Processor Receivable / Reserve 分类供会计判断。不得把 H 混入 F；不得仅因金额长期未回款就自动冲费用或自动认定坏账。

### 情形 G：费用已发生但尚未支付

负债并不是“净扣手续费”的默认科目。只有确实存在未支付义务时，可能确认 Dr Fee Expense / Cr Payable。客户向金融机构借款也不自动变成承包商借款；须看追索与合同责任，不能以“Financing”支付方式直接确认本企业贷款负债。

## 4. Undeposited Funds 专用工作流

Intuit 官方建议第三方手续费处理为：先 Receive Payment 并放入 UF，再在 Bank Deposit 选择现有付款，在 Add other funds 增加负数费用行，使用对应费用科目，使最终存款等于银行净额。[QB06]

会计操作底稿必须包含：

1. 需要选择的 payment IDs / customer / amount；
2. 目标银行账户和存款日；
3. 需要新增的负数费用行及会计科目；
4. 预期净存款金额；
5. 已存在存款/银行 Feed 匹配提示；
6. 操作后重新导出的 Deposit Detail/GL 验收项。

IIF 导入不会自动关联交易。UF 总账余额为零也不保证待存款列表中每笔收款已正确关联。[QB08]

因此 canonical 的 is_undeposited_funds 应来自已确认账户类型/流程，不可只靠字符串包含“Undeposited”。自定义命名或子科目可能规避名字判断。

## 5. 调账批准与防重复

### 5.1 状态

INELIGIBLE → DRAFT → APPROVED → EXPORTED → VERIFIED_IN_QB

- EXPORTED：只表示已下载文件。
- VERIFIED_IN_QB：重新读取目标账套 GL，确认相同 journal identifier、科目、日期与金额。
- 不能因收到付款、下载完成、用户口头点击“已完成”就自动记已过账。
- 重新导出同一文件不会自动说明它未曾导入。

### 5.2 批准签名

批准必须绑定不可变 payload，至少覆盖：

- company_id、bank account、clearing account、fee account；
- 源文件哈希、mapping version、规则版本、完整账簿覆盖范围；
- case / group identity、所有 ST/QB/bank evidence references；
- gross、net、confirmed fee、当前 clearing residual；
- fee mode 和经核实的已有过账状态；
- journal date、period-open确认；
- 最终每行 debit / credit / account / memo；
- approving reviewer 与批准时间。

source_version_hash 只绑定源文件是不够的。批准后修改科目映射、日期或金额必须使批准失效。建议用稳定 canonical JSON 计算 proposal_hash；approved_proposal_hash 必须完全一致。哈希是变更检测，不是授权认证本身；多用户版本仍需服务器端验证 reviewer role。

### 5.3 防重复标识

- 内部 proposal identity 使用完整碰撞耐受哈希及可追踪原字段。
- QBD 短 DOCNUM 是显示/导入兼容字段，不能作为唯一权威身份。
- 账套+业务case+调整版本决定稳定ID；重新下载不要生成新号。
- 查询已导入 GL 的相同编号及同经济内容分录。
- 发现已存在、导入状态不明、部分成功或来源版本改变时，先核实，不生成另一套同义分录。
- 导出前人工/技术校验失败时，不建议关闭 QuickBooks 重复号码提示。

## 6. QBO CSV 适配器

### 6.1 官方接口

当前美国版 Intuit 文档明确有 CSV 日记账导入入口。[QB01] 文档没有明确精确套餐矩阵；产品应记录实际客户的 product/region、看到的 import入口及下载样例版本。

推荐字段：

| 文件列 | QBO 目标字段 | 必须满足 |
|---|---|---|
| Journal No. | Journal No. | 同一JE所有行一致；稳定，不重复 |
| Journal Date | Journal Date | 美式 MM/DD/YYYY；目标导入UI日期格式一致 |
| Account Name | Account Name | COA已存在的完整名称；子科目包含父路径 |
| Journal/Description | Journal/Description | 可追踪case编号；不含原客户隐私或公式 |
| Debits | Debits | 非负十进制两位；贷方行留空 |
| Credits | Credits | 非负十进制两位；借方行留空 |

样例：

```csv
Journal No.,Journal Date,Account Name,Journal/Description,Debits,Credits
RD2609001,09/30/2026,Merchant Financing Fees,Approved fee for batch B042,900.00,
RD2609001,09/30/2026,ServiceTitan Clearing,Approved fee for batch B042,,900.00
```

这个 CSV 表达“情形B”。它不是借银行/贷收入分录。

### 6.2 前置要求

- 按官方提示导入前暂时关闭 account numbers，导入后可恢复。
- 科目预先存在，子科目用 Parent:Subaccount。
- 新科目不由本产品偷偷创建；无法确定科目时阻止导出。
- 首版不自动生成 A/R、A/P、sales tax、payroll 类分录。
- Class/Location 在客户账号启用并测试后才输出；一个JE不同Location或未支持字段不能臆造。
- 中文/Unicode科目在QBO可保留，但仍需实际导入验证；QBD ASCII适配器单独严格处理。
- 官方通用导入FAQ提示低于1,000行；工程默认<=900数据行且不拆开一个JE。此为保守策略，不冒充所有JE导入器共同硬限制。[QB02]
- 导入入口不出现时提供review底稿；不得自动购买或引入第三方导入器。

### 6.3 序列化出口校验

CSV serializer本身也必须验证，不可只依赖builder：

- 必须为APPROVED的当前payload；
- 至少两行，行数/总金额在支持范围；
- 每行仅一边正数，另一边0或空，禁止负数debit/credit；
- 所有金额整数cents且总借方=总贷方；
- 日期合法、科目来自COA批准映射；
- 不允许journal_id/科目/memo以 = + - @ 或危险空白前缀触发电子表格公式；
- 不允许嵌入NUL、TAB、CR、LF及其他控制字符；
- 不把未验证Name或memo原文带进导入文件；
- CSV转义用成熟writer，不手拼逗号；
- 导入文件不通过给科目前缀加单引号“修复”公式，因为这会改变实际科目名。危险科目映射应阻止并让会计确认。

Review CSV与import CSV可分开：review文件可额外放证据和注释；import文件严格保留目标允许字段。

## 7. QBD IIF 适配器

### 7.1 格式

IIF为ASCII的tab-separated文本，不是逗号CSV。[QB07]

如下代码块使用可读的制表符示意；实际文件必须为TAB分隔，每笔一个TRNS、其余SPL，最后ENDTRNS：

```text
!TRNS	TRNSTYPE	DATE	ACCNT	AMOUNT	DOCNUM	MEMO
!SPL	TRNSTYPE	DATE	ACCNT	AMOUNT	DOCNUM	MEMO
!ENDTRNS
TRNS	GENERAL JOURNAL	09/30/2026	Merchant Financing Fees	900.00	RD2609001	Approved fee for batch B042
SPL	GENERAL JOURNAL	09/30/2026	ServiceTitan Clearing	-900.00	RD2609001	Approved fee for batch B042
ENDTRNS
```

- 借方正，贷方负；同一事务总和=0。
- US日期 MM/DD/YYYY。
- 普通费用/资产账户，不涉及需要Name关联的A/R或A/P。
- NAME/CLASS若客户版本要求或真实业务需要，则根据官方sample加入空列或有效值；不能不经试验跨版本承诺。
- CRLF输出，ASCII校验；不静默转写损坏科目名。
- DOCNUM采用经目标版本测试长度的稳定短标识；完整内部ID保存在manifest。
- 不包含自动创建COA或客户/供应商list的块。

### 7.2 目标账套验收

官方提供General journal entry的journal.iif样例下载入口。[QB07] 本研究环境未获得该样例ZIP字节、未运行QBD，因此示例只能标记为候选格式，不能写“已通过QBD导入测试”。

验收必须在客户同地区同版本副本进行：

1. 导出/核对COA，确认费用和普通clearing账户已存在；
2. 备份；
3. 官方导入入口选择 Import IIF；
4. 保留验证，不使用跳过检查的选项；
5. 导入一笔零争议测试JE；
6. 比对借贷、账户、日期、DOCNUM和memo；
7. 检查未新增Bank account或错误类别；
8. 导出Transaction Journal和GL复核；
9. 记录版本与报告，才将该适配器标记已验证。

Intuit提醒不存在的ACCNT可能创建为Bank account。[QB07] 这使COA白名单成为必要的正确性条件。

### 7.3 失败与部分成功

2019+导入器会报告成功/失败数量，并产生包含失败记录的新IIF。[QB09]

- 部分成功不能整包重试。
- 只有失败事务经修正后可重试。
- 原包、成功IDs、失败文件、修复版本需保留。
- 未拿到成功清单时先重新导出GL识别已入账记录。
- IIF不自动link transactions，也不能跨国家版本保证兼容。[QB08]

QBD通用CSV/Excel导入能力不代表任意journal.csv可直接进入GL。首版明确：QBO出口CSV，QBD出口IIF，CSV同时作为会计review底稿。QBJ作为会计师交换格式暂缓。

## 8. 导出报告与字段可靠性

### QBO

官方支持General Ledger增加Debit、Credit和Cleared，并按Account过滤。[QB03] 报表classic与enhanced体验不同。

典型映射别名：

| 含义 | 常见候选列名 | 限制 |
|---|---|---|
| 记账日期 | Date / Transaction date | 不一定为创建时间或银行清算日 |
| 单据类型 | Transaction Type | 不能只凭名称判是否posted |
| 单据编号 | Num | 未必唯一，需账套+类型+日期/源ID |
| 对方 | Name | 不是稳定身份键 |
| 说明 | Memo / Memo/Description | 仅本地查看，LLM不收原文 |
| 本科目 | Account / Account full name | 优先报告分组提供确切科目 |
| 对方科目 | Split / Item split account | -Split-不是实际科目 |
| 借贷 | Debit / Credit | 强烈推荐，消除natural sign歧义 |
| 报告金额 | Amount | 根据报告profile确认符号语义 |
| 余额 | Balance | 科目自然余额可能不同，不盲目同号 |
| 清账状态 | Cleared | 不等于银行实际资金证明 |

QBO官方出口是Export to Excel；应用接受XLSX与用户另存CSV。[QB04]

### QBD

官方Cash Receipts Journal列为Type、Date、Num、Memo、Clr、Split、Amount。[QB10]

Deposit Detail显示关联交易，而不是单纯可加总流水；官方指出其没有Paid Amount列。[QB11] Transaction Journal为accrual视图，source先targets后，也可显示非过账单据的借贷表达。[QB12]

因此解析器必须：

- 去掉标题、账户分组头、小计、合计、空行；
- 保存排除行的行号与理由；
- 区分transaction summary、posting line、linked detail；
- 金额与报告控制数核对；
- 不把bank deposit summary与其下付款重复相加；
- 对缺失真实debit/credit且符号不确定的报告要求mapping review；
- 对现金基础报表不承诺完整clearing权责发生核验。

## 9. 本规格验收用例

| 用例 | 必须结果 |
|---|---|
| 10,000 ST，9,100 bank，QB已净额冲clearing，900有净扣凭证 | 可生成费用-only草案，批准后导出两行 |
| 同上但只看到Bank Feed待审核 | 禁止费用-only自动批准 |
| QB已拆费900 | 无AJE |
| gap=900但实为reserve | 不能记费用 |
| GreenSky品牌、未知fee mode | 仅候选，不自动判净扣 |
| 净扣凭证缺失，仅费率9%落范围 | SUSPECTED，不自动批准 |
| 改已批准proposal的费用科目/日期/金额 | 批准失效 |
| 同一journal已在GL | 阻止再次生成 |
| 只知道UF余额差900 | 输出UF操作底稿，阻止普通clearing模板 |
| CSV含=HYPERLINK/控制字符 | 阻止import导出 |
| IIF账户不存在 | 阻止导出 |
| IIF部分成功 | 只处理失败组，不整包重导 |
| 缺opening balance | 不称月结已证实平衡 |
| 两个clearing账户一正一负抵消 | 分别显示差异 |
| 3,000行中找出金额组合但没有身份/结算证据 | 数学候选，不自动确诊 |

## 10. 来源清单

所有来源读取于2026-10-21；官方帮助内容可能随版本更新。字段适配与导入仍以实际目标账号/版本的sample与验收为准。

- [QB01] Intuit — Import journal entries: https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US
- [QB02] Intuit — Common questions about importing data: https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/common-questions-importing-data-quickbooks-online/L4OYJRFdj_US_en_US
- [QB03] Intuit — Run a ledger report showing debits and credits: https://quickbooks.intuit.com/learn-support/en-us/help-article/profit-loss-reports/create-report-shows-debits-credits-transaction/L1zvqNX0e_US_en_US
- [QB04] Intuit — Export reports to Excel: https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/export-reports-excel-quickbooks-online/L7iAoP97n_US_en_US
- [QB05] Intuit — Match your bank and credit card transactions: https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/match-online-bank-transactions-quickbooks-online/L6qyw0PvP_US_en_US
- [QB06] Intuit — Enter a bank service fee using a third-party merchant: https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/enter-bank-service-fee-using-third-party-merchant/L94JHLIsf_US_en_US
- [QB07] Intuit — IIF overview, import kit, samples and headers: https://quickbooks.intuit.com/learn-support/en-us/help-article/list-management/iif-overview-import-kit-sample-files-headers/L5CZIpJne_US_en_US
- [QB08] Intuit — Export, import and edit IIF files: https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/export-import-edit-iif-files/L56LT9Z0Q_US_en_US
- [QB09] Intuit — Improved IIF import in 2019 and later: https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/improved-iif-import-quickbooks-2019-later/L1K3ZQDX9_US_en_US
- [QB10] Intuit — Create a Cash Receipts Journal: https://quickbooks.intuit.com/learn-support/en-us/help-article/customize-reports/create-cash-receipts-journal-report/L7RBPOBI3_US_en_US
- [QB11] Intuit — Check and Deposit Detail transaction links: https://quickbooks.intuit.com/learn-support/en-us/help-article/accounts-receivable-reports/use-check-deposit-detail-reports-show-transaction/L0Lbizj8s_US_en_US
- [QB12] Intuit — Transaction Journal report: https://quickbooks.intuit.com/learn-support/en-us/help-article/transaction-reports/view-transaction-journal-report-quickbooks-desktop/L944aaidk_US_en_US
- [GS01] GreenSky — Merchant FAQ: https://www.greensky.com/merchant-faq/

会计分支为基于已明示事实的借贷推演，不把供应商帮助文章当作完整US GAAP认证，也不推定所有融资合同、追索条款或企业会计政策相同。

