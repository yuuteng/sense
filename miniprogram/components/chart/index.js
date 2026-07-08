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
      if (this.chart) { this.chart.setOption(opt, true); return; }
      if (this._ready) this._init(opt);
      else this._pending = opt; // ready 之前先存起来
    },
  },
  lifetimes: {
    ready() {
      this._ready = true;
      // 注意：observers 对「创建时就带着的初始值」不触发（小程序规范），
      // 所以 ready 时要主动兜底读 data.option，否则首次渲染/重建后图表永远空白
      const opt = this._pending || this.data.option;
      if (opt) { this._init(opt); this._pending = null; }
    },
    detached() {
      if (this.chart) { this.chart.dispose(); this.chart = null; }
    },
  },
  methods: {
    _init(opt) {
      const ecc = this.selectComponent('#ec');
      if (!ecc) return;
      ecc.init((canvas, width, height, dpr) => {
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
      });
    },
    // 供页面主动获取实例（如 dispatchAction 高亮）
    getChart() { return this.chart || null; },
  },
});
