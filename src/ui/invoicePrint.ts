import type { Invoice } from "../domain/invoice";

const cash = (c: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(c / 100);
const when = (s: string) => new Date(s).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });

/**
 * One invoice as a printable page.
 *
 * A final invoice folds adjustments into the total and lists them as ordinary
 * lines. A draft additionally marks them, so the worker can see what he is
 * about to send before he sends it - the point of a draft is that it shows what
 * the final would not.
 */
function page(inv: Invoice, draft: boolean, issued: string): string {
  const lines = [...inv.lines, ...inv.adjustmentLines].sort((a, b) => a.when.localeCompare(b.when));
  return `<article class="invoice">
    ${draft ? `<div class="draft-mark">Draft \u2014 not for sending</div>` : ""}
    <header class="inv-head">
      <div><h1>Invoice</h1><p class="for">Support for <b>${inv.clientName}</b></p></div>
      <div class="issued"><p>Issued ${when(issued)}</p><p class="total-badge">${cash(inv.total)}</p></div>
    </header>

    <table class="inv-lines">
      <thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th></tr></thead>
      <tbody>
        ${lines.map((l) => `<tr class="${l.kind === "adjustment" ? "adj" : ""}">
          <td>${when(l.when)}</td>
          <td>${l.detail}${l.quantity ? `<span class="qty">${l.quantity}</span>` : ""}${
            draft && l.kind === "adjustment" ? `<span class="qty">adjustment \u2014 folded into the total on a final invoice</span>` : ""}</td>
          <td class="r">${cash(l.amount)}</td>
        </tr>`).join("")}
      </tbody>
    </table>

    <table class="inv-sum">
      ${inv.time ? `<tr><td>Support time</td><td class="r">${cash(inv.time)}</td></tr>` : ""}
      ${inv.expenses ? `<tr><td>Expenses</td><td class="r">${cash(inv.expenses)}</td></tr>` : ""}
      ${inv.mileage ? `<tr><td>Mileage</td><td class="r">${cash(inv.mileage)}</td></tr>` : ""}
      ${inv.adjustments ? `<tr><td>Adjustments</td><td class="r">${cash(inv.adjustments)}</td></tr>` : ""}
      <tr class="grand"><td>Total due</td><td class="r">${cash(inv.total)}</td></tr>
    </table>

    <p class="foot">Every line can be checked: support is hours times the agreed rate, mileage is distance times the agreed rate per unit.</p>
  </article>`;
}

/**
 * Opens the browser's print dialogue, from which the user chooses Save as PDF.
 * Deliberately not a PDF library: this keeps the app free of a large dependency,
 * works offline, and produces real selectable text rather than an image.
 */
export function printInvoices(invoices: Invoice[], draft: boolean) {
  const issued = new Date().toISOString();
  const w = window.open("", "_blank");
  if (!w) throw new Error("The browser blocked the print window. Allow pop-ups for this site.");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8" />
    <title>${draft ? "Draft" : "Invoice"}${invoices.length === 1 ? ` \u2014 ${invoices[0].clientName}` : ""}</title>
    <style>
      @page { size: portrait; margin: 18mm 16mm; }
      * { box-sizing: border-box; }
      body { font: 12pt/1.5 Georgia, "Times New Roman", serif; color: #1a1a1a; margin: 0; }
      /* Each person starts a new sheet, so one file can hold them all. */
      .invoice { page-break-after: always; }
      .invoice:last-child { page-break-after: auto; }
      .draft-mark { border: 2px solid #b23; color: #b23; padding: 6px 10px; font: 700 10pt/1 sans-serif;
        letter-spacing: .1em; text-transform: uppercase; display: inline-block; margin-bottom: 14pt; }
      .inv-head { display: flex; justify-content: space-between; align-items: flex-start;
        border-bottom: 2px solid #1a1a1a; padding-bottom: 10pt; margin-bottom: 16pt; }
      h1 { font-size: 22pt; margin: 0 0 4pt; letter-spacing: -.01em; }
      .for { margin: 0; color: #444; }
      .issued { text-align: right; }
      .issued p { margin: 0 0 4pt; color: #444; }
      .total-badge { font-size: 17pt; font-weight: 700; color: #1a1a1a !important; }
      table { width: 100%; border-collapse: collapse; }
      .inv-lines th { text-align: left; font: 700 9pt/1 sans-serif; text-transform: uppercase;
        letter-spacing: .07em; color: #666; border-bottom: 1px solid #999; padding-bottom: 5pt; }
      .inv-lines td { padding: 7pt 0; border-bottom: 1px solid #e2e2e2; vertical-align: top; }
      .qty { display: block; font-size: 9.5pt; color: #666; }
      .adj td { color: #8a3520; }
      .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .inv-sum { margin-top: 14pt; margin-left: auto; width: 46%; }
      .inv-sum td { padding: 4pt 0; }
      .grand td { border-top: 2px solid #1a1a1a; font-weight: 700; font-size: 13pt; padding-top: 7pt; }
      .foot { margin-top: 22pt; font-size: 9.5pt; color: #666; border-top: 1px solid #e2e2e2; padding-top: 8pt; }
    </style></head><body>
    ${invoices.map((i) => page(i, draft, issued)).join("")}
    </body></html>`);
  w.document.close();
  w.focus();
  // Give the new document a moment to lay out before the dialogue opens.
  setTimeout(() => w.print(), 250);
}
