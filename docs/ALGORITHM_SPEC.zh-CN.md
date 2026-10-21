# 核心算法规格：三条边、全局分配与证据门

版本 1.0。与 `PRD_ENGINEERING.zh-CN.md`、`contracts/canonical.ts`、`reference/core.py` 配合使用。

**本文是完整产品的实现规格和可复制伪代码，不是已实现的完整引擎。** `reference/core.py` 只提供金额、营业日、有界子集和、手续费候选及限定 AJE 导出组件。不得据此宣称 G1 的解析器、三边匹配 CLI 或前端已经完成。

## 1. 状态必须先定义清楚

每个结果同时保存三个独立维度：

| 维度 | 用途 |
|---|---|
| `matching_state` | `UNMATCHED / CANDIDATE / PARTIAL / MATCHED / AMBIGUOUS / BLOCKED`，表达三方链路完成程度 |
| `matching_scope` | `ACTIVITY_BRIDGE / VERIFIED_THREE_WAY`，供 UI 明示活动关联还是已验证三方闭环 |
| `search_status` | `COMPLETE / AMBIGUOUS / CANDIDATE_CAP / CARDINALITY_CAP / TIMEOUT / UNSUPPORTED`，表达搜索是否完成 |

`MATCHED + VERIFIED_THREE_WAY` 只用于三条边均 `CONFIRMED`、身份无冲突、金额守恒且范围可验证的结果。只有 clearing GL 单腿时，QB deposit 与银行可形成 `SUPPORTED_ASSOCIATION`，仍显示 `PARTIAL + ACTIVITY_BRIDGE`。补 QB bank GL、完整 deposit journal，或会计逐项核实实际已过账对象并留下可追溯确认后，才升级该边。

正常的经济事件不等于已被当前文件证明的三方匹配。样本的 `ground_truth_cause=NORMAL` 与 `three_way_matching_state=PARTIAL` 可以同时成立。对账算法必须保留这个区别。

新增内部辅助结构即可，不必扩张三张业务表：

```python
EdgeAssessment = {
    "kind": "ST_QB_RECEIPT | QB_BANK_SETTLEMENT | ST_BANK_CASH",
    "state": "ABSENT | CANDIDATE | SUPPORTED | CONFIRMED | CONTRADICTED",
    "source_ids": [], "expected_cents": 0, "observed_cents": 0,
    "difference_cents": 0, "identity_refs": [], "evidence_refs": [],
    "missing_evidence": [], "rule_id": "", "rule_version": "",
}
Hypothesis = {
    "id": "stable content hash", "edges": [], "claims": [],
    "financial_components": {}, "constraints": [], "search_scope_ids": [],
    "identity_gate": False, "unexplained_cents": 0,
}
AllocationClaim = {
    "atom_id": "canonical economic/posting atom", "group_id": "",
    "signed_allocated_cents": 0, "component_id": None,
    "split_authorization_ref": None,
}
```

## 2. 原子、身份与金额预算

### 2.1 源行不总是经济原子

一个付款可在多张发票应用行重复显示 `Payment Amount`；一个银行存款可有总行和明细；一个 QB JE 可有 summary 与 posting lines。先确定粒度，再构造 canonical atoms：

- 支付明细：以可靠 Payment ID 为原子；多张发票分配存入 `invoice_allocations`，不复制毛收款。
- 汇总批次：成员齐全时，以成员原子计算一个只读汇总视图；没有成员证据时，只保留一个不可随意拆分的 summary atom。
- QB：posting line 是原子。`transaction_id` 相同的不同 `line_id` 不是重复项。总行与下属明细不能同时计入控制量。
- 银行：posted transaction 是原子。daily summary 只有在存款清单给出成员时才能建立受约束的子分配。

重复源行的处理不等于删除相同金额：同文件 SHA 再导入可幂等；可靠源 ID 和相同版本可合并 provenance；只有指纹相似而缺源 ID 的两条记录保留并等待确认。

### 2.2 每个原子的预算只消费一次

默认一个原子只能属于一个已接受的 reconciliation group。一个付款在同一组内同时被 E1 和 E3 引用，不算消费两次；**分配按 group/atom 去重，不按边累计**。

对非零金额原子 `a`：

```text
sign(allocation[a,g]) = sign(source_amount[a])
sum_g abs(allocation[a,g]) <= abs(source_amount[a])
residual[a] = source_amount[a] - sum_g allocation[a,g]
```

默认禁止部分分配。允许拆分必须有 processor settlement line、deposit component manifest 或会计逐项批准的分配凭证；每个 component ID 只能消费一次。金额碰巧可拆开不构成拆分授权。

不同 clearing 科目分别滚动，不允许 A 科目 +900 与 B 科目 −900 相抵后宣布两者已平。汇总视图和明细视图共享底层预算，不能形成两份可重复消耗的余额。

### 2.3 结算与账本是两套等式

```text
ExpectedBank = Gross - Refunds - Fees - NewHolds + HoldReleases
               + ExternalReceipts + OtherAdjustments
Unexplained = ExpectedBank - ObservedBank

ClearingClose[account] = ClearingOpen[account]
                        + SumDebit[account] - SumCredit[account]
```

Gross 只含正向原始收款；Refunds/Fees/Holds/Releases 使用非负量；OtherAdjustments 带符号。`PAYMENT_CORRECTION` 不能直接当作已发生的银行退款。尚未证明的 gap 只进入 `Unexplained`，不自动填入 Fees 或 ExternalReceipts。

## 3. 总调度：waterfall 产生候选，不先到先得

```python
def reconcile(inputs, project, rules, evidence, clock):
    ctx = pass0_normalize_validate_and_index(inputs, project, rules)
    if ctx.has_fatal_schema_or_company_error:
        return blocked_result(ctx.errors, ctx.source_controls)

    pool = CandidatePool()       # immutable hypotheses; no amount consumed here
    scopes = SearchScopeLedger() # includes unfinished/too-large candidate scopes
    pool.extend(pass1_exact_edges(ctx, evidence, scopes))
    pool.extend(pass2_net_components_and_fee_hypotheses(ctx, evidence, scopes))
    pool.extend(pass3_subset_candidates(ctx, pool, scopes, clock))

    # Join compatible partial edges; deduplicate alternate derivations of the
    # same allocation. Preserve unresolved financial explanations separately.
    groups = join_edges_into_hypotheses(pool, ctx)
    groups = reject_only_hard_contradictions(groups, ctx, evidence)
    resolution = resolve_global_claims(groups, scopes, ctx)
    allocation_ledger = atomically_commit_proved_allocations(resolution)

    for case in build_cases(resolution, allocation_ledger, ctx):
        case.diagnoses = pass4_diagnose_all_applicable_causes(case, ctx, evidence)
        case.matching_state, case.matching_scope = assess_three_edges(case)
        case.aje_state = evaluate_aje_eligibility_without_export(case, ctx, evidence)

    assert_source_budget_conservation(ctx.atoms, allocation_ledger)
    assert_account_rollforwards(ctx)  # missing opening stays unknown, not zero
    return auditable_result(ctx, resolution, allocation_ledger)
```

Pass 1 的候选不能从后续 Pass 的输入中永久删除。可以优先计算未解释部分，但所有候选、受影响范围和冲突仍要汇总后才能提交。新增证据或改映射时重算受影响连通分量，旧批准失效。

## 4. Pass 0：标准化与范围检查

```python
def pass0_normalize_validate_and_index(inputs, project, rules):
    require_explicit(project.company_id, project.currency, project.bank_account_id)
    require(project.currency == "USD")
    raw = parse_without_executing_formulas(inputs)
    manifests = capture_report_scope_dates_basis_filters_and_controls(raw)
    rows = apply_approved_mapping_and_runtime_schema(raw)

    for row in rows:
        require_safe_integer_cents(row)
        reject_unknown_money_sign_or_date_locale(row)
        preserve_null_separately_from_zero(row)
        preserve_provenance_and_typed_identity(row)
        if row.company_id != project.company_id:
            quarantine(row, "COMPANY_CONFLICT")

    rows = remove_exact_same_file_reimport_only(rows)
    atoms = normalize_report_grain_without_double_counting(rows)
    # Group payment applications only with reliable source_payment_id. Keep the
    # one true receipt amount; validate allocated totals and unapplied balance.
    validate_payment_application_controls(atoms)
    validate_summary_detail_controls(atoms)
    classify_qb_roles_using_account_mapping_and_export_mode(atoms)

    for qb in qb_atoms(atoms):
        require(qb.signed_cents == qb.debit_cents - qb.credit_cents)
        require(qb.debit_cents >= 0 and qb.credit_cents >= 0)
        reject_both_positive_debit_and_credit(qb)
        if not qb.is_posted_ledger:
            exclude_from_posted_match(qb, "BANK_FEED_REVIEW_IS_NOT_LEDGER")
    for bank in bank_atoms(atoms):
        if bank.pending:
            exclude_from_final_settlement(bank, "PENDING")
        keep_negative_activity_for_refunds_returns_and_fees(bank)

    verify_control_totals_if_supplied(manifests, atoms)
    partitions = build_partitions(atoms, key=("company", "currency", "bank_account"))
    # Unknown merchant/channel may widen search, never override a known conflict.
    indexes = build_typed_id_indexes_and_amount_date_indexes(partitions)
    return Context(atoms, manifests, partitions, indexes, validation_results)
```

控制量失败应阻断受影响 partition 的自动接受和 AJE，不必阻断用户看见未验证源行。缺期初不阻断活动关联，但不得声称期末余额全部调平。`as_of` 来自文件清单，不用系统今天代替历史观察时间。

项目分别记录 `period_cutoff` 与 `evidence_observed_through`。10 月银行证明 9 月底在途时，UI 应写“9 月底未达，后续已于 10 月 5 日到账”；不能回填成 9 月 30 日已到账。

## 5. Pass 1：三条边分别建候选

### 5.1 公共规则

身份键必须带类型与命名空间：`company + system + identity_kind + identity_value`。会计 batch、processor batch、payout、bank trace、invoice 不混成一个字符串键。`123` 不可命中 `1234` 子串；Invoice # 单独不能标识付款。

金额默认精确美分；已审核舍入规则最多允许 1 cent，但结果为 `ROUNDING_REVIEW`，不能因此确认费用或自动 write-off。候选窗口为 `[business_add(anchor,-1), business_add(anchor,+5)]`，calendar/cutoff/profile 作为输入。强身份超窗保留为 `DATE_POLICY_REVIEW`，不能直接抛弃。

### 5.2 E1：ST ↔ QB receipt

```python
def build_st_qb_receipt_edges(ctx):
    for unit in ctx.payment_or_complete_accounting_batch_units:
        mode = unit.confirmed_export_mode
        if mode == "UNKNOWN":
            emit_missing(unit, "EXPORT_MODE_REQUIRED")
            continue
        expected = accounting_effect_for(mode, unit)
        # Example ordinary asset clearing: receipt Dr Clearing G / Cr AR G.
        # UF / financing liability workflows need their own confirmed adapters.
        # A pure invoice allocation change may have ZERO cash/GL effect.
        if expected is UNKNOWN:
            emit_missing(unit, "EXPECTED_QB_OBJECT_AND_ACCOUNTING_EFFECT")
            continue
        qb_sets = ctx.qb_index.lookup_exact_typed_references(unit)
        if not qb_sets:
            qb_sets = ctx.qb_index.lookup_amount_and_dates(expected, unit.date_window)
        for qb_set in qb_sets:
            reject_known_company_currency_account_or_role_conflict(unit, qb_set)
            verify_complete_batch_membership_if_summary(unit, qb_set)
            edge = compare(expected, actual_posting_effect(qb_set))
            edge.identity_gate = reliable_external_id_or_complete_batch_anchor(unit, qb_set)
            edge.state = CONFIRMED if edge.exact and edge.identity_gate else CANDIDATE
            emit(edge) # do not consume ST or QB atoms
```

“ST 标成 Exported”不是 QB 存在的证据；手工 marked exported 与系统实际导出要区分。缺 QB 对应项即保存 E1 缺失，不能因 ST 与银行金额相等直接宣布三方完成。

### 5.3 E2：QB settlement ↔ 银行

```python
def build_qb_bank_edges(ctx, evidence):
    for tx in ctx.posted_qb_deposit_or_settlement_transactions:
        if tx.has_verified_bank_posting_leg:
            bank_effect = sum_bank_debits_minus_credits(tx, ctx.target_bank_account)
            proof_level = CONFIRMED
        elif evidence.has_itemized_qb_posting_confirmation(tx):
            bank_effect = evidence.verified_bank_effect(tx)
            proof_level = CONFIRMED
        elif tx.has_clearing_leg_and_named_bank_split_with_validated_report_semantics:
            bank_effect = tx.supported_net_deposit_amount
            proof_level = SUPPORTED # association, not an independently seen bank leg
        else:
            emit_missing(tx, "QB_BANK_LEG_OR_ITEMIZED_ACCOUNTANT_CONFIRMATION")
            continue

        for bank_unit in bank_units_by_trace_or_amount_date(ctx, tx, bank_effect):
            require_posted(bank_unit)
            require_same_bank_account_and_currency(tx, bank_unit)
            require_summary_membership_if_bank_unit_is_aggregate(bank_unit, evidence)
            edge = compare(bank_effect, bank_unit.signed_cents)
            edge.identity_gate = reliable_deposit_trace_or_documented_membership(tx, bank_unit)
            edge.state = proof_level if edge.exact and edge.identity_gate else CANDIDATE
            emit(edge)
```

不要拿任意 clearing credit 当银行净入账：完整分录可能是 Dr Bank 9,100 + Dr Fee 900 / Cr Clearing 10,000。此时 clearing credit 是 10,000，银行腿是 9,100。`Split=-Split-` 没有银行账户证明作用。

### 5.4 E3：ST / processor ↔ 银行现金

```python
def build_st_bank_cash_edges(ctx, evidence):
    for settlement in settlement_units_with_documented_membership(ctx, evidence):
        parts = classify_signed_receipts_refunds_fees_holds_releases(settlement)
        # Use evidenced parts only. Missing fee is not filled with G-B.
        expected = parts.G - parts.R - parts.F - parts.H + parts.L + parts.E + parts.J
        for bank_unit in compatible_bank_units(ctx, settlement):
            edge = compare(expected, bank_unit.signed_cents)
            edge.identity_gate = reliable_payout_trace_or_manifest(settlement, bank_unit)
            edge.state = CONFIRMED if (
                edge.exact and edge.identity_gate and parts.all_used_components_evidenced
            ) else CANDIDATE
            emit(edge)
```

金额和日期唯一但无身份锚点仍是候选。净额已对上但 QB 漏记费用可同时表现为 E3 确认、E1 确认、E2 待核、clearing residual 存在；匹配与异常原因不得合为同一个枚举。

## 6. Pass 2：费用假设与有证据的净额

```python
def pass2_net_components_and_fee_hypotheses(ctx, evidence, scopes):
    for bucket in homogeneous_merchant_method_fee_profile_buckets(ctx):
        profile = bucket.profile_effective_at_payment_date
        if profile.fee_mode == "SEPARATE_INVOICE":
            continue # no automatic net deduction merely because of brand
        for payout_candidate in candidate_payouts(bucket):
            G, R, H, L, E, J, B = known_amount_components(payout_candidate)
            if any_used_component_unknown_except_fee(payout_candidate):
                emit_unexplained(payout_candidate)
                continue
            unexplained_fee_candidate = G - R - H + L + E + J - B
            fee_basis = profile.documented_fee_basis_or_gross(G)
            lo, hi = {"CARD": (150, 380), "FINANCING": (500, 1500)}.get(bucket.method, (None, None))
            in_band = (lo is not None and unexplained_fee_candidate > 0 and
                       lo * fee_basis <= 10000 * unexplained_fee_candidate <= hi * fee_basis)
            if in_band:
                emit_fee_hypothesis(payout_candidate, unexplained_fee_candidate,
                                    evidence_level="SUSPECTED", import_eligible=False)

            statement = evidence.exact_settlement_statement(payout_candidate.identity)
            if statement is None:
                continue
            require_statement_company_merchant_currency_and_period(statement, bucket)
            if statement.fee_mode != "NETTED":
                continue
            exact_fee = statement.fee_cents
            if G - R - exact_fee - H + L + E + J == B:
                emit_evidenced_net_component(payout_candidate, exact_fee, statement.source_refs)
```

公式中的费率带只用于排序和搜索，不是统一费率事实；固定每笔费用、最低收费或月末费用都可能落在带外。不要为了凑账同时拟合 rate、固定费、reserve 和退款金额。

混合 $50,000 场景使用各已证明 component 的净额。缺少办公室 $6,150 凭证时，该金额仍是未归属；不可推断它是手续费、支票或 ST 漏单。品牌 GreenSky 不提供 `NETTED` 事实；测试合同中必须明确该字段。

证明发生费用与证明 QB 漏记费用不同。后者还需实际已过账 bank leg、选定 clearing 残差、费用科目/对应对象覆盖以及防重复检查。只读 clearing 单腿只能让费用底稿的数学条件就绪。

## 7. Pass 3：有界子集和

### 7.1 调用者约束

每个 bank target 只考虑同公司、同币种、同银行账户、日期窗口、处理商/merchant、可信 reference 关系中的**正净额 settlement components**。已确认的退款与费用可以先组成有凭证的正净 component；未关联的负数不得进入正子集求解器。

n>28 返回 `CANDIDATE_CAP`，不静默排序后取前 28 个。每组默认 `max_members=8`、容差0、预算≤80ms；全轮预算根据实际计时分配。每个搜索 scope 保存完整候选 ID 集合或其可验证筛选范围，即使搜索被截断，也不能让这些记录被其他候选偷偷抢走。

### 7.2 核心伪代码

```python
def constrained_subset(items, target, max_members=8, max_candidates=28, epsilon=0):
    require_unique_ids_and_positive_integer_cents(items)
    if len(items) > max_candidates:
        return Result("CANDIDATE_CAP", complete=False)

    # max_members is a performance cap, not an economic truth.
    cardinality_can_hide = (len(items) > max_members and
        sum(sorted(x.cents for x in items)[:max_members + 1]) <= target + epsilon)

    left, right = deterministic_halves(items) # each <= 14
    left_states = enumerate_positive_subsets(left, up_to_members=max_members,
                                             max_sum=target + epsilon, with_deadline=True)
    right_states = enumerate_positive_subsets(right, up_to_members=max_members,
                                              max_sum=target + epsilon, with_deadline=True)
    # Keep two DIFFERENT ID combinations per (sum, cardinality), not one.
    right_index = index_two_representatives_per_sum_and_count(right_states)
    solutions = []
    for total_l, ids_l in left_states:
        check_deadline_and_node_cap()
        for delta in integer_range(-epsilon, epsilon):
            for count_r, two_representatives in right_index[target + delta - total_l]:
                if 1 <= len(ids_l) + count_r <= max_members:
                    for ids_r in two_representatives:
                        add_distinct_sorted_id_solution(solutions, ids_l + ids_r)
                        if len(solutions) >= 2:
                            return Result("AMBIGUOUS", solutions[:2], complete=False)
    if deadline_or_node_budget_exhausted():
        return Result("TIMEOUT", solutions, complete=False)
    if cardinality_can_hide:
        return Result("CARDINALITY_CAP", solutions, complete=False)
    return Result("UNIQUE_CANDIDATE" if solutions else "NO_MATCH",
                  solutions, complete=True)
```

上面的 `integer_range(a,b)` 包含两端；Python 实现是 `range(a,b+1)`。实际可运行、带预算检查的版本见 `reference/core.py::bounded_subset_sum`。

**关键截断案例**：9 个 $1.00、target=$9.00、max_members=8，答案必须是 `CARDINALITY_CAP`，不能是 NO_MATCH。若另外有一笔 $9.00，只找到了单笔解，仍必须是 `CARDINALITY_CAP`，不能是假唯一。最小 9 项之和大于 target+epsilon 时，正数性质才证明 9 项及以上不可能命中。

如果先做 1/2/3-sum 快速查找：找到两解可立即认定歧义；只找到一解仍必须继续检查其他允许规模及截断风险，不能提前返回唯一。

`UNIQUE_CANDIDATE/NO_MATCH` 是求解器结果，转换为 `SearchStatus.COMPLETE` 后另保存候选数与求解状态。`AMBIGUOUS` 只需两个实际解即可证明，不要求穷尽全部解。`TIMEOUT/CANDIDATE_CAP/CARDINALITY_CAP` 不能映射到 NO_MATCH。

### 7.3 500ms 的可测定义

3,000 指全月行数，不是每次 subset 的 n。测量 parser 后的 indexing + candidates + bounded search + result assembly，模型网络、文件读取、PDF 排除。记录 p50/p95、硬件、warm/cold、超时数和未决金额。500ms 是交互目标，不是任意 NP-hard 问题的完整求解保证。

预算耗尽后取消 Worker，保留已证明且与任何未搜索 scope 不相交的结果；受影响 scope 标搜索未完成。不能因为只跑到了 Pass 1 就提交一组可能被 Pass 2/3 推翻的金额匹配。

## 8. 全局冲突与提交

首版使用保守的冲突消解，不求“金额覆盖最高”的最大权集合，不用评分贪心：

```python
def resolve_global_claims(hypotheses, search_scopes, ctx):
    hypotheses = merge_identical_allocations_and_preserve_evidence(hypotheses)
    hypotheses = reject_hard_contradictions_with_reason(hypotheses)
    # Hard contradiction examples: known payout ID differs, wrong merchant,
    # wrong bank, unsupported split, incomplete summary, inconsistent cents.
    graph = build_components_sharing_exclusive_atoms_or_identity_constraints(hypotheses)
    result = []
    for component in graph.components:
        if intersects_unfinished_scope(component, search_scopes):
            if not immutable_id_evidence_proves_scope_exclusion(component):
                result.append(unresolved(component, search_status_of_scope(component)))
                continue
        feasible = apply_hard_identity_and_amount_constraints(component)
        if competing_claims_remain(feasible):
            result.append(ambiguous(component, preserve_at_least_two_alternatives=True))
            continue
        if not all_candidate_identity_gates_pass(feasible):
            result.append(candidate_only(component))
            continue
        if not all_shared_atoms_have_documented_disjoint_splits(feasible):
            result.append(ambiguous(component))
            continue
        verify_every_source_capacity_and_component_equation(feasible)
        result.append(accept_allocations_for_activity_edges(feasible))
    return result
```

没有竞争才可接受，不表示选择最高分的一组；发现可信唯一 payout 绑定可剔除违反该绑定的候选，但必须记录硬约束和原证据。一个低证据金额候选不能仅因为分数低就被无声删除。

同一组内部引用不同边不重复消费。多个组确需分享银行汇总行时，须有 disjoint component identities，且各分配净额相加不超过该行。其余情况整个连通分量保留歧义。数据重排、遍历顺序或 Pass 顺序改变不得改变结果。

接受活动分配与宣布三方闭环分开。E1/E3 已确认、E2 仅 supported 时可保存已证明的活动归属，结果仍是 PARTIAL；不得进一步授予 AJE 导入资格。

## 9. Pass 4：多标签原因、硬证据门与分数

### 9.1 决策顺序

```python
def pass4_diagnose_all_applicable_causes(case, ctx, evidence):
    if case.has_invalid_scope_or_amount_controls:
        return [unexplained("INCOMPLETE_OR_INVALID_SOURCE", missing_controls(case))]
    findings = []
    # Independent checks: no elif chain; fee + refund + hold may coexist.
    for rule in [date_lag_rule, net_fee_drift_rule, unbatched_refund_rule,
                 post_export_drift_rule, outside_receipt_rule, processor_hold_rule]:
        observation = rule.collect_observed_facts(case, ctx, evidence)
        if not observation.applies:
            continue
        gates = rule.required_evidence_gates(observation)
        score = evidence_score(observation)
        if gates.all_pass and case.no_allocation_conflict and score >= 90:
            level = "CONFIRMED"
        elif gates.has_independent_support and not gates.has_contradiction:
            level = "SUPPORTED"
        else:
            level = "SUSPECTED" if observation.has_plausible_signal else "UNKNOWN"
        # Explicit caps override score. Rate-band only stays SUSPECTED.
        level = apply_rule_specific_evidence_ceiling(level, gates)
        findings.append(finding(rule.cause, level, score, gates.refs, gates.missing))
    if not findings or case.unexplained_cents != 0:
        findings.append(unexplained("UNRESOLVED_COMPONENT", remaining_missing_evidence(case)))
    return deduplicate_by_cause_and_financial_component(findings)
```

### 9.2 六类 required evidence gates

| 原因 | 允许 CONFIRMED 所需事实 | 缺少时输出与下一步 |
|---|---|---|
| DATE_LAG | 截止日已经发生/记载的收款；同一 payout/reference；期后 posted bank；期内未达与后续到账时间可复核；观察范围完整 | 窗口未过为 EXPECTED_IN_TRANSIT；超过窗口为 OVERDUE_UNSETTLED。补下一期银行，不猜 Hold。 |
| NET_FEE_DRIFT | 同一 payout 的真实净扣费金额；合同/statement fee_mode=NETTED；完整净额等式；QB bank 实际过账；确认费用未记/未重复记；对应普通 clearing 残差恰为费用 | 比例吻合仅 SUSPECTED。Statement 可证明 fee，但 QB bank/expense 覆盖缺失时只支持费用底稿。 |
| UNBATCHED_REFUND | 独立成功退款 ID；ST refund 状态确已退款且未入批/导出；已过已知 batching/export due；QB 相关退款对象/账户覆盖完整且确无该退款；金额及时间对应 | 仅见未入批行可报 UNEXPORTED_REFUND_RECORD；银行少款不能证明退款。只有 clearing GL 不足排除退款已从其他账户过账。 |
| POST_EXPORT_DRIFT | 原导出快照/hash/time；后续明确字段变更或独立 correction；确认 export_mode 下应改变的 QB 对象/金额；QB 当前该对象缺失或不同；超过同步观察区间 | 只有 audit 证明 after-export 修改，最多 SOURCE_RELATIONSHIP_CHANGE 或 POST_EXPORT_DRIFT_CANDIDATE。付款改挂发票不必改变 cash/clearing；不能仅凭此报同步 Bug。 |
| OUT_OF_SYSTEM_DEPOSIT | 已 posted bank；真实存款/办公室收款/融资凭证；ST 全收款范围完整；由凭证及相关人员核实未录 ST；业务性质已识别 | ST 找不到仅 UNATTRIBUTED_BANK_CREDIT。先排除 transfer、loan、owner contribution；不得自动贷收入。 |
| PROCESSOR_HOLD | provider 明示 held 状态及金额；merchant/payout/batch 与本组身份一致；证据 as_of 有效；相关银行/processor release 范围已核查没有该笔释放 | 超时仅 missing/overdue settlement。缺少 hold 明文凭证时永不可 CONFIRMED Hold；不生成费用冲销。 |

如果真实费用已正确记账，它是净额组成事实，不是 NET_FEE_DRIFT 异常。若退款仍 pending/failed，它不是已流出的现金。Export error、chargeback、bank return、transfer、loan、重复源记录和范围缺失可作为阻断说明，不强行塞进六类。

### 9.3 评分公式

`S = clamp(35I + 20A + 15Q + 10D + 10P + 10U − 40C, 0, 100)`。

I=可靠身份锚点；A=精确金额守恒；Q=独立来源佐证；D=时序吻合；P=账户与通道一致；U=候选范围完整且无竞争归属；C=明确反证。各取0/1。相同文件复制成两份不构成独立 Q；1 cent review 不算精确 A；搜索超时不能给 U=1。

分数是规则证据等级，**不是 95% 正确率或统计概率**。高分不能覆盖 required gates；低证据费率推导不因金额很大升为 confirmed。UI 显示“证据分 85/100”，并逐条列出加分项、反证和缺失凭证，不显示“AI 有 85% 把握”。

## 10. AJE 是另一个状态机

```python
def evaluate_aje_eligibility_without_export(case, ctx, evidence):
    if case.target_is_undeposited_funds:
        attach_bank_deposit_workpaper(case)
        return "INELIGIBLE"
    if not verified_existing_ordinary_asset_clearing_and_expense_accounts(case):
        return "INELIGIBLE"
    require_evidenced_netted_fee_and_complete_bank_posting_and_expense_review(case)
    require(case.component_gross - case.component_bank_net == case.confirmed_fee)
    require(case.target_clearing_component_residual == case.confirmed_fee > 0)
    require(no_other_unexplained_amounts_and_no_duplicate_fee(case))
    require(open_accounting_period_and_approved_account_mapping(case))
    return "DRAFT" # still not approved, exported, or posted

def approve_and_export(draft, approver, context):
    approved_snapshot = immutable_preview(draft, context)
    approval_hash = sha256(canonical_json(approved_snapshot))
    record_explicit_reviewer_approval(approver, approval_hash)
    # At export, recompute full payload, not just source-file hashes.
    require(recompute_preview_hash(draft, context) == approval_hash)
    require(journal_id_not_already_present_in_uploaded_qb_ledger(draft))
    require(sum_debits(draft) == sum_credits(draft) > 0)
    return serialize_verified_format(draft) # state EXPORTED, never POSTED
```

批准快照包括公司、case、全部科目名称与类型、金额、分录日期、源文件和映射版本、规则版本、fee_mode、证据引用、前后余额及批准人。改日期、金额、科目或证据后必须重新批准；不能自动重算 hash 并沿用旧批准。Hash 是完整性检查，不是数字签名或身份认证。

混合存款中的 fee-only proposal 必须针对已证明的 component residual；不能拿整个 $50,000 银行行代替 $18,200 融资 component 的净额。银行源行可作为多个底稿的证据引用，但现金分配仍只有一次。

当前合成 CSV 未提供 QB bank leg、完整费用账户覆盖或会计逐项确认，所以 12 项 $3,518.72 费用仅 `fee_proposal_math_ready=true`，全部 `fee_aje_draft_eligible=false`。它们可展示条件式会计底稿，不能直接输出可导入稿。单独的 $10,000/$9,100/$900 AJE 格式示例应明确标注额外账务与审批假设，不能代表样本已完成三方验证。

## 11. G1 必须实现的测试断言

下面是待实现引擎的验收用例，不等于已经运行通过的集成测试。

| 输入/操作 | 必须断言 |
|---|---|
| 同 Payment ID 的三条 invoice application 各重复 gross=100 | 只生成 $100 支付预算，不能变 $300 |
| QB deposit summary 与下属明细同时存在 | 控制量只计一种粒度；总行不能被第二组消费 |
| 一组 ST 付款在 E1 与 E3 两边引用 | 同 group/atom 只消费一次 |
| 两笔 bank credit 竞争同一 ST $100 | 整分量 AMBIGUOUS；不能先遍历先匹配 |
| Pass1 有 $100 金额候选，Pass2 才见该付款确实净结算 $97 的 payout 证据 | Pass1 未提前提交；以硬身份约束重算，$100 仍未归属 |
| 仅 clearing GL 与银行匹配 | E2=SUPPORTED；组为 PARTIAL/ACTIVITY_BRIDGE；不能输出已验证三方闭环 |
| 补同一 QB deposit 的实际 bank leg | 验证一致后才允许 E2=CONFIRMED |
| Clearing A +900，Clearing B −900 | 分别保留残差，不用合计0掩盖 |
| 10000 gross、9700 bank，但有300 reserve证明 | 不能确诊 fee；按 reserve/hold 解释 |
| GreenSky separate-invoice profile | 不因差额9%进入已确认净扣费 |
| 费率命中、无结算单 | SUSPECTED；AJE 不可用 |
| $20k 未到账、没有 provider hold notice | MISSING_SETTLEMENT；不得 CONFIRMED Hold |
| payment application 导出后改挂发票，无应改变 QB 金额的证据 | SOURCE_RELATIONSHIP_CHANGE；不得断言 clearing 金额错误 |
| 退款 pending/failed 或只是 credit memo | 不计为已退款现金 |
| ST 无入账匹配，bank description=TRANSFER | 保留业务性质核实；不可自动 OUT_OF_SYSTEM 客户收款或收入 |
| 子集输入28项内存在两个不同ID组合且和相同 | AMBIGUOUS；不能因只保留第一组误称唯一 |
| 9个100 cents，target900，max_members8 | CARDINALITY_CAP；不是 NO_MATCH |
| 上例再加一项900 cents | CARDINALITY_CAP 且可保留一个候选；不是 UNIQUE_CANDIDATE |
| 最小9项和超过target，且完整遍历只有一个解 | UNIQUE_CANDIDATE；仍须业务身份与全局冲突检查 |
| >28候选 / 节点或时间预算耗尽 | CANDIDATE_CAP / TIMEOUT；不得称完整无匹配 |
| 银行负数混入正子集求解 | 拒绝该调用；转退款/负结算流程 |
| 同源文件行重排、hash provenance更新后重算 | 经济匹配结果不依赖行顺序；旧审批失效 |
| 已批准后修改科目、分录日期、金额或来源映射 | 全payload hash不匹配，阻止导出 |
| UF、负债 clearing、AR/AP 模板 | 关闭 fee-only importer，输出相应操作底稿 |
| 样本三核心文件与增强证据两种模式 | 对照答案允许状态，不要求六类全 CONFIRMED，也不把 NORMAL 当全部 MATCHED |

输出每次 run 的 rule/mapping/calendar 版本、各阶段耗时、搜索截断、拒绝候选的硬约束、已分配与剩余金额和所有源行证据。重新上传已导入后的 QB 账本，找到稳定 journal number、科目和金额，并确认相关业务对象已清理后，才进入 `VERIFIED_IN_QB`。
