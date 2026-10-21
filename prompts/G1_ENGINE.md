# G1 4.5 小时 核心引擎和 CLI

## 目标

实现可运行TypeScript pure engine与CLI，读三份CSV及可选增强证据，输出
run JSON、三方分组、缺证据列表、逐账户控制总表。参考Python是行为参考，
不要在生产浏览器调用Python，也不要把测试答案当引擎输入。

## 执行步骤

1. 建Vite/TypeScript最简工程，固定依赖与lockfile；创建Zod runtime schemas。
2. 把CSV表头、manifest、整数钱、日期和row grain normalize做成纯函数。
   只先支持samples中的显式profiles，再加官方常见aliases和人工映射。
3. 实现Pass0质量门，输出excluded/invalid rows，不静默丢行。
4. Pass1分别构建ST→QB receipt、QB→bank、ST/processor→bank证据边。
   对汇总JE用完整batch成员求和，不能凭invoice total补收款。
5. Pass2费率仅候选；optional processor证据才确认fee mode和fee amount。
6. Pass3移植bounded subset，保留两解、CARDINALITY_CAP、TIMEOUT和全局冲突。
7. Pass4按六类规则+UNKNOWN多标签诊断，分数不是概率。
8. 实现逐账户rollforward与行级allocation守恒；人工override不可突破金额上限。

## 必须通过的测试

- 20k无银行在minimal-three中不是CONFIRMED_HOLD；加对应statement后才确认。
- 50k没有manifest/external receipt时不声称全匹配；加证据后3150fee仅来自融资部分。
- 同金额不同付款、同invoice多payment、退款与非现金correction不会重复计数。
- 八成员上限不能漏掉九个小额组成的替代解后声称唯一。
- 未匹配ST+bank成功但QB缺失不叫三方MATCHED。
- 一条QB batch summary不能被多个匹配组重复全额使用。
- 输入排序变化不影响确定性结果；唯一性的证明范围可审查。

## 输出

CLI命令如 `pnpm reconcile --st ... --qb ... --bank ... --profile demo.json`；
JSON schema及真实输出；独立golden assertions（由tests读取答案）；
运行时间与未支持模式说明。G1通过后继续G2。
