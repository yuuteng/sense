const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');
const tabbar = require('../../utils/tabbar');
const theme = require('../../utils/chart-theme');

const GREEN = '#9edf10', BLUE = '#00ccf9', TRACK = '#e4e7ec', AXIS = '#97a7b7';
function enc(svg) { return 'data:image/svg+xml,' + encodeURIComponent(svg); }
function genId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// —— 以下三个 SVG 生成函数仅用于「添加图表」面板的静态示意缩略图 ——
// 真实图表已全部迁移 ECharts（utils/chart-theme.js + components/chart）。
// 甜甜圈饼图：收入(绿) vs 支出(蓝)
function donutSvg(income, expense) {
  const cx = 100, cy = 100, r = 66, sw = 30, C = 2 * Math.PI * r;
  const total = income + expense;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${sw}"/>`;
  if (total > 0) {
    const incLen = C * (income / total);
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${GREEN}" stroke-width="${sw}" stroke-dasharray="${incLen.toFixed(2)} ${(C - incLen).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    const expLen = C - incLen;
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${BLUE}" stroke-width="${sw}" stroke-dasharray="${expLen.toFixed(2)} ${incLen.toFixed(2)}" stroke-dashoffset="${(-incLen).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
  }
  s += `</svg>`;
  return enc(s);
}
// 柱状图（支出）
function barsSvg(values, labels) {
  const W = 320, H = 156, base = H - 24, top = 12, n = values.length || 1;
  const max = Math.max(1, ...values);
  const slot = W / n;
  const bw = Math.max(6, Math.min(28, slot * 0.5));
  const every = Math.ceil(n / 7);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="${TRACK}" stroke-width="1"/>`;
  values.forEach((v, i) => {
    const h = v > 0 ? Math.max(3, (v / max) * (base - top)) : 0;
    const x = slot * i + (slot - bw) / 2;
    s += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${BLUE}"/>`;
    if (i % every === 0) s += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 5}" font-size="11" text-anchor="middle" fill="${AXIS}">${labels[i]}</text>`;
  });
  s += `</svg>`;
  return enc(s);
}
// 分组柱状图：每月 收入(绿) + 支出(蓝)
function pairedSvg(rows) {
  const W = 320, H = 156, base = H - 24, top = 12, n = rows.length || 1;
  const max = Math.max(1, ...rows.map((r) => r.income), ...rows.map((r) => r.expense));
  const slot = W / n;
  const bw = Math.max(4, Math.min(11, slot * 0.30));
  const every = Math.ceil(n / 6);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="${TRACK}" stroke-width="1"/>`;
  rows.forEach((r, i) => {
    const c = slot * i + slot / 2;
    const hi = r.income > 0 ? Math.max(3, (r.income / max) * (base - top)) : 0;
    const he = r.expense > 0 ? Math.max(3, (r.expense / max) * (base - top)) : 0;
    s += `<rect x="${(c - bw - 1).toFixed(1)}" y="${(base - hi).toFixed(1)}" width="${bw.toFixed(1)}" height="${hi.toFixed(1)}" rx="2" fill="${GREEN}"/>`;
    s += `<rect x="${(c + 1).toFixed(1)}" y="${(base - he).toFixed(1)}" width="${bw.toFixed(1)}" height="${he.toFixed(1)}" rx="2" fill="${BLUE}"/>`;
    if (i % every === 0) s += `<text x="${c.toFixed(1)}" y="${H - 5}" font-size="10" text-anchor="middle" fill="${AXIS}">${rows[i].label}</text>`;
  });
  s += `</svg>`;
  return enc(s);
}

// 图表类型（可添加多个同类型实例）。趋势卡不按「指标×粒度」拆成一堆类型，
// 而是卡内配置：指标（支出/收入/结余）× 区间（近7/14/30日、近6/12月）——组合全覆盖。
const TYPES = {
  monthPie: { title: '月度收支', desc: '任一月份收入 / 支出占比，可切换月份', kind: 'pie' },
  catBreakdown: { title: '分类占比', desc: '某月支出/收入按分类的占比与排行，可钻取明细', kind: 'cat' },
  yearPie: { title: '年度收支', desc: '自然年（可切年份）或近一年的收支占比', kind: 'pie' },
  totalPie: { title: '累计收支', desc: '账本自建立以来收支占比', kind: 'pie' },
  yearInOut: { title: '收支对比', desc: '近 N 月收入 vs 支出并排柱状', kind: 'paired', defRange: 6 },
  trendBars: { title: '收支柱状', desc: '支出 / 收入 / 结余，按日或按月，柱状', kind: 'bars' },
  trendLine: { title: '收支趋势', desc: '支出 / 收入 / 结余，按日或按月，折线', kind: 'line' },
};
const DEFAULT_LAYOUT = ['monthPie', 'catBreakdown', 'trendLine', 'yearInOut'];

// 趋势卡的指标与区间（span：d=按日 m=按月，数字为期数）
const METRICS = {
  expense: { label: '支出', color: BLUE },
  income: { label: '收入', color: GREEN },
  balance: { label: '结余', color: '#0089c0' },
};
const SPANS = [
  { k: 'd7', label: '近 7 日' }, { k: 'd14', label: '近 14 日' }, { k: 'd30', label: '近 30 日' },
  { k: 'm6', label: '近 6 月' }, { k: 'm12', label: '近 12 月' },
];
const RANK_TOP = 5; // 分类排行默认展示前 5，其余折叠

// 'YYYY-MM' 偏移 delta 个月
function shiftYm(ym, delta) {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
// 本地当月（后端字段缺失时的兜底）
function localYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 多色环形示意图（分类占比缩略图）：values 为各段占比，colors 对应色
function catPreviewSvg(values, colors) {
  const cx = 100, cy = 100, r = 66, sw = 30, C = 2 * Math.PI * r;
  const total = values.reduce((s, v) => s + v, 0) || 1;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">`;
  let off = 0;
  values.forEach((v, i) => {
    const len = C * (v / total);
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i]}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    off += len;
  });
  s += `</svg>`;
  return enc(s);
}

// 折线示意图（面积 + 线）
function lineSvg(values, color) {
  const W = 320, H = 156, base = H - 14, top = 14;
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => `${((i * W) / (n - 1)).toFixed(1)},${(base - (v / max) * (base - top)).toFixed(1)}`);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<polygon points="0,${base} ${pts.join(' ')} ${W},${base}" fill="${color}22"/>`;
  s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `</svg>`;
  return enc(s);
}

// 「添加图表」弹层用的示意缩略图：套用真实图表的画法 + 一组样例数据，纯展示、不含真实金额
const PREVIEW = {
  monthPie: donutSvg(62, 38),
  yearPie: donutSvg(58, 42),
  totalPie: donutSvg(56, 44),
  catBreakdown: catPreviewSvg([38, 26, 18, 12, 6], theme.CAT_COLORS.slice(0, 5)),
  trendLine: lineSvg([30, 46, 38, 64, 50, 72, 58, 80], BLUE),
  trendBars: barsSvg([30, 52, 40, 68, 45, 60, 74], ['', '', '', '', '', '', '']),
  yearInOut: pairedSvg([
    { income: 70, expense: 52, label: '' }, { income: 60, expense: 66, label: '' },
    { income: 82, expense: 48, label: '' }, { income: 55, expense: 62, label: '' },
    { income: 76, expense: 58, label: '' }, { income: 64, expense: 72, label: '' },
  ]),
};
// 面板按图形形态分组：先环形、再柱状、后折线，同形态集中展示
const PICKER_SECTIONS = [
  { name: '环形图 · 占比', ids: ['monthPie', 'catBreakdown', 'yearPie', 'totalPie'] },
  { name: '柱状图 · 对比', ids: ['yearInOut', 'trendBars'] },
  { name: '折线图 · 趋势', ids: ['trendLine'] },
].map((sec) => ({
  name: sec.name,
  items: sec.ids.map((id) => ({ type: id, kind: TYPES[id].kind, title: TYPES[id].title, desc: TYPES[id].desc, preview: PREVIEW[id] })),
}));

// 兼容旧布局（字符串 id / 旧类型 id）与新布局（实例对象）。
// month：'YYYY-MM' = 固定看该月；不存 = 跟随当前月（默认卡行为）。
// 旧趋势类型迁移：dayLine/weekExpense/balanceLine → trendLine/trendBars + 指标/区间配置。
const LEGACY_TREND = {
  dayLine: (r) => ({ type: 'trendLine', metric: 'expense', span: 'd' + (r || 30) }),
  balanceLine: (r) => ({ type: 'trendLine', metric: 'balance', span: 'm' + (r || 12) }),
  weekExpense: (r) => ({ type: 'trendBars', metric: 'expense', span: 'd' + (r || 7) }),
};
function normalizeLayout(order) {
  const arr = (Array.isArray(order) && order.length) ? order : DEFAULT_LAYOUT;
  return arr.map((raw0) => {
    let it = raw0;
    if (typeof it === 'string') it = { type: it };
    if (!it || !it.type) return null;
    if (LEGACY_TREND[it.type]) it = { ...it, ...LEGACY_TREND[it.type](it.range) };
    if (!TYPES[it.type]) return null;
    const inst = { iid: it.iid || genId(), type: it.type, range: it.range || TYPES[it.type].defRange };
    if (/^\d{4}-\d{2}$/.test(it.month || '')) inst.month = it.month;
    if (it.type === 'catBreakdown') inst.catKind = it.catKind === 'income' ? 'income' : 'expense';
    if (it.type === 'yearPie') {
      inst.yearMode = it.yearMode === 'rolling' ? 'rolling' : 'year';
      const y = Number(it.year);
      if (y >= 2000 && y <= 2100) inst.year = y; // 不存 = 跟随当前年
    }
    if (it.type === 'trendLine' || it.type === 'trendBars') {
      inst.metric = METRICS[it.metric] ? it.metric : 'expense';
      inst.span = /^[dm]\d+$/.test(it.span || '') ? it.span : (it.type === 'trendLine' ? 'd30' : 'd7');
    }
    return inst;
  }).filter(Boolean);
}

Page({
  data: {
    cards: [],
    editing: false,
    bookName: '',
    displayCurrency: '',
    chevronDown: '',
    addIcon: '',
    barsIcon: '',
    canAdd: true,
    needInit: false,
    loading: true,
    // 账本切换（与首页一致）
    switcherVisible: false,
    currentBookId: '',
    books: [],
    // 展示币种切换
    curCode: 'CNY',
    curSym: '¥',
    curVisible: false,
    // 添加图表弹层（按图形形态分组）
    pickerRender: false,
    pickerUp: false,
    pickerSections: PICKER_SECTIONS,
    // 编辑模式（长按进入）：整张卡片拖拽排序
    dragIid: '',
    dragY: 0,
    // 任一弹层打开时卸载图表 canvas（iOS 同层渲染会浮到弹层上）
    overlayUp: false,
  },

  onPageScroll(e) { this._scrollTop = e.scrollTop; },

  onLoad() {
    this.layout = normalizeLayout(DEFAULT_LAYOUT);
    const wi = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._winH = wi.windowHeight; // 拖拽时自动滚动的边缘判定
    this._scrollTop = 0;
    this.setData({
      chevronDown: icons.get('chevronDown', '#748294', 2.2),
      addIcon: icons.get('plus', '#0089c0', 2),
      barsIcon: icons.get('bars', '#97a7b7', 1.4),
      dragIcon: icons.get('dragHandle', '#97a7b7', 2),
      bookIcon: icons.get('book', '#0089c0', 1.7),
      splitIcon: icons.get('bookSplit', '#a47d06', 1.7),
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1, hidden: false });
    }
    this.load();
  },

  async load() {
    try {
      const book = await api.call('book', 'getCurrent');
      if (!book) { this.setData({ needInit: true, loading: false }); return; }
      if (this.bookId !== book.bookId) this._catCache = {}; // 切账本清分类聚合缓存
      this.bookId = book.bookId;
      this.cur = book.displayCurrency || 'CNY';
      this.setData({ bookName: book.name, currentBookId: book.bookId, curCode: this.cur, curSym: fmt.symbolOf(this.cur), needInit: false });
      const [raw, layout] = await Promise.all([
        api.call('stats', 'getChartData', { bookId: book.bookId }),
        api.call('layout', 'get', { bookId: book.bookId }),
      ]);
      this.raw = raw;
      this._catCache = {}; // 数据可能已变（新记账/改展示币种），聚合重新拉
      this.layout = normalizeLayout(layout.order);
      await this.ensureCatData();
      this.rebuild();
      this.setData({ loading: false });
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  // 确保布局中所有分类占比卡所需月份的聚合数据已就位（并发拉取，去重）
  async ensureCatData() {
    const curYm = (this.raw && this.raw.curMonth) || localYm();
    const months = [...new Set(this.layout.filter((x) => x.type === 'catBreakdown').map((x) => x.month || curYm))];
    this._catCache = this._catCache || {};
    const missing = months.filter((ym) => !this._catCache[ym]);
    if (!missing.length) return;
    const results = await Promise.all(missing.map((ym) =>
      api.call('stats', 'getCategoryData', { bookId: this.bookId, month: ym }).catch(() => null)));
    missing.forEach((ym, i) => { if (results[i]) this._catCache[ym] = results[i]; });
  },

  rebuild() {
    this.setData({ cards: this.layout.map((inst) => this.buildCard(inst)), canAdd: true });
  },

  buildCard(inst) {
    const raw = this.raw || {}; const cur = this.cur;
    if (inst.type === 'totalPie') {
      const p = raw.totalPie || { income: 0, expense: 0 };
      return {
        iid: inst.iid, type: inst.type, kind: 'pie',
        title: '账本累计收支', sub: '自建立以来 · 收入 vs 支出',
        option: theme.donutOption(p.income, p.expense),
        legends: [
          { dot: GREEN, k: '总收入', v: fmt.money(p.income, cur), type: 'income' },
          { dot: BLUE, k: '总支出', v: fmt.money(p.expense, cur), type: 'expense' },
          { k: '累计结余', v: fmt.signedTotal(p.income - p.expense, cur), strong: true, link: true },
        ],
      };
    }
    if (inst.type === 'monthPie') {
      // 月度收支：inst.month 固定看某月；未设置则跟随当前月
      const curYm = raw.curMonth || localYm();
      const firstYm = raw.firstMonth || curYm;
      const ym = inst.month || curYm;
      const isCur = ym === curYm;
      const p = (isCur && raw.monthPie)
        ? raw.monthPie
        : ((raw.monthly || []).find((x) => x.ym === ym) || { income: 0, expense: 0 });
      const [yy, mm] = ym.split('-');
      const mNum = parseInt(mm, 10);
      return {
        iid: inst.iid, type: inst.type, kind: 'pie',
        title: isCur ? '本月收支' : `${yy}年${mNum}月收支`,
        sub: `${yy} 年 ${mNum} 月 · 收入 vs 支出`,
        monthText: `${yy}年${mNum}月`,
        month: {
          ym, text: `${yy}年${mNum}月${isCur ? ' · 本月' : ''}`,
          first: firstYm, last: curYm,
          prevOk: ym > firstYm, nextOk: ym < curYm,
        },
        drFrom: `${ym}-01`, drTo: `${ym}-31`, drText: `${yy}年${mNum}月`,
        option: theme.donutOption(p.income, p.expense),
        legends: [
          { dot: GREEN, k: '收入', v: fmt.money(p.income, cur), type: 'income' },
          { dot: BLUE, k: '支出', v: fmt.money(p.expense, cur), type: 'expense' },
          { k: '结余', v: fmt.signedTotal(p.income - p.expense, cur), strong: true, link: true },
        ],
      };
    }
    if (inst.type === 'yearPie') {
      // 年度收支：自然年（可切年份，默认跟随当前年）或「近一年」滚动 12 个月
      const curYm = raw.curMonth || localYm();
      const curYear = Number(curYm.slice(0, 4));
      const firstYear = Number((raw.firstMonth || curYm).slice(0, 4));
      const rolling = inst.yearMode === 'rolling';
      const monthly = raw.monthly || [];
      const year = Math.max(firstYear, Math.min(curYear, inst.year || curYear));
      const rows = rolling ? monthly.slice(-12) : monthly.filter((x) => x.ym.slice(0, 4) === String(year));
      let inc = 0, ex = 0;
      rows.forEach((x) => { inc += x.income; ex += x.expense; });
      inc = Math.round(inc * 100) / 100; ex = Math.round(ex * 100) / 100;
      return {
        iid: inst.iid, type: inst.type, kind: 'pie',
        title: rolling ? '近一年收支' : `${year} 年收支`,
        sub: rolling ? '近 12 个月 · 收入 vs 支出' : `${year} 自然年 · 收入 vs 支出`,
        yearMode: rolling ? 'rolling' : 'year',
        yearNav: rolling ? null : { year, prevOk: year > firstYear, nextOk: year < curYear },
        drFrom: rolling ? (rows[0] ? `${rows[0].ym}-01` : `${curYear}-01-01`) : `${year}-01-01`,
        drTo: rolling ? `${curYm}-31` : `${year}-12-31`,
        drText: rolling ? '近一年' : `${year}年`,
        option: theme.donutOption(inc, ex),
        legends: [
          { dot: GREEN, k: '收入', v: fmt.money(inc, cur), type: 'income' },
          { dot: BLUE, k: '支出', v: fmt.money(ex, cur), type: 'expense' },
          { k: '结余', v: fmt.signedTotal(inc - ex, cur), strong: true, link: true },
        ],
      };
    }
    if (inst.type === 'trendLine' || inst.type === 'trendBars') {
      // 趋势卡：指标（支出/收入/结余）× 区间（近7/14/30日、近6/12月），折线或柱状
      const metric = METRICS[inst.metric] ? inst.metric : 'expense';
      const span = /^[dm]\d+$/.test(inst.span || '') ? inst.span : 'd30';
      const isDay = span[0] === 'd';
      const n = Number(span.slice(1));
      const rows = ((isDay ? raw.daily : raw.monthly) || []).slice(-n);
      const val = (x) => (metric === 'income' ? x.income : metric === 'balance' ? Math.round((x.income - x.expense) * 100) / 100 : x.expense);
      const vals = rows.map(val);
      const labels = rows.map((x) => x.label);
      const m = METRICS[metric];
      const sub = metric === 'balance'
        ? `${isDay ? '按日' : '按月'} · 收入 − 支出`
        : `${isDay ? '按日' : '按月'} · 合计 ${fmt.money(vals.reduce((s, v) => s + v, 0), cur)}`;
      return {
        iid: inst.iid, type: inst.type,
        kind: inst.type === 'trendBars' ? 'bars' : 'line',
        trend: true,
        metrics: Object.keys(METRICS).map((k) => ({ k, label: METRICS[k].label, on: k === metric })),
        spans: SPANS.map((s) => ({ ...s, on: s.k === span })),
        title: `近 ${n} ${isDay ? '日' : '个月'}${m.label}`,
        sub,
        option: inst.type === 'trendBars'
          ? theme.barsOption(vals, labels, m.color)
          : theme.lineOption(vals, labels, { color: m.color }),
        legends: [{ dot: m.color, k: `每${isDay ? '日' : '月'}${m.label}` }],
      };
    }
    if (inst.type === 'catBreakdown') {
      // 分类占比：某月 × 收/支 × 顶级分类，环形图 + 排行（前 5 折叠）
      const curYm = raw.curMonth || localYm();
      const firstYm = raw.firstMonth || curYm;
      const ym = inst.month || curYm;
      const isCur = ym === curYm;
      const kind = inst.catKind || 'expense';
      const cache = (this._catCache || {})[ym];
      const kd = (cache && cache[kind]) || { total: 0, cats: [] };
      const [yy, mm] = ym.split('-');
      const mNum = parseInt(mm, 10);
      const expanded = !!(this._catExpand || {})[inst.iid];
      const rows = kd.cats.map((c, i) => ({
        categoryId: c.categoryId, name: c.name, count: c.count,
        total: fmt.money(c.total, cur), percent: c.percent + '%',
        dot: theme.catColorAt(i, kind),
      }));
      const shown = expanded ? rows : rows.slice(0, RANK_TOP);
      return {
        iid: inst.iid, type: inst.type, kind: 'cat',
        title: `${isCur ? '本月' : `${yy}年${mNum}月`}${kind === 'income' ? '收入' : '支出'}分类`,
        sub: `${yy} 年 ${mNum} 月 · 按顶级分类`,
        monthText: `${yy}年${mNum}月`,
        month: {
          ym, text: `${yy}年${mNum}月${isCur ? ' · 本月' : ''}`,
          first: firstYm, last: curYm,
          prevOk: ym > firstYm, nextOk: ym < curYm,
        },
        catKind: kind,
        option: theme.catDonutOption(kd.cats, kind),
        centerLabel: { k: kind === 'income' ? '总收入' : '总支出', v: fmt.money(kd.total, cur) },
        rows: shown,
        totalCount: rows.length,
        moreCount: rows.length - shown.length,
        expanded,
        empty: !rows.length,
      };
    }
    // yearInOut
    const arr = (raw.monthly || []).slice(-inst.range);
    return {
      iid: inst.iid, type: inst.type, kind: 'paired', range: 'month', rangeVal: inst.range,
      title: `近 ${inst.range} 个月收支`, sub: '按月 · 收入 vs 支出',
      option: theme.pairedOption(arr),
      legends: [{ dot: GREEN, k: '收入' }, { dot: BLUE, k: '支出' }],
    };
  },

  // —— 编辑模式：长按图表卡或点「编辑」进入；抓住卡片头部把整张卡拖走，其余卡片实时让位 ——
  toggleEdit() { if (this.data.editing) this.exitEdit(); else this.enterEdit(); },
  enterEdit(e) {
    if (this.data.editing || !this.layout.length) return;
    if (e) wx.vibrateShort({ type: 'light' }); // 长按触发时轻震反馈
    this.setData({ editing: true, dragIid: '', dragY: 0 });
  },
  exitEdit() {
    this._dz = null;
    this.setData({ editing: false, dragIid: '', dragY: 0 });
  },

  // 拖拽起手：实测所有卡片的位置与高度（页面坐标 = 视口坐标 + 滚动量），高矮不一也能精确换位
  onCardTouchStart(e) {
    if (!this.data.editing) return;
    const iid = e.currentTarget.dataset.iid;
    const pos = this.data.cards.findIndex((c) => c.iid === iid);
    if (pos < 0) return;
    this._dz = { iid, pos, startPageY: e.touches[0].clientY + this._scrollTop, ready: false, lastScroll: 0 };
    wx.createSelectorQuery()
      .selectAll('.chart-card').boundingClientRect()
      .selectViewport().scrollOffset()
      .exec((res) => {
        const dz = this._dz;
        if (!dz || dz.iid !== iid || !res || !res[0] || res[0].length !== this.data.cards.length) return;
        const st = res[1] ? res[1].scrollTop : this._scrollTop;
        const tops = res[0].map((r) => r.top + st);
        const hs = res[0].map((r) => r.height);
        dz.gap = tops.length > 1 ? Math.max(0, tops[1] - (tops[0] + hs[0])) : 12;
        dz.origTops = tops;                                   // 各卡初始页面顶（按 cards 下标）
        dz.vis = tops.map((t, i) => ({ ci: i, top: t, h: hs[i] })); // 视觉顺序槽位
        dz.dragH = hs[pos];
        dz.dragOrigTop = tops[pos];
        dz.ready = true;
      });
    this.setData({ dragIid: iid, dragY: 0 });
  },
  onCardTouchMove(e) {
    const dz = this._dz;
    if (!dz || !dz.ready) return;
    const clientY = e.touches[0].clientY;
    const dy = clientY + this._scrollTop - dz.startPageY;
    // 拖动卡的渲染中心 = 初始位置 + 手指位移（与槽位记账无关，保证手感跟手）
    const center = dz.dragOrigTop + dz.dragH / 2 + dy;
    const patch = { dragY: dy };
    let moved = true;
    while (moved) {
      moved = false;
      const below = dz.vis[dz.pos + 1];
      if (below && center > below.top + below.h / 2) {
        // 下邻上移进拖动卡的槽位；拖动卡槽位下移「下邻高度 + 间距」
        const slotTop = dz.vis[dz.pos].top;
        const dragSlot = dz.vis[dz.pos];
        below.top = slotTop;
        dragSlot.top = slotTop + below.h + dz.gap;
        dz.vis[dz.pos] = below;
        dz.vis[dz.pos + 1] = dragSlot;
        patch[`cards[${below.ci}].shiftY`] = Math.round(below.top - dz.origTops[below.ci]);
        dz.pos += 1;
        moved = true;
        continue;
      }
      const above = dz.vis[dz.pos - 1];
      if (above && center < above.top + above.h / 2) {
        // 上邻下移；拖动卡槽位上移到上邻原位置
        const aboveTop = above.top;
        const dragSlot = dz.vis[dz.pos];
        dragSlot.top = aboveTop;
        above.top = aboveTop + dz.dragH + dz.gap;
        dz.vis[dz.pos] = above;
        dz.vis[dz.pos - 1] = dragSlot;
        patch[`cards[${above.ci}].shiftY`] = Math.round(above.top - dz.origTops[above.ci]);
        dz.pos -= 1;
        moved = true;
      }
    }
    this.setData(patch);
    // 手指贴近视口上下沿：自动滚动，支持长距离拖动
    const now = Date.now();
    if (now - dz.lastScroll > 220) {
      if (clientY < 170 && this._scrollTop > 0) {
        dz.lastScroll = now;
        wx.pageScrollTo({ scrollTop: Math.max(0, this._scrollTop - 150), duration: 150 });
      } else if (clientY > this._winH - 170) {
        dz.lastScroll = now;
        wx.pageScrollTo({ scrollTop: this._scrollTop + 150, duration: 150 });
      }
    }
  },
  onCardTouchEnd() {
    const dz = this._dz;
    this._dz = null;
    if (!dz) return;
    if (!dz.ready) { this.setData({ dragIid: '', dragY: 0 }); return; }
    // 按最终视觉顺序提交 cards / layout，清空位移。
    // wx:key="iid" 让节点随排序移动而非重建，ECharts 画布无损保留。
    const order = dz.vis.map((v) => v.ci);
    const newCards = order.map((ci) => ({ ...this.data.cards[ci], shiftY: 0 }));
    this.layout = order.map((ci) => this.layout[ci]);
    this.setData({ cards: newCards, dragIid: '', dragY: 0 });
    this.saveLayout();
  },

  // 弹层期间卸载图表 canvas：canvas 2d 同层渲染在部分 iOS 上会浮到弹层之上，
  // 打开任何弹层（添加面板/账本切换/币种）即卸载画布（占位保高度），关闭后重挂自动重绘
  _setOverlay(open) {
    if (this._ovT) { clearTimeout(this._ovT); this._ovT = null; }
    if (open) this.setData({ overlayUp: true });
    else this._ovT = setTimeout(() => this.setData({ overlayUp: false }), 320); // 等退场动画结束再重挂
  },

  // 添加图表：弹出带示意图的选择面板（可重复添加，例如两个不同区间的支出趋势）；编辑模式中也可用
  openPicker() {
    tabbar.setHidden(true); // tabBar 层级高于弹层，打开时先藏
    this._setOverlay(true);
    this.setData({ pickerRender: true });
    this._pt = setTimeout(() => this.setData({ pickerUp: true }), 20);
  },
  closePicker() {
    tabbar.setHidden(false);
    this._setOverlay(false);
    this.setData({ pickerUp: false });
    this._pt = setTimeout(() => this.setData({ pickerRender: false }), 300);
  },
  noop() {},
  async pickType(e) {
    const { type } = e.currentTarget.dataset;
    if (!type || !TYPES[type]) return;
    const inst = { iid: genId(), type, range: TYPES[type].defRange };
    if (type === 'catBreakdown') inst.catKind = 'expense';
    if (type === 'yearPie') inst.yearMode = 'year'; // 默认自然年、跟随当前年
    if (type === 'trendLine') { inst.metric = 'expense'; inst.span = 'd30'; }
    if (type === 'trendBars') { inst.metric = 'expense'; inst.span = 'd7'; }
    this.layout = this.layout.concat([inst]);
    this.closePicker();
    if (type === 'catBreakdown') await this.ensureCatData();
    this.rebuild();
    this.saveLayout();
    wx.showToast({ title: `已添加「${TYPES[type].title}」`, icon: 'none' });
  },

  // —— 趋势卡：指标（支出/收入/结余）与区间（日/月）切换 ——
  setMetric(e) {
    const { iid, m } = e.currentTarget.dataset;
    if (!METRICS[m]) return;
    this.layout = this.layout.map((x) => (x.iid === iid ? { ...x, metric: m } : x));
    this.rebuild(); this.saveLayout();
  },
  setSpan(e) {
    const { iid, s } = e.currentTarget.dataset;
    if (!/^[dm]\d+$/.test(s || '')) return;
    this.layout = this.layout.map((x) => (x.iid === iid ? { ...x, span: s } : x));
    this.rebuild(); this.saveLayout();
  },

  // —— 年度收支卡：年份切换 / 自然年↔近一年 ——
  yearShift(e) {
    const { iid, dir } = e.currentTarget.dataset;
    const raw = this.raw || {};
    const curYear = Number((raw.curMonth || localYm()).slice(0, 4));
    const firstYear = Number((raw.firstMonth || raw.curMonth || localYm()).slice(0, 4));
    this.layout = this.layout.map((x) => {
      if (x.iid !== iid) return x;
      let y = (x.year || curYear) + Number(dir);
      y = Math.max(firstYear, Math.min(curYear, y));
      const next = { ...x };
      if (y === curYear) delete next.year; else next.year = y; // 当前年 = 跟随，不固化
      return next;
    });
    this.rebuild(); this.saveLayout();
  },
  setYearMode(e) {
    const { iid, m } = e.currentTarget.dataset;
    this.layout = this.layout.map((x) => (x.iid === iid ? { ...x, yearMode: m === 'rolling' ? 'rolling' : 'year' } : x));
    this.rebuild(); this.saveLayout();
  },

  removeCard(e) {
    const iid = e.currentTarget.dataset.iid;
    this.layout = this.layout.filter((x) => x.iid !== iid);
    if (this.data.editing && !this.layout.length) this.setData({ editing: false }); // 删空自动退出编辑
    this.rebuild(); this.saveLayout();
  },
  setRange(e) {
    const iid = e.currentTarget.dataset.iid; const r = Number(e.currentTarget.dataset.r);
    this.layout = this.layout.map((x) => (x.iid === iid ? { ...x, range: r } : x));
    this.rebuild(); this.saveLayout();
  },

  // —— 月度类卡片：月份切换（箭头逐月 / 原生月份 picker）——
  // 选中当前月 = 清掉 month（回到「跟随当月」的默认行为）
  async _setInstMonth(iid, ym) {
    const raw = this.raw || {};
    const curYm = raw.curMonth || localYm();
    const firstYm = raw.firstMonth || curYm;
    if (!ym || ym > curYm) ym = curYm;
    if (ym < firstYm) ym = firstYm;
    this.layout = this.layout.map((x) => {
      if (x.iid !== iid) return x;
      const next = { ...x };
      if (ym === curYm) delete next.month; else next.month = ym;
      return next;
    });
    await this.ensureCatData(); // 分类占比卡切月需拉对应月聚合
    this.rebuild(); this.saveLayout();
  },
  monthShift(e) {
    const { iid, dir } = e.currentTarget.dataset;
    const inst = this.layout.find((x) => x.iid === iid);
    if (!inst) return;
    const curYm = (this.raw && this.raw.curMonth) || localYm();
    this._setInstMonth(iid, shiftYm(inst.month || curYm, Number(dir)));
  },
  monthPick(e) {
    this._setInstMonth(e.currentTarget.dataset.iid, e.detail.value);
  },

  // —— 分类占比卡：收/支切换、排行展开 ——
  setCatKind(e) {
    const { iid, kind } = e.currentTarget.dataset;
    this.layout = this.layout.map((x) => (x.iid === iid ? { ...x, catKind: kind === 'income' ? 'income' : 'expense' } : x));
    this.rebuild(); this.saveLayout();
  },
  toggleCatAll(e) {
    const iid = e.currentTarget.dataset.iid;
    this._catExpand = this._catExpand || {};
    this._catExpand[iid] = !this._catExpand[iid];
    this.rebuild();
  },

  // —— 点击钻取：跳记录筛选列表页 ——
  goRecords(params) {
    const q = Object.keys(params)
      .filter((k) => params[k] !== '' && params[k] != null)
      .map((k) => `${k}=${encodeURIComponent(params[k])}`)
      .join('&');
    wx.navigateTo({ url: '/pages/records/records?' + q });
  },
  // 分类排行行 → 该月该分类明细
  onCatRowTap(e) {
    const d = e.currentTarget.dataset;
    this.goRecords({
      bookId: this.bookId,
      dateFrom: `${d.ym}-01`, dateTo: `${d.ym}-31`,
      categoryTopId: d.cid, type: d.kind,
      catName: d.name, monthText: d.mtext,
    });
  },
  // 饼图类（月度/年度/累计）图例行 → 该范围明细；结余行不带收支筛选（收入+支出合看）。
  // 日期范围由卡片统一给出（data-from/to/mtext），月度=当月、年度=自然年或近一年、累计=不限
  onLegendTap(e) {
    const d = e.currentTarget.dataset;
    if (!d.type && !d.link) return;
    const p = { bookId: this.bookId };
    if (d.type) p.type = d.type;
    if (d.from) { p.dateFrom = d.from; p.dateTo = d.to; p.monthText = d.mtext; }
    this.goRecords(p);
  },
  // 柱状/折线点数据点（两段式第一段）：高亮 + 卡内滑出「查看明细」入口条；再点同一点取消
  onBarTap(e) {
    const iid = e.currentTarget.dataset.iid;
    const dataIndex = e.detail.dataIndex;
    const inst = this.layout.find((x) => x.iid === iid);
    if (!inst || dataIndex == null) return;
    const curCard = this.data.cards.find((c) => c.iid === iid);
    if (curCard && curCard.drill && curCard.drillIdx === dataIndex) {
      // 再点同一根柱/同一点：收起入口条 + 取消高亮
      const comp0 = this.selectComponent(`#chart-${iid}`);
      const chart0 = comp0 && comp0.getChart && comp0.getChart();
      if (chart0) chart0.dispatchAction({ type: 'downplay' });
      this.setData({ cards: this.data.cards.map((c) => (c.iid === iid ? { ...c, drill: null, drillIdx: null } : c)) });
      return;
    }
    const raw = this.raw || {};
    let drill = null;
    if (inst.type === 'trendLine' || inst.type === 'trendBars') {
      const span = /^[dm]\d+$/.test(inst.span || '') ? inst.span : 'd30';
      const isDay = span[0] === 'd';
      const rows = ((isDay ? raw.daily : raw.monthly) || []).slice(-Number(span.slice(1)));
      const row = rows[dataIndex];
      if (!row) return;
      const metric = METRICS[inst.metric] ? inst.metric : 'expense';
      const mLabel = METRICS[metric].label;
      const v = metric === 'income' ? row.income : metric === 'balance' ? row.income - row.expense : row.expense;
      const vText = metric === 'balance' ? fmt.signedTotal(v, this.cur) : fmt.money(v, this.cur);
      const typeFilter = metric === 'balance' ? {} : { type: metric }; // 结余 = 收入+支出合看
      if (isDay) {
        drill = {
          label: fmt.cnMonthDay(row.date),
          lines: [`${mLabel} ${vText}`],
          params: { bookId: this.bookId, dateFrom: row.date, dateTo: row.date, monthText: fmt.cnMonthDay(row.date), ...typeFilter },
        };
      } else {
        const [yy, mm] = row.ym.split('-');
        const mtext = `${yy}年${parseInt(mm, 10)}月`;
        drill = {
          label: mtext,
          lines: [`${mLabel} ${vText}`],
          params: { bookId: this.bookId, dateFrom: `${row.ym}-01`, dateTo: `${row.ym}-31`, monthText: mtext, ...typeFilter },
        };
      }
    } else if (inst.type === 'yearInOut') {
      const row = (raw.monthly || []).slice(-inst.range)[dataIndex];
      if (!row) return;
      const [yy, mm] = row.ym.split('-');
      const mtext = `${yy}年${parseInt(mm, 10)}月`;
      drill = {
        label: mtext,
        lines: [`收 ${fmt.money(row.income, this.cur)}`, `支 ${fmt.money(row.expense, this.cur)}`],
        params: { bookId: this.bookId, dateFrom: `${row.ym}-01`, dateTo: `${row.ym}-31`, monthText: mtext },
      };
    }
    if (!drill) return;
    const comp = this.selectComponent(`#chart-${iid}`);
    const chart = comp && comp.getChart && comp.getChart();
    if (chart) {
      chart.dispatchAction({ type: 'downplay' });
      chart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex });
      if (inst.type === 'yearInOut') chart.dispatchAction({ type: 'highlight', seriesIndex: 1, dataIndex });
    }
    this.setData({ cards: this.data.cards.map((c) => (c.iid === iid ? { ...c, drill, drillIdx: dataIndex } : c)) });
  },
  // 两段式第二段：点入口条进明细
  goDrill(e) {
    const card = this.data.cards.find((c) => c.iid === e.currentTarget.dataset.iid);
    if (card && card.drill) this.goRecords(card.drill.params);
  },
  // 收支饼图扇区点击：扇区保持放大 + 右侧对应图例行凸显（再点同一扇区取消）。
  // 图例行本身是钻取入口，凸显同时起引导作用。
  onPieTap(e) {
    const iid = e.currentTarget.dataset.iid;
    const name = e.detail.name; // '收入' / '支出' / '暂无'
    if (!name || name === '暂无') return;
    let hlName = '';
    const cards = this.data.cards.map((c) => {
      if (c.iid !== iid) return c;
      hlName = c.hlName === name ? '' : name;
      return {
        ...c,
        hlName,
        legends: (c.legends || []).map((lg) => ({ ...lg, hl: !!hlName && (lg.k === hlName || lg.k === '总' + hlName) })),
      };
    });
    const comp = this.selectComponent(`#chart-${iid}`);
    const chart = comp && comp.getChart && comp.getChart();
    if (chart) {
      chart.dispatchAction({ type: 'downplay' });
      if (hlName) chart.dispatchAction({ type: 'highlight', seriesIndex: 0, name });
    }
    this.setData({ cards });
  },

  // 分类环形扇区点击：扇区保持放大 + 联动排行行凸显（再点同一扇区取消）；
  // 点「其他」或折叠区扇区则展开列表
  onCatPieTap(e) {
    const iid = e.currentTarget.dataset.iid;
    const name = e.detail.name;
    const card = this.data.cards.find((c) => c.iid === iid);
    if (!card || !name || name === '暂无') return;
    this._catExpand = this._catExpand || {};
    if (name === '其他' || !card.rows.some((r) => r.name === name)) {
      if (!this._catExpand[iid]) { this._catExpand[iid] = true; this.rebuild(); }
      return;
    }
    const hlName = card.hlName === name ? '' : name; // 再点同一扇区 = 取消
    const comp = this.selectComponent(`#chart-${iid}`);
    const chart = comp && comp.getChart && comp.getChart();
    if (chart) {
      chart.dispatchAction({ type: 'downplay' });
      if (hlName) chart.dispatchAction({ type: 'highlight', seriesIndex: 0, name });
    }
    this.setData({
      cards: this.data.cards.map((c) => (c.iid === iid
        ? { ...c, hlName, rows: c.rows.map((r) => ({ ...r, hl: !!hlName && r.name === hlName })) }
        : c)),
    });
  },

  async restoreDefault() {
    this.layout = normalizeLayout(DEFAULT_LAYOUT);
    this.setData({ editing: false, dragIid: '', dragY: 0 });
    await this.ensureCatData(); // 默认卡含分类占比，先拉当月聚合再渲染，否则空卡直到切月
    this.rebuild(); this.saveLayout();
  },

  saveLayout() {
    if (!this.bookId) return;
    api.call('layout', 'save', { bookId: this.bookId, order: this.layout }).catch(() => {});
  },

  // —— 账本切换（与首页同一套逻辑）——
  async openSwitcher() {
    try {
      const list = await api.call('book', 'list');
      this._setOverlay(true);
      this.setData({
        books: list.map((b) => ({
          bookId: b.bookId, name: b.name, typeLabel: b.typeLabel,
          typeClass: b.type === 'split' ? 'book-type--split' : 'book-type--share',
          iconSrc: b.type === 'split' ? this.data.splitIcon : this.data.bookIcon,
          iconBg: b.type === 'split' ? 'rgba(255,205,47,0.16)' : 'rgba(0,204,249,0.12)',
        })),
        switcherVisible: true,
      });
    } catch (e) { api.toast(e); }
  },
  async onSwitcherSelect(e) {
    const { bookId } = e.detail;
    this._setOverlay(false);
    this.setData({ switcherVisible: false });
    if (!bookId || bookId === this.data.currentBookId) return;
    try {
      await api.call('book', 'setDefault', { bookId });
      this.setData({ loading: true });
      await this.load();
      wx.showToast({ title: '已切换账本', icon: 'none' });
    } catch (e2) { api.toast(e2); }
  },
  onSwitcherClose() { this._setOverlay(false); this.setData({ switcherVisible: false }); },
  goManageBooks() { this._setOverlay(false); this.setData({ switcherVisible: false }); wx.navigateTo({ url: '/pages/books/books' }); },

  // 展示币种切换（顶部按钮 → 币种选择器）
  openCurPicker() { this._setOverlay(true); this.setData({ curVisible: true }); },
  closeCurPicker() { this._setOverlay(false); this.setData({ curVisible: false }); },
  onCurPick(e) {
    const code = e.detail.code;
    this._setOverlay(false);
    this.setData({ curVisible: false });
    if (!code || code === this.data.curCode) return;
    const prev = { curCode: this.data.curCode, curSym: this.data.curSym };
    // 胶囊即时切换 + 即刻加载态；图表数值必须等服务器重算，失败回滚胶囊
    this.setData({ curCode: code, curSym: fmt.symbolOf(code), loading: true });
    api.call('settings', 'update', { displayCurrency: code })
      .then(() => this.load())
      .catch((err) => { this.setData({ ...prev, loading: false }); api.toast(err); });
  },
});
