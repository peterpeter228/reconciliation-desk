# 按证据批量关联与 UNKNOWN 恢复原型

日期：2026-10-22。全部夹具、示例、日志仅使用合成数据。无 QBO 写入、客户账簿、网络传输或部署。

## 1. 已实现：显式交易清单批量关联

入口：案例复核 → Review facts → Other fee / clearing transactions → Associate an explicit transaction list by evidence。

1. 先复核原始凭据与每笔交易，并填写复核人。
2. 从已导入源文件或已附支持文档选择一个 SHA-256，界面展示文件名和完整摘要。
3. 选择一个不同的、身份已 BOUND 的经济案例。
4. 明确输入交易 ID，一行一个。没有全选、按金额推荐或自动扩展清单。
5. 点击 Apply reviewed OTHER_CASE list。原子校验全部成功后才写入现有 relations；任意一条失败则全部不变。

每个批次限制为同一证据、同一其他案例。每条持久化关系包含 transactionId、OTHER_CASE、relatedCaseId、evidenceRef（完整哈希）、reviewer。现有项目格式可保存这些关系，不引入另一套批准状态。修改关系仍通过已有 update 删除旧 proposal，必须重新构建、批准。

校验拒绝：空/重复清单、未知哈希、虚构/当前/不确定案例、交易不属于选定案例、当前案例任意交易、缺复核人、覆盖已有不同判断。UNKNOWN 关系可被显式新判断替换，其他冲突必须逐笔处理。重复相同批次不增加重复关系。

批量功能不是证据认证。仅知道文件哈希不证明该文件内容真的支持关系；人必须读证据。已有 proposalFromCase 仍重新检查实际案例、已知哈希、完整账簿、导入历史、金额和会计条件。没有删除账簿行、推算费用、改变阻断或解锁导出。

## 2. Verified：合成全月操作测量

执行：

`BATCH_MEASUREMENT_OUTPUT=evidence/dot-followup-20261022/batch/month-operations.json npx vitest run tests/dot-batch-review/month-ui.test.tsx`

受控合成全月夹具：10 个其他案例，每案 6 个交易，共 60 个。基础案例经真实 parser/engine 建立；额外月份案例/交易为测试人为构造，**不宣称对这些扩展交易完成真实引擎关联或账簿完整性验收**。

旧逐笔表单：每笔关系选择、其他案例 ID、证据引用各一个 change，60 × 3 = 180 次。

新批次表单：每批证据选择、案例选择、显式清单输入各一个 change，加一个应用 click，10 × 4 = 40 次。测量保守计入每批重新选择证据，即使 UI 保留上批值。节省 140 次（77.8%）表单操作。

测试实际向 React 表单发送这些事件并断言两种方式生成相同的 60 条关系，所有输入账簿、导出历史、导入状态不变。

此为 **jsdom 表单事件次数**，不是实际浏览器、原生文件选择器、人工计时或真实客户工时。一次 textarea 粘贴按一次事件计算；不包含双方共同需要的交易列表准备、凭据阅读、文件附加、复核人填写、展开面板。六笔相同目标的假设会影响收益：单笔一批并不一定更快，不承诺任意全月都节省 77.8%。证据见 month-operations.json、month-ui.log。

## 3. UNKNOWN：仅设计与隔离原型，不接入生产出口

src/review/unknown-recovery.ts 是纯函数 sidecar 原型。生产 UI、导出适配器、项目 importStatus 没有调用它，也没有导出重试按钮。

输入：已有 UNKNOWN 案例及其完整 exportHistory；指定已存在的 journalId；复核人；检查时间；实际 GL 报表 SHA-256（必须在调用者已附 GL 哈希清单中）；FOUND/NOT_FOUND；检查范围和方法。

输出：带 economicCaseId、accountingActionId、完整导出历史摘要的独立复核记录；history 只追加。后续相反判断也保留旧记录，不覆盖。原 review 对象、所有导出历史和 UNKNOWN 状态保持不变。输出固定 accountingExportAllowed=false、sameJournalRedownload=OWNER_POLICY_DECISION_REQUIRED。

检查结果解释：

- FOUND：只记录复核人声称找到日志号，不自动设置 IMPORTED。须检查精确科目、日期、金额、行完整性以及是否存在部分导入/冲销。
- NOT_FOUND：仅代表给定时间与报告范围内未找到，不证明从未导入。GL 日期范围、筛选、公司、导入后变更都会影响判断。
- 两种结果都继续阻断。历史摘要是变更检测，不是签名认证；无真实账簿验证声明。

未来 UI 草案：已有导出提示下面显示日志号列表 → 附加本地 GL 并计算字节摘要 → 显示报告期间/筛选复核问题 → 复核人明确选找到/未找到 → 写检查方法与检查时间 → 保存独立复核底稿 → 展示全部历史。底稿必须与导出/manifest/原账簿一并保留。此草案本轮未接入应用。

**待 owner 单独决定的会计策略**：NOT_FOUND 后是否可以重新下载同一 journalId 的完全相同原始文件。若将来批准，还必须定义原文件及 manifest 保存、字节一致性、检查报告范围/时效、多标签页/设备行为、再次操作审计；绝不生成第二个日志号或重建不同 payload。当前没有保存原始导出字节的恢复路径，因此本轮不提供重新下载。决策前停止在可复核原型。

## 4. 回归与限制

`npx vitest run tests/dot-batch-review`：批量原子性/拒绝变体、UNKNOWN 侧录/历史保护、生产 proposal 阻断、React 全月操作对比。真实执行输出在 evidence/dot-followup-20261022/batch/。

typecheck.log 保存第一次全仓检查结果，包含另一个并行测试文件的中间编译错误，不把它标为通过；最终全仓验收以主复核日志为准。

实现未修改 case-adapter、共享 ReviewCase 类型或任何出口状态机。没有声称真实浏览器批量流程已验证。本轮另在案例 UI 附加 HTML 财务信息隐私提示，并修正本地重复导出保护的绝对保证用语：公司标签、无锁浏览器、站点数据清除和其他设备仍有剩余风险。
