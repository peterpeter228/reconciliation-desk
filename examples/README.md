# 示例文件的使用范围

这里的 QBO CSV 和 QBD IIF 仅用于审查格式和测试公司副本。
**全部是合成示例，不要导入真实客户账套。** 本包未实际连接或操作 QuickBooks。

`fee_case_evidence.json` 单独定义10,000毛收款、9,100净到账、900已证实净扣费用，
并列出已经过账的银行/clearing完整分录。这是独立教学案例，不是主350事件样本
已经获得全部账簿凭证的结果。`Demo Reviewer` 是合成批准人。

`sample_qbo_fee_only.csv` 只有借费用900、贷普通资产clearing900；没有再次借银行。
`sample_qbd_fee_only.iif` 使用真实TAB和CRLF。目标美国Windows QBD版本试导仍待验。
`fee_case_approved_proposal.json` 展示source hash、case approval hash和最终payload hash。

`support_escalation_sample.pdf` 使用samples中的独立支付修正记录展示证据工单；
它不把非现金应用修正当作现金退款，不把未知的QB对象差异称为ST系统Bug。

`benchmark_reference.json` 仅是Python参考组件的实测，明确不包含完整浏览器三方引擎。
