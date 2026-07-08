const cur = require('../../utils/currency');
const tabbar = require('../../utils/tabbar');

Component({
  options: { addGlobalClass: true },
  properties: {
    visible: { type: Boolean, value: false },
    current: { type: String, value: 'CNY' },
  },
  data: { list: cur.CURRENCIES, render: false, anim: false },
  observers: {
    visible(v) {
      tabbar.setHidden(v); // 弹层打开时藏 tabBar（非 tab 页如 add/onboarding 内部自动跳过）
      if (v) {
        // 先挂载（初始在屏幕下方），下一帧再加动画类触发滑入
        this.setData({ render: true });
        this._t = setTimeout(() => this.setData({ anim: true }), 20);
      } else {
        // 先播退场动画，结束后再卸载
        this.setData({ anim: false });
        this._t = setTimeout(() => this.setData({ render: false }), 300);
      }
    },
  },
  lifetimes: { detached() { if (this._t) clearTimeout(this._t); } },
  methods: {
    pick(e) { this.triggerEvent('select', { code: e.currentTarget.dataset.code }); },
    close() { this.triggerEvent('close'); },
    stop() {},
  },
});
