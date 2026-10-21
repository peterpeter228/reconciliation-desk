# Reconciliation Desk 工程开发包

本包把 ServiceTitan、QuickBooks Online/Desktop、银行三方存款对账需求转化为
可以交给 Cursor / Claude Code 执行的工程 PRD、算法规格、数据契约、阶段指令和
可运行合成样本。研究基准日：2026-10-21。

**交付是工程规格与已测试参考组件，不是已经上线的 SaaS。** 原始真实账簿、
目标QBO账号导入、QBD真机和完整浏览器性能仍需在18小时实施阶段核验。

## 先看这些文件

| 文件 | 用途 |
|---|---|
| docs/PRD_ENGINEERING.zh-CN.md | 六模块主PRD、数据模型、UI、会计门、技术栈、18h计划、60秒演示 |
| docs/ALGORITHM_SPEC.zh-CN.md | Waterfall流水线、三条边、冲突与allocation、六类状态机和伪代码 |
| docs/ACCOUNTING_EXPORT_SPEC.zh-CN.md | 10k/9.1k费用AJE的状态分支、UF专用流程、QBO CSV与QBD IIF |
| docs/SOURCES_AND_EXPORT_PROFILES.zh-CN.md | 44条编号来源、实际报表字段、银行模板待验范围和事实纠偏 |
| docs/synthetic_contract.md | 350个经济收款事件的定义、精确金额、证据强弱和测试答案契约 |
| contracts/canonical.ts | 三张核心表及provenance、import manifest、reconciliation group |
| contracts/header_mapping.schema.json | 受约束的LLM表头映射JSON，不允许可执行表达式 |
| reference/core.py | 整数金额、有界subset、fee候选、带审批hash的fee-only导出 |
| scripts/generate_synthetic.py | 完整标准库Python生成器 |
| prompts/START_HERE.md | 交给开发AI的第一条指令，后续按G1-G4执行 |
| examples/ | 可检查的QBO/IIF文件、独立教学案例证据、两页支持PDF、性能记录 |
| docs/VALIDATION_REPORT.md | 本包实际执行的验证和明确尚未执行的产品验收 |

## 五分钟运行

Python 3.10+，核心生成器和测试不需要安装依赖。在本目录运行：

```bash
python3 scripts/generate_synthetic.py --out samples --seed 20261021
python3 -m unittest discover -s tests -v
python3 scripts/benchmark_reference.py --out examples/benchmark_reference.json
```

Windows可用`py`替代`python3`。生成器会替换目标目录内同名fixture文件，
请使用专门的samples目录，不要指向真实客户文件目录。

重建可选PDF/示例需安装reportlab后执行`python3 scripts/build_example_exports.py`。
PDF使用reportlab自带字体；它是独立模板，没有发送给ServiceTitan。

## 已生成样本

350个原始经济收款事件，毛收款精确250,000美元；297正常、53异常，
比例84.857%/15.143%（350×85%=297.5，无法精确分成整数）。

三个主文件：`samples/st_export.csv`359行、`samples/qbo_clearing_gl.csv`338行、
`samples/chase_bank.csv`140行。源文件行数、收入、毛收款和银行净额不是同一口径。
另外包含processor、audit、external receipts、next-period bank、deposit components
五种增强CSV。答案位于`ground_truth_answer_key.json`，严禁进生产引擎或bundle。

20k未到账只有加processor Hold证据才能确诊冻结。50k归集案例的四个净额组成是
18,200+13,650+12,000+6,150；融资净扣3,150只属于两个融资部分。它是有manifest
支持的合成归集压力场景，不是把GreenSky ACH与支票天然视为一笔银行流水。
纯三文件不得凭答案推导6,150外部支票。

本fixture仍缺完整QB银行/费用科目证据。12个费用案例共3,518.72只表示数学
底稿已就绪；所有案例的fee_aje_draft_eligible=false，补齐证据后才能进入草稿与审批。
独立900美元教学示例在examples中有
明示的完整既存分录和虚构Reviewer批准，与主样本分开。

## 推荐实施方式

把整个目录交给Cursor/Claude Code，粘贴prompts/START_HERE.md。
先G1引擎，再G2界面与导出，最后G3反例/隐私/性能和G4部署。
完整应用选择React+TypeScript+Vite、浏览器Web Worker、Cloudflare静态托管。
先卖199美元单公司单月人工复核诊断服务；订阅和云多租户在真实案例验证后开放。

关键约束：LLM只映射表头；普通clearing和UF分流；手续费区间不等于证据；
缺记录不等于Hold；匹配有歧义必须保留；任何调整改科目/日期/金额都要重新批准。
产品不连接或回写财务系统，导出后由客户复核导入，并重新读取GL验证结果。
