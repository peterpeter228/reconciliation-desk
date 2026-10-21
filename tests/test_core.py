import csv
import io
import random
import unittest
from dataclasses import replace
from datetime import date
from itertools import combinations
from reference.core import (Candidate, FeeCase, add_business_days, bounded_subset_sum,
                            fee_candidate, fee_case_approval_hash, make_fee_only_aje, parse_money, qbd_iif, qbo_csv)


class CoreTests(unittest.TestCase):
    def test_strict_money(self):
        self.assertEqual(parse_money("($1,234.50)"), -123450)
        self.assertEqual(parse_money("0.01"), 1)
        self.assertEqual(parse_money("-900.00"), -90000)
        for bad in ["", "1,23", "NaN", "1e3", "12.345", "($-10)", 12.3]:
            with self.assertRaises(ValueError): parse_money(bad)

    def test_us_settlement_holiday(self):
        self.assertEqual(add_business_days(date(2026, 9, 4), 1, frozenset({date(2026, 9, 7)})), date(2026, 9, 8))
        self.assertEqual(add_business_days(date(2026, 9, 8), -1, frozenset({date(2026, 9, 7)})), date(2026, 9, 4))

    def test_50000_mixed_net_known_components(self):
        r = bounded_subset_sum([Candidate("finance1", 1820000), Candidate("finance2", 1365000),
                               Candidate("check1", 1200000), Candidate("office", 615000)], 5000000)
        self.assertEqual(r.status, "UNIQUE_CANDIDATE")
        self.assertTrue(r.complete_search)
        self.assertEqual(len(r.solutions[0]), 4)
        # Components are already supported NET amounts. Arithmetic is not identity.

    def test_ambiguity_not_first_solution(self):
        r = bounded_subset_sum([Candidate("a", 100), Candidate("b", 200), Candidate("c", 300)], 300)
        self.assertEqual(r.status, "AMBIGUOUS")
        self.assertEqual(len(r.solutions), 2)

    def test_bounds_never_claim_no_match(self):
        c = [Candidate(str(i), i + 1) for i in range(29)]
        self.assertEqual(bounded_subset_sum(c, 40).status, "CANDIDATE_CAP")
        self.assertEqual(bounded_subset_sum(c[:8], 40, budget_ms=0).status, "TIMEOUT")
        with self.assertRaises(ValueError): bounded_subset_sum([Candidate("r", -10)], 10)
        with self.assertRaises(ValueError): bounded_subset_sum([Candidate("x", 1), Candidate("x", 1)], 1)

    def test_subset_against_bruteforce(self):
        rng = random.Random(91)
        for _ in range(80):
            candidates = [Candidate(f"p{i}", rng.randint(1, 50)) for i in range(9)]
            target = rng.randint(1, 160)
            expected = [tuple(x.id for x in group) for k in range(1, 9)
                        for group in combinations(candidates, k) if sum(x.cents for x in group) == target]
            r = bounded_subset_sum(candidates, target, budget_ms=500)
            self.assertEqual(r.status, "NO_MATCH" if not expected else "UNIQUE_CANDIDATE" if len(expected) == 1 else "AMBIGUOUS")
            for solution in r.solutions: self.assertIn(solution, expected)

    def test_rate_is_only_hypothesis(self):
        r = fee_candidate(1000000, 910000, "FINANCING")
        self.assertEqual(r["status"], "FEE_HYPOTHESIS")
        self.assertFalse(r["aje_allowed"])
        self.assertEqual(fee_candidate(1000000, 910000, "FINANCING", fee_mode="SEPARATE_INVOICE")["status"], "NOT_APPLICABLE")
        self.assertEqual(fee_candidate(1000000, 910000, "FINANCING", hold_cents=90000)["status"], "UNEXPLAINED")

    def case(self):
        case = FeeCase("sample-co", "fee-1", "snapshot-v1", "snapshot-v1", "Demo Reviewer",
                       ("settlement-confirmed", "posted-GL-confirmed"), date(2026, 9, 30),
                       "ServiceTitan Clearing", "Merchant Financing Fees", 1000000, 910000, 90000,
                       90000, True, False, "NETTED", True, True)
        return replace(case, approval_payload_hash=fee_case_approval_hash(case, self.accounts()))

    def accounts(self):
        return {"ServiceTitan Clearing": "OTHER_CURRENT_ASSET", "Merchant Financing Fees": "EXPENSE"}

    def test_aje_balanced_no_bank_duplicate(self):
        aje = make_fee_only_aje(self.case(), self.accounts(), set())
        self.assertEqual(sum(x["debit_cents"] - x["credit_cents"] for x in aje["lines"]), 0)
        self.assertEqual(len(aje["lines"]), 2)
        rows = list(csv.DictReader(io.StringIO(qbo_csv(aje))))
        self.assertEqual(rows[0]["Debits"], "900.00")
        self.assertEqual(rows[1]["Credits"], "900.00")
        iif = qbd_iif(aje)
        self.assertIn("\t-900.00\t", iif)
        self.assertEqual(iif.count("\nTRNS\t"), 1)
        with self.assertRaises(ValueError): make_fee_only_aje(self.case(), self.accounts(), {aje["journal_id"]})

    def test_aje_gates(self):
        changes = [{"is_undeposited_funds": True}, {"bank_posted_to_clearing": False},
                   {"fee_mode": "UNKNOWN"}, {"existing_fee_already_posted": True},
                   {"period_open": False}, {"coverage_complete": False},
                   {"approval_source_hash": "stale"}, {"approved_by": ""},
                   {"clearing_residual_cents": 90001}]
        for change in changes:
            with self.assertRaises(ValueError): make_fee_only_aje(replace(self.case(), **change), self.accounts(), set())
        with self.assertRaises(ValueError): make_fee_only_aje(self.case(), {}, set())

    def test_approval_binds_account_date_and_output_content(self):
        case = self.case()
        accounts = self.accounts() | {"Other Fees": "EXPENSE"}
        for altered in (replace(case, fee_account="Other Fees"), replace(case, journal_date=date(2026, 10, 1))):
            with self.assertRaises(ValueError): make_fee_only_aje(altered, accounts, set())
        aje = make_fee_only_aje(case, self.accounts(), set())
        aje["memo"] = "Changed after approval"
        with self.assertRaises(ValueError): qbo_csv(aje)
        with self.assertRaises(ValueError): qbd_iif(aje)


if __name__ == "__main__":
    unittest.main()
