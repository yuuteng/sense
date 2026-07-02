function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

Component({
  options: { addGlobalClass: true },
  properties: {
    visible: { type: Boolean, value: false },
    value: { type: String, value: '' }, // 选中日期 YYYY-MM-DD
  },
  data: { year: 2026, month: 7, weeks: [], title: '' },
  observers: {
    visible(v) { if (v) this.init(); },
  },
  methods: {
    init() {
      const val = this.data.value;
      let y, m;
      if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) { const p = val.split('-'); y = +p[0]; m = +p[1]; }
      else { const d = new Date(); y = d.getFullYear(); m = d.getMonth() + 1; }
      this.build(y, m);
    },
    build(y, m) {
      const startDow = new Date(y, m - 1, 1).getDay();
      const days = new Date(y, m, 0).getDate();
      const t = new Date();
      const todayStr = ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
      const sel = this.data.value;
      const cells = [];
      for (let i = 0; i < startDow; i++) cells.push({});
      for (let d = 1; d <= days; d++) {
        const ds = ymd(y, m, d);
        cells.push({ day: d, date: ds, isToday: ds === todayStr, isSel: ds === sel });
      }
      while (cells.length % 7) cells.push({});
      const weeks = [];
      for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
      this.setData({ year: y, month: m, weeks, title: `${y} 年 ${m} 月` });
    },
    prev() { let y = this.data.year, m = this.data.month - 1; if (m < 1) { m = 12; y--; } this.build(y, m); },
    next() { let y = this.data.year, m = this.data.month + 1; if (m > 12) { m = 1; y++; } this.build(y, m); },
    today() { const d = new Date(); this.triggerEvent('pick', { date: ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()) }); },
    pick(e) { const date = e.currentTarget.dataset.date; if (date) this.triggerEvent('pick', { date }); },
    close() { this.triggerEvent('close'); },
    stop() {},
  },
});
