# Independent architecture and accounting-safety review

Review date: 2026-10-21. Scope: original linked request, extracted engineering kit, current public vendor documentation, and reference-kit regression run. This is an implementation safety review, not an accounting opinion, audit, or certification of QuickBooks compatibility.

## Executive conclusion

Implement the kit's corrected evidence-gated specification, not the original request's unconditional assumptions. The kit is substantially safer than those assumptions. No live ServiceTitan, QuickBooks, bank, or payment account was accessed or changed.

The smallest safe release is a local-file exception workbench with explicit candidate/partial/verified states, auditable source rows, conditional workpapers, and a separately gated ordinary-asset-clearing fee-only export. The provided three primary CSV files do **not** independently establish the QB bank posting leg or complete fee-account coverage. Their normal activity may be associated without becoming verified three-way reconciliation; the main fixture must not unlock importable AJE files.

The single teaching example that supplies extra ledger assumptions is not evidence that the main fixture is export-eligible. Keep it visibly separate.

## 1. Independently verified critical vendor semantics

### ST batch identity and settlement fields

ServiceTitan distinguishes the TSYS processor batch identifier from its accounting export batch and supplies a separate Payment Batch Number for relating payments back to ST. Store these as typed, company-scoped identities, never one generic batch key. [ST batch matching](https://help.servicetitan.com/docs/match-tsys-payment-batches-to-quickbooks-online-deposits)

The detailed settlement report says Net Deposit excludes holds, whereas Deposit Amount is actual deposited amount. Its debit/credit explanations conflict with the shorter matching guide and with its own FAQ. Therefore names alone cannot select sign semantics or cash amounts. Require the exact report profile, transaction code/signs, and control-total checks; ambiguous source semantics must block automatic acceptance. [ST settlement report](https://help.servicetitan.com/docs/tsys-settlement)

### ST export mode, refunds, changes, and timing

Payment types can export as Payment to Undeposited Funds or as journal entries to configured accounts. A finance-fee payment type can already debit expense and credit receivables. Thus neither “all ST exports are batch JEs” nor “all financing fee differences need another expense” is safe. [ST payment types](https://help.servicetitan.com/docs/set-up-payment-types-in-servicetitan)

ST documents manual marking as exported as bypassing QuickBooks. The presence of an exported flag is not independent QB posting evidence. [ST payment process](https://help.servicetitan.com/docs/overview-of-the-payments-process)

Automated refund workflows exist and depend on configuration. Do not define refund correctness as a universal manual-unpost procedure. Refund success, actual cash movement, export status, and ledger coverage remain separate evidence. [ST automated refunds](https://help.servicetitan.com/docs/set-up-automated-refund-workflow)

Exported original invoices are corrected through adjustment invoices, and the original displayed total can remain unchanged. Comparing only original totals misses the correction chain; a payment allocation change also need not alter cash. [ST adjustments](https://help.servicetitan.com/docs/create-an-adjustment-invoice)

ST's reconciliation guide describes different card/ACH settlement intervals and possible per-record export errors despite batch-level exported status. Treat timing as a configurable channel/calendar/cutoff policy, not universal T+2–T+5 or a proof of hold. [ST reconciliation](https://help.servicetitan.com/docs/reconcile-payments-deposits-1)

### QB bank feed versus ledger

Intuit explicitly states that For review bank transactions do not affect books until matched or categorized. Matching relates existing records; categorizing creates a new record. A feed-only row is insufficient evidence that a bank debit/clearing credit already exists. [QBO bank matching](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/match-online-bank-transactions-quickbooks-online/L6qyw0PvP_US_en_US)

### Net fees are not inferred from brands

GreenSky's public merchant FAQ describes billing merchants monthly for prior-month transactions. It does not establish universal 9% net settlement. The proposed $10,000/$9,100/$900 case is valid only under separately evidenced netted-fee and prior-ledger assumptions. Contract-specific arrangements take precedence; brand and rate-band fit are hypotheses. [GreenSky FAQ](https://www.greensky.com/merchant-faq/)

### QBO CSV versus QBD IIF

QBO's US help page supports JE CSV and documents journal number/date, account, description, debits, credits, existing chart-of-accounts names, and full parent/subaccount paths. The page is not a guarantee that every regional/version/account configuration exposes the feature. Use the target account's downloaded sample and dry run before compatibility claims. [QBO JE import](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US)

Intuit describes IIF as ASCII, tab-separated text. Nonexistent account names can create new bank accounts, so an independently verified account allowlist is a correctness gate. Its official journal example is useful for format comparison, not a substitute for target-version testing. [IIF format and samples](https://quickbooks.intuit.com/learn-support/en-us/help-article/list-management/iif-overview-import-kit-sample-files-headers/L5CZIpJne_US_en_US)

IIF import does not automatically link transactions and is not guaranteed portable between countries' QuickBooks versions. Back up the test company before import. A zero UF ledger balance is not proof that payment/deposit links were cleared. [IIF limitations](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/export-import-edit-iif-files/L56LT9Z0Q_US_en_US)

The newer IIF importer can partially succeed and returns failed records separately. Never blindly replay the whole file or recommend bypassing validation. [IIF result handling](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/improved-iif-import-quickbooks-2019-later/L1K3ZQDX9_US_en_US)

For UF, Intuit's workflow selects existing received payments in Bank Deposit and adds the known fee as a negative fee line. Do not silently replace that linkage workflow with a generic clearing JE. [UF merchant-fee workflow](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/enter-bank-service-fee-using-third-party-merchant/L94JHLIsf_US_en_US)

## 2. Highest-risk contradictions and implementation decisions

| Risk | Conflicting premise or unsafe shortcut | Required decision |
|---|---|---|
| P0 | Three files must precisely diagnose all six causes | Permit unknown, suspected, supported, and confirmed. Missing evidence remains visible. |
| P0 | Normal synthetic event means verified three-way match | Keep economic truth separate from observable evidence. Clearing-only input stays PARTIAL/ACTIVITY_BRIDGE. |
| P0 | Any gross-minus-net gap within a fee band is a missing fee | Never use the gap to manufacture a fee. Distinguish refund, reserve, release, outside receipt, other adjustment, and existing fee posting. |
| P0 | Missing $20k means processor hold | Require identified, dated processor hold evidence and review releases. Otherwise missing/overdue settlement. |
| P0 | Bank-feed row means posted bank receipt | Use actual bank ledger leg or itemized, auditable reviewer confirmation. Never duplicate cash to “fix” a fee. |
| P0 | Payment, invoice, accounting batch, processor batch, and deposit number can join interchangeably | Namespace IDs and validate membership/crosswalks. Exact same text across namespaces is not identity. |
| P0 | Generic QBD CSV or JE into UF is universally importable and complete | QBO CSV and candidate QBD IIF are separate adapters. UF uses workpapers; do not advertise certified imports. |
| P1 | First waterfall pass or first subset solution can consume records | Generate candidates, resolve global conflicts, then commit conserved allocations. Preserve ambiguity. |
| P1 | Search cap/time budget establishes no match or uniqueness | Emit CANDIDATE_CAP/CARDINALITY_CAP/TIMEOUT, and never certify incomplete search. |
| P1 | Current original invoice total reveals all post-export drift | Track original snapshot plus adjustments, payment application changes, and expected accounting effect. |
| P1 | One hash and a reviewer text field authenticate a financial approval | Hashes detect mutation, not identity. Standalone local approval is an explicit review record, not authenticated multi-user control. |
| P1 | Reference Python primitives constitute a production engine | They do not parse and reconcile full three-edge inputs. Add independent production integration tests and preserve evidence gates. |

### Reference-code porting cautions

1. The fee builder explicitly trusts caller-supplied assertions such as coverage_complete and bank_posted_to_clearing. Production must derive these from traceable evidence/review records. A generic checkbox or default true must not stand in for the missing source facts.
2. The sample journal display ID uses nine hex characters. Preserve a full collision-resistant internal proposal identity; short DOCNUM is a presentation/target-format field, not the sole deduplication key.
3. The serializer validates balance, text, approval integrity, and two-line structure. It cannot independently establish source provenance, account existence, or prior posting. Do not expose a route that accepts arbitrary “approved” JSON from an import and then serializes it.
4. The fee-only template is intentionally narrower than general settlement accounting: positive gross/net, ordinary asset clearing, explicit netted fee, already-posted net bank settlement, and exact component residual. Refund/hold/mixed-component cases require isolation of the proved component or a workpaper, not relaxing the template.
5. Vendor help documents can be inconsistent. In particular, do not implement contradictory ST debit/credit descriptions as fixed accounting truths.

## 3. Concrete release-blocking invariants and adversarial tests

These are required production tests, not claims that they are already implemented.

### Input, scope, and provenance

- I01: Reject non-integer cents, unsafe integer overflow, ambiguous locale/sign, and unrecognized date semantics. Preserve missing amount as unknown, not zero.
- I02: Three application rows for one $100 payment yield one $100 cash atom, not $300; allocations cannot exceed the payment.
- I03: Parent deposit/JE totals and child posting lines cannot both enter monetary controls.
- I04: Same file hash re-import is idempotent. Same-date/same-amount/same-description without a reliable ID remains two possible real transactions.
- I05: Different company, currency, bank account, or known merchant conflict blocks merging; identifiers are company and namespace scoped.
- I06: Missing opening balance permits activity association only; no month-close certification. Two clearing accounts at +$900 and -$900 remain separately unresolved.
- I07: Preserve original physical row/sheet, file hash, mapping version, source ID, and exclusions. Sorting never substitutes new row numbers for physical source locators.
- I08: Pending bank lines, failed refunds, credit memos, and noncash payment corrections cannot count as settled cash.
- I09: QB Amount/Balance/summary fields cannot silently replace posted debit-minus-credit lines; -Split- is not proof of the bank account.
- I10: TSYS Net Deposit 1,000, Hold 100, Deposit Amount 900 must not become a 100 fee or a 1,000 actual bank receipt.

### Matching, search, and accounting conservation

- M01: One $100 receipt claimed by two $100 deposits yields a conflict component, not two matches.
- M02: Referencing an atom in E1 and E3 within the same group consumes it once; competing groups cannot overspend its budget.
- M03: Split allocations require documented component IDs and sum within source amounts; partial payments cannot be invented to fit.
- M04: Known processor payout 97 for receipt 100 overrides an earlier weak 100 amount/date candidate without silently consuming the latter.
- M05: Two distinct exact subsets stay ambiguous. Candidate or cardinality truncation cannot manufacture uniqueness.
- M06: Nine 100-cent items targeting 900 with max_members=8 report CARDINALITY_CAP; adding one 900-cent item does not prove it is the only solution.
- M07: Candidate count above limit or time/node limit exhaustion remains incomplete; UI shows the reason and never “no match found” as exhaustive.
- M08: Negative refund items never enter a positive-only subset solver; no greedy cancellation of unrelated positive/negative amounts.
- M09: Shuffle source rows, candidate enumeration, and pass order; accepted economic allocations and diagnoses remain unchanged.
- M10: No reliable identity anchor means amount/date agreement is a candidate, even if arithmetically unique.
- M11: Clearing-only GL may support E2 association but cannot yield VERIFIED_THREE_WAY. Add the exact bank posting leg and only then permit upgrade.
- M12: Enforce ExpectedBank = Gross - Refunds - Fees - NewHolds + Releases + ExternalReceipts + OtherAdjustments without using unexplained residual as an invented component.

### Diagnostic evidence

- D01: $20k missing without a processor notice is never confirmed hold; an old notice with later release is not current held balance.
- D02: $10k gross/$9.1k bank under UNKNOWN or SEPARATE_INVOICE does not auto-confirm net fee.
- D03: The same $900 gap evidenced as reserve cannot create fee expense.
- D04: A fee already correctly recorded is a component, not NET_FEE_DRIFT or another AJE.
- D05: A failed/pending refund or generic credit memo is not a successful cash refund. Clearing-only coverage cannot prove no refund exists elsewhere.
- D06: Original invoice unchanged plus adjustment invoice must still be reviewed; invoice reassignment with no required GL effect cannot be labeled sync bug.
- D07: Unmatched bank credit could be transfer, loan, capital, or another business event. No automatic customer receipt or revenue classification.
- D08: Post-period deposit proves later settlement, not settlement on the historical cutoff date.
- D09: Multiple causes can coexist. A score cannot override missing mandatory evidence, and score is not probability or measured accuracy.
- D10: Duplicate copies of one file are not independent corroboration.

### AJE/export controls

- A01: Standard $10,000/$9,100/$900 with verified prior Dr Bank/Cr Clearing and missing netted fee yields only Dr Fee 900/Cr Clearing 900; no new bank line.
- A02: Bank-feed-only, missing bank leg, incomplete expense review, unverified COA, unknown period status, UF, liability clearing, or unresolved discrepancy blocks importable export.
- A03: A missing bank settlement may justify a conditional workpaper but cannot silently use the fee-only template.
- A04: Approval binds company, case, evidence refs/hashes, account names/types, mapping/rules, journal date, amounts, and prior ledger state. Mutation invalidates approval; do not recompute a new approval automatically.
- A05: Repeated download preserves stable business/proposal identity. Existing or uncertain imported journal blocks a fresh equivalent proposal until verification.
- A06: Reject empty/unbalanced lines, negative debit/credit, two positive sides on one line, same account on both sides, control characters, formula prefixes (including normalized or whitespace-hidden forms), and unsupported encoding.
- A07: Import account names must match the verified COA. Do not “fix” them by prepending apostrophes or silently transliterating.
- A08: QBO CSV has separate debit/credit columns; QBD IIF has real tabs, TRNS/SPL/ENDTRNS, signed amounts, and tested encoding. Mark target compatibility unverified until a real version-matched dry run.
- A09: QBD partial success retries failed journal groups only. Never close the review state solely because a file was downloaded.
- A10: EXPORTED is not VERIFIED_IN_QB. Verification requires re-imported posted ledger with matching identifiers, accounts, date, and amounts, plus linkage validation where applicable.

### Privacy and demo integrity

- P01: Production engine cannot import the answer key, ground-truth labels, expected match IDs, or fixture-specific cause markers.
- P02: Baseline and enhanced evidence modes produce different confidence; removing support evidence must lower certainty, not leave hard-coded six confirmed diagnoses.
- P03: No raw transaction rows, real amounts/dates/identifiers, names, memo text, account numbers, or customer data go to any LLM or telemetry endpoint.
- P04: Mapping suggestions cannot execute expressions, SQL, scripts, formulas, macros, or instructions embedded in headers/cells.
- P05: Unknown formats stop for mapping review; heuristic profile labels are not bank or accounting-platform certification.

## 4. Validation actually executed

Command in the extracted source kit:

`python3 -m unittest discover -s tests -v`

Result: **33 tests passed; 0 failures; 0 errors; 0.160 seconds.**

Coverage is the reference primitives, reference export guards, and synthetic fixture contracts. This does not establish parser coverage, full reconciliation accuracy, browser behavior, real customer compatibility, or production end-to-end performance.

No real QBO/QBD import, real ST export parsing, or bank-file compatibility test was performed. The claimed 3,000-row sub-500ms target remains a product acceptance goal unless measured on the implemented production path with disclosed hardware, candidate distribution, evidence mode, and incomplete-search rates.

## 5. Recommended acceptance evidence for the first repository release

1. Versioned deterministic production tests containing the above negative cases, not only the supplied answer key.
2. Baseline fixture output demonstrating no false confirmed hold and no importable AJE from clearing-only inputs.
3. Separate explicitly synthetic fee-only example demonstrating approval invalidation and exact two-line export.
4. Full source manifests, per-account controls, candidate/search outcomes, immutable approval snapshots, and residual budgets available in exported audit workpapers.
5. README distinguishes implemented, measured, candidate-format, and target-account-unverified features. No “GAAP-certified,” “bank-certified,” “100% accurate,” or real-customer claims from synthetic data.

