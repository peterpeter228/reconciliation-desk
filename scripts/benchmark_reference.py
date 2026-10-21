#!/usr/bin/env python3
"""Reproducible primitive benchmarks, NOT a completed three-way app benchmark."""
from __future__ import annotations
import argparse
import json
import math
import platform
import random
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reference.core import Candidate, bounded_subset_sum


def distribution(values):
    ordered = sorted(values)
    return {"min_ms": round(ordered[0], 3), "median_ms": round(statistics.median(ordered), 3),
            "p95_ms": round(ordered[math.ceil(len(ordered)*.95)-1], 3), "max_ms": round(ordered[-1], 3)}


def run(repetitions=40):
    rng = random.Random(20261021)
    rows = [{"company": "demo", "account": "checking", "currency": "USD",
             "reference": f"PAY-{i:05d}", "cents": rng.randint(1000, 1000000)} for i in range(3000)]
    def exact_index():
        index = {(r["company"], r["account"], r["currency"], r["reference"], r["cents"]): r for r in rows}
        return sum((r["company"], r["account"], r["currency"], r["reference"], r["cents"]) in index for r in rows)

    hard = [Candidate(f"s{i}", 2*rng.randint(5000, 100000)) for i in range(28)]
    def bounded():
        # Odd target / even amounts: no exact solution, but bounded cardinality
        # search alone deliberately does not prove the unrestricted conclusion.
        return bounded_subset_sum(hard, 900001, budget_ms=80)

    def ambiguous():
        return bounded_subset_sum([Candidate(f"c{i}", 100) for i in range(28)], 400, budget_ms=80)

    workloads = [("3000_row_identity_index_only", exact_index),
                 ("28_candidate_mitm_bounded", bounded),
                 ("28_candidate_multiple_solutions", ambiguous)]
    results = []
    for name, fn in workloads:
        fn()
        durations = []
        statuses = Counter()
        for _ in range(repetitions):
            start = time.perf_counter()
            result = fn()
            durations.append((time.perf_counter()-start)*1000)
            statuses[str(result) if isinstance(result, int) else result.status] += 1
        results.append({"workload": name, "repetitions": repetitions, "statuses": dict(statuses), **distribution(durations)})
    cap = bounded_subset_sum([Candidate(f"a{i}", i+1) for i in range(3000)], 5000000)
    cpu = "unknown"
    info = Path("/proc/cpuinfo")
    if info.exists():
        for line in info.read_text().splitlines():
            if line.startswith("model name"):
                cpu = line.split(":", 1)[1].strip()
                break
    return {"scope": "Python primitives only; no parser, browser, LLM, full waterfall, or QB import included",
            "environment": {"python": platform.python_version(), "os": platform.system(), "machine": platform.machine(), "cpu": cpu},
            "workloads": results,
            "unrestricted_3000_candidate_test": {"status": cap.status, "complete_search": cap.complete_search, "elapsed_ms": round(cap.elapsed_ms,3)},
            "production_500ms_status": "NOT_VERIFIED: requires G3 full browser benchmark including coverage and false acceptance metrics"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="examples/benchmark_reference.json")
    parser.add_argument("--repetitions", type=int, default=40)
    args = parser.parse_args()
    if args.repetitions < 5:
        parser.error("Use at least 5 repetitions")
    result = run(args.repetitions)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
