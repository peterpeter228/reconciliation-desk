# 交付验证记录

验证日期：2026-10-21。验证对象：本开发包内的 Python 参考组件、生成器、示例文件和规格一致性。

**本记录不代表完整 SaaS、浏览器匹配引擎或目标 QuickBooks 账套已通过生产验收。** 未执行项目在文末逐项列出；G1–G4 的验收必须使用实施后的真实结果替换。

## 1. 已执行的自动化测试

环境：Python 3.12.14，Linux x86_64，AMD EPYC 9V74 80-Core Processor。

命令：

```bash
python3 -m unittest discover -s tests -v
```

最终结果：**33 tests / 0 failures / 0 errors，耗时 0.163 秒**。

| 测试文件 | 数量 | 实际覆盖 |
|---|---:|---|
| `tests/test_core.py` | 10 | 严格整数美分、营业日、枚举小集合的交叉校验、歧义、候选边界、费率只作假设、AJE平衡、审批绑定 |
| `tests/test_core_review.py` | 10 | 独立反例：9笔以上截断不能冒充唯一/无解、0 cent容差、空分录、不平分录、借贷负数、同一行双边、公式文本、未批准导出 |
| `tests/test_synthetic.py` | 13 | 350事件与250k、297/53、六场景、GL和银行控制量、20k Hold证据门、50k混合清单、批次汇总粒度、退款/非现金修正、固定种子、源行hash、答案隔离、活动关联不冒充三方核实 |

导出反例不只测试“缺审批hash”；测试先创建合法批准数据，再修改其内容并重算完整性hash，确认serializer仍独立拒绝违反会计和文本规则的输入。hash不是授权凭证或数字签名。

上述33项是参考组件和fixture测试。完整Pass 0–4引擎的验收用例列于 `ALGORITHM_SPEC.zh-CN.md` 第11节；那些用例尚未全部实现或运行，不能把33项写成完整产品准确率。

## 2. 默认合成数据的实际控制量

生成命令：

```bash
python3 scripts/generate_synthetic.py --out samples --seed 20261021
```

虚构公司 Cedar Ridge Home Services LLC；期间2026-09；USD；350个正向经济收款事件。

| 控制量 | 实际值 |
|---|---:|
| 原始毛收款 | $250,000.00 |
| 正常 / 异常事件 | 297 / 53 |
| ST / QB clearing / bank 主文件数据行 | 359 / 338 / 140 |
| Clearing期初借方余额 | $0.00 |
| Clearing借方发生额 | $242,360.14 |
| Clearing贷方发生额 | $219,755.12 |
| Clearing期末借方余额 | $22,605.02 |
| 银行期初 | $42,500.00 |
| 银行收款credit | $217,191.95 |
| 银行退款debit | $1,543.26 |
| 银行期末 | $258,148.69 |
| ST展平报表有符号合计 | $239,972.92 |

Clearing残差分解：

```text
4,639.66 在途
+ 22,086.50 明示hold（增强证据模式）
+ 3,518.72 待核实费用记账
- 7,639.86 尚未录ST的外部收款
= 22,605.02
```

ST有符号总额包含独立负向退款和非现金应用修正，不能当作收入或真实现金净流入。单一clearing科目文件也不要求全文件借贷相等。

经典大额案例：一笔$20,000收款在本期银行缺失；添加provider的HELD记录后才允许确认冻结。$50,000归集行由18,200+13,650+12,000+6,150组成；两笔融资毛额35,000、指定合成合同净扣3,150。四项成员需由清单证明，不能根据答案偷偷补齐6,150。

现有增强CSV仍缺QB银行腿、完整费用账户覆盖和会计逐项确认。12项费用合计3,518.72只有 `fee_proposal_math_ready=true`；全部 `fee_aje_draft_eligible=false`。8项post-export样本证明独立应用修正的时序，尚未证明对应QB对象的必要会计影响。退款样本也保留相关QB退款过账状态未知。

## 3. 已执行的参考性能测量

命令：

```bash
python3 scripts/benchmark_reference.py --out examples/benchmark_reference.json
```

每项40次warm测量；原始记录在 `examples/benchmark_reference.json`。

| 实际工作负载 | p50 | p95 | 结果解释 |
|---|---:|---:|---|
| 3,000行身份索引构建 | 0.780 ms | 1.041 ms | 只测索引，不含解析/全局匹配 |
| 28候选MITM有界搜索 | 25.162 ms | 30.758 ms | 40次均CARDINALITY_CAP，未声称穷尽所有基数 |
| 28候选多解搜索 | 1.990 ms | 2.579 ms | 40次均AMBIGUOUS，两解即可证明歧义 |

直接把3,000项送入单个subset调用，0.458ms返回 `CANDIDATE_CAP`、`complete_search=false`，并未求解整个3,000项子集问题。

**未测：** 浏览器Worker内3,000行完整流水线p95<500ms、文件解析、LLM网络、PDF导出、全局冲突图及真实客户数据。500ms仍为G3目标。不能以快速拒绝、大量截断或Python局部函数速度冒充高覆盖完整对账性能。

## 4. 示例和文档核查

- 5个JSON文件均可由Python标准库解析；这不等于所有运行时JSON Schema约束均已验收。
- 独立$10,000/$9,100/$900教学案例已通过当前 `validate_approved_aje`；QBO CSV和QBD IIF字节与当前serializer输出完全一致。
- 示例只补 `Dr Merchant Financing Fees 900 / Cr ServiceTitan Clearing 900`，没有重复借记银行。已有银行入账、未记费用、账户类型、期间和虚构审批均写在 `fee_case_evidence.json`。
- 两页 `support_escalation_sample.pdf` 已渲染为PNG并逐页检查。字体已嵌入，表格、金额、行号和页脚清晰，无溢出或截断。所有内容为合成数据，没有发送给ST。
- PRD、算法规格、canonical contract与fixture契约已交叉检查：CARDINALITY_CAP、PARTIAL/ACTIVITY_BRIDGE、全payload审批、三方过账缺证据和post-export会计影响门一致。
- 来源附录包含44个编号来源及官方字段/模式的适用边界。银行profile与合成CSV均未标称真实客户导出或厂商认证。

## 5. 明确尚未执行的产品验收

| 项目 | 当前状态 | 实施时的通过条件 |
|---|---|---|
| 完整CSV/XLSX解析器与表头映射 | 规格已写，应用未实现 | 真实报表/重复表头/日期/符号/粒度/控制量测试通过 |
| TypeScript typecheck | 未运行；本环境未提供TypeScript编译器 | 项目安装依赖后 `tsc --noEmit` 与lint通过 |
| JSON Schema标准验证器 | 未运行；本环境无jsonschema包 | 在应用使用Zod/Ajv等执行约束及语义复核 |
| Pass 0–4完整三方引擎 | 伪代码与参考组件已交付 | 不加载answer key，按证据等级执行golden/property测试 |
| 真实QBO CSV导入 | 未执行 | 目标美国账套导入、检查科目/借贷、重新导出GL核验 |
| 真实QBD IIF导入 | 未执行 | 目标版本测试公司备份后导入、检查失败文件与GL |
| UF业务对象清理 | 未执行 | 原payments在正确Bank Deposit中被选择，挂账对象实际移除 |
| 浏览器UI/E2E/500ms | 未执行 | G2/G3真浏览器操作、实际硬件记录、未决率与错接受率一起报告 |
| LLM 2秒与成本 | 未执行 | 部署账户20组脱敏样本实测；超时/manual fallback可用 |
| Stripe付款与上线 | 仅规格/流程 | 测试付款验证、人工履约路径、真实部署和回滚烟测 |
| 实际簿记工作效率/付费意愿 | 未验证 | 授权试点月份前后耗时、错误数与真实付款记录 |

对应未验证项保持Beta或底稿交付模式，不得写成已上线、已通过GAAP认证、已兼容全部QBO/QBD版本或已找回款项。
