基于对提交 `44b996e74aa718d7276b325157204cf624af7f12` 所提供源码、测试与脱敏执行记录的独立静态审查，以下为结构化审查结论（声明：本审查仅基于提供的源码文本与历史执行记录进行静态推理，未声称亲自运行任何测试、构建或浏览器操作）。

---

### 1. 阻断级/高风险问题与具体边界漏洞

在核心账务安全边界（分录身份隔离、exact-posting 范围限制、全量 GL 验证拒绝事务级证据、XLSX epoch/公式拦截）上，**静态审查未发现阻断级（Blocker）或高风险（High）的越权提升漏洞**。但在您指定重点审查的“异步失效流程、来源字节绑定、XLSX namespace 边界、状态机闭环”中，发现了以下 **4 个具体的设计/实现缝隙（中低风险/防御纵深缺陷）**：

#### 问题 1.1：[中风险 / UI 异步竞态与过期闭包] `readFile` 在异步等待 `runXlsxInspect` 后读取过期的闭包状态，且工作区 30MB 预算校验未计入并发上传
* **精确位置**：`src/pages/import.tsx` -> `readFile(kind: MainKind, file: File)`（第 157–238 行）。
* **可复现事件序列**：
  1. 用户选择 QBO profile 为 `manual`，开始上传一个需要耗时检验的 `.xlsx` 文件（单工作表）。此时 `readFile` 进入 `await runXlsxInspect(bytes, file.name)`（第 180 行）。
  2. 在 `runXlsxInspect` 尚未返回前（或在 `readFile` 内部等待 `file.arrayBuffer()` 时），用户修改了表单中的 `periodStart` 或 `dateFormat`（但假设用户在 `runXlsxInspect` 之前瞬间修改，或者考察 `readFile` 中 `options()` 的调用时机）。更直接的漏洞在于第 168–172 行：
     ```ts
     const total =
       Object.entries(files).reduce(
         (sum, [key, value]) => sum + (key === kind ? 0 : (value?.file.size ?? 0)),
         0,
       ) + file.size;
     ```
     以及在 `validate()`（第 309–340 行）和 `readFile`（第 207 行）调用 `parseFile` 时，**从未向底层 `parseSource` / `parseXlsx` 传递 `existingTotalBytes`**。
  3. 若用户先后或并发拖入 ST (9.5MB)、QBO (9.5MB)、BANK (9.5MB)，然后替换其中一个为 9.5MB，或并发触发两次上传：由于 `files` 是 React 渲染快照闭包，并发上传时两次 `readFile` 看到的 `files` 均为空，绕过 UI 层的 30MB 检查；且底层 worker 调用未传 `existingTotalBytes`，导致 `csv.ts:95` 和 `xlsx.ts:624` 的 `IMPORT_LIMITS.totalBytes` 防线在 UI 路径上形同虚设。
  4. 此外，在 `readFile` 执行期间，所有表单控件（如 `QuickBooks product`、`QuickBooks report profile`、`Expected report company name`）仅判断 `disabled={busy}`，而**未判断 `disabled={busy || reading}`**（见第 434、449、466 行）。虽然修改它们会递增 `parseToken.current` 丢弃旧上传结果，但这会导致用户刚选好的文件在 `readFile` 完成时因 token 失效被静默丢弃（UI 既无错误提示，文件卡片也未挂载）。
* **预期与实际推理**：
  * **预期**：正在读取/解析文件（`reading === true`）时应锁定影响解析语义的 profile 控件或在设置变更后保留已读取的 `file/bytes` 并标记为需重载；每次 worker 解析应传入准确的 `existingTotalBytes`。
  * **实际**：`existingTotalBytes` 在 `import.tsx` 中从未传入；`reading` 期间修改 profile 会导致刚上传的文件被 `if (token !== parseToken.current) return;` 直接静默吞掉。
* **最小修复**：
  1. 在 `import.tsx` 的 `parseFile` 或 `validate` 循环中计算并传入 `existingTotalBytes`。
  2. 将 `qbProduct`、`qbReportProfile`、`reportCompanyName` 及 `.form-grid` 内的表单控件在 `busy || reading` 时禁用，或在 `readFile` 中先挂载 `source` 基础字节再校验 `token`。
* **回归测试建议**：
  * 在 `tests/ui/qbo-journal-profile.test.ts` 中新增测试：模拟上传文件处于 `runXlsxInspect` 挂起状态时修改日期或切换 profile，断言文件字节不会静默丢失或控件在 `reading` 期间被禁用；断言 `validate()` 调用 `runImport` 时携带累计的 `existingTotalBytes`。

#### 问题 1.2：[中低风险 / 来源字节绑定边界] `parseSource` 的 UTF-8 原生字节一致性校验仅在 `profile === 'qbo-transaction-journal-v1'` 下生效，且对 BOM 的剥离允许 `text` 与 `originalBytes` 产生 SHA-256 哈希偏移
* **精确位置**：`src/ingestion/csv.ts` -> `parseSource`（第 86–93 行、第 118 行）。
* **可复现输入**：
  * **场景 A（BOM 伪造哈希）**：调用 `parseSource(textWithoutBom, 'QBO', { profile: 'qbo-transaction-journal-v1', originalBytes: bytesWithUtf8Bom })`。
    第 91 行：`if (decoded.replace(/^\uFEFF/, '') !== text.replace(/^\uFEFF/, ''))` 判定通过。随后第 118 行使用 `await sha256(bytes)`（含 BOM 的字节）计算 `fileHash`，而第 108 行 `recordsWithLocators(body)` 对去除了 BOM 的 `text` 计算 `raw_row_sha256`。这使得调用方可以通过附加或剥离 `\uFEFF` 在完全相同的 `text` 上生成两个不同的 `source_file_sha256`，绕过 `seenFileHashes` 去重检查（`csv.ts:157`）。
  * **场景 B（Manual 模式未校验 `originalBytes`）**：当 `options.profile === 'manual'`（如 ST、BANK 或普通 QBO GL 导入）且传入了 `options.originalBytes` 时，第 87 行的 `if` 条件不成立，**完全不校验 `originalBytes` 解码后是否等于 `text`**，直接用 `sha256(originalBytes)` 作为 `manifest.source_file_sha256` 并用 `text` 解析行数据。这正是此前在 native profile 上修复的“旧 CSV 文本与 `originalBytes` 不一致”漏洞在非 native profile 下的残留。
* **预期与实际推理**：
  * **预期**：只要调用方显式提供了 `options.originalBytes`，无论任何 `kind` 或 `profile`，`text` 都必须与 `originalBytes` 严格绑定；且 BOM 处理不应允许同一字节流与被篡改过 BOM 的文本混用。
  * **实际**：绑定检查被窄化到了 `options.profile === 'qbo-transaction-journal-v1'`。
* **最小修复**：
  将 `src/ingestion/csv.ts:87` 的校验扩展到所有携带 `options.originalBytes` 的调用（若支持 UTF-16 则走对应的解码比对，或强制要求 `decodeCsv(bytes) === text`）。
* **回归测试建议**：
  * 在 `tests/qbo-roundtrip-adversarial/parser.test.ts` 中新增用例：在 `profile: 'manual'` 下传入不匹配的 `text` 与 `originalBytes`，断言返回 `IMPORT_BLOCKED`；以及测试 `text` 无 BOM 但 `originalBytes` 有 BOM 时的行为一致性。

#### 问题 1.3：[低风险 / XLSX Namespace 与关系校验不对称] `walkXml` 仅在 `workbookPr` 上强制检查了 `spreadsheetNamespaces`，而在 `sheet`、`row`、`c`、`v` 及パッケージ元数据上仅按本地标签名（`name`）匹配
* **精确位置**：`src/ingestion/xlsx.ts` -> `walkXml` 与 `validateXml`（第 273–495 行）。
* **可复现输入**：
  构造一个合法的 ZIP/XLSX 包，在 `xl/worksheets/sheet1.xml` 中声明 `<spoof:c xmlns:spoof="urn:custom" r="A1" t="n"><spoof:v>900</spoof:v></spoof:c>`，或者在 `xl/workbook.xml` 中插入非标准命名空间的 `<custom:sheet name="Shadow" sheetId="2" r:id="rId2"/>`。
* **预期与实际推理**：
  * **预期**：`validateXml` 的安全预算与结构检查（`tag === 'sheet'`、`tag === 'row'`、`tag === 'c'`、`tag === 'v'`）应当与 SheetJS 的解析视野完全一致，或严格限制主工作表/工作簿标签必须属于 `spreadsheetNamespaces`。
  * **实际**：因为 SheetJS 也会剥离 XML 前缀，`validateXml` 按剥离前缀后的本地名 `tag` 进行拦截在大多数情况下恰好与 SheetJS 对齐（形成了防御）；但反之，对于 `[Content_Types].xml` 和 `.rels` 中的 `Relationship` / `Override` / `Default`（第 278、366–388 行），`validateXml` **未校验其 `namespace`**（如 `http://schemas.openxmlformats.org/package/2006/relationships`），且未禁止在 `sheet1.xml` 中出现 `<Relationship>` 标签，也未禁止在 `workbook.xml.rels` 中使用非标准默认命名空间。虽然这不会导致公式执行或 `date1904` 绕过，但属于命名空间校验的不彻底。
* **最小修复**：
  在 `validateXml` 中对核心工作簿/工作表结构标签（`workbook`, `sheets`, `sheet`, `worksheet`, `sheetData`, `row`, `c`, `v`, `is`, `t`, `sst`, `si`）统一断言 `spreadsheetNamespaces.has(namespace ?? '')`。
* **回归测试建议**：
  * 在 `tests/qbo-xlsx/workbook-properties.test.ts` 中新增测试：将 `<sheet>` 或 `<c>` 置于 `xmlns="urn:spoof"` 下，断言 `inspectXlsx` 抛出 `XLSX_XML_UNSUPPORTED`。

#### 问题 1.4：[低风险 / 证明结构完整性] `matchProposalJournalPosting` 未校验 `manifest.excluded_summary_rows` 与各组边界行号的一致性
* **精确位置**：`src/export/journal-posting.ts` -> `matchProposalJournalPosting`（第 157–300 行）。
* **可复现输入**：
  直接调用 `matchProposalJournalPosting(proposal, rows, [manifest])`，攻击者篡改 `manifest.excluded_summary_rows = []`（清空非入账行记录），随后重算 `manifest.qbo_transaction_journal.manifest_payload_sha256`。
* **预期与实际推理**：
  * **预期**：当攻击者自洽重算 SHA-256 摘要时，`matchProposalJournalPosting` 会重新验证所有结构不变量（如第 232–275 行对 `group_physical_row`、`total_physical_row`、`footer_physical_row` 的严格递增与求和校验）。
  * **实际**：代码严格校验了 `proof.groups`、`total_physical_row`、`footer_physical_row` 和 `accounts`，但 `manifestSchema` 仅校验了 `excluded_summary_rows: z.array(locator)`（可为空数组），未校验 `excluded_summary_rows` 必须包含 `[1, 2, 3, 4]` 以及每个 group 的 `group_physical_row`、`total_physical_row`、grand total `total_physical_row` 和 `footer_physical_row`。
* **最小修复**：
  在 `src/export/journal-posting.ts:276` 附近增加断言：验证 `[1, 2, 3, 4, ...proof.groups.flatMap(g => [g.group_physical_row, g.total_physical_row]), proof.total_physical_row, proof.footer_physical_row]` 均存在于 `manifest.excluded_summary_rows` 中。
* **回归测试建议**：
  * 在 `tests/qbo-roundtrip-adversarial/posting-proof.test.ts` 的 `independent invariants survive a recomputed evidence digest` 测试集中新增一项：清空 `manifest.excluded_summary_rows` 并重算摘要，断言 `matchProposalJournalPosting` 返回 `matched: false`。

---

### 2. 误报排除与已验证的现有防御（不得误报为缺陷）

经静态代码核对，以下机制在当前版本（`44b996e`）中已具备严密的运行时防御或属于有意设计的安全边界：

1. **只读严格分组身份传播与 `Num` 隔离（已防御）**：
   * 在 `src/ingestion/qbo-transaction-journal.ts:127-166` 中，仅在 `col 0` 匹配 `/^[1-9]\d{0,19}$/` 且未重复时创建事务组，明细行必须 `col 0 === ''`，且组内所有明细行的 `posting_date` 与 `Num`（`col 3`）必须一致、借贷严格平衡并与 `Total for <id>` 核对一致。
   * 明细行的 `transaction_id` 仅在克隆出来的 `projection[0]` 上注入，原始 `column_indices` 保持 `QBO_JOURNAL_BINDINGS`（不含 `transaction_id`），且在 `provenance.transaction_id_derivation` 中单独记录来源行号（row 6）与组控制行号（row 9）及其原始行 SHA-256。`Num` 从未被当作 `transaction_id`。
2. **精确分录匹配不越权提升、全量 GL 验证拒绝事务范围证据（已防御）**：
   * `matchProposalJournalPosting`（`src/export/journal-posting.ts`）返回值固定为 `scope: 'EXACT_JOURNAL_POSTING_ONLY'`、`periodReconciliationVerified: false`、`clearingBalanceVerified: false`，且不修改 `ReconciliationGroup.aje_state`（不会推进到 `VERIFIED_IN_QB`）。
   * `verifyProposalInLedger`（`src/export/aje.ts:471-579`）具备四重纵深防御，即使调用者手动将 `manifest.coverage_confirmed` 改为 `true`、删掉 `manifest.qbo_transaction_journal`、删掉 `row.source_refs[0].transaction_id_derivation` 并重算哈希，仍会被第 504 行的 `r.source_refs.some(ref => ref.mapping_version?.startsWith('qbo-transaction-journal-v1:'))` 以及第 529–533 行的 `!ref.column_indices.transaction_id?.length || ref.column_indices.transaction_id.some(column => ref.column_indices.num?.includes(column))` 拦截。
3. **跨事务组重用 `Num`、组内额外分录（Extra Legs）与截断隐藏（已防御）**：
   * 若两个不同事务组（如 `145` 和 `981`）使用相同的 `Num`（`p.journalId`），`matchProposalJournalPosting` 在第 192 行 `matches.length !== p.lines.length`（4 !== 2）和第 196 行 `matches.some(r => r.transaction_id !== txId)` 双重拦截。
   * 若同一事务组内包含额外的借贷平衡分录（且 `Num` 为空或不同以试图逃避 `matches` 过滤）：解析器在 `qbo-transaction-journal.ts:147` 强制同一组内 `Num` 必须完全相同；即使在运行时直接篡改内存行将其 `Num` 改掉，`journal-posting.ts:199-203` 的 `transactionRows` 按 `transaction_id === txId` 过滤，发现 `transactionRows.length !== matches.length` 立即拒绝。
   * 若解析后截断删除不相关的事务组：`journal-posting.ts:219-227` 会因 `reportRows.length !== manifest.normalized_row_count`、`journalRowsDigest` 不匹配以及第 273 行 grand total `checkedSum(reportRows) !== proof.debit_cents` 而失败闭合。
4. **XLSX `workbookPr` 命名空间修复与原生公式工作簿拒绝（有意安全边界）**：
   * `src/ingestion/xlsx.ts:328-346` 实现了基于元素栈原型链（`Object.create(stack.at(-1)?.namespaces ?? null)`）的作用域命名空间解析，兄弟节点不会继承子节点的局部重绑定。
   * 第 392–429 行严格区分标准 OOXML 命名空间下的唯一 `<workbook>/<workbookPr>` 与窄化的 `<workbook>/<extLst>/<ext uri="{140A7094-...}"><x15:workbookPr chartTrackingRefBase="..."/>`，阻止了 SheetJS 将 `x15:workbookPr` 中的 `date1904` 当作工作簿日期基准的解析器差异漏洞。
   * 原生導出的 `target-transaction-journal-145.xlsx` 在 H9/I9/H10/I10 含有 `<f>` 公式，被 `xlsx.ts:349`（XML 扫描阶段）和 `xlsx.ts:518`（SheetJS 单元格检查阶段）双重拦截并报 `XLSX_FORMULA`。这是有意且正确的 fail-closed 边界，绝不应通过静默剥离公式或信任缓存值 `<v>` 来放行。
5. **UI 标签准确性与状态失效重置（已修复）**：
   * `src/pages/import.tsx:644-699` 与 `src/pages/desk.tsx:241-251` 在 `fixedJournalProfile` / `m.qbo_transaction_journal` 下正确显示了 8 个固定映射列、禁用下拉框、显示 `6 nonempty records after header`、`2 normalized`、`11 non-posting rows (includes preamble/blanks)`、借贷总额 `$900.00` 及逐行排除原因，未影响 ST/Bank 的常规 `summaries excluded` 标签。
   * 切换 `qbProduct`、`qbReportProfile`、`reportCompanyName` 均调用 `invalidateQbPreview()`，立即清除 `validated` 和 `confirmed` 状态，保留已选的 `sheetName` 和 `headerRow`。

---

### 3. 仍未证实的兼容性与信任边界（Unestablished Boundaries）

根据静态代码审查与证据范围限制，以下事项**尚未建立或无法仅凭当前代码证明**：

1. **机构真实性与防伪造边界**：SHA-256（`file_sha256`、`raw_row_sha256`、`normalized_rows_sha256`、`manifest_payload_sha256`、`approval.payloadHash`）仅提供本地数据防篡改与一致性绑定。如果操作者从一开始就构造自洽的虚假 CSV（包含伪造的 `Craig's Design...` 标题、配平的分录与合法的 GMTZ 页脚）并在 UI 中输入相同的公司名重新点击确认和批准，系统在设计上无法验证该文件是否真实来源于 QuickBooks Online 服务器。
2. **整期覆盖率、清算账户余额与三方对账闭环**：`qbo-transaction-journal-v1` 仅证明特定日记账分录存在且配平（`coverage_confirmed: false`，期初/期末余额为 `null`）。它不能证明整个会计期间内清算账户（Clearing Account）无遗漏分录、不能验证期末余额滚算（Rollforward），也不能将对账组推进至 `VERIFIED_IN_QB` 或完成三方现金对账（配套浏览器测试中的 ST 记录因缺少成功状态被标记为 `UNSUCCESSFUL_PAYMENT_EXCLUDED`）。
3. **原生含公式 XLSX 的直接导入**：QBO 原生导出的 Transaction Journal `.xlsx` 含汇总公式，当前被有意拦截；独立生成的纯值（values-only）XLSX 仅验证了纯值工作簿解析路径，不代表对 QBO 原生 XLSX 导出物的直接验收。
4. **区域、语言与版本泛化兼容性**：`qbo-transaction-journal.ts` 硬编码了美式英语表头、`All Dates`、`Journal Entry`、`Total for <id>`、`TOTAL`、美式 `MM/DD/YYYY` 日期以及 `GMTZ` 导出时间戳页脚。其他语言区域（Locale）、自定义日期范围标题（非 `All Dates`）、含拆分子表头、非日记账交易类型或 QuickBooks Desktop (QBD) 均不受此 profile 支持。
5. **真实生产环境与外部系统集成**：本审查包不包含任何真实客户账套数据，亦未验证導出的 AJE CSV/IIF 文件在目标 QuickBooks 生产版本中的实际导入行为或部署环境的 HTTP 安全响应头。

---

### 4. 按风险排序的改进建议（不超过 10 项）

静态审查未发现高风险（High/Blocker）问题；针对上述中低风险缝隙与防御纵深，按风险从高到低排序建议如下：

1. **[中] 补齐 UI 层的 `existingTotalBytes` 传递（对应问题 1.1）**：在 `src/pages/import.tsx` 的 `parseFile` 调用链中计算其他已加载文件的字节总和并传入 `options.existingTotalBytes`，确保 Worker 侧的 30MB 工作区硬限制真正生效。
2. **[中] 在 `reading` 期间锁定 Profile 与表单控件（对应问题 1.1）**：在 `src/pages/import.tsx` 中将 `qbProduct`、`qbReportProfile`、`reportCompanyName` 等控件的 `disabled={busy}` 改为 `disabled={busy || reading}`，防止异步解析中途切换设置导致刚上传的文件对象被 `parseToken` 静默丢弃。
3. **[中低] 将 `originalBytes` 文本绑定校验推广至所有 CSV 导入模式（对应问题 1.2）**：在 `src/ingestion/csv.ts:87` 中，只要提供了 `options.originalBytes`，无论是否为 `qbo-transaction-journal-v1`，均强制验证 `originalBytes` 解码结果与 `text` 完全一致（含 BOM 一致性），消除 `manual` 模式下的字节错配可能。
4. **[低] 在 `validateXml` 中对核心工作表标签强制校验 `spreadsheetNamespaces`（对应问题 1.3）**：在 `src/ingestion/xlsx.ts` 中要求 `sheet`、`row`、`c`、`v`、`si` 等标签必须处于 `spreadsheetNamespaces` 命名空间下，并对 `.rels` 和 `[Content_Types].xml` 根/子元素校验各自的 OpenXML Package 命名空间。
5. **[低] 在 `matchProposalJournalPosting` 中校验 `excluded_summary_rows` 完整性（对应问题 1.4）**：在 `src/export/journal-posting.ts` 中验证 `manifest.excluded_summary_rows` 精确包含前言行（1–4）、所有事务组的头尾控制行、总计行与页脚行，防止重算哈希后抹除排除行审计记录。