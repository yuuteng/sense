// 图表组件：包装 ec-canvas + 定制 ECharts。
// 用法：<chart option="{{opt}}" height="312rpx" bind:chartclick="onTap"></chart>
// - option 变化自动 setOption（全量替换）；首个 option 到达时才初始化 canvas（数据异步友好）
// - 点击图形元素上抛 chartclick 事件（seriesIndex/dataIndex/name/value）
const echarts = require('../../ec-canvas/echarts');

Component({
  properties: {
    option: { type: Object, value: null },
    height: { type: String, value: '312rpx' },
  },
  data: {
    ec: { lazyLoad: true }, // 由本组件在拿到 option 后手动 init
  },
  observers: {
    option(opt) {
      if (!opt) return;
      try {
        if (this.chart) { this.chart.setOption(opt, true); return; }
        if (this._ready) this._init(opt);
        else this._pending = opt; // ready 之前先存起来
      } catch (e) { console.error('[chart] setOption/init 失败', e); }
    },
  },
  lifetimes: {
    ready() {
      this._ready = true;
      // 注意：observers 对「创建时就带着的初始值」不触发（小程序规范），
      // 所以 ready 时要主动兜底读 data.option，否则首次渲染/重建后图表永远空白。
      // 全程 try/catch：图表引擎任何故障只降级为空画布，绝不连累卡片渲染。
      const opt = this._pending || this.data.option;
      if (opt) {
        try { this._init(opt); } catch (e) { console.error('[chart] ready init 失败', e); }
        this._pending = null;
      }
    },
    detached() {
      try { if (this.chart) { this.chart.dispose(); this.chart = null; } } catch (e) { /* 忽略 */ }
    },
  },
  methods: {
    _init(opt) {
      const ecc = this.selectComponent('#ec');
      if (!ecc) { console.error('[chart] 找不到 ec-canvas 子组件'); return; }
      ecc.init((canvas, width, height, dpr) => {
        try {
          const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
          canvas.setChart(chart);
          chart.setOption(opt);
          chart.on('click', (p) => {
            this.triggerEvent('chartclick', {
              seriesIndex: p.seriesIndex, dataIndex: p.dataIndex,
              seriesName: p.seriesName, name: p.name, value: p.value,
            });
          });
          this.chart = chart;
          return chart;
        } catch (e) { console.error('[chart] echarts.init 失败', e); return null; }
      });
    },
    // 供页面主动获取实例（如 dispatchAction 高亮）
    getChart() { return this.chart || null; },
  },
});
