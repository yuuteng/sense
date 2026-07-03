const icons = require('../../utils/icons');

Component({
  options: { addGlobalClass: true },
  properties: {
    visible: { type: Boolean, value: false },
    books: { type: Array, value: [] },
    currentId: { type: String, value: '' },
  },
  data: { render: false, anim: false, checkIcon: '', chevron: '' },
  lifetimes: {
    attached() {
      this.setData({
        checkIcon: icons.get('check', '#0089c0', 2.4),
        chevron: icons.get('chevron', '#748294', 2),
      });
    },
    detached() { if (this._t) clearTimeout(this._t); },
  },
  observers: {
    visible(v) {
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
  methods: {
    pick(e) { this.triggerEvent('select', { bookId: e.currentTarget.dataset.id }); },
    manage() { this.triggerEvent('manage'); },
    close() { this.triggerEvent('close'); },
    stop() {},
  },
});
