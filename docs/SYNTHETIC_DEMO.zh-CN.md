# Reconciliation Desk：可复现合成演示

**SYNTHETIC / DO NOT IMPORT。所有人物、公司、交易与凭据均为虚构技术样例。**

目标不是展示“自动替你记账”，而是展示：金额差异 → 核对身份与证据 → 人工复核 → 受限草案/工作底稿。没有连接 ST、QuickBooks 或银行；没有真实客户、真实账簿、付款、生产部署或外部模型调用。

本演示基于 2026-10-22 已独立复核代码。技术验收与用户需求、目标系统导入、盈利分别判断，不以测试数量或演示流畅替代商业验证。

## 1. Ubuntu 从仓库启动

在已同步的仓库目录执行。Node ≥22，Python 3 用于完整参考验证；当前依赖锁文件应保留。

```bash
npm ci --ignore-scripts
npm run typecheck
node --import tsx scripts/synthetic-demo.ts
npm run dev
```

打开 Vite 输出的 **127.0.0.1** 地址。上述服务只用于本机演示，不绑定公网，不修改防火墙。若在无桌面的 Ubuntu 上执行，CLI 部分可以完成；不要把终端启动成功说成浏览器验收通过，也不要为此自动开放公网端口。

第一条命令按锁文件获取依赖，需网络；安装后生成演示及应用处理不调用外部业务服务。当前脚本复用 `tests/integration/fixtures.ts` 和 `tests/claude-review/fee-case-fixture.ts`，属于开发/演示工具，不进入生产浏览器 bundle。

可选保存新结果，已有文件会拒绝覆盖：

```bash
node --import tsx scripts/synthetic-demo.ts --out /tmp/reconciliation-synthetic-new.json
npx vitest run tests/synthetic-demo
```

本轮真实生成的[场景目录](../evidence/synthetic-demo-20261022/summary.json)记录稳定 group ID、金额（分）、各条边状态和阻断码，不含假造批准。输出稳定不代表对真实租户或未来版本的保证。

## 2. 五幕讲解稿

以下时间只作演示安排，不是实测用户完成时长或节省工时。

### A. 开场与范围（约 30 秒）

点 **Load demo**。说明：“这是合成文件工作台，不是银行连接器。我们先看哪些金额有解释、哪些仍缺证据。下载文件并不等于入账。”

不要把样例中的 $20,000 未结算或 $50,000 合并存款说成挽回的损失或客户收入。

### B. 金额平衡 ≠ 完整核实（约 45 秒）

在全量样例中查看 gross/bank 均为 $3,233.11 的 `clean-arithmetic` 对应案例（批次 430193）。CLI 目录采用补充合成证据后的结果；浏览器先点击 Add evidence → Add sample evidence & recalculate 再比较。可按目录中的 group ID/金额定位。它的 gross 与 bank 相同、fee 为零、未解释金额为零，但仍显示缺失的身份边。读出实际状态，不称“金额相同所以全部确认”。

这幕特意展示产品不会将巧合的金额对上当作结案。若界面无法按完整 ID 搜索，用源付款/批次记录定位；不能修改界面状态来配合讲稿。

### C. $900 已有凭据的手续费案例（约 2 分钟）

打开 **Import**，使用以下现成文件，无须临时制作数据：

- ST：`tests/fixtures/fee-case-csv/st_payments.csv`
- QuickBooks：`tests/fixtures/fee-case-csv/qbo_general_ledger.csv`
- 银行：`tests/fixtures/fee-case-csv/bank_activity.csv`
- 后续补充结算凭据：`tests/fixtures/fee-case-csv/processor_settlement.csv`

明确输入：公司 `Synthetic HVAC Co`，银行标签/银行 GL 科目 `Collections Checking`，清算科目 `ServiceTitan Clearing`，USD，Accrual，2026-09-01 至 2026-09-30，as-of 2026-09-30，America/New_York，MDY，Payment 行粒度，JE to clearing，manual profile，完整分录范围。上述完整性确认仅描述该合成夹具，不能照抄到真实客户。

真实结果是 gross $10,000、bank $9,100、documented fee $900。三条边可以确认，但还没有人工批准。展示来源行、科目和独立费用凭据，再按屏幕逐项完成复核。

若演示分录，明确是 **Dr Merchant Processing Fees / Cr ServiceTitan Clearing** 的受限草案，不是再次 Dr Bank / Cr Income。只下载本地 `SYNTHETIC_DO_NOT_IMPORT` 文件，绝不导入任何 QBO/QBD 公司。存在 UNKNOWN 历史时保持阻断，不换公司名或清存储绕过。

### D. UF 与歧义（约 90 秒）

UF 使用同一组合，仅将 GL 替换为 `qbo_uf_ledger.csv`，明确 clearing=`Undeposited Funds` 及 UF 属性。它缺少已记录的 QB 银行腿，展示存款工作底稿 `CANDIDATE → REVIEWED_INSTRUCTIONS`；“复核指引”不是已过账或可自动记账。

然后回到 **Load demo**。若已有工作，先保存/按可见替换确认操作，不忽略取消保护。选择 `ambiguous` 案例，说明多个候选不能用金额相同自动裁决，需额外身份凭据。

### E. 错误路径与结尾（约 30 秒）

CLI 场景 `invalid-input-blocked` 在内存把合成金额替换为非法文本，由真实解析器拒绝；原 CSV 不被修改。它是程序级验证，不冒称浏览器已完成此错误路径。

结尾：“目前证明的是合成文件上的技术流程。原生 GL 往往缺身份关系，需要独立凭据补充。我们还需要检验真实使用者能否完成准备，以及是否愿意为这个工作流付费。”

## 3. 已有证据与演示素材

- [独立复核报告](DOT_REVIEW_RESULTS_20261022.zh-CN.md)：784 Vitest、33 Python 参考测试；保留失败项与范围。
- [浏览器复核](DOT_BROWSER_REVIEW.md)：双标签防重复、UF、PDF 等实际操作证据；与本次演示截图分开。
- [H5 原生 GL 带截图引导](DOT_NATIVE_GL_AND_COMMERCIAL.md)：原生样式列与补充身份的差异，不伪称补充列是 QBO 原生必有字段。
- [49 秒中文截图演示 MP4](../evidence/synthetic-demo-20261022/browser/synthetic-demo-slideshow.mp4)：**实际操作截图演示，不是连续录屏**；全程标明 SYNTHETIC / DO NOT IMPORT。旁白字幕不证明未录制的动作。
- [本次浏览器证据及复现边界](../evidence/synthetic-demo-20261022/browser/README.zh-CN.md)：10 项通过；寻找不存在的 clean 标签这项演示假设失败，原始结果保留。
- 实际截图：[导入校验](../evidence/synthetic-demo-20261022/browser/02-import-validated.png)、[费用草案](../evidence/synthetic-demo-20261022/browser/04-draft.png)、[下载后保护](../evidence/synthetic-demo-20261022/browser/05-after-export.png)、[UF 工作底稿](../evidence/synthetic-demo-20261022/browser/uf-full-click-reviewed.png)、[歧义案例](../evidence/synthetic-demo-20261022/browser/10-ambiguous.png)。

## 4. 不能说的宣传语

不要说“已通过全部验收”“保证不重复入账”“一键支持所有 QBO 导出”“已可盈利”“节省 X% 时间”或“已经完成真实会计系统导入”。本地防重依赖精确公司标签、当前浏览器存储及可用锁机制，跨设备或清除存储不保证。

目前仍存在混合场景性能阈值未达、Enter-only 文件选择器异常未定位、下载 HTML 视觉验收受浏览器策略阻断、屏幕阅读器未验收。当前云端 QA 站点未更新，本地演示不代表线上版本。

## 5. 下一步，而非无限加功能

让获得授权的独立参与者依据合成凭据完成 H5 准备演练，记录真实步骤与耗时；不能拿自动生成结果代替受访者。若缺独立身份凭据或超过两小时，停止“原生自动可用”的主张。对外联系、真实客户数据、QBO/QBD 写入、部署与收款均需另行授权。
