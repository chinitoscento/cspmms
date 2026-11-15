// Builds the PDF and Excel (.xlsx) downloads of a saved stock count report.
// Plain JavaScript with no extra libraries, so nothing needs to be installed.
//
//   const bytes = stockCountPdf(report, lines, KIND_LABEL);
//   saveBytes(bytes, 'file.pdf', 'application/pdf');

const enc = new TextEncoder();

// ---------- formatting ----------
const reportNo = (n) => `SC-${String(n).padStart(4, '0')}`;
const qtyText = (v) => Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const moneyText = (v) =>
  (Number(v) < 0 ? '-' : '') + 'PHP ' + Math.abs(Number(v || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateText = (d) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const stampText = (ts) =>
  ts
    ? new Date(ts).toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
const hasCount = (l) => l.counted_qty !== null && l.counted_qty !== undefined;
const isOff = (l) => hasCount(l) && Math.abs(Number(l.diff_qty)) > 0.0005;
const signed = (v) => `${Number(v) > 0 ? '+' : ''}${qtyText(v)}`;

// items grouped by kind, in the order of kindLabel, each group sorted by item name
function groupLines(lines, kindLabel) {
  return Object.keys(kindLabel)
    .map((k) => ({
      kind: k,
      label: kindLabel[k],
      items: lines.filter((l) => l.stock_kind === k).sort((a, b) => String(a.item_name).localeCompare(String(b.item_name), undefined, { numeric: true })),
    }))
    .filter((g) => g.items.length > 0);
}

export function reportFileName(report, ext) {
  return `stock-count-${reportNo(report.report_no)}-${report.count_date}.${ext}`;
}

// ---------- saving a file in the browser ----------
export function saveBytes(bytes, filename, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// =====================================================================
// Excel (.xlsx). An .xlsx file is a zip of XML files; the zip is built here without compression.
// =====================================================================
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (data) => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zipStore(files) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  const push = (u8) => {
    parts.push(u8);
    offset += u8.length;
  };
  files.forEach((f) => {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // names are UTF-8
    head.setUint16(8, 0, true); // stored, no compression
    head.setUint16(10, dosTime, true);
    head.setUint16(12, dosDate, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, f.data.length, true);
    head.setUint32(22, f.data.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    const start = offset;
    push(new Uint8Array(head.buffer));
    push(name);
    push(f.data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true);
    c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true);
    c.setUint32(24, f.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, start, true);
    central.push(new Uint8Array(c.buffer), name);
  });
  const cdStart = offset;
  central.forEach(push);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, offset - cdStart, true);
  end.setUint32(16, cdStart, true);
  push(new Uint8Array(end.buffer));

  const out = new Uint8Array(offset);
  let p = 0;
  parts.forEach((u8) => {
    out.set(u8, p);
    p += u8.length;
  });
  return out;
}

const xmlEsc = (s) =>
  String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// cell styles (see STYLES_XML): 1 table heading, 2 title, 3 money, 4 bold label
const S = { head: 1, title: 2, money: 3, bold: 4 };

const colName = (i) => String.fromCharCode(65 + i);
function cellXml(spec, r, c) {
  const o = spec !== null && typeof spec === 'object' ? spec : { v: spec };
  if (o.v === null || o.v === undefined || o.v === '') return '';
  const ref = `${colName(c)}${r}`;
  const s = o.s ? ` s="${o.s}"` : '';
  if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c r="${ref}"${s}><v>${o.v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(o.v)}</t></is></c>`;
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFE6C8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

export function stockCountXlsx(report, lines, kindLabel) {
  const no = reportNo(report.report_no);
  const rows = [
    [{ v: `Stock count report ${no}`, s: S.title }],
    [{ v: 'Count date', s: S.bold }, dateText(report.count_date)],
    [{ v: 'Counted by', s: S.bold }, report.counted_by || ''],
    [{ v: 'Saved', s: S.bold }, `${stampText(report.saved_at)} (system quantities are as of this time)`],
    [{ v: 'Notes', s: S.bold }, report.notes || ''],
    [{ v: 'Items counted', s: S.bold }, `${report.items_counted} of ${report.items_total}`],
    [{ v: 'Differences', s: S.bold }, report.items_off === 0 ? 'none' : Number(report.items_off)],
    [{ v: 'Approx. value of differences', s: S.bold }, { v: Number(report.value_diff), s: S.money }],
    [],
    ['Kind', 'Item', 'Group', 'Unit', 'System qty', 'Counted qty', 'Difference', 'Approx. value difference'].map((v) => ({ v, s: S.head })),
  ];
  groupLines(lines, kindLabel).forEach((g) => {
    g.items.forEach((l) => {
      rows.push([
        g.label,
        l.item_name,
        l.group_name || '',
        l.unit || '',
        Number(l.system_qty),
        hasCount(l) ? Number(l.counted_qty) : 'not counted',
        hasCount(l) ? Number(l.diff_qty) : '',
        l.value_diff === null || l.value_diff === undefined ? '' : { v: Number(l.value_diff), s: S.money },
      ]);
    });
  });

  const widths = [22, 40, 18, 8, 14, 14, 14, 24];
  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => cellXml(c, i + 1, j)).join('')}</row>`).join('')}</sheetData>` +
    '</worksheet>';

  const files = [
    {
      name: '[Content_Types].xml',
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>'
      ),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>'
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `<sheets><sheet name="${xmlEsc(no)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>'
      ),
    },
    { name: 'xl/styles.xml', data: enc.encode(STYLES_XML) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) },
  ];
  return zipStore(files);
}

// =====================================================================
// PDF. A4 portrait, standard fonts (Helvetica for text, Courier for the table so columns line up).
// =====================================================================
const PW = 595.28;
const PH = 841.89;
const MARGIN = 40;
const CW = 4.8; // width of one Courier character at 8 pt
const COLS = [36, 14, 14, 12, 16]; // item, system, counted, difference, value (in characters)

const clean = (s) =>
  String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '*')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
const pdfStr = (s) => clean(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function wrap(text, width) {
  const out = [];
  let line = '';
  String(text ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .forEach((word) => {
      let w = word;
      while (w.length > width) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    });
  if (line) out.push(line);
  return out.length ? out : [''];
}

const RED = [0.75, 0.15, 0.15];
const GRAY = [0.45, 0.45, 0.45];
const BLACK = [0, 0, 0];

export function stockCountPdf(report, lines, kindLabel) {
  const no = reportNo(report.report_no);
  const pages = [];
  let ops;
  let y;
  const newPage = () => {
    ops = [];
    pages.push(ops);
    y = PH - 56;
  };
  const text = (f, size, x, yy, t, color = BLACK) => ops.push({ f, size, x, y: yy, t, color });
  const rule = (yy) => ops.push({ rule: true, x: MARGIN, y: yy, w: PW - 2 * MARGIN });

  newPage();
  text('F2', 16, MARGIN, y, `Stock count report ${no}`);
  y -= 22;
  text('F1', 9, MARGIN, y, `Count date: ${dateText(report.count_date)}`);
  y -= 13;
  text('F1', 9, MARGIN, y, `Counted by: ${report.counted_by || '-'}`);
  y -= 13;
  text('F1', 9, MARGIN, y, `Saved: ${stampText(report.saved_at)} (system quantities are as of this time)`);
  y -= 13;
  if (report.notes) {
    wrap(`Notes: ${report.notes}`, 100).forEach((ln) => {
      text('F1', 9, MARGIN, y, ln);
      y -= 12;
    });
  }
  y -= 4;
  text(
    'F2',
    9,
    MARGIN,
    y,
    `Items counted: ${report.items_counted} of ${report.items_total}    Differences: ${report.items_off === 0 ? 'none' : report.items_off}    Approx. value of differences: ${moneyText(report.value_diff)}`
  );
  y -= 12;
  text('F1', 8, MARGIN, y, 'A frozen copy of a physical count. Saving it did not change any stock or books.', GRAY);
  y -= 24;

  const row = (cells) =>
    cells[0].padEnd(COLS[0]) + ' ' + cells[1].padStart(COLS[1]) + ' ' + cells[2].padStart(COLS[2]) + ' ' + cells[3].padStart(COLS[3]) + ' ' + cells[4].padStart(COLS[4]);
  const tableHead = () => {
    text('F4', 8, MARGIN, y, row(['ITEM', 'SYSTEM SAID', 'COUNTED', 'DIFFERENCE', 'APPROX. VALUE']));
    y -= 4;
    rule(y);
    y -= 12;
  };

  groupLines(lines, kindLabel).forEach((g) => {
    if (y < 120) newPage();
    text('F2', 10, MARGIN, y, g.label);
    y -= 14;
    tableHead();
    g.items.forEach((l) => {
      const nameLines = wrap(l.item_name, COLS[0]);
      if (y - nameLines.length * 11 < 56) {
        newPage();
        text('F2', 10, MARGIN, y, `${g.label} (continued)`);
        y -= 14;
        tableHead();
      }
      const has = hasCount(l);
      const color = !has ? GRAY : isOff(l) ? RED : BLACK;
      const cells = [
        nameLines[0],
        `${qtyText(l.system_qty)}${l.unit ? ` ${l.unit}` : ''}`,
        has ? qtyText(l.counted_qty) : 'not counted',
        has ? signed(l.diff_qty) : '-',
        l.value_diff === null || l.value_diff === undefined ? '-' : moneyText(l.value_diff),
      ];
      text('F3', 8, MARGIN, y, row(cells), color);
      y -= 11;
      nameLines.slice(1).forEach((ln) => {
        text('F3', 8, MARGIN, y, ln, color);
        y -= 11;
      });
    });
    y -= 12;
  });

  pages.forEach((p, i) => {
    ops = p;
    text('F1', 8, MARGIN, 28, `Stock count report ${no}`, GRAY);
    text('F1', 8, PW - MARGIN - 50, 28, `Page ${i + 1} of ${pages.length}`, GRAY);
  });

  // ---- assemble the file ----
  const fonts = { F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Courier', F4: 'Courier-Bold' };
  const n = (v) => Number(v.toFixed(2));
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = pages.map((_, i) => `${7 + 2 * i} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  ['F1', 'F2', 'F3', 'F4'].forEach((k, i) => {
    objects[3 + i] = `<< /Type /Font /Subtype /Type1 /BaseFont /${fonts[k]} /Encoding /WinAnsiEncoding >>`;
  });
  pages.forEach((p, i) => {
    const content = p
      .map((o) =>
        o.rule
          ? `0.8 g ${n(o.x)} ${n(o.y)} ${n(o.w)} 0.6 re f`
          : `${o.color.join(' ')} rg BT /${o.f} ${o.size} Tf ${n(o.x)} ${n(o.y)} Td (${pdfStr(o.t)}) Tj ET`
      )
      .join('\n');
    objects[7 + 2 * i] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${8 + 2 * i} 0 R >>`;
    objects[8 + 2 * i] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}