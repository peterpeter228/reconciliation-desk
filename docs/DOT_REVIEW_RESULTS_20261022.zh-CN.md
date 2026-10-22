# Reconciliation Desk：独立复核与继续开发结论

日期：2026-10-22。审查对象 `review/claude-code-independent-20261022`，重新读取到 `7b479631cd4ceaede355d825818b78a04b7f13c3`，不是仅依赖交接中 `d5964ce`。基线 `42d677e9e983a05629ef24d1018562ba9a812221`。交付独立分支 `review/dot-followup-20261022`；没有合并 main。

## 结论范围

这是源码、合成数据、本地浏览器和技术证据的复核，不是会计审计或商业验证。没有连接会计/银行账户，没有对外联系、真实客户账簿、QBO/QBD 写入、部署或付费模型调用。UNKNOWN 恢复只是未接入生产的审查原型，现有阻断仍保留。

当前结论：Claude Code 的主体修复有价值，但不能无条件背书。F01/F02/F03/F04/F05/F07/F08/F09 需要本轮补充后合并；F06 核心保守 guard 可合并，另补导入字段校验；F10 可合并：既有静态变异，又在基线真实浏览器独立复现默认 favicon 请求 404。

## 1. F01–F10 的 A–D 决定

详细文件行号、具名测试、原始红/恢复绿输出和反例分别见 [来源与会计 guard 复核](DOT_SOURCE_REVIEW.md) 和 [工作区与导出复核](DOT_UI_REVIEW.md)。这些文档是本报告证据索引，不用测试数量替代结论。

| 项目 | A：42d677e 基线 | B：独立变异 | C：关键复核与修改 | D |
|---|---|---|---|---|
| F01 来源重验证 | 合成篡改/来源验证缺口复现 | 撤关键验证，具名测试红；恢复绿 | 同哈希不同 parseOptions、文件改名、demo/真实转换、补证继承；增加会话上下文绑定。不把领域状态构造说成已证实 UI 攻击 | 修改后合并 |
| F02 替换确认 | 未保存工作替换缺确认复现 | 撤 guard，pending 测试红→绿 | 修复提前 resolve；连续请求先 settle 被替代者；取消不动原工作 | 修改后合并 |
| F03 已导出纠错提示 | 基线缺查日志号/新 GL 路径 | 删除关键提示红→绿 | 保留先查账路径，撤销“绝对不会第二份”的表述；未开放 UNKNOWN 重下载 | 修改后合并 |
| F04 UF 冲突 | 合成费用/关系反例复现 | 撤冲突检查红→绿 | 无关银行行不误挡；OTHER_CASE 需要已知证据哈希、现有其他 BOUND 案例及交易成员；不能排除本案交易 | 修改后合并 |
| F05 映射摘要 | 多文件版本字符串超限复现 | 撤摘要红→绿 | 原摘要仅绑定版本集合，不唯一绑定每份来源；增加逐来源哈希、kind、映射、解析配置、行级 provenance 绑定，旧批准失效 | 修改后合并 |
| F06 银行边 | SUPPORTED 不足以确认结算复现 | 撤 CONFIRMED guard 红→绿 | 实际银行腿/逐项会计确认可达 CONFIRMED；单纯 clearing 语义 SUPPORTED 正确保守阻断；新增同名 clearing/bank 导入拒绝 | 核心合并，配合新增校验 |
| F07 未保存保护 | 无 beforeunload 复现 | 撤 listener 红→绿 | 撤销替换后仍 dirty；Promise 生命周期补全 | 修改后合并 |
| F08 本地防重 | 旧测试被 F05 干扰；隔离单映射后真实复现缺登记阻断 | 撤 existing 判定红→绿 | 明示精确公司标签、大小写/拼写、Web Locks、存储清除及跨设备局限；不静默合并不同公司身份 | 修改后合并 |
| F09 HTML 摘要 | 基线无摘要入口；不是基线 XSS 复现 | 撤转义，恶意合成字段测试红→绿 | 转义/CSP 未发现绕过；新增摘要内及入口财务信息提醒 | 修改后合并 |
| F10 favicon | 静态缺图标声明及真实浏览器默认 favicon 404 均复现 | 撤 data 图标具名测试红→绿 | `browser/f10-baseline/baseline-browser.json` 保存实际请求错误；最终应用无该错误 | 合并 |

B 的全部十项结果：`evidence/dot-followup-20261022/{source-review,ui-review}/mutation-results.json`。变异在隔离副本进行，未把变异后的源码作为交付。

## 2. 独立重跑与差异

证据根目录：`evidence/dot-followup-20261022/`。

### Verified：原 Claude 快照

- 新环境 `npm ci --ignore-scripts --cache /tmp/reconciliation-npm-cache` 成功。第一次默认 npm cache 位置不可写，已改临时 cache；没有改依赖版本、执行安装脚本或降低沙箱。
- 对未修改的 7b47963 独立运行 typecheck、720 项 Vitest、33 项 Python reference、build、format、artifacts，全部通过，见 `integration/claude-snapshot-checks.txt`。
- 真实浏览器原 29 项检查：28 PASS，1 项下载 HTML 的 `file://` 打开被浏览器管理员策略阻止。已下载 HTML 的内容断言通过，但渲染不记通过，也没有绕过策略重新托管该文件。
- 实际下载 CSV SHA-256 完全符合旧记录：`b2db0b58fab32b688fdc7a4c6c456808a1aa98a87ad866d39290ebb73d118d49`。manifest 含时间，不要求字节一致。

### 最终集成验收

| 检查 | 实际结果 | 证据 |
|---|---|---|
| typecheck / build | PASS；最终打印修复后构建退出 0 | `integration/build-print.txt` |
| Vitest | **784/784，44 文件 PASS** | `integration/final-vitest-print.txt` |
| Python reference | **33/33 PASS** | `integration/reference.txt` |
| format / artifact | PASS，退出 0 | `integration/{format-final,artifacts-final}.txt` |
| 原 29 浏览器检查 | 原快照及修复后均 **28 PASS + 1 policy FAIL/BLOCKED**，非 29/29 | `browser/{claude-snapshot,final}/browser-results.json` |
| 实际下载 | 两次 CSV SHA 精确相同且匹配期望；源映射加固未改变这笔确定性分录 | `browser/final/export-sha256.txt` 与实际 CSV |
| 扩展功能矩阵 | **34 PASS / 1 policy FAIL / 1 screen-reader BLOCKED** | [完整矩阵](DOT_BROWSER_REVIEW.md) |
| 两真实标签页并发 | PASS，同一案例仅一个 tab 下载 CSV + manifest | `browser/final/concurrent-tab*.png` 及实际下载文件 |
| 键盘完整导入 | Tab + **Space** 文件按钮激活 PASS；Enter-only 第二个 QB picker 变体 FAIL，根因未确定 | `browser/keyboard-space/`、`browser/supplement/run.log` |
| UF 实际 UI | CANDIDATE → REVIEWED_INSTRUCTIONS，`importEligible:false` | `browser/final/uf-{candidate,reviewed}.json` |
| 原生 GL 引导 | 原生与补列两次实际解析、结果、截图均完成 | [带截图步骤](DOT_NATIVE_GL_AND_COMMERCIAL.md) |
| 打印/PDF | 先视觉 FAIL，print-only 修复后具名实际检查及两页视觉复验 PASS | `browser/print-after-fix/` |
| 应用网络/console | 观察到的页面请求仅 127.0.0.1，应用 console 无错误；不是操作系统全流量审计 | `browser/final/browser-results.json` |

最终一行 print-only CSS 修改后重跑了全 784 单元/组件测试、构建、格式、产物和定向实际打印；**没有冒称再次执行全 36 浏览器矩阵**。FileChooser.setFiles 用于已由可见控件触发的原生选择器文件选择，不是手工 OS 对话框键入证明。原生 OS 打印对话框 NOT RUN，屏幕阅读器 BLOCKED。

保留失败历史而不是只留下 PASS：第一次集成与源文件导出函数修改重叠，记录了临时缺失函数；稳定树第二次为 782/783，旧 XLSX 测试在工作表选择后过早提交下一次文件事件。修正测试等待可见上传锁释放，不删除任何原断言。该问题是测试同步缺口，不冒称生产解析漏洞。

### 性能与口径

最终较少并行工作的运行：普通身份完整场景 p95 **449.62 ms，通过**；混合歧义/截断场景 **641.27 ms，失败**，命令退出 1。安全断言每轮全部通过，见 `integration/benchmark-3000-quiet.{json,txt}`。独立对未修改 Claude 快照同环境重跑得到 434.13 / 725.82 ms，亦为普通通过、混合失败，见 `benchmark-original-comparison.{json,txt}`。两者引擎源码快照哈希相同 `7964e277f7ffe91d8e0e4b3967fa921e4a58a88fa651a83b66142235db9ccdfc`，没有证据把混合场景失败归因于本轮 UI/复核改动；也不据单轮比较宣称性能改善。旧报告全通过不能直接迁移到当前主机。

早先两次运行的 p95 目标未达标已保留：`integration/benchmark-3000.json` 与 `native-gl/benchmark-configurable.json`。并行工作可能影响延迟，但不能将“共享环境”推断直接当作证实原因。历史 `evidence/implementation-20261021/benchmark-3000.json` 没有被覆盖。性能阈值不因本轮失败而放宽。

## 3. 新问题及修复

- 来源会话绑定与映射逐来源归属：防止程序状态中哈希验证与已验证上下文脱离；属于防御性不变量加强，未证明可通过普通 UI 注入任意状态。见 DOT_SOURCE_REVIEW。
- UF OTHER_CASE 证据不足：任意非空关系不能排除费用冲突，需验证关联。仍由人复核证据语义，已知哈希不是“文件内容证明了该关系”。
- 替换 Promise 提前结束及被连续请求遗弃：先红后绿，见 `ui-review/new-defect-red.txt`、`superseded-red.txt`、`superseded-green.txt`。
- clearing/bank 同名：新测试先红后绿，见 `integration/bank-clearing-{red,green}.txt`；源 `src/pages/import.tsx` 明确拒绝，避免错误账户角色假设。
- 防重与 HTML 信息风险表述：按实际能力收紧，未声称绝对防重复或完全安全。
- PRINT-01 / P2：真实 PDF 视觉检查发现固定的 Skip to workspace 链接遮盖表格。仅在 print media 隐藏该链接，屏幕键盘跳转仍保留；静态具名测试先红后绿，实际浏览器打印前后及渲染证据见浏览器报告。PDF 文件生成成功与版式验收分开。

## 4. 剩余五项任务

1. **H5 原生 GL**：合成原生样式 11 列、4 行，没有 Role/Account Type/Linked ID，可解析但不能确认三方。明确账户映射可提供角色；增加 3 列、8 个非空身份值后形成三条 CONFIRMED 边。该值来源于合成独立关系凭据，不按金额猜测。7 阶段引导草案不是 7 点击或真实用户工时。详见 [H5 与商业准备](DOT_NATIVE_GL_AND_COMMERCIAL.md)。截图状态见浏览器矩阵。
2. **全月 OTHER_CASE 批量关联**：已实现并接 UI。已知哈希、现有其他案例、显式唯一交易清单、原子验证、冲突不覆盖；没有全选或金额匹配。合成 10 案例×6 交易 jsdom 操作数从 180 到 40，结果相同，不代表人工时间或需求成立。见 [批量关联与恢复](DOT_BATCH_AND_RECOVERY.md)。
3. **UNKNOWN 恢复**：未接生产的纯函数侧车原型，保留导出历史、记录 GL 哈希、复核人、找到/未找到。始终 `accountingExportAllowed:false`，原 UNKNOWN 阻断未变。未找到是否允许同日志号重下载需单独会计策略批准。
4. **商业验证材料**：五份角色问题单、合成演示、空白记录及明确虚构练习记录已在 `docs/interviews/`。不是五次采访；没有外联。未引用 E4/E5/E6/E8/E7b 为事实，因此保留未核实，不把旧 403 当新访问结果。
5. **工程整理**：benchmark 支持 CLI/env 输出，新默认路径不覆盖历史，wx 拒绝覆盖；路径回归通过。浏览器 runner 环境、依赖与可复现边界单独记录，未加入生产依赖。

## 5. 交付能力分级

| 阶段 | 判定与依据 |
|---|---|
| 本地可演示 | 合成流程可演示，最终验收矩阵限定具体已测路径；不把下载 HTML 渲染策略阻塞说成已测通过 |
| 辅助试点可用 | 可准备人工监督的合成演示及访谈；真实客户试点尚未验收，原生身份补充仍需人工证据 |
| 真实客户可用 | 未达到。无真实数据授权/样本复核、原生跨租户适配验证、支持流程与稳定公司身份保证 |
| QBO/QBD 验收 | 未达到。CSV 生成正确不等于目标系统导入成功；本轮禁止所有公司写入 |
| 需求验证 | 未达到。五份访谈材料不是用户行为/付费承诺，H1–H5 仍待实证 |
| 盈利验证 | 未达到。$199 等价格是待测假设，未有收入、成本、转化或留存证据 |

## 6. 一个优先下一步与停止条件

**优先：用已准备的合成演示执行一次受监督的 H5 原生导出准备演练，验证独立使用者能否依据明确凭据补齐关系，而不是继续加功能。** 在有合适参与者且取得对外联系/演练授权后执行；不导入任何会计系统。若参与者无法获得独立身份凭据，或准备超过既定 H5 两小时阈值，停止扩展“原生自动可用”主张，保留调查工作底稿定位并重新评估产品范围。当前材料已准备，演练未执行。

单独需要 owner 决策的边界：对外访谈及参与者；任何真实客户账簿处理范围；QBO/QBD 测试公司写入；UNKNOWN 重下载会计策略；部署/支付；合并 main。此报告及现有分支不代替上述授权。

## 远端交付与完整性

保留并更新原 `HANDOFF_TO_DOT.md`，顶部指向本报告，旧 Claude 交接保留为历史，不另建重复入口。源码首个提交为 `ca0798ef4be8882f8c3e8def6160a40e3b911274`，24 个源码/测试 blob 已逐一和本地 Git hash 比对。后续打印修复与完整证据在同一独立分支的下一提交。

- [独立分支](https://github.com/peterpeter228/reconciliation-desk/tree/review/dot-followup-20261022)
- [与 Claude 分支比较](https://github.com/peterpeter228/reconciliation-desk/compare/review/claude-code-independent-20261022...review/dot-followup-20261022)
- [与 main 比较（包含 Claude 原修复）](https://github.com/peterpeter228/reconciliation-desk/compare/main...review/dot-followup-20261022)

发布使用新分支、`expected_sha=7b479631cd4ceaede355d825818b78a04b7f13c3`、非强制更新；完整提交 SHA 以 GitHub 分支提交记录及最终交付消息的回读结果为准。本文件不嵌入自身提交哈希，避免自引用。所有新文件公开前做密钥模式检查及人工范围检查，仅代码、技术文档、合成数据/测试和浏览器产物。`evidence/dot-followup-20261022/publication-manifest.json` 列出本轮其余文件的 Git blob 与字节 SHA-256，明确排除该清单自身。
