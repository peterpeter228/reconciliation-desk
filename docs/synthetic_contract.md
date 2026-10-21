# 合成数据契约与验收口径

版本：1.0.0。固定演示种子：`20261021`。公司：虚构的 Cedar Ridge Home Services LLC。期间：2026-09-01 至 2026-09-30；本地业务时区为 America/New_York；币种为 USD。

**这些文件是可复算的合成适配器样本，不是从 ServiceTitan、QuickBooks 或 Chase 取得的真实客户导出，也不是厂商认证模板。** 生成器只用 Python 标准库；不联网、不调用模型、不读取客户数据。

## 1. 一条“交易”究竟是什么

用户要求“350 笔交易、85% 正常、15% 异常”。`350 × 85% = 297.5`，无法用整数事件精确满足。因此本套固定为：

| 口径 | 数量 |
|---|---:|
| 原始经济收款事件 | 350 |
| 正常事件 | 297（84.857142857%） |
| 异常事件 | 53（15.142857143%） |
| 原始毛收款合计 | $250,000.00 |
| 额外退款跟进记录 | 8 |
| 额外非现金支付应用修正记录 | 8 |

350 是原始经济收款事件数量。退款、修正、支付手续费、账本借贷腿和汇总存款不是另外的原始收款事件。一个事件可以产生多条源记录，多笔事件也可以归入同一批次或银行存款。因此 **350 不是任意一个 CSV 的行数**。

`$250,000.00` 是这 350 个原始收款事件的毛金额合计。它不是当前 ST 报表的有符号合计、银行净入账合计、GAAP 营业收入，也不是发票总额合计。退款另列负数；非现金应用修正不代表银行已退款。

各事件的 `ground_truth_cause` 只存在于测试答案文件。正常事件所属存款在缺少证据时也可能不可辨识。例如混合 $50,000 存款中的 $12,000 支票本身是正常事件，但三文件视角仍需要归集清单才可确定归属。不要把 297 当作最低限度三文件上传后的自动匹配数承诺。

本套 QB 文件只有 clearing 单腿；增强 CSV 也没有补 QB bank leg、完整 deposit journal 或会计逐项确认。因此全部事件的 `matching_scope=ACTIVITY_BRIDGE`、`three_way_matching_state=PARTIAL`。正常行可有已确认的 ST—银行现金归属，但不能据此显示 `VERIFIED_THREE_WAY`。活动已解释与三方过账均已验证是两种结论。

## 2. 运行方法

在开发包根目录执行：

```bash
python3 scripts/generate_synthetic.py --out samples --seed 20261021
python3 -m unittest discover -s tests -p 'test_synthetic.py' -v
```

Python 3.10 或以上即可。不需要 `pip install`。同一版本、同一种子生成相同的金额、排序与 CSV 字节。程序会替换目标目录内同名文件；不会删除目录中的其他文件。更换种子改变普通事件金额和部分日期，同时保持总额、数量、六类覆盖和两个经典案例。

## 3. 输出文件

默认种子下的实际生成结果：

| 文件 | 数据行数 | 用途 |
|---|---:|---|
| `st_export.csv` | 359 | 三文件模式：343 条 ST 原支付 + 8 条退款 + 8 条独立修正 |
| `qbo_clearing_gl.csv` | 338 | 三文件模式：指定 clearing 资产科目的完整期间借贷腿 |
| `chase_bank.csv` | 140 | 三文件模式：归集账户的入账及相关退款扣款 |
| `processor_settlements.csv` | 243 | 增强证据：结算、净扣手续费、退款、在途计划及明确的 HELD 状态 |
| `st_audit_events.csv` | 8 | 增强证据：原导出时间及后续独立修正创建时间 |
| `external_receipts.csv` | 7 | 增强证据：办公室/直接收款登记与未录 ST 事实 |
| `bank_next_period.csv` | 10 | 增强证据：10 月实际结算，验证 9 月底的在途判断 |
| `deposit_components.csv` | 4 | 增强证据：$50,000 归集存款的四个已证明组成部分 |
| `ground_truth_answer_key.json` | 不适用 | 测试专用答案、期望状态、精确金额、源行指纹、文件哈希 |

所有 CSV 使用 UTF-8、逗号分隔、首行表头、换行符 LF；日期用 `MM/DD/YYYY`。金额用无千位分隔符的两位十进制文本，内部全部用整数美分计算。

### 3.1 ST 适配器配置

`Batch Number` 在这套配置里专指 **accounting export batch**，绝不能与 `processor_settlements.csv` 的 `Processor Batch Number` 混用。付款主键是 `Payment ID`；不能把 `Invoice #` 当作唯一支付主键。

关键列为：

```text
Payment ID, Related Payment ID, Record Type, Payment Date,
Batch Number, Batch Close Date, Batch Post Date, Invoice #,
Customer Name, Business Unit, Payment Type, Processor,
Gross Amount, Net Amount, GL Account Code, Export Status,
Payment Status, Reference, Currency
```

这是把支付、退款及可区分的支付应用修正展平后的合成适配器配置。真实租户可能需要 Payments、Accounting Batch、Invoices 或调整报告的组合。`Net Amount`、`Related Payment ID`、`Record Type` 等列不是所有原生报表均保证存在的字段。

`Record Type` 决定金额的业务含义：

| 值 | 金额含义 | 是否可直接作为银行现金流候选 |
|---|---|---|
| `PAYMENT` | 原始实际收款的毛金额 | 可以，按实际结算/手续费配置转换 |
| `REFUND` | 已发生退款的负向金额 | 可以，与银行负向扣款或结算抵扣核对 |
| `PAYMENT_CORRECTION` | 独立支付应用修正的负向金额 | 不可以；必须保留为调整证据，不能假定现金已退 |

原已导出的支付记录保持不变。后续修正使用新 Payment ID 和新批次/未导出状态。样本不暗示 ST 允许直接修改锁定的导出支付。修正记录的负数可以参与“当前应用总额 vs 原导出总额”的差异解释，但不得加入现金退款合计。

### 3.2 QuickBooks 适配器配置

```text
Transaction ID, Line ID, Date, Transaction Type, Num, Name,
Memo/Description, Account, Split, Debit, Credit, Amount, Clr
```

这里使用 accrual、单一 USD、`ServiceTitan Clearing` 资产科目视角。账本行的 `Amount = Debit - Credit`。正常批次中最多 3 笔 ST 支付汇总成一条 QB clearing 借方，不在 QB 汇总行伪造逐笔支付 ID。

银行存款对应 clearing 贷方；已记账手续费对应 clearing 贷方及未包含在该科目筛选报表内的费用借方。CSV 只有被筛选 clearing 科目的一腿，所以 **全文件借贷不相等是预期行为，不能据此报 JE 不平衡**。真正调整分录导出必须另外生成完整借贷双方并验证平衡。

字段 `Transaction ID` 与 `Line ID` 是本适配器保留的技术标识。真实 QB 原生导出不一定保留这些 ID；缺失时必须从不可变文件摘要、物理行号和行内容构造源记录 ID。一个 Deposit 可包含多个 clearing 行，因此 `Transaction ID` 不能去重代替 `Line ID`。

### 3.3 银行适配器配置

```text
Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #
```

这是 Chase 风格的合成列布局，不是 Chase 商业账户统一格式的断言。信用入账为正、退款扣款为负；`Details` 与金额方向交叉校验。模拟的是独立 collections checking 归集账户，涵盖本样本所有收款及相关退款，不包含经营付款账户的工资、供应商或房租支出。

不得在解析时先删除所有负数：那会把退款异常的银行证据一起删除。`Balance` 按行中包含的全部活动滚动计算；次期文件从本期期末余额继续。

## 4. 六类地雷与证据边界

默认种子的金额如下。它们来自生成脚本而非外部行业统计。

| 真实事件类别 | 事件数 | 原始毛收款 | clearing 余额贡献 | 三文件可以断言的范围 |
|---|---:|---:|---:|---|
| 正常 | 297 | $164,446.39 | $0.00 | 非混合存款的批次、账本活动和结算引用一致；QB bank leg 仍待核 |
| 跨期在途 | 10 | $4,639.66 | +$4,639.66 | 截止日未见结算且在配置窗口内；仍只是候选 |
| 净扣手续费 | 12 | $41,078.50 | +$3,518.72 | 净额差及费率吻合仅提供候选，不能证明原因 |
| 退款未入导出批次 | 8 | $5,889.11 | $0.00 | 观察到独立未导出退款；银行另有合计 $1,543.26 扣款 |
| 导出后修正不同步 | 8 | $4,219.98 | $0.00 | 观察到独立未导出修正，不能直接归因软件 Bug |
| 系统外收款 | 7 | $7,639.86 | -$7,639.86 | QB/银行存在贷记，但完整 ST 期间视图未见对应记录 |
| 支付通道冻结 | 8 | $22,086.50 | +$22,086.50 | 只见缺失结算；“缺失”不能证明被 Hold |
| 合计 | 350 | $250,000.00 | +$22,605.02 | — |

所有类别都有两套期望状态：`expected_minimum_three_files` 与 `expected_with_evidence`。测试不能用答案中的真因替代三文件可见的证据。

8 个导出后修正样本保留原锁定支付，并用 audit 证明独立 application correction 是在导出后创建。它们的增强结论是 `SOURCE_RELATIONSHIP_CHANGE / SUPPORTED_NOT_ACCOUNTING_DRIFT_PROOF`，并非已确认 clearing 少账。此处 `ground_truth_cause=POST_EXPORT_DRIFT` 表示种入的场景家族，不表示已证明必须改变 QB 金额的会计错误。纯改挂发票可能不改变现金或 GL；还需要 `EXPECTED_QB_OBJECT_AND_ACCOUNTING_EFFECT` 和 QB 目标对象活动历史才能确认会计同步差异。8 个退款样本的增强结论也保留 `QB_STATUS_UNKNOWN`，因为 clearing 单腿不能排除退款已经通过其他 QB 科目记账。

### $20,000 “ST 已记、银行未到”

ST 保留 $20,000 原支付及已导出批次；QB clearing 已借记 $20,000；本期和提供的次期银行文件中都没有它。三文件结果必须为 `MISSING_SETTLEMENT`，不得升级成已确认 Hold。

增强证据的支付通道记录明确提供 `Status=HELD`、`Amount Held=20000.00`，才允许在合成测试中确认 `PROCESSOR_HOLD`。不生成冲销这笔 clearing 的调账分录。等待结算是一项资产的状态，不是凭空抹掉资产的理由。

### $50,000 “无主银行入账”

该样本是有清单证明的 treasury/statement consolidation 压力案例。**它不代表 GreenSky ACH 与纸支票在正常银行原始流水中天然合并成一笔。** 银行行的 Type 为 `DEPOSIT`，Description 为 `CONSOLIDATED DEPOSIT CONSOL260918`，不伪装成一笔 GreenSky ACH。

| 组成部分 | 毛额 | 净扣 | 实际归集入账 |
|---|---:|---:|---:|
| 合成 GreenSky 资金 1 | $20,000.00 | $1,800.00 | $18,200.00 |
| 合成 GreenSky 资金 2 | $15,000.00 | $1,350.00 | $13,650.00 |
| ST 已录支票 | $12,000.00 | $0.00 | $12,000.00 |
| 办公室未录 ST 的支票 | $6,150.00 | $0.00 | $6,150.00 |
| 合计 | $53,150.00 | $3,150.00 | $50,000.00 |

两笔融资行的 `Fee Mode=netted`、`Contract Reference=SYNTHETIC-NETTED-FUNDING-09` 是该测试合同的显式假设。不得根据 GreenSky 品牌名推断真实合同默认为净扣；某些真实产品/合同是按月开票收取商户费用。

只读三个核心文件时，ST 里只有 $47,000 毛额，对应银行 $50,000；单一费率公式甚至会得到负费率。正确结果是“尚需归集构成与外部收款证据”，不能强行找到一个子集就宣称已平。加入 `deposit_components.csv`、结算及办公室收款证据后，四个净额组成才能逐项得到证明。

对融资毛额 $35,000 而言费用是 $3,150；不能把 9% 套到 $53,150 的整个混合池，也不能把 ST 缺失的 $6,150 当作刷卡手续费。

## 5. 数值守恒与余额

默认种子的完整数值关系：

```text
Clearing opening                       0.00
+ period debits                  242,360.14
- period credits                 219,755.12
= clearing closing                22,605.02

Clearing closing = in-transit      4,639.66
                 + held          22,086.50
                 + unbooked fees  3,518.72
                 - outside ST     7,639.86
                 =               22,605.02

Bank opening                      42,500.00
+ receipt credits                217,191.95
- refund debits                    1,543.26
= bank closing                   258,148.69

ST signed report                 239,972.92
= original gross receipts        250,000.00
- outside-ST original receipts     7,639.86
- refund follow-ups                1,543.26
- noncash application corrections    843.96
```

上面最后一式是源报告金额守恒，不是现金流或收入公式。非现金修正必须在报表解释中单独列出。退款没有进入 QB 本期导出，原收款的 clearing 借贷腿已经平，所以这类问题不会必然在 clearing 期末净余额中显现；只检查 clearing 余额为零会漏掉它们。

净扣费用有 12 个事件，共 $3,518.72。增强证据可使这 12 项的费用/净额数学条件就绪：`fee_proposal_math_ready=true`。但当前样本没有 QB bank leg、完整费用科目去重覆盖或会计逐项核验，故所有事件的 `fee_aje_draft_eligible=false`，不能直接导出可导入稿。必须另补这些证据、验证 clearing 同额残差、账户映射和会计批准后，才允许 fee-only draft：借记所选费用科目，贷记 clearing。此总额是条件式费用底稿金额，不是找回现金、追回损失或新增利润。

`auto_post_allowed` 对全部事件恒为 `false`。账户映射和会计复核仍是草稿导出的必要条件。

## 6. 答案文件与防答案泄漏

`ground_truth_answer_key.json` 包含：

- `measurement_contract`：350 的口径及整数舍入说明。
- `export_profile`：合成数据与真实厂商导出之间的界限。
- `balances`：opening、期间借贷、closing、银行正负流水和 ST 有符号合计。
- `headline_cases`：两个经典压力案例及各自证据界限。
- `expected_settlement_groups`：银行源行、对应事件集合、gross/fee/net 和组的来源。
- `events`：每个事件真实类别、金额贡献、两个证据级别下的期望状态、AJE 资格和源行引用。
- `files`：每个 CSV 的字节数、行数、SHA-256。

每个源行引用包含文件名、从 1 开始的物理 CSV 行号（表头为 1）和按字段内容计算的 SHA-256；ST 支付、QB 交易/行等可用 ID 也同时保留。一个汇总账本行可在多个经济事件的 source refs 中出现，不能因此复制消费该源行。

**生产匹配器不允许加载这个答案文件。** 测试夹具加载器先把核心 CSV 或显式的增强证据交给被测引擎，再由断言程序读取答案对比结果。不得把 `ground_truth_cause`、event ID、人工异常标签加入核心三文件或发给 LLM。

可选 CSV 中的 `Evidence Document` 是合成凭证定位标记。该脚本不会生成那些描述性的 PDF；不能把它们渲染成“已上传真实凭证”或可点击存在的附件。增强证据 CSV 本身就是这套测试的模拟原始凭证；正式产品必须替换为真实文件并记录其摘要和上传来源。

## 7. 已执行的测试及其证明范围

`tests/test_synthetic.py` 共 13 项，已在交付环境通过：

1. 350、297/53、六类数量及 $250,000.00 精确毛收款。
2. ST 源记录、系统外收款、退款及非现金修正之间的数值关系。
3. clearing opening + debits − credits = closing，且各类残差相加一致。
4. 真实一对多批次粒度、QB Line ID 唯一、会计批次与支付通道批次不同。
5. 银行正负流水、滚动余额、当期与次期日期隔离。
6. $20,000 缺失不能仅凭三文件确诊 Hold。
7. $50,000 四成分净额守恒与 manifest 必要性。
8. 原锁定支付未改写、8 条退款和 8 条非现金修正分离。
9. 三文件及现有增强证据均不生成缺少 QB 银行过账/费用核验的 AJE；12 个费用底稿的数学金额相等。
10. 2026 年 Labor Day 与周末跨越的营业日计算。
11. 核心 CSV 无原因标签/答案字段；源行与文件哈希吻合。
12. 相同种子重现，不同种子保持关键不变量。
13. 活动关联不冒充三方已验证；导出后 application correction 不冒充已证明会计金额差异。

这些测试证明样本内部一致性与证据契约，**不证明匹配器已经实现、不证明真实文件兼容性，也不证明 QuickBooks 导入成功**。实际匹配器、AJE 目标版本、复杂报表格式与 Windows 浏览器性能需要各自的验收证据。

## 8. 接入真实试点前需要补的样本

此生成器不覆盖所有真实生产形态。首批付费试点仍要收集去标识化的：原生 ST/QB 表头与元数据行；真实 gross/net/fee/reserve 报表；独立手续费按月开票；一个付款分摊多发票；同一银行金额的多组合法解；重复上传；部分结算；chargeback；旧余额跨期；多币种；同一公司多个银行账户。默认匹配器必须对这些未知情况保留未决状态，不得强行归入六类。
