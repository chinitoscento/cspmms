// Exports an accounting report to PDF or Excel.
// The libraries load only when an export button is clicked, so the app stays light.
//
// A report "doc" looks like:
// {
//   title: 'Trial Balance',
//   subtitle: 'As of Nov 10, 2026',
//   preparedBy: 'Edson II Tan',
//   landscape: false,
//   columns: [{ header: 'Account', align: 'left', width: 40 }, { header: 'Debit', align: 'right', width: 18 }],
//   rows: [
//     { kind: 'section', cells: ['ASSETS'] },
//     { kind: 'row',     cells: ['Cash', 50000] },
//     { kind: 'total',   cells: ['Total assets', 50000] },
//     { kind: 'grand',   cells: ['Net income', 50000] },
//     { kind: 'note',    cells: ['Some remark'] },
//   ],
// }
// Numbers are written as money. Text is written as it is.

const BUSINESS = 'Chinito Scento';

const money = (n) => {
  const v = Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${v})` : v;
};

const cellText = (v) => (typeof v === 'number' ? money(v) : v == null ? '' : String(v));

const stampNow = () =>
  new Date().toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const exportFileName = (title, ext) => {
  const clean = title.replace(/[^a-z0-9]+/gi, '');
  return `ChinitoScento_${clean}_${new Date().toLocaleDateString('en-CA')}.${ext}`;
};

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ───────────────────────── PDF ─────────────────────────
export async function exportPdf(doc) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: doc.landscape ? 'landscape' : 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 40;
  const cols = doc.columns;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(17);
  pdf.setTextColor(30, 27, 18);
  pdf.text(BUSINESS, margin, 50);
  pdf.setFontSize(13);
  pdf.text(doc.title, margin, 70);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(110, 105, 95);
  pdf.text(`${doc.subtitle}  |  Amounts in Philippine pesos (PHP)`, margin, 86);

  const align = (i) => (cols[i].align === 'right' ? 'right' : 'left');

  const body = doc.rows.map((r) => {
    if (r.kind === 'section') {
      return [
        {
          content: String(r.cells[0]).toUpperCase(),
          colSpan: cols.length,
          styles: { fontStyle: 'bold', textColor: [150, 110, 20], fillColor: [250, 246, 235] },
        },
      ];
    }
    if (r.kind === 'note') {
      return [
        {
          content: String(r.cells[0]),
          colSpan: cols.length,
          styles: { fontStyle: 'italic', textColor: [110, 105, 95], fontSize: 8 },
        },
      ];
    }
    const style =
      r.kind === 'grand'
        ? { fontStyle: 'bold', fillColor: [240, 232, 208] }
        : r.kind === 'total'
        ? { fontStyle: 'bold', lineWidth: { top: 0.6 }, lineColor: [150, 145, 135] }
        : {};
    return cols.map((_, i) => ({ content: cellText(r.cells[i]), styles: { halign: align(i), ...style } }));
  });

  const totalWidth = cols.reduce((s, c) => s + (c.width || 20), 0);
  const usable = pageW - margin * 2;
  const columnStyles = {};
  cols.forEach((c, i) => {
    columnStyles[i] = { cellWidth: ((c.width || 20) / totalWidth) * usable, halign: align(i) };
  });

  autoTable(pdf, {
    startY: 100,
    margin: { left: margin, right: margin, bottom: 46 },
    head: [cols.map((c, i) => ({ content: c.header, styles: { halign: align(i) } }))],
    body,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 4, bottom: 4, left: 4, right: 4 }, textColor: [30, 27, 18], overflow: 'linebreak' },
    headStyles: { fontStyle: 'bold', fillColor: [30, 27, 18], textColor: [240, 205, 110] },
    columnStyles,
    rowPageBreak: 'avoid',
  });

  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(120, 115, 105);
    pdf.text(`Prepared by ${doc.preparedBy || 'Chinito Scento system'} on ${stampNow()}`, margin, pageH - 24);
    pdf.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 24, { align: 'right' });
  }

  pdf.save(exportFileName(doc.title, 'pdf'));
}

// ───────────────────────── Excel ─────────────────────────
export async function exportExcel(doc) {
  const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default;

  const wb = new ExcelJS.Workbook();
  wb.creator = BUSINESS;
  wb.created = new Date();

  const HEADER_ROW = 6;
  const ws = wb.addWorksheet(doc.title.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
    pageSetup: { orientation: doc.landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const cols = doc.columns;
  ws.columns = cols.map((c) => ({ width: c.width || 20 }));
  const lastCol = cols.length;
  const MONEY = '"₱"#,##0.00;("₱"#,##0.00);"-"';

  const textRow = (rowNo, text, font) => {
    ws.mergeCells(rowNo, 1, rowNo, lastCol);
    const cell = ws.getCell(rowNo, 1);
    cell.value = text;
    cell.font = font;
  };

  textRow(1, BUSINESS, { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1E1B12' } });
  textRow(2, doc.title, { name: 'Calibri', size: 13, bold: true });
  textRow(3, doc.subtitle, { name: 'Calibri', size: 10, color: { argb: 'FF6E695F' } });
  textRow(4, `Prepared by ${doc.preparedBy || 'Chinito Scento system'} on ${stampNow()}`, {
    name: 'Calibri',
    size: 9,
    italic: true,
    color: { argb: 'FF6E695F' },
  });

  const head = ws.getRow(HEADER_ROW);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Calibri', bold: true, color: { argb: 'FFF0CD6E' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B12' } };
    cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left', vertical: 'middle' };
  });
  head.height = 20;

  let rowNo = HEADER_ROW;
  doc.rows.forEach((r) => {
    rowNo += 1;
    const row = ws.getRow(rowNo);

    if (r.kind === 'section' || r.kind === 'note') {
      ws.mergeCells(rowNo, 1, rowNo, lastCol);
      const cell = row.getCell(1);
      cell.value = String(r.cells[0]);
      if (r.kind === 'section') {
        cell.font = { name: 'Calibri', bold: true, color: { argb: 'FF966E14' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF6EB' } };
      } else {
        cell.font = { name: 'Calibri', italic: true, size: 9, color: { argb: 'FF6E695F' } };
      }
      return;
    }

    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = r.cells[i];
      if (typeof v === 'number') {
        cell.value = v;
        cell.numFmt = MONEY;
        cell.alignment = { horizontal: 'right' };
      } else {
        cell.value = v == null ? '' : String(v);
        cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left', wrapText: true, vertical: 'top' };
      }
      if (r.kind === 'total') {
        cell.font = { name: 'Calibri', bold: true };
        cell.border = { top: { style: 'thin', color: { argb: 'FF96918A' } } };
      }
      if (r.kind === 'grand') {
        cell.font = { name: 'Calibri', bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0E8D0' } };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
      }
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  download(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    exportFileName(doc.title, 'xlsx')
  );
}