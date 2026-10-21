"""Auditable primitives for G1, not a complete production reconciliation engine.

Standard library only. Exact cents, bounded positive subset sum, conservative
fee candidates, and a deliberately narrow fee-only adjusting-entry exporter.
The solver proves arithmetic uniqueness within its supplied candidate set;
it NEVER proves business identity or the completeness of that candidate set.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import time
import unicodedata
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable

MAX_CENTS = 100_000_000_000
MONEY = re.compile(r"^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$")


def parse_money(value: str) -> int:
    """Strict US dollars -> signed integer cents; rejects blanks, floats, extra dp.
    Locale/sign convention must already have been confirmed by the import profile.
    """
    if not isinstance(value, str):
        raise ValueError("Money must enter as source text, never float")
    text = value.strip()
    sign = 1
    if text.startswith("(") and text.endswith(")"):
        sign, text = -1, text[1:-1].strip()
    elif text.startswith("-"):
        sign, text = -1, text[1:]
    if text.startswith("$"):
        text = text[1:]
    if not MONEY.fullmatch(text):
        raise ValueError(f"Invalid or ambiguous US money: {value!r}")
    cents = int(Decimal(text.replace(",", "")) * 100) * sign
    if abs(cents) > MAX_CENTS:
        raise ValueError("Row amount exceeds configured limit")
    return cents


def dollars(cents: int) -> str:
    if type(cents) is not int:
        raise ValueError("Integer cents required")
    sign = "-" if cents < 0 else ""
    whole, fraction = divmod(abs(cents), 100)
    return f"{sign}{whole}.{fraction:02d}"


def add_business_days(day: date, offset: int, holidays: frozenset[date]) -> date:
    """Calendar is an explicit dependency, not generic US-federal observed days.
    Offset zero preserves day (caller resolves cutoffs / nonbusiness anchor dates).
    """
    direction = 1 if offset >= 0 else -1
    for _ in range(abs(offset)):
        day += timedelta(days=direction)
        while day.weekday() >= 5 or day in holidays:
            day += timedelta(days=direction)
    return day


@dataclass(frozen=True)
class Candidate:
    id: str
    cents: int


@dataclass(frozen=True)
class SubsetResult:
    status: str
    solutions: tuple[tuple[str, ...], ...]
    complete_search: bool
    candidates: int
    nodes: int
    elapsed_ms: float


def bounded_subset_sum(
    candidates: Iterable[Candidate], target_cents: int, *,
    max_candidates: int = 28, max_members: int = 8,
    tolerance_cents: int = 0, budget_ms: float = 80.0,
    node_limit: int = 250_000,
) -> SubsetResult:
    """Meet-in-the-middle; positive amounts only; stop after two distinct solutions.

    Candidate partitioning (company, account, currency, dates, channel, evidence)
    belongs to the caller. No silent top-k truncation. Candidate cap/timeout are
    incomplete outcomes, not NO_MATCH. Worker watchdog required in browser port.
    """
    started = time.perf_counter()
    nodes = 0
    items = sorted(list(candidates), key=lambda x: x.id)
    if type(target_cents) is not int or target_cents <= 0:
        raise ValueError("Positive integer target required")
    if len({x.id for x in items}) != len(items):
        raise ValueError("Duplicate candidate identity")
    if any(type(x.cents) is not int or x.cents <= 0 for x in items):
        raise ValueError("Refunds/zero amounts must not enter the positive solver")
    if not 0 <= tolerance_cents <= 1 or not 1 <= max_members <= 8:
        raise ValueError("Unsupported tolerance/cardinality")
    if not 1 <= max_candidates <= 28:
        raise ValueError("Candidate cap must be <= 28")
    found: list[tuple[str, ...]] = []

    def finish(status: str, complete: bool) -> SubsetResult:
        return SubsetResult(status, tuple(found), complete, len(items), nodes,
                            (time.perf_counter() - started) * 1000)

    if len(items) > max_candidates:
        return finish("CANDIDATE_CAP", False)
    # A cardinality performance cap must not manufacture uniqueness. Positive
    # amounts prove it irrelevant only if even the smallest (cap+1) exceed target.
    cardinality_may_hide_solutions = (
        len(items) > max_members and
        sum(sorted(x.cents for x in items)[:max_members + 1]) <= target_cents + tolerance_cents
    )
    if budget_ms <= 0 or node_limit <= 0:
        return finish("TIMEOUT", False)
    deadline = started + budget_ms / 1000

    def tick() -> None:
        nonlocal nodes
        nodes += 1
        if nodes > node_limit or (nodes % 128 == 0 and time.perf_counter() >= deadline):
            raise TimeoutError

    def enumerate_half(half: list[Candidate]) -> list[tuple[int, tuple[str, ...]]]:
        # Positive amounts let us prune above-target states without losing solutions.
        states: list[tuple[int, tuple[str, ...]]] = [(0, ())]
        for item in half:
            added = []
            for total, ids in states:
                tick()
                if len(ids) < max_members and total + item.cents <= target_cents + tolerance_cents:
                    added.append((total + item.cents, ids + (item.id,)))
            states.extend(added)
        return states

    try:
        mid = len(items) // 2
        left = enumerate_half(items[:mid])
        right = enumerate_half(items[mid:])
        # Index by sum AND cardinality. Two representatives per bucket suffice to
        # prove ambiguity; keeping only one would falsely claim a unique solution.
        right_by_sum: dict[int, dict[int, list[tuple[str, ...]]]] = {}
        for amount, ids in right:
            tick()
            bucket = right_by_sum.setdefault(amount, {}).setdefault(len(ids), [])
            if len(bucket) < 2:
                bucket.append(ids)
        for left_amount, left_ids in left:
            tick()
            for delta in range(-tolerance_cents, tolerance_cents + 1):
                buckets = right_by_sum.get(target_cents + delta - left_amount, {})
                for count, representatives in buckets.items():
                    if not 1 <= len(left_ids) + count <= max_members:
                        continue
                    for right_ids in representatives:
                        tick()
                        ids = tuple(sorted(left_ids + right_ids))
                        if ids not in found:
                            found.append(ids)
                            if len(found) == 2:
                                return finish("AMBIGUOUS", False)
        if time.perf_counter() >= deadline:
            return finish("TIMEOUT", False)
        if cardinality_may_hide_solutions:
            return finish("CARDINALITY_CAP", False)
        return finish("UNIQUE_CANDIDATE" if found else "NO_MATCH", True)
    except TimeoutError:
        return finish("TIMEOUT", False)


def fee_candidate(gross_cents: int, bank_cents: int, method: str, *,
                  refund_cents: int = 0, hold_cents: int = 0,
                  release_cents: int = 0, fee_mode: str = "UNKNOWN") -> dict:
    """Rate bands are search hints only. Never returns CONFIRMED or AJE approval."""
    if any(type(x) is not int for x in (gross_cents, bank_cents, refund_cents, hold_cents, release_cents)):
        raise ValueError("Integer cents required")
    if min(refund_cents, hold_cents, release_cents) < 0 or gross_cents <= 0:
        raise ValueError("Invalid amount signs")
    if fee_mode == "SEPARATE_INVOICE":
        return {"status": "NOT_APPLICABLE", "aje_allowed": False}
    expected_before_fees = gross_cents - refund_cents - hold_cents + release_cents
    gap = expected_before_fees - bank_cents
    bands = {"CARD": (150, 380), "FINANCING": (500, 1500)}  # basis points
    low, high = bands.get(method, (0, -1))
    in_band = gap > 0 and low * gross_cents <= 10_000 * gap <= high * gross_cents
    return {
        "status": "FEE_HYPOTHESIS" if in_band else "UNEXPLAINED",
        "gap_cents": gap,
        "implied_rate": str(Decimal(gap) / Decimal(gross_cents)),
        "evidence_level": "SUSPECTED", "aje_allowed": False,
    }


@dataclass(frozen=True)
class FeeCase:
    company_id: str
    case_id: str
    source_version_hash: str
    approval_source_hash: str
    approved_by: str
    evidence_refs: tuple[str, ...]
    journal_date: date
    clearing_account: str
    fee_account: str
    gross_cents: int
    bank_cents: int
    confirmed_fee_cents: int
    clearing_residual_cents: int
    bank_posted_to_clearing: bool
    existing_fee_already_posted: bool
    fee_mode: str
    coverage_complete: bool
    period_open: bool
    is_undeposited_funds: bool = False
    approval_payload_hash: str = ""


def stable_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def fee_case_approval_hash(case: FeeCase, chart_of_accounts: dict[str, str]) -> str:
    """Hash for the exact preview the reviewer approves, not just uploaded bytes.
    UI must compute before approval, store the approved snapshot, and recompute
    on export. Hashing is an integrity check, not authentication or a signature.
    """
    payload = asdict(case)
    payload.pop("approval_payload_hash")
    payload.pop("approval_source_hash")
    payload["journal_date"] = case.journal_date.isoformat()
    payload["rule_version"] = "fee-only-v1"
    payload["account_types"] = {name: chart_of_accounts.get(name)
                                for name in (case.clearing_account, case.fee_account)}
    return stable_hash(payload)


def safe_import_text(text: str) -> bool:
    if not isinstance(text, str) or not text.strip():
        return False
    normalized = unicodedata.normalize("NFKC", text).lstrip()
    return (not normalized.startswith(("=", "+", "-", "@"))
            and not any(unicodedata.category(c).startswith("C") for c in text))


def make_fee_only_aje(case: FeeCase, chart_of_accounts: dict[str, str],
                      existing_journal_ids: set[str]) -> dict:
    """Generate only Dr Fee / Cr ordinary asset Clearing, after reviewer approval.
    Caller must supply independently verified GL/evidence assertions. This does
    not inspect source files and does not connect to or modify QuickBooks.
    """
    if not case.approved_by or not case.evidence_refs:
        raise ValueError("Reviewer approval and supporting evidence required")
    if case.source_version_hash != case.approval_source_hash:
        raise ValueError("Stale approval: source inputs changed")
    if case.approval_payload_hash != fee_case_approval_hash(case, chart_of_accounts):
        raise ValueError("Stale or absent approval: preview/accounts/date/amount changed")
    if case.is_undeposited_funds:
        raise ValueError("UF requires payment/deposit workflow, not this exporter")
    if not case.bank_posted_to_clearing or case.existing_fee_already_posted:
        raise ValueError("Fee-only entry does not match the verified prior ledger state")
    if case.fee_mode != "NETTED" or not case.coverage_complete or not case.period_open:
        raise ValueError("Evidence, coverage or accounting-period gate failed")
    for value in (case.gross_cents, case.bank_cents, case.confirmed_fee_cents, case.clearing_residual_cents):
        if type(value) is not int or value <= 0 or value > MAX_CENTS:
            raise ValueError("Positive, bounded integer cents required")
    if case.gross_cents - case.bank_cents != case.confirmed_fee_cents:
        raise ValueError("Gross-net difference is not the documented fee")
    if case.clearing_residual_cents != case.confirmed_fee_cents:
        raise ValueError("Clearing balance would not be closed by this fee")
    if case.clearing_account == case.fee_account:
        raise ValueError("Distinct accounts required")
    if chart_of_accounts.get(case.clearing_account) != "OTHER_CURRENT_ASSET":
        raise ValueError("Only verified ordinary asset clearing supported in v1")
    if chart_of_accounts.get(case.fee_account) != "EXPENSE":
        raise ValueError("Verified existing expense account required")
    for text in (case.clearing_account, case.fee_account):
        if not safe_import_text(text):
            raise ValueError("Unsafe account text: remap, never silently alter")
    key = f"{case.company_id}|{case.case_id}|fee-only-v1"
    journal_id = "RD" + hashlib.sha256(key.encode()).hexdigest()[:9].upper()
    if journal_id in existing_journal_ids:
        raise ValueError("Journal already present; reconcile instead of re-exporting")
    memo = "Approved financing or processing fee " + journal_id
    lines = [
        {"account": case.fee_account, "debit_cents": case.confirmed_fee_cents, "credit_cents": 0},
        {"account": case.clearing_account, "debit_cents": 0, "credit_cents": case.confirmed_fee_cents},
    ]
    assert sum(x["debit_cents"] - x["credit_cents"] for x in lines) == 0
    aje = {"journal_id": journal_id, "date": case.journal_date.isoformat(), "memo": memo,
            "lines": lines, "evidence_refs": list(case.evidence_refs),
            "source_version_hash": case.source_version_hash, "approved_by": case.approved_by,
            "case_approval_hash": case.approval_payload_hash,
            "status": "APPROVED_FOR_EXPORT_NOT_POSTED"}
    aje["approved_payload_hash"] = stable_hash(aje)
    return aje


def validate_approved_aje(aje: dict) -> None:
    """Repeat validation at serialization, even if a caller bypasses the builder."""
    if not isinstance(aje, dict) or aje.get("status") != "APPROVED_FOR_EXPORT_NOT_POSTED":
        raise ValueError("Approved immutable proposal required")
    for field in ("approved_by", "source_version_hash", "case_approval_hash"):
        if not aje.get(field):
            raise ValueError("Incomplete approval trail")
    if not aje.get("evidence_refs"):
        raise ValueError("Missing supporting evidence")
    payload = {k: v for k, v in aje.items() if k != "approved_payload_hash"}
    if aje.get("approved_payload_hash") != stable_hash(payload):
        raise ValueError("Export payload differs from approved snapshot")
    for field in ("journal_id", "memo"):
        if not safe_import_text(aje.get(field, "")):
            raise ValueError("Unsafe import text")
    if not re.fullmatch(r"RD[A-Z0-9]{9}", aje["journal_id"]):
        raise ValueError("Invalid stable journal number")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", aje.get("date", "")):
        raise ValueError("ISO journal date required")
    date.fromisoformat(aje["date"])
    lines = aje.get("lines")
    if not isinstance(lines, list) or len(lines) != 2:
        raise ValueError("Only the approved two-line fee-only template is supported")
    total_debits = total_credits = 0
    for row in lines:
        if set(row) != {"account", "debit_cents", "credit_cents"} or not safe_import_text(row["account"]):
            raise ValueError("Invalid account line")
        dr, cr = row["debit_cents"], row["credit_cents"]
        if any(type(x) is not int or x < 0 or x > MAX_CENTS for x in (dr, cr)):
            raise ValueError("Nonnegative integer debit/credit required")
        if (dr > 0) == (cr > 0):
            raise ValueError("Each line must have exactly one nonzero side")
        total_debits += dr
        total_credits += cr
    if total_debits <= 0 or total_debits != total_credits or lines[0]["account"] == lines[1]["account"]:
        raise ValueError("Unbalanced or economically empty entry")


def qbo_csv(aje: dict) -> str:
    validate_approved_aje(aje)
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(["Journal No.", "Journal Date", "Account Name", "Journal/Description", "Debits", "Credits"])
    dt = date.fromisoformat(aje["date"]).strftime("%m/%d/%Y")
    for row in aje["lines"]:
        writer.writerow([aje["journal_id"], dt, row["account"], aje["memo"],
                         dollars(row["debit_cents"]) if row["debit_cents"] else "",
                         dollars(row["credit_cents"]) if row["credit_cents"] else ""])
    return stream.getvalue()


def qbd_iif(aje: dict) -> str:
    """US Windows candidate format. Requires target-version sample-company test."""
    validate_approved_aje(aje)
    fields = ["TRNSTYPE", "DATE", "ACCNT", "AMOUNT", "DOCNUM", "MEMO"]
    lines = ["\t".join(["!TRNS"] + fields), "\t".join(["!SPL"] + fields), "!ENDTRNS"]
    dt = date.fromisoformat(aje["date"]).strftime("%m/%d/%Y")
    for i, row in enumerate(aje["lines"]):
        values = ["TRNS" if i == 0 else "SPL", "GENERAL JOURNAL", dt, row["account"],
                  dollars(row["debit_cents"] - row["credit_cents"]), aje["journal_id"], aje["memo"]]
        if any(any(c in value for c in "\t\r\n") or not value.isascii() for value in values):
            raise ValueError("IIF v1 requires verified ASCII and no embedded controls")
        lines.append("\t".join(values))
    lines.append("ENDTRNS")
    return "\r\n".join(lines) + "\r\n"
