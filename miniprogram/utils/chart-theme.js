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

// 单系列柱状图（每日支出）。labels 与 values 等长；label 稀疏显示对齐原图（约 7 个）。
function barsOption(values, labels) {
  const n = values.length || 1;
  return {
    animationDuration: 400,
    grid: { left: 4, right: 4, top: 12, bottom: 24 },
    xAxis: {
      type: 'category', data: labels,
      axisLine: { lineStyle: { color: COLOR.track } },
      axisTick: { show: false },
      axisLabel: { color: COLOR.axis, fontSize: 11, interval: Math.ceil(n / 7) - 1 },
    },
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'bar', data: values,
      itemStyle: { color: COLOR.expense, borderRadius: [3, 3, 0, 0] },
      barMaxWidth: 28, barCategoryGap: '45%',
      emphasis: { itemStyle: { color: '#0089c0' } }, // 点击/高亮加深
    }],
  };
}

// 分组柱状图（每月 收入 vs 支出）。rows: [{label, income, expense}]
function pairedOption(rows) {
  const n = rows.length || 1;
  return {
    animationDuration: 400,
    grid: { left: 4, right: 4, top: 12, bottom: 24 },
    xAxis: {
      type: 'category', data: rows.map((r) => r.label),
      axisLine: { lineStyle: { color: COLOR.track } },
      axisTick: { show: false },
      axisLabel: { color: COLOR.axis, fontSize: 10, interval: Math.ceil(n / 6) - 1 },
    },
    yAxis: { type: 'value', show: false },
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

// 分类占比色板（8 色，已通过 CVD/对比度校验：品牌蓝开头，相邻色红绿色盲下可分）。
// 分类按金额排名取色（第 9 名起合并为灰色「其他」）；排行列表行内色点+名称+金额并存，
// 不单靠颜色传达身份。
const CAT_COLORS = ['#0089C0', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const CAT_OTHER = '#97a7b7';
function catColorAt(i) { return i < CAT_COLORS.length ? CAT_COLORS[i] : CAT_OTHER; }

// 分类占比环形图。cats: [{name, total}] 已按金额降序；超过 8 个折叠为「其他」。
function catDonutOption(cats) {
  const list = cats || [];
  const top = list.slice(0, CAT_COLORS.length);
  const rest = list.slice(CAT_COLORS.length);
  const data = top.map((c, i) => ({ value: c.total, name: c.name, itemStyle: { color: CAT_COLORS[i] } }));
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

module.exports = { COLOR, CAT_COLORS, CAT_OTHER, catColorAt, donutOption, barsOption, pairedOption, catDonutOption };
