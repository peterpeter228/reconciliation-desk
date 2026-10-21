"""Accounting and identifiability contract tests for the synthetic data generator.

Run from the kit root: python3 -m unittest discover -s tests -p 'test_synthetic.py' -v
These tests validate fixtures, not the accuracy of a reconciliation engine.
"""

from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
import tempfile
import unittest
from collections import Counter
from datetime import date, datetime
from pathlib import Path


KIT_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("synthetic_generator", KIT_ROOT / "scripts" / "generate_synthetic.py")
assert SPEC and SPEC.loader
gen = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gen)


class SyntheticAccountingContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dataset = gen.build_dataset()
        cls.tables = cls.dataset["tables"]
        cls.key = cls.dataset["answer_key"]
        cls.events = cls.key["events"]

    def test_event_unit_counts_and_exact_250k_receipts(self) -> None:
        self.assertEqual(len(self.events), 350)
        self.assertEqual(sum(event["original_receipt_gross_cents"] for event in self.events), 25_000_000)
        self.assertEqual(Counter(event["ground_truth_cause"] for event in self.events), gen.CAUSE_COUNTS)
        self.assertEqual(sum(event["ground_truth_cause"] != "NORMAL" for event in self.events), 53)
        self.assertEqual(len(self.tables["st_export.csv"]), 350 - 7 + 8 + 8)
        self.assertIn("impossible", self.key["measurement_contract"]["integer_count_note"])

    def test_signed_source_totals_do_not_masquerade_as_revenue(self) -> None:
        actual_st = sum(gen.parse_money(row["Gross Amount"]) for row in self.tables["st_export.csv"])
        outside = sum(event["original_receipt_gross_cents"] for event in self.events if event["ground_truth_cause"] == "OUT_OF_SYSTEM")
        refunds = sum(event["refund_cents"] for event in self.events)
        corrections = sum(event["noncash_correction_cents"] for event in self.events)
        self.assertEqual(actual_st, 25_000_000 - outside - refunds - corrections)
        self.assertNotEqual(actual_st, 25_000_000)
        self.assertEqual(actual_st, self.key["balances"]["st_signed_report_cents"])

    def test_clearing_rollforward_and_residual_equation(self) -> None:
        rows = self.tables["qbo_clearing_gl.csv"]
        debits = sum(gen.parse_money(row["Debit"]) for row in rows)
        credits = sum(gen.parse_money(row["Credit"]) for row in rows)
        for row in rows:
            debit, credit = gen.parse_money(row["Debit"]), gen.parse_money(row["Credit"])
            self.assertGreaterEqual(debit, 0)
            self.assertGreaterEqual(credit, 0)
            self.assertFalse(debit and credit)
            self.assertEqual(gen.parse_money(row["Amount"]), debit - credit)
        held_and_lag = sum(event["original_receipt_gross_cents"] for event in self.events
                           if event["ground_truth_cause"] in {"PROCESSOR_HOLD", "DATE_LAG"})
        unbooked_fees = sum(event["fee_cents"] for event in self.events if event["ground_truth_cause"] == "NET_FEE")
        outside = sum(event["original_receipt_gross_cents"] for event in self.events if event["ground_truth_cause"] == "OUT_OF_SYSTEM")
        self.assertEqual(debits - credits, held_and_lag + unbooked_fees - outside)
        self.assertEqual(debits - credits, self.key["balances"]["clearing_closing_cents"])
        self.assertEqual(debits - credits, sum(event["qb_clearing_contribution_cents"] for event in self.events))
        self.assertFalse(self.key["balances"]["qb_ledger_is_full_double_entry_journal"])

    def test_real_batch_summary_grain_and_unique_line_identity(self) -> None:
        qb_rows = self.tables["qbo_clearing_gl.csv"]
        self.assertEqual(len({row["Line ID"] for row in qb_rows}), len(qb_rows))
        summary_rows = [row for row in qb_rows if row["Debit"] and len(row["_event_ids"]) > 1]
        self.assertGreater(len(summary_rows), 50)
        event_by_id = {event["event_id"]: event for event in self.events}
        for row in summary_rows:
            expected = sum(event_by_id[event_id]["original_receipt_gross_cents"] for event_id in row["_event_ids"])
            self.assertEqual(gen.parse_money(row["Debit"]), expected)
        self.assertTrue(all(row["Accounting Batch Number"] != row["Processor Batch Number"]
                            for row in self.tables["processor_settlements.csv"]))

    def test_bank_balance_and_period_scoping(self) -> None:
        running = gen.OPENING_BANK_CENTS
        for filename in ("chase_bank.csv", "bank_next_period.csv"):
            for row in self.tables[filename]:
                posting = datetime.strptime(row["Posting Date"], "%m/%d/%Y").date()
                if filename == "chase_bank.csv":
                    self.assertLessEqual(posting, gen.CUTOFF)
                    self.assertGreaterEqual(posting, gen.PERIOD_START)
                else:
                    self.assertGreater(posting, gen.CUTOFF)
                running += gen.parse_money(row["Amount"])
                self.assertEqual(gen.parse_money(row["Balance"]), running)
                self.assertTrue(gen.is_business_day(posting))
        positive_credits = sum(max(0, gen.parse_money(row["Amount"])) for row in self.tables["chase_bank.csv"])
        self.assertEqual(positive_credits, sum(event["current_bank_receipt_component_cents"] for event in self.events))
        self.assertEqual(len(self.tables["bank_next_period.csv"]), 10)

    def test_twenty_thousand_absence_is_not_hold_proof(self) -> None:
        event_id = self.key["headline_cases"]["20000_missing_settlement"]["event_id"]
        event = next(event for event in self.events if event["event_id"] == event_id)
        self.assertEqual(event["original_receipt_gross_cents"], 2_000_000)
        self.assertEqual(event["expected_minimum_three_files"]["diagnosis"], "MISSING_SETTLEMENT")
        self.assertNotIn("chase_bank.csv", event["source_refs"])
        self.assertEqual(event["expected_with_evidence"]["diagnosis"], "PROCESSOR_HOLD")
        processor_rows = [row for row in self.tables["processor_settlements.csv"] if row["Payment ID"] == event["st_payment_id"]]
        self.assertEqual(len(processor_rows), 1)
        self.assertEqual(processor_rows[0]["Status"], "HELD")
        self.assertEqual(gen.parse_money(processor_rows[0]["Amount Held"]), 2_000_000)
        self.assertFalse(event["expected_with_evidence"]["fee_aje_draft_eligible"])

    def test_fifty_thousand_heterogeneous_components_need_manifest(self) -> None:
        case = self.key["headline_cases"]["50000_mixed_deposit"]
        self.assertEqual(case["gross_components_cents"], [2_000_000, 1_500_000, 1_200_000, 615_000])
        self.assertEqual(case["components_cents"], [1_820_000, 1_365_000, 1_200_000, 615_000])
        self.assertEqual(sum(case["components_cents"]), 5_000_000)
        self.assertEqual(sum(case["fee_components_cents"]), 315_000)
        mixed_events = [event for event in self.events if event["in_50000_consolidation"]]
        self.assertEqual(len(mixed_events), 4)
        self.assertTrue(all(event["expected_minimum_three_files"]["diagnosis"] == "MIXED_DEPOSIT_NEEDS_COMPONENT_MANIFEST"
                            for event in mixed_events))
        manifest = self.tables["deposit_components.csv"]
        self.assertEqual(len(manifest), 4)
        self.assertEqual(sum(gen.parse_money(row["Net Amount"]) for row in manifest), 5_000_000)
        funding = [row for row in manifest if row["Component Type"] == "NETTED_FINANCING"]
        self.assertEqual(len(funding), 2)
        self.assertTrue(all(row["Fee Mode"] == "netted" and row["Contract Reference"].startswith("SYNTHETIC-") for row in funding))
        bank_row = next(row for row in self.tables["chase_bank.csv"] if case["settlement_group_id"] in row["Description"])
        self.assertEqual(bank_row["Type"], "DEPOSIT")
        self.assertNotIn("ACH", bank_row["Type"])
        self.assertNotIn("GreenSky", bank_row["Description"])

    def test_refunds_and_corrections_keep_original_locked_payment(self) -> None:
        originals = {row["Payment ID"]: row for row in self.tables["st_export.csv"] if row["Record Type"] == "PAYMENT"}
        refunds = [row for row in self.tables["st_export.csv"] if row["Record Type"] == "REFUND"]
        corrections = [row for row in self.tables["st_export.csv"] if row["Record Type"] == "PAYMENT_CORRECTION"]
        self.assertEqual(len(refunds), 8)
        self.assertEqual(len(corrections), 8)
        self.assertTrue(all(not row["Batch Number"] for row in refunds))
        for row in refunds + corrections:
            original = originals[row["Related Payment ID"]]
            self.assertEqual(original["Export Status"], "Exported")
            self.assertGreater(gen.parse_money(original["Gross Amount"]), 0)
            self.assertLess(gen.parse_money(row["Gross Amount"]), 0)
            self.assertEqual(row["Export Status"], "Not Exported")
        self.assertTrue(all(row["Cash Refund Confirmed"] == "No" for row in self.tables["st_audit_events.csv"]))
        bank_debits = [row for row in self.tables["chase_bank.csv"] if gen.parse_money(row["Amount"]) < 0]
        self.assertEqual(len(bank_debits), 8)
        self.assertEqual(-sum(gen.parse_money(row["Amount"]) for row in bank_debits),
                         sum(event["refund_cents"] for event in self.events))

    def test_no_unsupported_aje_from_minimum_three_files(self) -> None:
        self.assertTrue(all(not event["expected_minimum_three_files"]["fee_aje_draft_eligible"] for event in self.events))
        self.assertTrue(all(not event["expected_with_evidence"]["fee_aje_draft_eligible"] for event in self.events))
        math_ready = [event for event in self.events if event["expected_with_evidence"]["fee_proposal_math_ready"]]
        self.assertEqual(len(math_ready), 12)
        self.assertTrue(all(event["ground_truth_cause"] == "NET_FEE" for event in math_ready))
        for event in math_ready:
            expected = event["expected_with_evidence"]
            self.assertEqual(expected["fee_aje_debit_cents"], expected["fee_aje_credit_cents"])
            self.assertEqual(expected["fee_aje_credit_cents"], event["qb_clearing_contribution_cents"])
            self.assertFalse(expected["auto_post_allowed"])

    def test_activity_bridge_is_not_verified_bank_posting_or_accounting_drift(self) -> None:
        self.assertFalse(self.key["balances"]["qb_bank_posting_verified"])
        for event in self.events:
            self.assertEqual(event["expected_with_evidence"]["three_way_matching_state"], "PARTIAL")
            self.assertEqual(event["expected_with_evidence"]["matching_scope"], "ACTIVITY_BRIDGE")
            self.assertIn("QB_BANK_LEG_OR_ITEMIZED_ACCOUNTANT_CONFIRMATION",
                          event["expected_with_evidence"]["missing_required_evidence"])
            if event["ground_truth_cause"] == "POST_EXPORT_DRIFT":
                self.assertEqual(event["expected_with_evidence"]["diagnosis"], "SOURCE_RELATIONSHIP_CHANGE")
                self.assertIn("EXPECTED_QB_OBJECT_AND_ACCOUNTING_EFFECT",
                              event["expected_with_evidence"]["missing_required_evidence"])

    def test_business_calendar_labor_day_and_weekend(self) -> None:
        self.assertEqual(gen.add_business_days(date(2026, 9, 4), 1), date(2026, 9, 8))
        self.assertEqual(gen.add_business_days(date(2026, 9, 4), 2), date(2026, 9, 9))
        self.assertEqual(gen.add_business_days(date(2026, 9, 8), -1), date(2026, 9, 4))
        self.assertEqual(gen.add_business_days(date(2026, 9, 30), 3), date(2026, 10, 5))

    def test_write_provenance_hashes_and_no_answer_leakage(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            gen.write_dataset(temp)
            root = Path(temp)
            key = json.loads((root / "ground_truth_answer_key.json").read_text())
            forbidden = ["ground_truth_cause", "EVT0001", "PROCESSOR_HOLD", "DATE_LAG", "OUT_OF_SYSTEM", "NET_FEE"]
            for filename in ("st_export.csv", "qbo_clearing_gl.csv", "chase_bank.csv"):
                raw = (root / filename).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), key["files"][filename]["sha256"])
                for token in forbidden:
                    self.assertNotIn(token, raw.decode("utf-8"))
                rows = list(csv.DictReader(raw.decode("utf-8").splitlines()))
                self.assertEqual(len(rows), key["files"][filename]["data_rows"])
                fields = self.dataset["fields"][filename]
                for event in key["events"]:
                    for ref in event["source_refs"].get(filename, []):
                        row = rows[ref["csv_row_number"] - 2]
                        self.assertEqual(gen.row_hash(row, fields), ref["row_sha256"])

    def test_seed_reproducibility_and_invariants_across_seeds(self) -> None:
        first = gen.build_dataset(101)
        second = gen.build_dataset(101)
        different = gen.build_dataset(202)
        self.assertEqual(first["answer_key"], second["answer_key"])
        self.assertNotEqual(first["answer_key"]["balances"], different["answer_key"]["balances"])
        for dataset in (first, different):
            self.assertEqual(sum(event["original_receipt_gross_cents"] for event in dataset["answer_key"]["events"]), 25_000_000)
            self.assertEqual(dataset["answer_key"]["headline_cases"]["50000_mixed_deposit"]["bank_cents"], 5_000_000)


if __name__ == "__main__":
    unittest.main()
