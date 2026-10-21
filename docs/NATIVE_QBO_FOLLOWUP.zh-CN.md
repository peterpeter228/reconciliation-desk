# QuickBooks 原生报表后续修复

## 本轮成果

- 新增显式选择的 QBO Transaction Journal CSV 配置，不自动把普通账簿当作该格式。要求核对报表打印的公司名，验证交易分组、逐行金额、组小计、总计与页脚。
- 未改动的官方样例 CSV 能识别交易 145 的两条分录，并与已批准的合成 $900 日记账精确匹配。交易 ID 来自原生分组行，不是手填或拿日记账号冒充。
- 精确单笔匹配不等于整期覆盖、清算余额归零或真实客户关账；旧整期验证仍然拒绝事务范围证据。
- 修复 CSV 文本与原始字节不一致的来源绑定问题，以及删除可选证明字段后误提升覆盖范围的路径。
- 修复标准 workbookPr 与 x15 扩展混淆的兼容问题；恶意命名空间、重复标准属性和日期别名仍被拒绝。原始 QBO XLSX 含小计公式，因此仍被安全拒绝，不能称为 XLSX 原生回导通过。
- 完整自动测试 529 项通过，类型、格式、构建和静态产物检查通过。测试数不构成安全认证。

## 证据

- [原生 CSV 精确匹配结果](../evidence/quickbooks-acceptance-20261021/native-profile-roundtrip-result.json)
- [配置与范围合同](QBO_TRANSACTION_JOURNAL_PROFILE.md)
- [独立反例测试](../tests/qbo-roundtrip-adversarial/README.md)
- [XLSX 兼容性与安全复核](../tests/qbo-xlsx/README.md)
- [本轮执行记录](../evidence/qbo-native-profile-20261021/)

真实浏览器新配置回归和外部 Argon 调用状态分别记录；不能沿用旧测试或旧外部审查的成功来代替本轮结论。

本轮 Argon 请求在工具安全检查阶段受阻，未取得可验证的审查结果；远端是否收到请求及计费未知，未重试。详见 evidence/argon-native-profile-20261021。

后续 13:06 UTC 的用户明确重试已成功返回 Argon 审查，并独立核实修复成立项；此前请求的远端接收/费用仍未知。[查看最新取舍与验证](ARGON_OWNER_REVIEW_TRIAGE_20261021.md)。
