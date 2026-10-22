# 商业验证方案（2026-10-22）：证据与假设分开

本文件不是销售承诺，也不是已接受的价格。没有联系任何人、没有注册任何账户、没有发出任何外联。
公开网页于 2026-10-22 读取；“事实”项均附来源，其中标 ✔ 的条目由审查者逐页回读核对，其余来自子代理调研
（原始调研笔记未入库，可按 URL 复查），只能作为线索。

## 1. 已知事实（公开来源）

| # | 事实 | 来源 |
|---|---|---|
| E1 ✔ | ServiceTitan Payments（Adyen）存款总额为净额：“gross $5,000、fees $125，Total $4,875”。银行存款流程可勾选 “Include Payment Processing Fees”，但需联系技术支持做账户配置；“Journal Entry exporting is not yet available for QuickBooks Desktop.”（页面元数据 updated 2026-10-16） | https://help.servicetitan.com/docs/manage-adyen-autobatching-fees |
| E2 ✔ | ReconoSync：核对 ServiceTitan/Housecall Pro/Jobber 推送到 QBO 的内容与存款报表和银行，列出“card fees taken out of deposits”、卡在 Undeposited Funds 的款项等；起始只读，修复需人工逐条批准、90 天可撤销。Review list $199/月（≤10 本账），Managed $590/月，Firm 定制，按月 | https://reconosync.com/ |
| E3 ✔ | QBO 导入：“You can only import spreadsheets with less than 1,000 rows.”；日记账需 Journal No、Journal Date、Journal Code、Account Name、Journal、Debits、Credits、日期格式（en-global 页面；US 页面未取得） | https://quickbooks.intuit.com/learn-support/en-global/help-article/import-export-files/common-questions-importing-data-quickbooks-online/L4OYJRFdj_ROW_en |
| E4 | ServiceTitan 默认把付款导出为 Dr Undeposited Funds / Cr A/R，资金到银行后再移入银行 | https://help.servicetitan.com/docs/deposit-funds-into-your-quickbooks-bank-accounts |
| E5 | QBO 银行 feed：费用或折扣改变总额、多笔合并存款时不给匹配建议；Match 表示记录已存在，Categorize 新建记录 | https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/match-online-bank-transactions-quickbooks-online/L6qyw0PvP_US_en_US |
| E6 | QBD IIF：错误检查有限，Intuit 不提供 IIF 辅助支持；缺失科目会被创建为新银行科目 | https://quickbooks.intuit.com/learn-support/en-us/manage-lists/iif-overview-import-kit-sample-files-and-headers/00/201577 |
| E7 ✔ | 两家公开报价（仅两例，不代表行情）：Flow Bookkeeping 清理 “Starting at $750” 对应 “1–3 months behind”，并提供 “Free Books Diagnostic”；Books and Trucks ServiceTitan 方案 “from $995 a month”，含 ServiceTitan→QuickBooks 月度对账，并提供三个工作日内的免费查看 | https://www.flowbookkeepingservices.com/ · https://booksandtrucks.com/pricing |
| E7b | 未核实线索：子代理报告 SDO CPA 约 $320/落后月、Civita $300–$675/落后月等；SDO CPA 页面回读返回 HTTP 403，其余未回读 | https://www.sdocpa.com/catch-up-bookkeeping-services/ · https://civitataxsolutions.com/quickbooks-cleanup |
| E8 | 公开讨论存在 ServiceTitan→QBO 同步与 Undeposited Funds 混乱的抱怨；直接描述“净额手续费漏记”的帖子未找到（未找到不等于不存在） | 例：https://www.reddit.com/r/Bookkeeping/comments/1ujlmqh/syncing_quickbooks_with_service_titan/ |

**推断**：E1 说明“没人知道净额手续费问题”不能作为卖点；E2 说明同价位已有连接 QBO、按月订阅的直接竞品。本工具可能的差异
仅剩：不连接账户、一次性、按期间出证据包、历史期间清理、未启用配置或非 Adyen 处理器的商户、QBD。以上差异是否有人付费，**无证据**。

## 2. 目标用户与付款人（假设 H-U）

- 使用者：服务 1–10 家 ServiceTitan + QBO 家装/暖通服务商的外包 bookkeeper，或这类企业的内部会计。
- 付款人：bookkeeping 事务所（作为补账/清理工作的成本），其次是业主。
- 触发场景：月结或年末清理时银行存款与 ServiceTitan 收款对不上；clearing 或 Undeposited Funds 余额长期不为零；接手新客户的历史烂账。
- 现有做法：在 ServiceTitan 存款报表、处理器结算报表、QBO 之间人工比对；或使用 ReconoSync 一类连接式工具；或外包清理。

## 3. 可证伪的商业假设

| ID | 假设 | 证伪条件 |
|---|---|---|
| H1 | 目标 bookkeeper 至少每季度遇到一次 ST→QBO 存款差异需要逐笔解释 | 5 次访谈中 <2 人确认 |
| H2 | 他们愿意上传/本地打开导出文件，而不愿授予 QBO 读权限 | 多数人更偏好 OAuth 连接工具 |
| H3 | 可复核的证据包（摘要 + 工作底稿）比自动修复更被看重 | 受访者只关心“自动入账”结果 |
| H4 | 单期辅助诊断可收费 | 多数受访者认为诊断应免费（E7 两例均提供免费诊断或查看；两例不代表行情） |
| H5 | 真实导出能在合理人工准备下进入当前引擎 | 首个获授权样本需要 >2 小时补列/映射才能形成案例 |

## 4. 报价假设

`$199` 单期辅助诊断仍是**未验证报价**。已核实的两例（E7）中，一家清理报价 $750 起（1–3 个落后月）并提供免费诊断，另一家 ServiceTitan 方案 $995/月起并提供免费查看；样本太少，不能推断普遍行情。E2 的 $199 是**按月订阅且连接 QBO**。
建议在访谈中对比两个方案，而不是假设 $199：
- A：免费诊断（一个期间，交付调查摘要），清理按期间另行报价（金额待访谈确定，不预设区间）。
- B：$199 单期“证据包”（不含任何入账），作为对照。

## 5. 最小试点服务范围（尚未执行）

- 一家公司、一个日历月、一个银行账户、USD；ST 付款导出 + QBO GL（含 clearing/UF、银行、费用科目）+ 银行流水 + 处理器结算报表；总行数 ≤3,000。
- 交付物：复核摘要（HTML）、调查工作底稿（JSON/CSV）、待补证据清单；满足全部门槛时才附受限 fee-only 草案（不导入、不入账）。
- 排除：UF 实际存款操作、负债 clearing、hold/release、退款混合、跨期、QBD 导入、任何账簿写入。
- 返工边界：一次映射修正、一次补证据重算。
- 前置：真实客户书面授权、数据最小化与删除约定、仅本地处理。**均需用户另行授权。**

## 6. 单次交付经济模型（全部为未知或假设）

| 项 | 当前状态 |
|---|---|
| 资料准备（客户/bookkeeper 导出、补关联列） | 未测量；当前原生 QBO GL 缺少引擎所需关联列（见审查报告 §4.1），可能是主要成本 |
| 映射与清洗 | 合成样例约 13 次交互；真实文件未测 |
| 解释与复核 | fee-only 路径约 37 次事实录入；全月 clearing 逐笔关联未测 |
| 支持与返工 | 未知 |
| 获客、支付、托管、退款 | 未配置；收款需可信服务端事件，本轮不启用 |

单次贡献 = 价格 − （人工小时 × 时薪 + 支付费用 + 退款准备）。在测得人工小时之前，任何“盈利”结论都不成立。

## 7. 演示脚本（合成数据）

1. 打开 Demo，说明“三条独立证据边”和“相同金额不是证据”。
2. 用 `tests/fixtures/fee-case-csv/` 的合成 CSV 走“Use my files”→ 补处理器结算 → 900 手续费案例。
3. 展示复核摘要：哪些是来源证明、哪些是复核人声明、还缺什么、下一步谁确认。
4. 展示阻断：未命名银行科目时不出分录；重开项目需重新附原件；导出后旧副本不能再出第二份。
5. 明确：不连接账户、不入账、下载不等于过账。

## 8. 试点成功/失败指标与停止条件

- 成功：≥3/5 受访者确认 H1；≥1 家书面同意用真实（脱敏）一期数据试点；试点中 ≥1 个差异被复核人认为解释正确且节省时间。
- 失败/停止：H1 <2/5；或首个真实样本准备 >2 小时仍无法形成案例；或受访者一致偏好连接式工具（转向“证据包导出给现有工具”或停止）。

## 9. 外联草稿（未发送，仅供用户决定）

> 你好，我在做一个只在浏览器本地运行的小工具，用来解释 ServiceTitan 收款、QuickBooks 与银行存款之间的差异（例如处理器手续费被净额扣除、合并存款、Undeposited Funds 积压）。它不连接你的账户，也不入账。想请教 20 分钟：你上一次处理这类差异是什么时候、怎么做的、花了多久？不需要提供任何客户数据。

## 10. 结论

现在可以诚实交付的是：本地演示、合成证据包、受限 fee-only 草案机制。不能声称：真实客户可用、QBO/QBD 验收、需求或收入。
最值得继续验证的是 **H1 + H5**（问题是否高频、真实导出准备成本是否可接受），而不是扩展更多会计场景。
