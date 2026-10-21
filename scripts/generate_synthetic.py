#!/usr/bin/env python3
"""Deterministic, cents-exact, synthetic three-way reconciliation fixtures.

This is NOT a vendor export specimen.  It models an explicitly documented export
profile and hypothetical netted-fee contracts.  In particular, a GreenSky brand
name does not establish fee timing, fee accounting, or net settlement.

Usage: python3 scripts/generate_synthetic.py --out samples --seed 20261021
Only Python's standard library is required (Python 3.10+).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any


DEFAULT_SEED = 20261021
PERIOD_START = date(2026, 9, 1)
CUTOFF = date(2026, 9, 30)
HOLIDAYS = {date(2026, 9, 7)}  # US Labor Day; explicit fixture calendar only.
GROSS_RECEIPTS_CENTS = 25_000_000
OPENING_CLEARING_CENTS = 0
OPENING_BANK_CENTS = 4_250_000
CLEARING_ACCOUNT = "ServiceTitan Clearing"
BANK_ACCOUNT = "Collections Checking"
CAUSE_COUNTS = {
    "NORMAL": 297,
    "DATE_LAG": 10,
    "NET_FEE": 12,
    "UNBATCHED_REFUND": 8,
    "POST_EXPORT_DRIFT": 8,
    "OUT_OF_SYSTEM": 7,
    "PROCESSOR_HOLD": 8,
}

ST_FIELDS = [
    "Payment ID", "Related Payment ID", "Record Type", "Payment Date",
    "Batch Number", "Batch Close Date", "Batch Post Date", "Invoice #",
    "Customer Name", "Business Unit", "Payment Type", "Processor",
    "Gross Amount", "Net Amount", "GL Account Code", "Export Status",
    "Payment Status", "Reference", "Currency",
]
QB_FIELDS = [
    "Transaction ID", "Line ID", "Date", "Transaction Type", "Num", "Name",
    "Memo/Description", "Account", "Split", "Debit", "Credit", "Amount", "Clr",
]
BANK_FIELDS = [
    "Details", "Posting Date", "Description", "Amount", "Type", "Balance",
    "Check or Slip #",
]
PROCESSOR_FIELDS = [
    "Statement Line ID", "As Of Date", "Payment ID", "Accounting Batch Number",
    "Processor Batch Number", "Settlement Reference", "Processor", "Status",
    "Gross Amount", "Fee Amount", "Net Amount", "Amount Held", "Fee Mode",
    "Scheduled Settlement Date", "Actual Settlement Date", "Contract Reference",
    "Evidence Document",
]
AUDIT_FIELDS = [
    "Audit Event ID", "Event At", "Action", "Original Payment ID",
    "Correction Payment ID", "Original Accounting Batch Number",
    "Original Exported At", "Original Receipt Amount", "Correction Amount",
    "Current Application Total", "Cash Refund Confirmed", "Evidence Document",
]
EXTERNAL_FIELDS = [
    "Receipt ID", "Received Date", "Customer", "Method", "Amount",
    "ST Payment ID", "Entered In ST", "Deposit Reference", "Check Number",
    "Evidence Document",
]
COMPONENT_FIELDS = [
    "Deposit Reference", "Bank Posting Date", "Bank Amount",
    "Component Reference", "ST Payment ID", "Component Type", "Gross Amount",
    "Fee Amount", "Net Amount", "Fee Mode", "Contract Reference",
    "Evidence Document",
]


def money(cents: int) -> str:
    """No binary floating point in money formatting or accounting operations."""
    sign = "-" if cents < 0 else ""
    value = abs(cents)
    return f"{sign}{value // 100}.{value % 100:02d}"


def parse_money(value: str) -> int:
    """Parse this fixture's exact decimal format, including negative values."""
    if not value:
        return 0
    negative = value.startswith("-")
    whole, fraction = value.lstrip("-").split(".")
    assert len(fraction) == 2
    amount = int(whole) * 100 + int(fraction)
    return -amount if negative else amount


def fee_cents(gross: int, basis_points: int, fixed_cents: int = 0) -> int:
    """Positive-value half-up cent rounding; rates are integer basis points."""
    return (gross * basis_points + 5_000) // 10_000 + fixed_cents


def is_business_day(value: date) -> bool:
    return value.weekday() < 5 and value not in HOLIDAYS


def add_business_days(value: date, count: int) -> date:
    direction = 1 if count >= 0 else -1
    remaining = abs(count)
    while remaining:
        value += timedelta(days=direction)
        if is_business_day(value):
            remaining -= 1
    return value


def us_date(value: date | None) -> str:
    return value.strftime("%m/%d/%Y") if value else ""


def row_hash(row: dict[str, Any], fields: list[str]) -> str:
    content = {field: str(row.get(field, "")) for field in fields}
    payload = json.dumps(content, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def build_dataset(seed: int = DEFAULT_SEED) -> dict[str, Any]:
    rng = random.Random(seed)
    events: list[dict[str, Any]] = []
    by_cause: dict[str, list[dict[str, Any]]] = defaultdict(list)
    first_names = ["Morgan", "Taylor", "Jordan", "Casey", "Avery", "Riley", "Parker", "Alex"]
    last_names = ["Bennett", "Carter", "Miller", "Patel", "Brooks", "Reed", "Hayes", "Morgan"]

    for cause, count in CAUSE_COUNTS.items():
        for _ in range(count):
            index = len(events) + 1
            event = {
                "event_id": f"EVT{index:04d}",
                "cause": cause,
                "payment_id": f"PMT{740_000 + index}",
                "invoice_id": f"INV{92_000 + index}",
                "customer": f"{first_names[index % 8]} {last_names[(index // 8) % 8]} {index:03d}",
                "business_unit": ["HVAC Service", "HVAC Install", "Plumbing Service"][index % 3],
                "gross_cents": None,
                "fee_cents": 0,
                "refund_cents": 0,
                "correction_cents": 0,
                "mixed": False,
                "source_refs": defaultdict(list),
            }
            events.append(event)
            by_cause[cause].append(event)

    # Five deliberately fixed receipts: a $20k hold and a $50k consolidation.
    fixed = [
        (by_cause["PROCESSOR_HOLD"][0], 2_000_000),
        (by_cause["NET_FEE"][0], 2_000_000),
        (by_cause["NET_FEE"][1], 1_500_000),
        (by_cause["NORMAL"][0], 1_200_000),
        (by_cause["OUT_OF_SYSTEM"][0], 615_000),
    ]
    for event, amount in fixed:
        event["gross_cents"] = amount
    mixed_events = [by_cause["NET_FEE"][0], by_cause["NET_FEE"][1],
                    by_cause["NORMAL"][0], by_cause["OUT_OF_SYSTEM"][0]]
    for event in mixed_events:
        event["mixed"] = True

    variable = [event for event in events if event["gross_cents"] is None]
    minimum = 8_000
    remainder = GROSS_RECEIPTS_CENTS - sum(amount for _, amount in fixed) - minimum * len(variable)
    weights = [rng.randint(70, 850) * rng.choice([1, 1, 1, 2, 4]) for _ in variable]
    weight_sum = sum(weights)
    allocations = [remainder * weight // weight_sum for weight in weights]
    rounding_remainder = remainder - sum(allocations)
    # Largest remainder apportionment preserves both the total and seed determinism.
    remainder_order = sorted(range(len(variable)),
                             key=lambda i: (-(remainder * weights[i] % weight_sum), i))
    for index in remainder_order[:rounding_remainder]:
        allocations[index] += 1
    for event, allocation in zip(variable, allocations):
        event["gross_cents"] = minimum + allocation

    tables: dict[str, list[dict[str, Any]]] = {
        "st_export.csv": [],
        "qbo_clearing_gl.csv": [],
        "chase_bank.csv": [],
        "processor_settlements.csv": [],
        "st_audit_events.csv": [],
        "external_receipts.csv": [],
        "bank_next_period.csv": [],
        "deposit_components.csv": [],
    }
    settlement_groups: list[dict[str, Any]] = []
    qb_serial = 0
    bank_serial = 0
    processor_serial = 0
    batch_serial = 430_100

    def new_batch() -> str:
        nonlocal batch_serial
        batch_serial += 1
        return str(batch_serial)

    def qb_line(members: list[dict[str, Any]], day: date, tx_type: str,
                num: str, debit: int, credit: int, split: str, memo: str,
                transaction_id: str | None = None) -> None:
        nonlocal qb_serial
        qb_serial += 1
        tables["qbo_clearing_gl.csv"].append({
            "Transaction ID": transaction_id or f"QB{810_000 + qb_serial}",
            "Line ID": f"QL{910_000 + qb_serial}",
            "Date": us_date(day), "Transaction Type": tx_type, "Num": num,
            "Name": members[0]["customer"] if len(members) == 1 else "",
            "Memo/Description": memo, "Account": CLEARING_ACCOUNT, "Split": split,
            "Debit": money(debit) if debit else "",
            "Credit": money(credit) if credit else "",
            "Amount": money(debit - credit), "Clr": "",
            "_event_ids": [member["event_id"] for member in members],
            "_date": day,
        })

    def bank_row(members: list[dict[str, Any]], day: date, amount: int,
                 description: str, kind: str, slip: str = "", next_period: bool = False) -> str:
        nonlocal bank_serial
        bank_serial += 1
        internal_id = f"BR{610_000 + bank_serial}"
        table = "bank_next_period.csv" if next_period else "chase_bank.csv"
        tables[table].append({
            "Details": "CREDIT" if amount >= 0 else "DEBIT",
            "Posting Date": us_date(day), "Description": description,
            "Amount": money(amount), "Type": kind, "Balance": "",
            "Check or Slip #": slip,
            "_event_ids": [member["event_id"] for member in members],
            "_date": day, "_id": internal_id,
        })
        return internal_id

    def st_row(event: dict[str, Any], record_type: str = "PAYMENT", amount: int | None = None,
               day: date | None = None, batch: str | None = None) -> None:
        is_original = record_type == "PAYMENT"
        suffix = "" if is_original else ("R" if record_type == "REFUND" else "A")
        amount = event["gross_cents"] if amount is None else amount
        known_net = event["cause"] in {"NORMAL", "UNBATCHED_REFUND", "POST_EXPORT_DRIFT", "DATE_LAG"}
        if is_original and known_net:
            net = money(amount - event["fee_cents"])
        elif record_type == "REFUND":
            net = money(amount)
        else:
            net = ""
        tables["st_export.csv"].append({
            "Payment ID": event["payment_id"] + suffix,
            "Related Payment ID": "" if is_original else event["payment_id"],
            "Record Type": record_type,
            "Payment Date": us_date(day or event["close_date"]),
            "Batch Number": event["batch"] if is_original else (batch or ""),
            "Batch Close Date": us_date(event["close_date"]) if is_original else "",
            "Batch Post Date": us_date(event["close_date"]) if is_original else "",
            "Invoice #": event["invoice_id"], "Customer Name": event["customer"],
            "Business Unit": event["business_unit"],
            "Payment Type": event["method"] if record_type != "PAYMENT_CORRECTION" else "Adjustment",
            "Processor": event["processor"] if record_type != "PAYMENT_CORRECTION" else "",
            "Gross Amount": money(amount), "Net Amount": net,
            "GL Account Code": "1055", "Export Status": "Exported" if is_original else "Not Exported",
            "Payment Status": "Completed" if is_original else (
                "Refunded" if record_type == "REFUND" else "Application Adjusted"),
            "Reference": event.get("reference", "") if is_original else event["payment_id"],
            "Currency": "USD", "_event_ids": [event["event_id"]],
            "_date": day or event["close_date"],
        })

    def processor_row(event: dict[str, Any], status: str, settlement_ref: str = "",
                      actual: date | None = None, scheduled: date | None = None,
                      held: int = 0, fee_mode: str = "netted", amount_override: int | None = None,
                      payment_suffix: str = "") -> None:
        nonlocal processor_serial
        processor_serial += 1
        gross = event["gross_cents"] if amount_override is None else amount_override
        fee = event["fee_cents"] if amount_override is None else 0
        contract_ref = "SYNTHETIC-NETTED-FUNDING-09" if event["processor"] == "GreenSky" else "SYNTHETIC-MERCHANT-09"
        tables["processor_settlements.csv"].append({
            "Statement Line ID": f"PS{720_000 + processor_serial}", "As Of Date": us_date(CUTOFF),
            "Payment ID": event["payment_id"] + payment_suffix,
            "Accounting Batch Number": event["batch"],
            "Processor Batch Number": f"P{530_000 + int(event['payment_id'][3:]) % 100_000}",
            "Settlement Reference": settlement_ref, "Processor": event["processor"],
            "Status": status, "Gross Amount": money(gross),
            "Fee Amount": "" if held else money(fee),
            "Net Amount": "" if held else money(gross - fee),
            "Amount Held": money(held), "Fee Mode": fee_mode,
            "Scheduled Settlement Date": us_date(scheduled),
            "Actual Settlement Date": us_date(actual),
            "Contract Reference": contract_ref,
            "Evidence Document": f"synthetic/processor_statement_2026_09.pdf#PS{720_000 + processor_serial}",
            "_event_ids": [event["event_id"]],
        })

    def receipt_group(members: list[dict[str, Any]], close_day: date, method: str,
                      settle_day: date, kind: str, fee_bps: int = 0,
                      fixed_fee: int = 0, missing_fee: bool = False,
                      future: bool = False) -> None:
        batch = new_batch()
        payout_ref = f"SET{870_000 + len(settlement_groups) + 1}"
        for event in members:
            event.update({"batch": batch, "close_date": close_day, "settle_date": settle_day,
                          "method": method, "processor": "ST Payments" if method in {"Visa", "MasterCard", "Amex", "ACH"} else "",
                          "reference": f"AUTH{510_000 + int(event['payment_id'][3:]) % 100_000}"})
            if method == "Financing":
                event["processor"] = "GreenSky"
            event["fee_cents"] = fee_cents(event["gross_cents"], fee_bps, fixed_fee) if fee_bps or fixed_fee else 0
            st_row(event)
        gross = sum(member["gross_cents"] for member in members)
        fees = sum(member["fee_cents"] for member in members)
        net = gross - fees
        qb_line(members, close_day, "Journal Entry", batch, gross, 0, "Accounts Receivable",
                f"ServiceTitan accounting batch {batch} export")
        if not future:
            qb_line(members, settle_day, "Deposit", payout_ref, 0, net, BANK_ACCOUNT,
                    f"Collections deposit {payout_ref}")
            if fees and not missing_fee:
                qb_line(members, settle_day, "Journal Entry", f"FEE{batch}", 0, fees,
                        "Merchant Processing Fees", f"Processor fee statement {payout_ref}")
        description = f"MERCHANT SETTLEMENT {payout_ref}" if method in {"Visa", "MasterCard", "Amex"} else (
            f"FUNDING CREDIT {payout_ref}" if method == "Financing" else f"DEPOSIT {payout_ref}")
        bank_id = bank_row(members, settle_day, net, description, kind, next_period=future)
        settlement_groups.append({
            "group_id": payout_ref, "event_ids": [event["event_id"] for event in members],
            "bank_internal_id": bank_id, "bank_file": "bank_next_period.csv" if future else "chase_bank.csv",
            "gross_cents": gross, "fee_cents": fees, "bank_net_cents": net,
            "source": "future_statement" if future else "ordinary_settlement",
        })
        for event in members:
            event["settlement_group"] = payout_ref
            if event["processor"]:
                processor_row(event, "PENDING" if future else "SETTLED", payout_ref,
                              actual=None if future else settle_day,
                              scheduled=settle_day if future else None,
                              fee_mode="none" if fees == 0 else "netted")

    early_days = [PERIOD_START + timedelta(days=i) for i in range(20)
                  if is_business_day(PERIOD_START + timedelta(days=i))]
    # True batch-summary exports: up to 3 ST receipts become one QB debit and
    # one bank payout.  The accounting batch and processor batch are distinct.
    normals = by_cause["NORMAL"][1:]
    methods = ["Visa", "Check", "ACH", "MasterCard", "Cash", "Amex"]
    for group_index in range(0, len(normals), 3):
        members = normals[group_index:group_index + 3]
        method = methods[(group_index // 3) % len(methods)]
        close_day = rng.choice(early_days)
        settle_day = add_business_days(close_day, 2 if method in {"Visa", "MasterCard", "Amex", "ACH"} else 1)
        card = method in {"Visa", "MasterCard", "Amex"}
        receipt_group(members, close_day, method, settle_day,
                      "ACH_CREDIT" if card or method == "ACH" else "DEPOSIT",
                      fee_bps=290 if card else 0, fixed_fee=30 if card else 0)

    for index, event in enumerate(by_cause["DATE_LAG"]):
        close_day = date(2026, 9, 29 if index % 2 == 0 else 30)
        settle_day = add_business_days(close_day, 3 + index % 3)
        receipt_group([event], close_day, "ACH", settle_day, "ACH_CREDIT", future=True)

    for index, event in enumerate(by_cause["NET_FEE"][2:]):
        close_day = rng.choice(early_days)
        financing = index % 2 == 0
        receipt_group([event], close_day, "Financing" if financing else "Visa",
                      add_business_days(close_day, 2), "ACH_CREDIT",
                      fee_bps=900 if financing else 290,
                      fixed_fee=0 if financing else 30, missing_fee=True)

    for index, event in enumerate(by_cause["UNBATCHED_REFUND"]):
        close_day = date(2026, 9, 2) + timedelta(days=index)
        while not is_business_day(close_day):
            close_day += timedelta(days=1)
        settle_day = add_business_days(close_day, 2)
        receipt_group([event], close_day, "Visa", settle_day, "ACH_CREDIT", fee_bps=290, fixed_fee=30)
        event["refund_cents"] = min(event["gross_cents"] // 2, 25_000)
        refund_day = add_business_days(settle_day, 3)
        st_row(event, "REFUND", -event["refund_cents"], refund_day)
        refund_ref = f"REF{event['payment_id']}"
        bank_row([event], refund_day, -event["refund_cents"],
                 f"MERCHANT REFUND {refund_ref}", "ACH_DEBIT")
        processor_row(event, "REFUND_SETTLED", refund_ref, actual=refund_day,
                      amount_override=-event["refund_cents"], payment_suffix="R", fee_mode="none")

    for index, event in enumerate(by_cause["POST_EXPORT_DRIFT"]):
        close_day = early_days[index]
        settle_day = add_business_days(close_day, 1)
        receipt_group([event], close_day, "Check", settle_day, "DEPOSIT")
        correction_day = add_business_days(settle_day, 3)
        event["correction_cents"] = max(1_000, event["gross_cents"] // 5)
        correction_batch = new_batch()
        st_row(event, "PAYMENT_CORRECTION", -event["correction_cents"],
               correction_day, correction_batch)
        tables["st_audit_events.csv"].append({
            "Audit Event ID": f"AUD{940_001 + index}",
            "Event At": correction_day.isoformat() + "T11:15:00-04:00",
            "Action": "PAYMENT_APPLICATION_CORRECTION_CREATED",
            "Original Payment ID": event["payment_id"],
            "Correction Payment ID": event["payment_id"] + "A",
            "Original Accounting Batch Number": event["batch"],
            "Original Exported At": close_day.isoformat() + "T18:00:00-04:00",
            "Original Receipt Amount": money(event["gross_cents"]),
            "Correction Amount": money(-event["correction_cents"]),
            "Current Application Total": money(event["gross_cents"] - event["correction_cents"]),
            "Cash Refund Confirmed": "No",
            "Evidence Document": f"synthetic/audit_history_2026_09.pdf#AUD{940_001 + index}",
            "_event_ids": [event["event_id"]],
        })

    for index, event in enumerate(by_cause["OUT_OF_SYSTEM"][1:]):
        day = early_days[(index * 2 + 1) % len(early_days)]
        event.update({"close_date": day, "settle_date": day, "batch": "",
                      "method": "Check" if index % 2 == 0 else "ACH", "processor": ""})
        deposit_ref = f"DEP{660_001 + index}"
        qb_line([event], day, "Deposit", deposit_ref, 0, event["gross_cents"], BANK_ACCOUNT,
                f"Collections deposit {deposit_ref}")
        bank_id = bank_row([event], day, event["gross_cents"],
                           f"REMOTE ONLINE DEPOSIT {deposit_ref}", "DEPOSIT")
        settlement_groups.append({"group_id": deposit_ref, "event_ids": [event["event_id"]],
                                  "bank_internal_id": bank_id, "bank_file": "chase_bank.csv",
                                  "gross_cents": event["gross_cents"], "fee_cents": 0,
                                  "bank_net_cents": event["gross_cents"], "source": "outside_receipt"})
        event["settlement_group"] = deposit_ref
        tables["external_receipts.csv"].append({
            "Receipt ID": f"OFF{550_001 + index}", "Received Date": us_date(day),
            "Customer": event["customer"], "Method": event["method"], "Amount": money(event["gross_cents"]),
            "ST Payment ID": "", "Entered In ST": "No", "Deposit Reference": deposit_ref,
            "Check Number": str(2401 + index) if event["method"] == "Check" else "",
            "Evidence Document": f"synthetic/office_receipt_register.pdf#OFF{550_001 + index}",
            "_event_ids": [event["event_id"]],
        })

    for index, event in enumerate(by_cause["PROCESSOR_HOLD"]):
        close_day = date(2026, 9, 14) if index == 0 else early_days[index % 8]
        event.update({"batch": new_batch(), "close_date": close_day, "settle_date": None,
                      "method": "Visa", "processor": "ST Payments", "reference": f"AUTH{580_001 + index}"})
        st_row(event)
        qb_line([event], close_day, "Journal Entry", event["batch"], event["gross_cents"], 0,
                "Accounts Receivable", f"ServiceTitan accounting batch {event['batch']} export")
        processor_row(event, "HELD", held=event["gross_cents"], fee_mode="unknown")

    # Stress fixture: a documented treasury / statement consolidation.  It is
    # intentionally NOT claimed to be a normal single ACH from GreenSky.
    mixed_ref = "CONSOL260918"
    mixed_day = date(2026, 9, 18)
    mixed_close = date(2026, 9, 16)
    mixed_qb_tx = "QB899901"
    for index, event in enumerate(mixed_events):
        event.update({"batch": "" if event["cause"] == "OUT_OF_SYSTEM" else new_batch(),
                      "close_date": mixed_close, "settle_date": mixed_day,
                      "method": "Financing" if index < 2 else "Check",
                      "processor": "GreenSky" if index < 2 else "",
                      "reference": f"FUND{790_001 + index}" if index < 2 else str(2701 + index),
                      "settlement_group": mixed_ref})
        event["fee_cents"] = fee_cents(event["gross_cents"], 900) if index < 2 else 0
        if event["cause"] != "OUT_OF_SYSTEM":
            st_row(event)
            qb_line([event], mixed_close, "Journal Entry", event["batch"], event["gross_cents"], 0,
                    "Accounts Receivable", f"ServiceTitan accounting batch {event['batch']} export")
        qb_line([event], mixed_day, "Deposit", mixed_ref, 0,
                event["gross_cents"] - event["fee_cents"], BANK_ACCOUNT,
                f"Documented collections consolidation {mixed_ref}", transaction_id=mixed_qb_tx)
        if index < 2:
            processor_row(event, "SETTLED", f"FUND{790_001 + index}", actual=mixed_day, fee_mode="netted")
        if event["cause"] == "OUT_OF_SYSTEM":
            tables["external_receipts.csv"].append({
                "Receipt ID": "OFF559901", "Received Date": us_date(mixed_close), "Customer": event["customer"],
                "Method": "Check", "Amount": money(event["gross_cents"]), "ST Payment ID": "",
                "Entered In ST": "No", "Deposit Reference": mixed_ref, "Check Number": "2704",
                "Evidence Document": "synthetic/office_receipt_register.pdf#OFF559901",
                "_event_ids": [event["event_id"]],
            })
        tables["deposit_components.csv"].append({
            "Deposit Reference": mixed_ref, "Bank Posting Date": us_date(mixed_day), "Bank Amount": "50000.00",
            "Component Reference": event["reference"],
            "ST Payment ID": "" if event["cause"] == "OUT_OF_SYSTEM" else event["payment_id"],
            "Component Type": "NETTED_FINANCING" if index < 2 else (
                "ST_CHECK" if index == 2 else "OFFICE_CHECK"),
            "Gross Amount": money(event["gross_cents"]), "Fee Amount": money(event["fee_cents"]),
            "Net Amount": money(event["gross_cents"] - event["fee_cents"]),
            "Fee Mode": "netted" if index < 2 else "none",
            "Contract Reference": "SYNTHETIC-NETTED-FUNDING-09" if index < 2 else "",
            "Evidence Document": "synthetic/consolidation_manifest_20260918.pdf",
            "_event_ids": [event["event_id"]],
        })
    assert sum(event["gross_cents"] - event["fee_cents"] for event in mixed_events) == 5_000_000
    mixed_bank_id = bank_row(mixed_events, mixed_day, 5_000_000,
                             f"CONSOLIDATED DEPOSIT {mixed_ref}", "DEPOSIT", "728104")
    settlement_groups.append({"group_id": mixed_ref, "event_ids": [event["event_id"] for event in mixed_events],
                              "bank_internal_id": mixed_bank_id, "bank_file": "chase_bank.csv",
                              "gross_cents": 5_315_000, "fee_cents": 315_000,
                              "bank_net_cents": 5_000_000, "source": "documented_consolidation",
                              "minimum_three_file_result": "NEEDS_COMPONENT_MANIFEST",
                              "enhanced_result": "COMPONENT_ALLOCATION_CONFIRMED"})

    tables["st_export.csv"].sort(key=lambda row: (row["_date"], row["Payment ID"]))
    tables["qbo_clearing_gl.csv"].sort(key=lambda row: (row["_date"], row["Transaction ID"], row["Line ID"]))
    bank_balance = OPENING_BANK_CENTS
    for filename in ("chase_bank.csv", "bank_next_period.csv"):
        tables[filename].sort(key=lambda row: (row["_date"], row["_id"]))
        for row in tables[filename]:
            bank_balance += parse_money(row["Amount"])
            row["Balance"] = money(bank_balance)

    fields_by_file = {
        "st_export.csv": ST_FIELDS, "qbo_clearing_gl.csv": QB_FIELDS,
        "chase_bank.csv": BANK_FIELDS, "processor_settlements.csv": PROCESSOR_FIELDS,
        "st_audit_events.csv": AUDIT_FIELDS, "external_receipts.csv": EXTERNAL_FIELDS,
        "bank_next_period.csv": BANK_FIELDS, "deposit_components.csv": COMPONENT_FIELDS,
    }
    event_lookup = {event["event_id"]: event for event in events}
    bank_ref_lookup: dict[str, dict[str, Any]] = {}
    for filename, rows in tables.items():
        for row_number, row in enumerate(rows, 2):
            reference = {"file": filename, "csv_row_number": row_number,
                         "row_sha256": row_hash(row, fields_by_file[filename])}
            for field in ("Payment ID", "Transaction ID", "Line ID", "Statement Line ID", "Audit Event ID", "Receipt ID"):
                if row.get(field):
                    reference[field] = row[field]
            if "_id" in row:
                bank_ref_lookup[row["_id"]] = reference
            for event_id in row["_event_ids"]:
                event_lookup[event_id]["source_refs"][filename].append(reference)
    for group in settlement_groups:
        group["bank_source_ref"] = bank_ref_lookup.pop(group.pop("bank_internal_id"))

    states = {
        "NORMAL": ("ACTIVITY_BRIDGE_RECONCILED", "SUPPORTED_ASSOCIATION", "ACTIVITY_BRIDGE_RECONCILED", "SUPPORTED_ASSOCIATION"),
        "DATE_LAG": ("IN_TRANSIT_CANDIDATE", "CANDIDATE", "DATE_LAG", "PROVED_BY_NEXT_PERIOD_BANK"),
        "NET_FEE": ("NET_DEDUCTION_CANDIDATE", "CANDIDATE", "NET_FEE_CONFIRMED_LEDGER_REVIEW", "SUPPORTED_PENDING_QB_BANK_AND_FEE_REVIEW"),
        "UNBATCHED_REFUND": ("UNEXPORTED_REFUND_RECORD", "OBSERVED_NOT_ROOT_CAUSE", "ST_UNBATCHED_REFUND_QB_STATUS_UNKNOWN", "SUPPORTED_PENDING_QB_REFUND_REVIEW"),
        "POST_EXPORT_DRIFT": ("UNEXPORTED_PAYMENT_CORRECTION", "OBSERVED_NOT_ROOT_CAUSE", "SOURCE_RELATIONSHIP_CHANGE", "SUPPORTED_NOT_ACCOUNTING_DRIFT_PROOF"),
        "OUT_OF_SYSTEM": ("BANK_QB_CREDIT_WITHOUT_ST_MATCH", "CANDIDATE", "OUT_OF_SYSTEM", "PROVED_BY_EXTERNAL_RECEIPT_AND_SCOPE"),
        "PROCESSOR_HOLD": ("MISSING_SETTLEMENT", "INSUFFICIENT_FOR_HOLD", "PROCESSOR_HOLD", "PROVED_BY_PROCESSOR_HOLD_STATEMENT"),
    }
    expected_events: list[dict[str, Any]] = []
    for event in events:
        cause = event["cause"]
        gross, fees = event["gross_cents"], event["fee_cents"]
        minimum_diagnosis, minimum_evidence, enhanced_diagnosis, enhanced_evidence = states[cause]
        if event["mixed"]:
            minimum_diagnosis = "MIXED_DEPOSIT_NEEDS_COMPONENT_MANIFEST"
            minimum_evidence = "CANDIDATE_COMPONENTS_ONLY"
        st_signed = 0 if cause == "OUT_OF_SYSTEM" else gross - event["refund_cents"] - event["correction_cents"]
        clearing_delta = (gross if cause in {"DATE_LAG", "PROCESSOR_HOLD"} else
                          fees if cause == "NET_FEE" else -gross if cause == "OUT_OF_SYSTEM" else 0)
        posted_receipt = 0 if cause in {"DATE_LAG", "PROCESSOR_HOLD"} else gross - fees
        expected_events.append({
            "event_id": event["event_id"], "ground_truth_cause": cause,
            "original_receipt_gross_cents": gross,
            "st_payment_id": None if cause == "OUT_OF_SYSTEM" else event["payment_id"],
            "accounting_batch_number": event["batch"] or None,
            "fee_cents": fees, "refund_cents": event["refund_cents"],
            "noncash_correction_cents": event["correction_cents"],
            "st_signed_report_amount_cents": st_signed,
            "qb_clearing_contribution_cents": clearing_delta,
            "current_bank_receipt_component_cents": posted_receipt,
            "current_bank_refund_cents": -event["refund_cents"],
            "settlement_group_id": event.get("settlement_group"),
            "in_50000_consolidation": event["mixed"],
            "expected_minimum_three_files": {
                "diagnosis": minimum_diagnosis, "evidence_level": minimum_evidence,
                "fee_aje_draft_eligible": False,
                "cash_match": "CONFIRMED" if cause == "NORMAL" and not event["mixed"] else "REVIEW",
                "matching_scope": "ACTIVITY_BRIDGE", "three_way_matching_state": "PARTIAL",
                "missing_required_evidence": ["QB_BANK_LEG_OR_ITEMIZED_ACCOUNTANT_CONFIRMATION"],
                "auto_post_allowed": False,
            },
            "expected_with_evidence": {
                "diagnosis": enhanced_diagnosis, "evidence_level": enhanced_evidence,
                "matching_scope": "ACTIVITY_BRIDGE", "three_way_matching_state": "PARTIAL",
                "fee_proposal_math_ready": cause == "NET_FEE",
                "fee_aje_draft_eligible": False,
                "fee_aje_type": "FEE_ONLY_CLEARING_RESIDUAL" if cause == "NET_FEE" else None,
                "fee_aje_debit_cents": fees if cause == "NET_FEE" else 0,
                "fee_aje_credit_cents": fees if cause == "NET_FEE" else 0,
                "required_approval": "reviewer_and_account_mapping" if cause == "NET_FEE" else None,
                "missing_required_evidence": ["QB_BANK_LEG_OR_ITEMIZED_ACCOUNTANT_CONFIRMATION"] + (
                    ["EXPECTED_QB_OBJECT_AND_ACCOUNTING_EFFECT", "QB_TARGET_OBJECT_ACTIVITY_HISTORY"] if cause == "POST_EXPORT_DRIFT" else
                    ["QB_EXPENSE_DUPLICATE_REVIEW", "EXISTING_ACCOUNT_MAPPING_AND_REVIEW_APPROVAL"] if cause == "NET_FEE" else
                    ["QB_REFUND_POSTING_COVERAGE"] if cause == "UNBATCHED_REFUND" else []),
                "auto_post_allowed": False,
            },
            "source_refs": dict(event["source_refs"]),
        })

    qb_debits = sum(parse_money(row["Debit"]) for row in tables["qbo_clearing_gl.csv"])
    qb_credits = sum(parse_money(row["Credit"]) for row in tables["qbo_clearing_gl.csv"])
    closing_clearing = OPENING_CLEARING_CENTS + qb_debits - qb_credits
    bank_receipts = sum(max(0, parse_money(row["Amount"])) for row in tables["chase_bank.csv"])
    bank_refunds = sum(min(0, parse_money(row["Amount"])) for row in tables["chase_bank.csv"])
    closing_bank = OPENING_BANK_CENTS + bank_receipts + bank_refunds
    answer_key = {
        "schema_version": "1.0.0", "generator_seed": seed,
        "synthetic_only": True,
        "company": "Cedar Ridge Home Services LLC — fictional",
        "period": {"start": PERIOD_START.isoformat(), "cutoff": CUTOFF.isoformat(),
                   "timezone": "America/New_York", "currency": "USD",
                   "business_day_calendar": "US weekdays excluding 2026-09-07; fixture-local calendar",
                   "business_day_count_convention": "exclude close day; include settlement day"},
        "measurement_contract": {
            "count_unit": "350 original economic receipt events; follow-up refunds/corrections are extra source rows",
            "gross_receipts_cents": GROSS_RECEIPTS_CENTS,
            "gross_is_not": "ST signed report total, net bank credits, invoice revenue, or each source file's row total",
            "normal_events": 297, "anomaly_events": 53,
            "normal_fraction": "297/350 = 84.857142857%", "anomaly_fraction": "53/350 = 15.142857143%",
            "integer_count_note": "Exactly 85% of 350 is 297.5 and is impossible for whole events; rounding is disclosed.",
            "cause_counts": CAUSE_COUNTS,
            "refund_follow_up_rows": 8, "noncash_correction_follow_up_rows": 8,
            "original_locked_records_remain_unchanged": True,
            "normal_classification_does_not_guarantee_three_file_identifiability": True,
            "reconciled_activity_is_not_verified_three_way": True,
            "cause_label_scope": "Seeded scenario family, not a license to confirm that cause from supplied files. POST_EXPORT_DRIFT seeds a post-export relationship correction; the expected QB accounting effect is intentionally not proved.",
        },
        "export_profile": {
            "label": "SYNTHETIC_ADAPTER_PROFILE_NOT_VENDOR_CERTIFIED",
            "st": "Combined receipt/adjustment profile with optional net columns; verify native report fields per tenant.",
            "qb": "Accrual, selected ServiceTitan Clearing asset account only; summary batch debits and deposit/fee credits.",
            "bank": "Chase-style synthetic collection-account activity, signed credits/debits; no claim of a universal Chase CSV.",
            "accounting_batch_is_not_processor_batch": True,
            "noncash_corrections_are_not_bank_refunds": True,
            "green_sky_fee_mode": "Hypothetical, explicitly evidenced netted contract. Not a claim about GreenSky default billing.",
            "mixed_deposit": "Documented treasury/statement consolidation stress case, not a presumed single GreenSky ACH.",
            "evidence_document_paths": "Illustrative provenance labels; these PDF files are not generated or asserted to exist.",
            "complete_scope_assumption": "All in-scope receipts/refunds for the fictional collections account and period are included; no real-world completeness claim.",
        },
        "balances": {
            "clearing_opening_cents": OPENING_CLEARING_CENTS,
            "clearing_period_debits_cents": qb_debits,
            "clearing_period_credits_cents": qb_credits,
            "clearing_closing_cents": closing_clearing,
            "bank_opening_cents": OPENING_BANK_CENTS,
            "bank_receipt_credits_cents": bank_receipts,
            "bank_refund_debits_signed_cents": bank_refunds,
            "bank_closing_cents": closing_bank,
            "next_period_bank_receipts_cents": sum(parse_money(row["Amount"]) for row in tables["bank_next_period.csv"]),
            "st_signed_report_cents": sum(parse_money(row["Gross Amount"]) for row in tables["st_export.csv"]),
            "qb_ledger_is_full_double_entry_journal": False,
            "qb_counterpart_lines_are_omitted_by_account_filter": True,
            "qb_bank_posting_verified": False,
        },
        "headline_cases": {
            "20000_missing_settlement": {
                "event_id": by_cause["PROCESSOR_HOLD"][0]["event_id"],
                "gross_cents": 2_000_000,
                "minimum_three_files": "missing settlement; hold cannot be proved from absence",
                "enhanced": "explicit processor status HELD and Amount Held = 20000.00",
                "aje_allowed": False,
            },
            "50000_mixed_deposit": {
                "settlement_group_id": mixed_ref,
                "event_ids": [event["event_id"] for event in mixed_events],
                "components_cents": [1_820_000, 1_365_000, 1_200_000, 615_000],
                "gross_components_cents": [2_000_000, 1_500_000, 1_200_000, 615_000],
                "fee_components_cents": [180_000, 135_000, 0, 0],
                "bank_cents": 5_000_000,
                "minimum_three_files": "Do not call a mixed subset proof without component and external-receipt evidence.",
                "enhanced": "4 documented net components sum exactly to 50000.00; only 2 financing components bear 9% fees.",
            },
        },
        "expected_settlement_groups": settlement_groups,
        "events": expected_events,
        "files": {},
    }
    assert len(events) == 350
    assert sum(event["gross_cents"] for event in events) == GROSS_RECEIPTS_CENTS
    assert sum(event["qb_clearing_contribution_cents"] for event in expected_events) == closing_clearing
    assert sum(event["st_signed_report_amount_cents"] for event in expected_events) == answer_key["balances"]["st_signed_report_cents"]
    assert sum(event["current_bank_receipt_component_cents"] for event in expected_events) == bank_receipts
    return {"tables": tables, "fields": fields_by_file, "answer_key": answer_key}


def write_dataset(out: Path | str, seed: int = DEFAULT_SEED) -> dict[str, Any]:
    output = Path(out)
    output.mkdir(parents=True, exist_ok=True)
    dataset = build_dataset(seed)
    answer_key = dataset["answer_key"]
    for filename, rows in dataset["tables"].items():
        path = output / filename
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=dataset["fields"][filename],
                                    extrasaction="ignore", lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        answer_key["files"][filename] = {
            "data_rows": len(rows), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size, "encoding": "UTF-8", "delimiter": ",",
            "header_row": 1, "is_core_input": filename in {
                "st_export.csv", "qbo_clearing_gl.csv", "chase_bank.csv"},
        }
    key_path = output / "ground_truth_answer_key.json"
    key_path.write_text(json.dumps(answer_key, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "output_directory": str(output.resolve()), "seed": seed,
        "economic_receipt_events": 350, "gross_receipts": money(GROSS_RECEIPTS_CENTS),
        "normal_events": 297, "anomaly_events": 53,
        "core_rows": {name: answer_key["files"][name]["data_rows"]
                      for name in ("st_export.csv", "qbo_clearing_gl.csv", "chase_bank.csv")},
        "clearing_closing": money(answer_key["balances"]["clearing_closing_cents"]),
        "bank_receipt_credits": money(answer_key["balances"]["bank_receipt_credits_cents"]),
        "answer_key": str(key_path.resolve()),
        "notice": "Synthetic fixtures; answer key is test-only and must never be fed to the production matcher.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("samples"), help="Output directory (existing files with matching names are replaced).")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = parser.parse_args()
    print(json.dumps(write_dataset(args.out, args.seed), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
