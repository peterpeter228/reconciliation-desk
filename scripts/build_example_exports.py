#!/usr/bin/env python3
"""Build synthetic import-format examples and a redacted support PDF.

Requires reportlab for PDF only. No system/account connections and no real data.
The fee case is a separate, fully stated teaching example; not a conclusion
that the 350-event three-file fixture already supports an approved adjustment.
"""
from __future__ import annotations
import csv
import hashlib
import json
import sys
from dataclasses import replace
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from reference.core import FeeCase, fee_case_approval_hash, make_fee_only_aje, qbo_csv, qbd_iif


def build_fee_example():
    output = ROOT / "examples"
    output.mkdir(exist_ok=True)
    evidence = {
        "synthetic_only": True,
        "separate_teaching_example_not_a_result_from_main_fixture": True,
        "currency": "USD",
        "processor_statement": {"gross_cents": 1000000, "netted_fee_cents": 90000,
                                "bank_net_cents": 910000, "fee_mode": "NETTED"},
        "prior_posted_gl": [
            {"journal": "DEMO-RECEIPT", "account": "ServiceTitan Clearing", "debit_cents": 1000000, "credit_cents": 0},
            {"journal": "DEMO-RECEIPT", "account": "Accounts Receivable", "debit_cents": 0, "credit_cents": 1000000},
            {"journal": "DEMO-DEPOSIT", "account": "Collections Checking", "debit_cents": 910000, "credit_cents": 0},
            {"journal": "DEMO-DEPOSIT", "account": "ServiceTitan Clearing", "debit_cents": 0, "credit_cents": 910000}],
        "assumptions": ["No existing fee entry or earlier AJE for this case",
                        "Full relevant account coverage reviewed by the fictional Demo Reviewer",
                        "Ordinary asset clearing, not Undeposited Funds or finance liability clearing",
                        "Accounting period open and account names/types verified in this fictional chart"],
    }
    source_hash = hashlib.sha256(json.dumps(evidence, sort_keys=True).encode()).hexdigest()
    coa = {"ServiceTitan Clearing": "OTHER_CURRENT_ASSET", "Merchant Financing Fees": "EXPENSE"}
    case = FeeCase("synthetic-teaching-co", "fee900-example", source_hash, source_hash,
                   "Demo Reviewer (fictional)", ("fee_case_evidence.json:processor_statement",
                   "fee_case_evidence.json:prior_posted_gl"), date(2026, 9, 30),
                   "ServiceTitan Clearing", "Merchant Financing Fees", 1000000, 910000,
                   90000, 90000, True, False, "NETTED", True, True)
    case = replace(case, approval_payload_hash=fee_case_approval_hash(case, coa))
    aje = make_fee_only_aje(case, coa, set())
    (output / "fee_case_evidence.json").write_text(json.dumps(evidence, indent=2)+"\n")
    (output / "fee_case_approved_proposal.json").write_text(json.dumps(aje, indent=2)+"\n")
    (output / "sample_qbo_fee_only.csv").write_bytes(qbo_csv(aje).encode("utf-8"))
    (output / "sample_qbd_fee_only.iif").write_bytes(qbd_iif(aje).encode("ascii"))


def build_support_pdf():
    import reportlab
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                   PageBreak, KeepTogether)
    output = ROOT / "examples" / "support_escalation_sample.pdf"
    font_dir = Path(reportlab.__file__).parent / "fonts"
    pdfmetrics.registerFont(TTFont("DeskSans", str(font_dir / "Vera.ttf")))
    pdfmetrics.registerFont(TTFont("DeskSans-Bold", str(font_dir / "VeraBd.ttf")))
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="DeskTitle", fontName="DeskSans-Bold", fontSize=22,
                              leading=26, textColor=colors.HexColor("#152C47"), spaceAfter=12))
    styles.add(ParagraphStyle(name="DeskBody", fontName="DeskSans", fontSize=10,
                              leading=14, spaceAfter=8))
    styles.add(ParagraphStyle(name="DeskSmall", fontName="DeskSans", fontSize=8,
                              leading=11, spaceAfter=4))
    styles.add(ParagraphStyle(name="DeskH2", fontName="DeskSans-Bold", fontSize=13,
                              leading=17, spaceBefore=13, spaceAfter=8))
    styles.add(ParagraphStyle(name="DeskCell", fontName="DeskSans", fontSize=8.5,
                              leading=11))
    story = []
    def p(text, style="DeskBody"):
        return Paragraph(escape(text).replace("\n", "<br/>"), styles[style])
    def table(headers, rows, widths):
        cells = [[p(x, "DeskCell") for x in headers]] + [[p(str(x), "DeskCell") for x in row] for row in rows]
        t = Table(cells, colWidths=widths, repeatRows=1, hAlign="LEFT")
        t.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#E6EDF5")),
            ("GRID", (0,0), (-1,-1), .4, colors.HexColor("#CFD8E3")),
            ("VALIGN", (0,0), (-1,-1), "TOP"),
            ("LEFTPADDING", (0,0), (-1,-1), 8), ("RIGHTPADDING", (0,0), (-1,-1), 8),
            ("TOPPADDING", (0,0), (-1,-1), 7), ("BOTTOMPADDING", (0,0), (-1,-1), 7),
        ]))
        return t
    def read(name):
        path=ROOT / "samples" / name
        with path.open(newline="",encoding="utf-8") as f:
            return list(csv.DictReader(f))
    st=read("st_export.csv"); qb=read("qbo_clearing_gl.csv"); bank=read("chase_bank.csv"); audits=read("st_audit_events.csv")
    original=next(r for r in st if r["Payment ID"]=="PMT740328")
    correction=next(r for r in st if r["Related Payment ID"]==original["Payment ID"])
    audit=next(r for r in audits if r["Original Payment ID"]==original["Payment ID"])
    qb_receipt=next(r for r in qb if r["Num"]==original["Batch Number"])
    qb_settlement=next(r for r in qb if r["Num"]=="SET870128")
    bank_row=next(r for r in bank if "SET870128" in r["Description"])
    story += [p("ServiceTitan export review", "DeskTitle"),
              p("SYNTHETIC SAMPLE | No customer data | Not a finding of a platform defect", "DeskSmall"),
              p("Cedar Ridge Home Services LLC (fictional)\nSeptember 2026 | As of September 30, 2026 | America/New_York"),
              p("Requested action", "DeskH2"),
              p("Please confirm whether correction PMT740328A requires a QuickBooks object update under the configured integration mode, and provide the related export status. We have a later source correction; its required accounting effect and counterpart status remain unverified."),
              p("Observed evidence", "DeskH2"),
              table(["Source", "Identity / status", "Amount"],[
                  ["ST original payment", original["Payment ID"]+" | Exported | Batch "+original["Batch Number"], "$"+original["Gross Amount"]],
                  ["ST later correction",correction["Payment ID"]+" | Not Exported | Noncash application correction", "$"+correction["Gross Amount"]],
                  ["QB clearing receipt",qb_receipt["Transaction ID"]+" | debit", "$"+qb_receipt["Debit"]],
                  ["QB clearing settlement",qb_settlement["Transaction ID"]+" | credit", "$"+qb_settlement["Credit"]],
                  ["Bank posted credit", bank_row["Description"]+" | "+bank_row["Posting Date"], "$"+bank_row["Amount"]]
              ], [1.3*inch,3.55*inch,1.05*inch]),
              p("What the numbers do and do not establish", "DeskH2"),
              p("The original $473.06 receipt and settlement agree in the supplied clearing activity and bank file. The separate -$94.61 application correction changes the source application view to $378.45. It is not evidence of a cash refund or a $94.61 clearing loss. The full QB bank journal and affected customer/invoice records are not included."),
              p("Disposition: supported source relationship change; accounting drift not yet confirmed. No adjusting entry proposed."),
              PageBreak(), p("Timeline and source references", "DeskTitle"),
              p("SYNTHETIC SAMPLE | Evidence locators refer to the included CSV files", "DeskSmall"),
              table(["When", "Observed event"],[
                  [audit["Original Exported At"],"Original payment exported in accounting batch "+original["Batch Number"]],
                  [bank_row["Posting Date"],"Bank credit posted; clearing settlement shown in QB activity"],
                  [audit["Event At"],"Independent payment application correction created; Cash Refund Confirmed = No"],
                  ["09/30/2026", "Review cutoff; no claim made about records outside supplied coverage"]
              ], [2.0*inch,3.9*inch]),
              p("Source row locators", "DeskH2")]
    refs=[]
    for name, rows, selected in [
        ("st_export.csv",st,[original,correction]),
        ("qbo_clearing_gl.csv",qb,[qb_receipt,qb_settlement]),
        ("chase_bank.csv",bank,[bank_row]),
        ("st_audit_events.csv",audits,[audit])]:
        digest=hashlib.sha256((ROOT/"samples"/name).read_bytes()).hexdigest()
        refs.append([name, ", ".join(str(rows.index(r)+2) for r in selected), digest[:20]+"..."])
    story += [table(["File", "CSV row", "SHA-256 prefix"], refs,[2.3*inch,.7*inch,2.9*inch]),
              p("Information needed to resolve", "DeskH2"),
              p("1. Confirm the active export mode and the expected QB object/accounting effect of this correction.\n2. Supply per-record export outcome or error trace for PMT740328A.\n3. Compare the relevant QB invoice/payment application and full deposit journal.\n4. Recommend a remediation path that preserves the original payment and avoids duplicate posting."),
              p("Scope and privacy", "DeskH2"),
              p("Customer names are omitted. No full account numbers, credentials or card data are included. Source hashes identify the generated CSVs; complete hashes are in the fixture manifest. The Evidence Document strings in the synthetic CSV are labels, not attached PDF files. This sample itself is the only PDF attached."),
              p("Generated for engineering review on October 21, 2026. This document is a reproducible template, not a sent support ticket.","DeskSmall")]
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("DeskSans",8)
        canvas.setFillColor(colors.HexColor("#5E6C7E"))
        canvas.drawString(54,28,"Reconciliation Desk | Evidence before adjustment")
        canvas.drawRightString(558,28,f"Synthetic sample | {doc.page}")
        canvas.restoreState()
    doc=SimpleDocTemplate(str(output),pagesize=letter,rightMargin=54,leftMargin=54,
                          topMargin=45,bottomMargin=46,title="ServiceTitan export review synthetic sample",
                          author="Reconciliation Desk")
    doc.build(story,onFirstPage=footer,onLaterPages=footer)
    print(str(output))


if __name__ == "__main__":
    build_fee_example()
    build_support_pdf()
