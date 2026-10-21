# QuickBooks 实际导入验收记录

> 后续本地工程复核：2026-10-21 新增显式 `qbo-transaction-journal-v1` profile 后，**未经修改的原生 CSV 已得到单笔精确过账匹配**；这不是完整期间/科目覆盖，也没有证明清算余额归零。原生 XLSX 仍因实际控制总计公式而被安全拒绝。新结果见 `native-profile-roundtrip-result.json`，可复现脚本 `check-native-profile-roundtrip.mjs`，约束见 [profile 文档](../../docs/QBO_TRANSACTION_JOURNAL_PROFILE.md)。下文原失败过程和 `native-roundtrip-result.json` 均保留，不改写历史结果。

核验日：2026-10-21。最终状态：**官方公开 Sample Company 的单笔合成 CSV 导入成功；原生报表回导未通过，因此仍不能当作已上线产品。**

## 已由真实浏览器证实

- 通过官方美国 Plus test drive 入口进入 `Sample Company`，报表公司名为 `Craig's Design and Landscaping Services`。未登录用户 QuickBooks 账号、未触碰真实账簿、未创建账号/公司/订阅，未使用 API key 或 OAuth。
- 在 Settings → Import Data 实际菜单中看到 Journal Entries，并打开原生 Upload → Map Fields → Import 流程。目标上传页面提示最多 1000 行。下载并保留官方目标样例 `official-target-sample.csv`。
- 读取既有科目：Bank Charges = Expenses / Bank Charges；Uncategorized Asset = Other Current Assets / Other Current Assets，起始余额 0.00，不是 Undeposited Funds。仅为隔离演示测试选用，不能当作真实客户的会计映射建议。
- 从生产 `buildFeeProposal` → `approveProposal` → `exportQboCsv` 重新生成两行纯合成文件，并保留 proposal、批准绑定 hash 和 manifest。没有批准后手改 CSV，也未改生产代码。生成者名称仅标识测试程序，不构成会计批准。
- QBO 自动映射 Journal No.、Journal Date、Debits、Credits、Journal/Description；Account Name 需手动选择同名列。日期格式 M/D/YYYY。Name 与 Memo 未映射，逐行 Description 保留合成警示。
- 导入前目标 UI 明确显示 `You're good to go` / `1 new journal entry will be imported.`。仅点击一次 Complete import。结果明确显示 `Nicely done` / `1 out of 1 journal entry was added.`，没有重试导入。
- 打开实际已入账记录核对：日记账号 **RDCE641C900E**，实际 QBO transaction ID **145**，日期 **09/30/2026**，两条有金额的分录：Bank Charges 借方 **900.00**，Uncategorized Asset 贷方 **900.00**，借贷合计 **900.00 / 900.00**，合成警示完整保留，没有银行借方。编辑表中的额外空白输入行不是已入账分录。未编辑或再次保存该交易。
- 实际交易地址：`https://qbo.intuit.com/app/journal?txnId=145`。它属于临时公开样例会话，不保证离开会话后仍可访问。
- 资产 register 只有该一笔交易，余额从 0.00 变为 -900.00。教学前提中的 10,000 收款和 9,100 银行净额没有在目标中创建，故**不能声称清算余额归零、完成真实三方对账或完整月末关账**。

## 本次上传文件

`PUBLIC_DEMO_ONLY_RDCE641C900E.csv`

SHA-256：`2d195090a36cc1da73cfbdd3bc60ba77e758f2ef30ddb36eebd3df7c5cdfd1a8`

可复现脚本：`generate-target-synthetic.mjs`。绑定材料：`target-synthetic-proposal.json`、`target-synthetic-export-manifest.json`、`target-synthetic-sha256.txt`。

原教学文件 `SYNTHETIC_DO_NOT_IMPORT_RD1E1BAA9EFD_BETA_NOT_POSTED.csv` 未上传，仅保留前序研究证据。生产导出器的全局 `BETA_NOT_TARGET_TESTED` / `EXPORTED_NOT_POSTED` 声明没有为了单笔验收而修改；实际提交结果单独记录在 `acceptance-status.json`。

## 原生报表往返：明确未通过

从已入账交易的 More → Transaction journal 打开原生报表。UI 显示 transaction group **145 (2)**，两条 posting lines 与批准文件一致，`Total for 145` 和 `TOTAL` 借贷均为 900.00。

原样下载、未修改的文件：

- `target-posted-journal-145.xls`：交易编辑页 Export to excel 输出，实际为 CDFV2 / 旧 Excel 二进制格式。只有科目、借方、贷方、描述、姓名，没有日期、日记账号或 transaction ID，不足以作为完整往返凭据。
- `target-transaction-journal-145.csv`：原生 Transaction Journal CSV。
- `target-transaction-journal-145.xlsx`：原生 Transaction Journal Excel。

报表 CSV 与 XLSX 的结构一致：第 1–3 行为公司/报表/All Dates，第 5 行表头，第 6 行独立未命名分组列为 `145`，第 7–8 行为两条分录，第 9 行 `Total for 145`，第 10 行 `TOTAL`，第 14 行为导出时间。逐行没有 Transaction ID；报表 Customize 的可选列也未提供该字段。

实际执行 `node --import tsx evidence/quickbooks-acceptance-20261021/check-native-roundtrip.mjs`，使用未经转换的原文件和生产解析器：

1. CSV：显式第 5 行表头、MDY、Account Name → account_full_name。生产解析器把第 6 行分组及第 14 行时间页脚当作待解析记录，均报 `ROW_INVALID: Both debit and credit are blank; an unknown ledger amount cannot become zero.`，原子失败返回 0 行，`verifyProposalInLedger` 返回 false。
2. XLSX：生产解析器报 `XLSX_DATE: Workbook date epoch is invalid or ambiguous.`，返回 0 行，验证 false。
3. 此报表是单交易范围，不是全科目/全期间覆盖，测试未谎称 coverageConfirmed=true。没有人为把 UI 中的 145 写入各行，没有删改原报表，也未绕过验证器。

完整结果：`native-roundtrip-result.json`，可复现脚本：`check-native-roundtrip.mjs`。

### 下一轮工程修复的明确验收标准（本轮未实施）

- 考虑一个**显式选择、严格限定**的 QBO Transaction Journal profile，而非泛化地向下填充任意数字或删除空金额行。真实 UI 的 txnId=145、报表分组 145 和两条分录形成一致证据，可作为这个 profile 的首个真实合成测试夹具；单个样例不足以证明所有 QBO 报表/地区/版本结构一致。
- profile 应验证正确的报表名称与完整列结构；分组 ID 只可在可验证的交易分组边界内传播；要求明确组结尾和控制合计，拒绝孤立行、缺失/重复/交错分组、混合日期/编号、超额分录、截断文件和不平衡组；不得把 journal Num 当作唯一交易 ID。
- 每条标准化分录需同时保留原文件 SHA-256、原 posting 行、原 group 行与位置、映射/profile 版本及推导依据。识别报表页脚必须是严格的已验证结构，不能用“空金额就丢弃”的宽泛规则。
- 往返验证仍须要求精确批准的完整分录、同一可靠交易身份、无多余分录，以及诚实的公司/期间/科目覆盖；单交易报表不能自动升级为完整关账覆盖。
- XLSX 的**待独立复核兼容性线索**：原文件 workbook.xml 同时有标准命名空间 `workbookPr` 和 `x15:workbookPr` 扩展。当前检查似乎去掉命名空间后把两者都计入日期属性，误判重复。应独立最小复现/复核后做 namespace-aware 修复；不能据此放宽真实重复标准 workbookPr、非法 date1904、恶意 XML/ZIP 等安全拒绝条件。
- 测试应包含多个原生合成报表、多交易、多组、不完整组、伪造/冲突 ID、异常 footer、重复 journal Num、额外金额腿，以及 CSV/XLSX 一致性。不得仅针对本单个文件修改解析器以造出通过结果。

## 关键证据

- `target-demo-bank-charges-accounts.png`、`target-demo-asset-account.png`：既有科目和类型。
- `target-mapped-fields.png`：实际六列映射和 MDY。
- `target-ready-one-journal.png`：预检 1 笔。
- `target-import-success.png`：1/1 实际导入成功。
- `target-imported-journal-145.png`：实际两腿、日期、编号、合计。
- `target-transaction-journal-report.png`：原生交易报表。
- `acceptance-status.json`：机器可读最终分阶段状态。
- `acceptance-artifacts-sha256.txt`：原文件/截图/hash 清单。
- `local-export-tests.txt`：7/7 本地导出测试，仅是本地测试，不是实际 QBO 往返通过。

## 尝试时间线（UTC）

- 10:52：首个隔离浏览器停在验证码，尚未获该次验证码许可，未上传。
- 11:06：获得用户明确许可后，先前保留会话已销毁；新会话一次挑战到期，两次 Verify 返回 Please try again。未观察到单独明确的自动访问拒绝。停止反复挑战，保留历史截图。
- 11:20–11:27：正常云 Chromium 浏览器使用同一官方公开 test drive，成功完成已许可验证码，进入 Sample Company，确认原生 Journal Entries 入口及科目。
- 11:32：单次选择纯合成 CSV 的工具调用进入许可/传输等待，后续工具返回 300 秒超时；没有盲目重新上传或提交。
- 11:48–11:49：仅重建浏览器工具的 JavaScript 运行时连接，不重置浏览器/网页。读取同一现有 tab，确认文件早已选中，因此不重传；继续映射和预检。
- 11:49–11:50：一次 Complete import，实际显示 1/1 成功。
- 11:51–11:53：核实实际交易 145 和两腿，下载原生报表。
- 11:54：生产解析器实际回导失败，记录上述兼容性缺口。没有改代码伪造通过。

## 官方环境区别与来源

公开 test drive 是样例公司，官方说明更改不持久保留。本轮已实测其原生 Journal Entries 导入可用：[Test drive and practice using QuickBooks Online](https://quickbooks.intuit.com/learn-support/en-us/help-article/small-business-processes/test-drive-quickbooks-online/L9C12ODlA_US_en_US)。入口：https://qbo.intuit.com/redir/testdrive；Advanced 另有 https://qbo.intuit.com/redir/testdrive_us_advanced，本轮没有测试 Advanced。

Intuit Developer sandbox 是另一种环境。官方 [Sandbox FAQ](https://static.developer.intuit.com/output_html/qbo/docs/develop/sandboxes/sandbox-faqs.html) 明确写其不支持导入/导出数据，不能把 API JournalEntry 成功当作 CSV UI 导入成功。没有因此创建开发者账号或获取凭据。

官方美国版 [Import journal entries](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US) 给出字段和导入步骤；本次结论仅适用于已观察的这个公开样例目标和这笔纯合成记录。

**未验收范围：原生 CSV/XLSX 生产回导、完整清算归零/关账、真实客户账套、QBD IIF、其他地区/套餐、重复导入幂等性、生产发布。** 没有在目标重复导入来测试幂等性，未知结果必须保持未知。
