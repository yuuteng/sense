// 导入导出纯逻辑（不依赖 wx-server-sdk，可本地单测）
// 导出：exportRows（记录→中文表头行）、toCsv（RFC4180 转义）
// 导入：parseImportContent（json/csv/excel → 统一行）+ 键名映射 + 值归一化
//
// 键名映射（ALIASES）解决「其他软件导出的字段名不一致」：
// 常见记账/账单导出的表头（中英文）都映射到我们的规范字段；未知列忽略，
// 缺关键字段（日期/金额）或值非法的行跳过并记录原因，导入结果反馈成功/失败条数与原因。

const round2 = (n) => Math.round(n * 100) / 100;
// 中间固化值必须比展示精度高：amountConverted 用 round6（与 lib.js:7 及 record.create/update 一致）。
// 用 round2 固化会在小面值展示币上把误差放大回来（ISK 约 159 倍 → 0.005×159 ≈ 0.78），
// 使「日聚合×系数」与「逐笔换算」两条路径落到不同的分上。
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const p2 = (n) => String(n).padStart(2, '0');

// ============ 导出 ============
function exportRows(records, mMap) {
  return records.map((r) => ({
    日期: r.date,
    类型: r.type === 'income' ? '收入' : '支出',
    标题: r.title || '',
    分类: r.categoryPath || '',
    原始金额: r.amount,
    币种: r.currency,
    换算金额: r.amountConverted,
    备注: r.note || '',
    记录人: (mMap[r.recorderOpenid] || {}).name || '',
    付款人: (mMap[r.payerOpenid] || {}).name || '',
  }));
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [headers.join(',')];
  rows.forEach((r) => lines.push(headers.map((h) => esc(r[h])).join(',')));
  return lines.join('\r\n');
}

// ============ 导入：解析 ============
// RFC4180 CSV 解析（引号包裹、"" 转义、字段内逗号/换行、CRLF、BOM）
function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = []; let cur = ['']; let ci = 0; let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { cur[ci] += '"'; i++; } else inQ = false; }
      else cur[ci] += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { cur.push(''); ci++; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      rows.push(cur); cur = ['']; ci = 0;
    } else cur[ci] += ch;
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1)
    .filter((r) => r.some((v) => String(v).trim() !== ''))
    .map((r) => { const o = {}; headers.forEach((h, i2) => { o[h] = r[i2] != null ? r[i2] : ''; }); return o; });
}

// Excel（.xlsx/.xls）→ 行对象（首个工作表，表头=第一行；日期单元格转 Date）
function excelToRows(buf) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

// ============ 导入：键名映射 + 值归一化 ============
// 表头别名 →规范字段。覆盖：本产品导出（中文表头/JSON 英文键）、
// 支付宝/微信账单、随手记/鲨鱼记账/钱迹等常见导出的表头叫法。
const ALIASES = {
  date: ['date', '日期', '时间', '交易时间', '记账日期', '交易创建时间', '日期时间', '入账日期', '消费日期'],
  type: ['type', '类型', '收支', '收/支', '收支类型', '交易类型'],
  amount: ['amount', 'money', '金额', '原始金额', '金额(元)', '金额（元）', '交易金额', '消费金额'],
  currency: ['currency', '币种', '货币', '币别'],
  category: ['categorypath', 'category', '分类', '类别', '分类名称', '交易分类', '一级分类', '父类别', '支出类别', '收入类别'],
  subcategory: ['subcategory', '二级分类', '子分类', '子类别'],
  title: ['title', '标题', '名称', '商品', '商品名称', '项目'],
  note: ['note', 'remark', 'memo', 'description', '备注', '摘要', '说明', '商品说明'],
  amountconverted: ['amountconverted', '换算金额'],
  rate: ['rate', '汇率'],
  counterparty: ['交易对方', '对方', '收/付款方'],
};
const HEADER_TO_FIELD = {};
Object.keys(ALIASES).forEach((f) => ALIASES[f].forEach((a) => { HEADER_TO_FIELD[a.toLowerCase()] = f; }));

// 一行原始对象 → { field: value }（按别名归拢，未知列丢弃）
function mapKeys(raw) {
  const out = {};
  Object.keys(raw || {}).forEach((k) => {
    const f = HEADER_TO_FIELD[String(k).trim().toLowerCase()];
    if (f && out[f] === undefined) out[f] = raw[k];
  });
  return out;
}

function normType(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (['income', '收入', '收', 'in', '+'].indexOf(s) >= 0) return 'income';
  if (['expense', '支出', '支', 'out', '-', '消费'].indexOf(s) >= 0) return 'expense';
  if (!s) return 'expense'; // 缺失默认支出（多数账单为支出）
  return null;              // 未知（如 不计收支/转账）→ 跳过
}

function normAmount(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[¥￥$€£,，\s元]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

function normDate(v) {
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel 日期序列号
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  let s = String(v == null ? '' : v).trim();
  if (!s) return null;
  s = s.split(/[T\s]/)[0].replace(/[./年月]/g, '-').replace(/日/g, '');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${p2(mo)}-${p2(d)}`;
}

const CUR_NAME = {
  人民币: 'CNY', 美元: 'USD', 欧元: 'EUR', 日元: 'JPY', 港币: 'HKD', 英镑: 'GBP', 韩元: 'KRW',
  瑞士法郎: 'CHF', 冰岛克朗: 'ISK', 瑞典克朗: 'SEK', 挪威克朗: 'NOK', 丹麦克朗: 'DKK',
  波兰兹罗提: 'PLN', 捷克克朗: 'CZK', 匈牙利福林: 'HUF', 罗马尼亚列伊: 'RON', 保加利亚列弗: 'BGN',
  土耳其里拉: 'TRY', 俄罗斯卢布: 'RUB',
  澳元: 'AUD', 加元: 'CAD', 新西兰元: 'NZD', 新加坡元: 'SGD', 新台币: 'TWD', 泰铢: 'THB',
  马来西亚林吉特: 'MYR', 越南盾: 'VND', 印尼盾: 'IDR', 印度卢比: 'INR', 阿联酋迪拉姆: 'AED',
};
function normCurrency(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (CUR_NAME[s]) return CUR_NAME[s];
  if (/^[a-z]{3}$/i.test(s)) return s.toUpperCase();
  return '';
}

// 分类路径统一为「父 / 子」（我们的模型固定两级）：
// - 分类+子分类两列 → 「父 / 子」
// - 单列含 / > 分隔的多级（3~4 级）→ 折叠为「首级 / 末级」（首级定大类，末级最具体；中间层舍弃）
// - 只有一级 → 「父」
function normCategoryPath(cat, sub) {
  const parts = String(cat == null ? '' : cat).split(/[/>＞]/).map((x) => x.trim()).filter(Boolean);
  const s = String(sub == null ? '' : sub).trim();
  if (s) return parts.length ? `${parts[0]} / ${s}` : s;
  if (parts.length > 2) return `${parts[0]} / ${parts[parts.length - 1]}`;
  return parts.join(' / ');
}

// 原始行数组 → { rows: 规范行[], errors: [{index, summary, reason}] }
// index 为数据行序号（1 起，不含表头）；summary 为「日期 · 标题」摘要，帮用户在源文件中定位
function normalizeImportRows(raws) {
  const rows = []; const errors = [];
  (raws || []).forEach((raw, i) => {
    const idx = i + 1;
    const m = mapKeys(raw);
    const brief = () => {
      const t = String(m.title == null ? '' : m.title).trim() || String(m.note == null ? '' : m.note).trim();
      const d = String(m.date == null ? '' : m.date).trim();
      return [d, t].filter(Boolean).join(' · ').slice(0, 40);
    };
    const type = normType(m.type);
    if (!type) { errors.push({ index: idx, summary: brief(), reason: `收支类型「${String(m.type).trim()}」不支持` }); return; }
    let amount = normAmount(m.amount);
    let conv = normAmount(m.amountconverted);
    let currency = normCurrency(m.currency);
    // 数据源只有「换算金额」一列（无原始金额）：把它当作基准币金额使用。
    // 此时即使标了外币也无法还原原始外币值，按基准币入账最不失真。
    if ((!Number.isFinite(amount) || amount === 0) && Number.isFinite(conv) && conv !== 0) {
      amount = conv;
      currency = '';
    }
    if (!Number.isFinite(amount) || amount === 0) { errors.push({ index: idx, summary: brief(), reason: '金额缺失或无效，应为大于 0 的数字' }); return; }
    amount = Math.abs(amount);
    if (Number.isFinite(conv)) conv = Math.abs(conv);
    const date = normDate(m.date);
    if (!date) { errors.push({ index: idx, summary: brief(), reason: '日期缺失或格式无法识别，应为 YYYY-MM-DD' }); return; }
    const note = String(m.note == null ? '' : m.note).trim() || String(m.counterparty == null ? '' : m.counterparty).trim();
    const rate = normAmount(m.rate);
    rows.push({
      _idx: idx, // 原始数据行号（1 起），供导入结果反馈定位
      type, amount, date,
      currency,
      categoryPath: normCategoryPath(m.category, m.subcategory),
      title: String(m.title == null ? '' : m.title).trim(),
      note,
      amountConverted: Number.isFinite(conv) && conv > 0 ? round6(conv) : null,
      rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    });
  });
  return { rows, errors };
}

// 入口：format = json | csv | excel。json/csv 传 content（utf8 文本），excel 传 contentBase64
function parseImportContent(format, content, contentBase64) {
  let raws;
  if (format === 'excel') {
    if (!contentBase64) throw new Error('缺少 Excel 文件内容');
    raws = excelToRows(Buffer.from(contentBase64, 'base64'));
  } else if (format === 'csv') {
    raws = parseCsv(content);
  } else {
    let obj = content;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj.replace(/^﻿/, '')); } catch (e) { throw new Error('JSON 解析失败'); }
    }
    raws = (obj && obj.records) || (Array.isArray(obj) ? obj : []);
  }
  return normalizeImportRows(raws);
}

// ============ PDF 报表 ============
// 中文渲染依赖内嵌字体 assets/wqy-microhei.ttc（文泉驿微米黑，Apache 许可）。
// rows 为 exportRows 的中文键行；meta = { bookName, baseCurrency, rangeText, exportedAt }
// 仅列内嵌字体（文泉驿微米黑，2010 年前字库）确定有字形的符号；
// 较新的货币符号（₺ ₽ ₹ ₫ د.إ 等）字体缺字形，回退用币种码前缀，避免 PDF 出现方块。
const PDF_SYM = {
  CNY: '¥', USD: '$', EUR: '€', JPY: '¥', KRW: '₩', HKD: 'HK$', GBP: '£',
  CHF: 'Fr', ISK: 'kr', SEK: 'kr', NOK: 'kr', DKK: 'kr',
  PLN: 'zł', CZK: 'Kč', HUF: 'Ft', RON: 'lei', BGN: 'лв',
  AUD: 'A$', CAD: 'C$', NZD: 'NZ$', SGD: 'S$', TWD: 'NT$', THB: '฿', MYR: 'RM', IDR: 'Rp',
};
function pdfMoney(n, code) {
  const s = (Math.round((n || 0) * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${PDF_SYM[code] || (code ? code + ' ' : '')}${s}`;
}
function buildPdf(meta, rows) {
  const PDFDocument = require('pdfkit');
  const nodePath = require('path');
  const INK = '#3e4550', MUTED = '#748294', LINE = '#e4e7ec', ZEBRA = '#f6f9fc';
  const GREEN = '#5c9a0e', BLUE = '#0089c0';
  const M = 40; // 页边距
  const doc = new PDFDocument({ size: 'A4', margins: { top: 48, left: M, right: M, bottom: 56 }, bufferPages: true });
  doc.registerFont('CN', nodePath.join(__dirname, 'assets', 'wqy-microhei.ttc'), 'WenQuanYiMicroHei');
  doc.font('CN');

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // 按当前字号实测宽度截断补"…"。
    // 不能依赖 lineBreak:false / ellipsis：pdfkit 对 CJK 每个字都是可断点，超宽会强制折行溢出行高。
    const fit = (v, w) => {
      let s = String(v == null ? '' : v);
      if (doc.widthOfString(s) <= w) return s;
      while (s.length > 1 && doc.widthOfString(s + '…') > w) s = s.slice(0, -1);
      return s + '…';
    };

    const W = doc.page.width - M * 2;              // 可用宽度
    const bottomY = doc.page.height - 56 - 16;     // 表格可用底线（给页脚留位）
    // 列布局：日期 | 类型 | 分类 | 标题·备注 | 原始金额 | 换算金额
    const cols = [
      { key: '日期', w: 62 }, { key: '类型', w: 32 }, { key: '分类', w: 102 },
      { key: '标题', w: W - 62 - 32 - 102 - 76 - 84 }, { key: '原始金额', w: 76, right: true }, { key: '换算金额', w: 84, right: true },
    ];
    const rowH = 19;

    // —— 头部 ——
    doc.fontSize(17).fillColor(INK).text('心数 Sense · 记账明细', M, 48);
    doc.fontSize(9).fillColor(MUTED).text(
      `账本：${meta.bookName}    基准币种：${meta.baseCurrency}    时间范围：${meta.rangeText}    导出日期：${meta.exportedAt}`,
      M, doc.y + 6,
    );
    // 汇总（按基准币换算金额）
    let tIn = 0, tOut = 0;
    rows.forEach((r) => { if (r.类型 === '收入') tIn += Number(r.换算金额) || 0; else tOut += Number(r.换算金额) || 0; });
    const y0 = doc.y + 10;
    doc.roundedRect(M, y0, W, 34, 6).fillAndStroke(ZEBRA, LINE);
    doc.fontSize(10);
    const cellW = W / 3;
    doc.fillColor(GREEN).text(`收入合计  +${pdfMoney(tIn, meta.baseCurrency)}`, M + 14, y0 + 10, { width: cellW });
    doc.fillColor(INK).text(`支出合计  -${pdfMoney(tOut, meta.baseCurrency)}`, M + 14 + cellW, y0 + 10, { width: cellW });
    doc.fillColor(BLUE).text(`结余  ${tIn - tOut >= 0 ? '+' : '-'}${pdfMoney(Math.abs(tIn - tOut), meta.baseCurrency)}`, M + 14 + cellW * 2, y0 + 10, { width: cellW - 14 });

    // —— 表格 ——
    let y = y0 + 46;
    const drawHead = () => {
      doc.rect(M, y, W, rowH).fill(ZEBRA);
      let x = M;
      doc.fontSize(8.5).fillColor(MUTED);
      cols.forEach((c) => {
        doc.text(fit(c.key, c.w - 10), x + 5, y + 5, { width: c.w - 10, align: c.right ? 'right' : 'left', lineBreak: false });
        x += c.w;
      });
      doc.moveTo(M, y + rowH).lineTo(M + W, y + rowH).strokeColor(LINE).lineWidth(0.5).stroke();
      y += rowH;
    };
    drawHead();
    if (!rows.length) {
      doc.fontSize(10).fillColor(MUTED).text('该时间范围内没有记录', M, y + 14, { width: W, align: 'center' });
    }
    rows.forEach((r, i) => {
      if (y + rowH > bottomY) { doc.addPage(); y = 48; drawHead(); }
      if (i % 2 === 1) doc.rect(M, y, W, rowH).fill(ZEBRA);
      const isIn = r.类型 === '收入';
      const conv = `${isIn ? '+' : '-'}${pdfMoney(r.换算金额, meta.baseCurrency)}`;
      const orig = `${pdfMoney(r.原始金额, r.币种)} ${r.币种}`;
      const titleTxt = [r.标题, r.备注].filter(Boolean).join(' · ');
      const vals = [r.日期, r.类型, r.分类 || '—', titleTxt || '—', orig, conv];
      let x = M;
      doc.fontSize(8.5);
      cols.forEach((c, ci) => {
        doc.fillColor(ci === 1 && isIn ? GREEN : ci === 5 ? (isIn ? GREEN : INK) : ci === 5 - 1 ? MUTED : INK);
        doc.text(fit(vals[ci], c.w - 10), x + 5, y + 5, { width: c.w - 10, align: c.right ? 'right' : 'left', lineBreak: false });
        x += c.w;
      });
      doc.moveTo(M, y + rowH).lineTo(M + W, y + rowH).strokeColor(LINE).lineWidth(0.5).stroke();
      y += rowH;
    });
    doc.fontSize(8.5).fillColor(MUTED).text(`共 ${rows.length} 条记录`, M, y + 8);

    // —— 页脚（页码）——
    // 注意：写入底边距区域会触发 pdfkit 自动加页，必须先把该页 bottom margin 清零
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const bm = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(8).fillColor(MUTED)
        .text('由 心数 Sense 生成 · 换算金额按记账当日汇率固化', M, doc.page.height - 40, { width: W / 2, lineBreak: false })
        .text(`第 ${i + 1} / ${range.count} 页`, M + W / 2, doc.page.height - 40, { width: W / 2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bm;
    }
    doc.end();
  });
}

module.exports = { exportRows, toCsv, parseCsv, excelToRows, normalizeImportRows, parseImportContent, buildPdf };
