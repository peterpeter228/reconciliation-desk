"""Independent adversarial acceptance tests for reference/core.py.

These test economic ambiguity and exporter trust boundaries. They intentionally
failed against the first reviewed implementation; fixes belong to core.py.
"""
from __future__ import annotations

import unittest
from dataclasses import replace
from datetime import date

from reference.core import (Candidate, FeeCase, bounded_subset_sum,
                            fee_case_approval_hash, make_fee_only_aje,
                            qbo_csv, qbd_iif, stable_hash)


class SubsetReviewTests(unittest.TestCase):
    def test_cardinality_limit_must_not_prove_false_uniqueness(self):
        # One 9-dollar amount OR nine 1-dollar checks. A performance cap of 8
        # cannot prove that the first combination is the unique true answer.
        candidates = [Candidate("whole", 900)]
        candidates += [Candidate(f"check-{i}", 100) for i in range(9)]
        result = bounded_subset_sum(candidates, 900, max_members=8, budget_ms=500)
        self.assertFalse(
            result.status == "UNIQUE_CANDIDATE" and result.complete_search,
            "Performance cardinality cap hid a valid nine-check alternative.",
        )

    def test_cardinality_limit_must_not_claim_exhaustive_no_match(self):
        result = bounded_subset_sum(
            [Candidate(f"check-{i}", 100) for i in range(9)],
            900, max_members=8, budget_ms=500,
        )
        self.assertFalse(
            result.status == "NO_MATCH" and result.complete_search,
            "A valid combination exists outside the performance cardinality cap.",
        )

    def test_cardinality_limit_can_be_proven_irrelevant(self):
        # At most two 6-dollar candidates can fit a 12-dollar positive target.
        result = bounded_subset_sum(
            [Candidate(f"c-{i}", 600) for i in range(10)],
            1200, max_members=8, budget_ms=500,
        )
        self.assertEqual(result.status, "AMBIGUOUS")

    def test_zero_cent_tolerance_is_not_silently_rounded(self):
        candidates = [Candidate("a", 100), Candidate("b", 101)]
        strict = bounded_subset_sum(candidates, 100, tolerance_cents=0, budget_ms=500)
        loose = bounded_subset_sum(candidates, 100, tolerance_cents=1, budget_ms=500)
        self.assertEqual(strict.solutions, (("a",),))
        self.assertEqual(loose.status, "AMBIGUOUS")


class ExportBoundaryReviewTests(unittest.TestCase):
    def aje(self):
        # Start with a real approved artifact. A hand-made dict missing the hash
        # would fail before any structural guard and produce false reassurance.
        accounts = {"ServiceTitan Clearing": "OTHER_CURRENT_ASSET",
                    "Merchant Financing Fees": "EXPENSE"}
        case = FeeCase(
            company_id="sample-co", case_id="fee-review-1",
            source_version_hash="snapshot-v1", approval_source_hash="snapshot-v1",
            approved_by="Reviewer", evidence_refs=("statement", "GL"),
            journal_date=date(2026, 9, 30),
            clearing_account="ServiceTitan Clearing", fee_account="Merchant Financing Fees",
            gross_cents=1000000, bank_cents=910000, confirmed_fee_cents=90000,
            clearing_residual_cents=90000, bank_posted_to_clearing=True,
            existing_fee_already_posted=False, fee_mode="NETTED",
            coverage_complete=True, period_open=True,
        )
        case = replace(case, approval_payload_hash=fee_case_approval_hash(case, accounts))
        aje = make_fee_only_aje(case, accounts, set())
        # Positive controls: the unmodified approved payload really is accepted.
        self.assertIn("Journal No.", qbo_csv(aje))
        self.assertIn("GENERAL JOURNAL", qbd_iif(aje))
        return aje

    def assert_blocked(self, aje, reason):
        # Recompute the unkeyed integrity hash after mutation so these tests
        # exercise INDEPENDENT structural guards, not just stale-hash rejection.
        # This is not authorization: production must preserve the reviewer's
        # immutable approved snapshot; a hash is deliberately not a signature.
        aje["approved_payload_hash"] = stable_hash(
            {key: value for key, value in aje.items() if key != "approved_payload_hash"}
        )
        for exporter in (qbo_csv, qbd_iif):
            with self.subTest(exporter=exporter.__name__):
                with self.assertRaisesRegex(ValueError, reason):
                    exporter(aje)

    def test_unbalanced_payload_cannot_reach_quickbooks(self):
        aje = self.aje()
        aje["lines"][1]["credit_cents"] = 89999
        self.assert_blocked(aje, "Unbalanced")

    def test_draft_payload_cannot_reach_import_file(self):
        aje = self.aje()
        aje["status"] = "DRAFT"
        self.assert_blocked(aje, "Approved immutable proposal")

    def test_empty_journal_cannot_reach_import_file(self):
        aje = self.aje()
        aje["lines"] = []
        self.assert_blocked(aje, "two-line fee-only template")

    def test_formula_text_and_control_characters_are_blocked(self):
        for field, bad in (("journal_id", "=1+1"), ("memo", "=HYPERLINK(\"https://example.invalid\")"),
                           ("memo", "fee\tsecond field"), ("memo", "fee\x00")):
            aje = self.aje()
            aje[field] = bad
            self.assert_blocked(aje, "Unsafe import text")

    def test_both_debit_and_credit_on_same_line_are_blocked(self):
        aje = self.aje()
        aje["lines"][0]["debit_cents"] = 90100
        aje["lines"][0]["credit_cents"] = 100
        self.assert_blocked(aje, "exactly one nonzero side")

    def test_negative_debit_is_not_mapped_as_valid_positive_credit(self):
        aje = self.aje()
        aje["lines"][0]["debit_cents"] = -90000
        aje["lines"][1]["credit_cents"] = -90000
        self.assert_blocked(aje, "Nonnegative integer debit/credit")


if __name__ == "__main__":
    unittest.main()

