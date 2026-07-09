// 图表主题与 option 工厂：统一 ECharts 视觉（对齐设计令牌与原 SVG 图表样式）。
// 色彩语义固定：收入=绿，支出=蓝；文字/轴用中性灰，不用系列色。
const COLOR = {
  income: '#9edf10',   // --success
  expense: '#00ccf9',  // --accent
  track: '#e4e7ec',    // --border（空环/基线）
  axis: '#97a7b7',     // 轴文字
  surface: '#ffffff',  // 卡片底（分段间隙色）
};

// 环形图（收入 vs 支出）。空数据时显示灰色整环。
// 半径对齐原 SVG（r66/sw30 于 200 盒 → 内 51% 外 81%）。
function donutOption(income, expense) {
  const total = (income || 0) + (expense || 0);
  const data = total > 0
    ? [
      { value: income, name: '收入', itemStyle: { color: COLOR.income } },
      { value: expense, name: '支出', itemStyle: { color: COLOR.expense } },
    ]
    : [{ value: 1, name: '暂无', itemStyle: { color: COLOR.track }, emphasis: { disabled: true } }];
  return {
    animationDuration: 500,
    series: [{
      type: 'pie',
      radius: ['51%', '81%'],
      center: ['50%', '50%'],
      silent: total <= 0,
      label: { show: false },
      labelLine: { show: false },
      itemStyle: { borderColor: COLOR.surface, borderWidth: 2 }, // 分段间 2px 间隙
      emphasis: { scale: true, scaleSize: 4 },
      data,
    }],
  };
}

// 纵轴：极简刻度 —— 3 条淡网格线 + 小字灰色数值（自动缩写 1.2万/3.5亿），
// 无轴线无刻度点：保留量级可读性，视觉负担最小（精确值靠点击钻取）
function axisNum(v) {
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
  if (a >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
  return String(Math.round(v));
}
function yAxisMinimal() {
  return {
    type: 'value',
    splitNumber: 3,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: COLOR.track, opacity: 0.6 } },
    axisLabel: { color: COLOR.axis, fontSize: 10, formatter: axisNum },
  };
}

// 高亮色 = 基色加深（选中态跟随系列色，收入绿加深、支出蓝加深，不再一律变蓝）
function darken(hex, f) {
  const d = (s) => Math.max(0, Math.round(parseInt(s, 16) * (1 - f)));
  return `rgb(${d(hex.slice(1, 3))},${d(hex.slice(3, 5))},${d(hex.slice(5, 7))})`;
}

// 单系列柱状图。labels 与 values 等长；label 稀疏显示对齐原图（约 7 个）；color 可选（默认支出蓝）。
function barsOption(values, labels, color) {
  const n = values.length || 1;
  const c = color || COLOR.expense;
  return {
    animationDuration: 400,
    grid: { left: 2, right: 4, top: 12, bottom: 24, containLabel: true },
    xAxis: {
      type: 'category', data: labels,
      axisLine: { lineStyle: { color: COLOR.track } },
      axisTick: { show: false },
      axisLabel: { color: COLOR.axis, fontSize: 11, interval: Math.ceil(n / 7) - 1 },
    },
    yAxis: yAxisMinimal(),
    series: [{
      type: 'bar', data: values,
      itemStyle: { color: c, borderRadius: [3, 3, 0, 0] },
      barMaxWidth: 28, barCategoryGap: '45%',
      emphasis: { itemStyle: { color: darken(c, 0.22) } }, // 点击/高亮 = 本系列色加深
    }],
  };
}

// 分组柱状图（每月 收入 vs 支出）。rows: [{label, income, expense}]
function pairedOption(rows) {
  const n = rows.length || 1;
  return {
    animationDuration: 400,
    grid: { left: 2, right: 4, top: 12, bottom: 24, containLabel: true },
    xAxis: {
      type: 'category', data: rows.map((r) => r.label),
      axisLine: { lineStyle: { color: COLOR.track } },
      axisTick: { show: false },
      axisLabel: { color: COLOR.axis, fontSize: 10, interval: Math.ceil(n / 6) - 1 },
    },
    yAxis: yAxisMinimal(),
    series: [
      {
        name: '收入', type: 'bar', data: rows.map((r) => r.income),
        itemStyle: { color: COLOR.income, borderRadius: [2, 2, 0, 0] },
        barMaxWidth: 11, barGap: '20%', barCategoryGap: '40%',
        emphasis: { itemStyle: { color: '#7db50c' } },
      },
      {
        name: '支出', type: 'bar', data: rows.map((r) => r.expense),
        itemStyle: { color: COLOR.expense, borderRadius: [2, 2, 0, 0] },
        barMaxWidth: 11,
        emphasis: { itemStyle: { color: '#0089c0' } },
      },
    ],
  };
}

// 分类占比色板（8 色，已通过 CVD/对比度校验；相邻色红绿色盲下可分）。
// 语义定调：支出模式蓝系开头、收入模式绿系开头（与全局「支出蓝 / 收入绿」一致）。
// 分类按金额排名取色（第 9 名起合并为灰色「其他」）；排行列表行内色点+名称+金额并存，
// 不单靠颜色传达身份。
const CAT_COLORS = ['#0089C0', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const CAT_COLORS_INCOME = ['#008300', '#1baf7a', '#0089C0', '#eda100', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const CAT_OTHER = '#97a7b7';
function catPalette(kind) { return kind === 'income' ? CAT_COLORS_INCOME : CAT_COLORS; }
function catColorAt(i, kind) { const p = catPalette(kind); return i < p.length ? p[i] : CAT_OTHER; }

// 分类占比环形图。cats: [{name, total}] 已按金额降序；超过 8 个折叠为「其他」；kind 决定色板首色语义。
function catDonutOption(cats, kind) {
  const palette = catPalette(kind);
  const list = cats || [];
  const top = list.slice(0, palette.length);
  const rest = list.slice(palette.length);
  const data = top.map((c, i) => ({ value: c.total, name: c.name, itemStyle: { color: palette[i] } }));
  if (rest.length) {
    data.push({ value: Math.round(rest.reduce((s, c) => s + c.total, 0) * 100) / 100, name: '其他', itemStyle: { color: CAT_OTHER } });
  }
  const empty = !data.length || data.every((d) => d.value <= 0);
  return {
    animationDuration: 500,
    series: [{
      type: 'pie',
      radius: ['51%', '81%'],
      center: ['50%', '50%'],
      silent: empty,
      label: { show: false },
      labelLine: { show: false },
      itemStyle: { borderColor: COLOR.surface, borderWidth: 2 },
      emphasis: { scale: true, scaleSize: 5 },
      data: empty ? [{ value: 1, name: '暂无', itemStyle: { color: COLOR.track }, emphasis: { disabled: true } }] : data,
    }],
  };
}

// 折线（面积）趋势图。values/labels 等长；opts.color 覆盖线色（默认支出蓝）。
// showSymbol:false 平时隐藏节点，高亮/点击时显示（两段式钻取的视觉反馈）。
function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function lineOption(values, labels, opts) {
  const color = (opts && opts.color) || COLOR.expense;
  const n = values.length || 1;
  return {
    animationDuration: 400,
    grid: { left: 2, right: 4, top: 12, bottom: 24, containLabel: true },
    xAxis: {
      type: 'category', data: labels, boundaryGap: false,
      axisLine: { lineStyle: { color: COLOR.track } },
      axisTick: { show: false },
      axisLabel: { color: COLOR.axis, fontSize: 11, interval: Math.ceil(n / 7) - 1 },
    },
    yAxis: yAxisMinimal(),
    series: [{
      type: 'line', data: values,
      smooth: true, symbol: 'circle', symbolSize: 7, showSymbol: false,
      lineStyle: { color, width: 3 },
      itemStyle: { color },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: hexA(color, 0.22) },
            { offset: 1, color: hexA(color, 0.02) },
          ],
        },
      },
      emphasis: { itemStyle: { color: darken(color, 0.22) } },
    }],
  };
}

module.exports = { COLOR, CAT_COLORS, CAT_OTHER, catColorAt, donutOption, barsOption, pairedOption, catDonutOption, lineOption };
