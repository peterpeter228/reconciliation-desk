# QuickBooks CSV 实际导入验收：本轮记录

核验日：2026-10-21。状态：**尚未通过目标 QuickBooks 导入验收，不是上线证明。**

## 已完成

- 阅读生产导出器 `src/export/qbo.ts`、批准与账簿复核逻辑 `src/export/aje.ts`，以及会计导出规格。
- 从现有生产导出函数生成一个纯合成、两行、借贷各 USD 900.00 的 fee-only CSV，未修改生产代码。
- 实际执行 `npm test -- tests/import-export/exports.test.ts`：1 个测试文件、7 个测试通过。完整输出见 `local-export-tests.txt`。这些是本地导出/拒绝条件测试，不是 QuickBooks 接受证明。
- 真实云浏览器打开官方美国版公开试用入口，停在 Security Verification / reCAPTCHA；Continue 按钮禁用。未点击或解决验证码，未登录、上传或写账。截图见 `testdrive-security-verification.png`。
- 当前可检索插件中没有找到 QuickBooks；现有浏览器配置没有记录已登录站点；一次限定 Intuit/QuickBooks/sandbox 的已连接邮箱搜索没有命中。这不证明用户没有账号，只说明当前未核实可用测试账套访问权。

## 精确阻塞

访问入口：https://qbo.intuit.com/redir/testdrive

实际停止地址：https://qbo.intuit.com/api/samplecompany/validated?SKU=7&bc=QBP-T39

页面标题：QuickBooks Online Security Verification。

还没看到公司首页、科目表、Import Data 或 Journal Entries 入口，因此不能声称当前公开试用支持或不支持 CSV 日记账导入。继续之前需要处理验证码的许可。即使进入后，也必须确认这是公开样例公司，而非用户真实账套。

## 三种环境不要混淆

1. **公开 test drive**：Intuit 官方说明它是样例公司；更改不会持久保留。普通入口为 Plus，另有 Advanced 入口。它是优先尝试的无订阅验收路径，但本轮被验证码挡住，还未核实实际导入/报表导出功能。[1]
2. **Intuit Developer sandbox**：官方 Sandbox FAQ 明确说明不支持向 sandbox 导入或从 sandbox 导出数据。因此，建立开发者账号或通过 API 创建 JournalEntry 不能证明本项目 CSV 文件能够被目标 UI 导入，也不能替代 CSV → QBO → GL 的往返验收。[2]
3. **专用非生产 QBO 公司/试用账套**：若公开样例缺少导入或报表导出，需由用户提供或另行授权创建独立测试账套，并核验地区、套餐和当前导入入口。试用不是自动授权订阅或接受金融账户协议，本轮没有创建或付费。不能改用真实客户公司做这项测试。

官方美国版日记账导入文档当前更新于 2026-08-04，列出本项目的六个字段和 Settings → Import Data → Journal Entries 流程；实际可用性仍应在目标产品/地区/UI 核验。[3]

## 合成材料

- `SYNTHETIC_DO_NOT_IMPORT_RD1E1BAA9EFD_BETA_NOT_POSTED.csv`
- `synthetic-proposal.json`
- `synthetic-export-manifest.json`
- `source-sha256.txt`

CSV SHA-256：`b35b6330925fb437635584429041179ff52c3d1c820623c8800780706d44e5d7`

两行内容：Merchant Financing Fees 借方 900.00；ServiceTitan Clearing 贷方 900.00。日记账号 RD1E1BAA9EFD；日期 09/30/2026；备注明确写明纯合成、不得导入真实账簿。没有银行借方。生成者名称仅标识测试程序，不构成会计批准。

合成 proposal 中的 10,000 收款和 9,100 银行净额属于本地教学前提，不是当前 QBO 中存在这些交易的证据。本次只导入 fee-only CSV 即使成功，也只能验证文件格式和两行会计记录；不能据此声称清算余额已归零或完成实际三方对账。

## 待执行的最小实际验收

以下均为计划，未标记通过：

1. 进入已确认隔离的美国版样例/专用测试公司；记录公司身份、地区、套餐、日期格式和浏览器版本。任何真实公司或不确定公司都停止。
2. 确认 Import Data → Journal Entries 可见，下载该目标 UI 的官方 CSV 样例。若入口不存在，记录截图并停止，不悄悄安装第三方导入器。
3. 核实目标科目表中存在费用科目及普通流动资产 clearing 科目，且 clearing 不是 Undeposited Funds。当前 CSV 的名称不可假定存在。如需匹配测试账套，必须在合成 FeeCase 中明确映射后重新生成/批准并保留新 hash，不在批准后手改 CSV。
4. 在已获授权的隔离测试公司中上传该纯合成 CSV；明确映射六列并选择 MM/DD/YYYY。保留预览、错误及成功计数证据。若 UI 要求更改设置/新建科目，先确认范围；不关闭重复号码保护来强行通过。
5. 仅在预览正确且目标公司已确认后执行一次导入。记录成功/失败数及实际交易 ID。状态不明或部分成功时先核对已有账簿，不能整包重试。
6. 在 QBO 打开该日记账，核对日期、编号、两个完整科目名称、借贷各 900.00 和备注；验证没有新增银行借方、错误科目或额外分录。
7. 从 QBO 导出真实目标 GL/Transaction Journal 报告并保留原文件。使用生产解析器重导，确认同一真实 transaction ID 下的全部 posting lines 与批准 payload 完全一致。若报表不提供可核实共同 transaction ID，当前验证器应拒绝通过，不能人为编造该字段。
8. 记录实际验证范围为该 QBO 地区/套餐/导入界面和这笔纯合成记录。QBD IIF、其他地区、真实客户账套和部署均不因此通过。

## 官方来源

[1] Test drive and practice using QuickBooks Online（2026-08-05 更新）：https://quickbooks.intuit.com/learn-support/en-us/help-article/small-business-processes/test-drive-quickbooks-online/L9C12ODlA_US_en_US

美国 Plus：https://qbo.intuit.com/redir/testdrive

美国 Advanced：https://qbo.intuit.com/redir/testdrive_us_advanced

[2] Intuit Sandbox FAQ（官方静态文档，本轮已读取）：https://static.developer.intuit.com/output_html/qbo/docs/develop/sandboxes/sandbox-faqs.html

动态入口仅返回加载壳：https://developer.intuit.com/app/developer/qbo/docs/develop/sandboxes/sandbox-faqs

[3] Import journal entries（2026-08-04 更新）：https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US

## 明确未执行

未创建账号或沙盒、未申请试用/订阅、未使用 API key 或 OAuth、未读取真实客户账簿、未上传任何数据至 QBO、未创建或更改真实会计交易、未完成 QBO 导入或 GL 往返验收。`BETA_NOT_TARGET_TESTED` 与 `EXPORTED_NOT_POSTED` 保持不变。
