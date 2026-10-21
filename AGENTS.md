# Reconciliation Desk implementation contract

Read README.md, docs/PRD_ENGINEERING.zh-CN.md, docs/ALGORITHM_SPEC.zh-CN.md,
docs/ACCOUNTING_EXPORT_SPEC.zh-CN.md, and contracts/canonical.ts before coding.
Use the phase prompts in prompts/. This package is a specification and tested
reference kit; it is not an already deployed application.

## Nonnegotiable invariants

1. Money is integer USD cents. Invoice totals are not cash receipts.
2. Accounting batch, processor batch, deposit, invoice and payment IDs are distinct.
3. Preserve source hashes and physical row locators. Do not sum summary and detail.
4. Never use LLMs to calculate, match, diagnose causes, choose accounts or approve entries.
5. Rate bands produce hypotheses. Missing settlement is not proof of a hold.
6. Each accepted allocation conserves amounts. Multiple solutions remain ambiguous.
7. Candidate, cardinality and time limits are incomplete search outcomes.
8. Approval binds the exact proposal, accounts, date, amounts, evidence and rule version.
9. UF requires payment/deposit linkage. Ordinary asset-clearing fee-only JE is the
   sole default import template. Unsupported accounting paths produce review workpapers.
10. Do not modify ST/QB/bank accounts. Export is not posting; verify from re-imported GL.
11. No raw transactions, customer names or free-text memos leave the browser for LLM mapping.
12. ground_truth_answer_key.json is test-only. Never import it in production engine code.
13. Payment Links return URLs are not payment proof. Do not implement fake subscription gates.
14. No new API integrations, RAG, vector database, autonomous agents or cloud tenancy in G1-G3.

## Verification

Run `python3 -m unittest discover -s tests -v` for reference-kit regressions.
Add meaningful tests for the production engine: arithmetic invariants, false matches,
ambiguity, evidence gates, import boundary validation and privacy egress.
Report executed commands and actual results; never label planned tests as passed.
Use supplied seeds plus held-out variations. Keep synthetic and real customer claims separate.

## Working rules

Work autonomously within the requested phase. Make ordinary reversible implementation
choices. Do not ask the user to pick frameworks already selected by this PRD.
Do not touch real accounting systems or send outreach. Live payments and deployment
must follow the user's actual authorization and available account permissions.
At each phase stop with concrete artifacts and evidence of the gate, not a checklist alone.
