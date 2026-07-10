const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

Page({
  data: {
    bookName: '',
    displayCurrency: '',
    summary: {},
    groups: [],
    chevronDown: '',
    plusIcon: '',
    loading: true,
    needInit: false,
    // 账本切换面板
    switcherVisible: false,
    currentBookId: '',
    books: [],
    // 展示币种切换
    curCode: 'CNY',
    curSym: '¥',
    curVisible: false,
    // 分页（按天）
    hasMore: false,
    loadingMore: false,
    canAdd: true,
  },

  onLoad() {
    this.setData({
      chevronDown: icons.get('chevronDown', '#748294', 2.2),
      plusIcon: icons.get('plus', '#ffffff', 2.4),
      bookIcon: icons.get('book', '#0089c0', 1.7),
      splitIcon: icons.get('bookSplit', '#8a690a', 1.7),
      settleIcon: icons.get('arrowRight', '#8a690a', 1.9),
      chevronIcon: icons.get('chevron', '#748294', 2),
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0, hidden: false });
    }
    this.applyOptimistic();
    this.load();
  },

  // 记完/删完回来：先本地上屏或移除（乐观更新），load() 拿到服务器数据后整体覆盖。
  applyOptimistic() {
    const app = getApp();
    // 删除：按 id 立即从列表移除，空组一并收掉（金额合计等服务器校正）
    const delId = app.globalData && app.globalData.justDeleted;
    if (delId) {
      app.globalData.justDeleted = null;
      const groups = this.data.groups
        .map((g) => ({ ...g, items: g.items.filter((it) => it.id !== delId) }))
        .filter((g) => g.items.length);
      this.setData({ groups });
    }
    const j = app.globalData && app.globalData.justSaved;
    if (!j) return;
    app.globalData.justSaved = null;
    if (this.data.needInit || j.bookId !== this.data.currentBookId) return;
    const cur = this.data.curCode;
    const today = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    if (j.date !== todayStr) return;
    let amt, fx = '', sub = '';
    if (j.currency === cur) amt = j.amount;
    else if (j.base === cur) {
      amt = j.amountConverted;
      fx = fmt.symbolOf(j.currency) + fmt.fmt(j.amount);
      sub = `按 ${fmt.cnMonthDay(j.date)} 汇率`;
    } else return; // 展示币 ≠ 原币 ≠ 基准币：本地无法换算，等服务器
    const row = {
      id: 'pending-' + Date.now(),
      pending: true,
      iconSrc: icons.get(j.icon || 'dots', j.type === 'income' ? '#4a7d0b' : '#0089c0', 1.7),
      title: j.title || (j.type === 'income' ? '收入' : '支出'),
      who: '我', whoInitial: '我', whoColor: '#00ccf9', whoAvatar: '',
      amount: fmt.signed(amt, j.type, cur),
      in: j.type === 'income',
      fx, sub,
    };
    const groups = this.data.groups.slice();
    const label = fmt.dayLabel(j.date);
    if (groups.length && groups[0].date === label) {
      groups[0] = { ...groups[0], items: [row].concat(groups[0].items) };
    } else {
      groups.unshift({ date: label, total: fmt.signedTotal(j.type === 'income' ? amt : -amt, cur), items: [row] });
    }
    this.setData({ groups });
  },

  async load() {
    try {
      // 登录闸门：未注册 → 登录页
      const profile = await api.call('user', 'getProfile');
      if (!profile.registered) { wx.reLaunch({ url: '/pages/login/login' }); return; }
      const book = await api.call('book', 'getCurrent');
      // 无账本 → 引导创建
      if (!book) { wx.reLaunch({ url: '/pages/onboarding/onboarding' }); return; }
      // 原默认账本已解散/被移出：服务端已自动回退，告知一声，避免「账本静默变了」
      if (book.fallback) wx.showToast({ title: `原账本已不可访问，已切换到「${book.name}」`, icon: 'none', duration: 2500 });
      const cur = book.displayCurrency || 'CNY';
      const sym = fmt.symbolOf(cur);
      const [summary, list] = await Promise.all([
        api.call('stats', 'getMonthlySummary', { bookId: book.bookId }),
        api.call('record', 'list', { bookId: book.bookId, currency: cur, page: 0 }),
      ]);
      this.page = 0;
      this.setData({
        loading: false,
        needInit: false,
        currentBookId: book.bookId,
        bookName: book.name,
        isSplit: book.type === 'split', // 分账账本：概要卡下出「分账结算」直达入口
        canAdd: book.myRole !== 'ro', // 只读成员无「记一笔」入口（服务端另有强制校验）
        curCode: cur,
        curSym: sym,
        hasMore: !!list.hasMore,
        loadingMore: false,
        summary: (() => {
          const balance = fmt.signedTotal(summary.balance, cur);
          return {
            monthLabel: `${summary.monthLabel} · 本月结余`,
            balance,
            compact: balance.length > 14, // 巨额结余降一号字，防顶到 hero 卡边
            income: fmt.money(summary.income, cur),
            expense: fmt.money(summary.expense, cur),
          };
        })(),
        groups: this.mapGroups(list.groups, cur),
      });
    } catch (e) {
      this.setData({ loading: false, needInit: e.code === 'NOT_MEMBER' });
      if (e.code !== 'NOT_MEMBER') api.toast(e);
    }
  },

  mapGroups(groups, cur) {
    return (groups || []).map((g) => ({
      date: fmt.dayLabel(g.date),
      total: fmt.signedTotal(g.total, cur),
      items: (g.items || []).map((it) => this.mapItem(it, cur)),
    }));
  },

  // 上拉到底：加载下一页（按天分页，日期组不跨页，直接追加）
  async onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.needInit) return;
    this.setData({ loadingMore: true });
    try {
      const cur = this.data.curCode;
      const list = await api.call('record', 'list', {
        bookId: this.data.currentBookId, currency: cur, page: (this.page || 0) + 1,
      });
      this.page = list.page;
      // 增量追加：path-syntax 只传新页数据，避免每翻一页都全量重传已加载列表
      const patch = { hasMore: !!list.hasMore, loadingMore: false };
      const base = this.data.groups.length;
      this.mapGroups(list.groups, cur).forEach((g, i) => { patch[`groups[${base + i}]`] = g; });
      this.setData(patch);
    } catch (e) { this.setData({ loadingMore: false }); api.toast(e); }
  },

  mapItem(it, cur) {
    return {
      id: it.recordId,
      iconSrc: icons.get(it.icon, it.type === 'income' ? '#4a7d0b' : '#0089c0', 1.7),
      title: it.title || it.categoryTopName || (it.type === 'income' ? '收入' : '支出'),
      who: it.recorderName,
      whoInitial: it.recorderInitial,
      whoColor: it.recorderColor,
      whoAvatar: it.recorderAvatar || '',
      amount: fmt.signed(it.amountConverted, it.type, cur),
      in: it.type === 'income',
      fx: it.isForeign ? (fmt.symbolOf(it.currency) + fmt.fmt(it.originalAmount)) : '',
      sub: it.isForeign ? `按 ${fmt.cnMonthDay(it.date)} 汇率` : '',
    };
  },

  goDetail(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id || id.indexOf('pending-') === 0) return; // 乐观行还没有真实 id，等刷新
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  goSettings() {
    wx.switchTab({ url: '/pages/settings/settings' });
  },

  // 点击顶栏账本名 → 拉取账本列表并弹出切换面板
  async openSwitcher() {
    try {
      const list = await api.call('book', 'list');
      this.setData({
        books: list.map((b) => ({
          bookId: b.bookId,
          name: b.name,
          typeLabel: b.typeLabel,
          typeClass: b.type === 'split' ? 'book-type--split' : 'book-type--share',
          iconSrc: b.type === 'split' ? this.data.splitIcon : this.data.bookIcon,
          iconBg: b.type === 'split' ? 'rgba(255,205,47,0.16)' : 'rgba(0,204,249,0.12)',
        })),
        switcherVisible: true,
      });
    } catch (e) { api.toast(e); }
  },

  // 选中某账本：设为默认账本（服务端），关闭面板并刷新首页
  async onSwitcherSelect(e) {
    const { bookId } = e.detail;
    this.setData({ switcherVisible: false });
    if (!bookId || bookId === this.data.currentBookId) return;
    try {
      await api.call('book', 'setDefault', { bookId });
      this.setData({ loading: true });
      await this.load();
      wx.showToast({ title: '已切换账本', icon: 'none' });
    } catch (e2) { api.toast(e2); }
  },

  onSwitcherClose() { this.setData({ switcherVisible: false }); },

  goSettle() { wx.navigateTo({ url: '/pages/settle/settle?bookId=' + this.data.currentBookId }); },

  goManageBooks() {
    this.setData({ switcherVisible: false });
    wx.navigateTo({ url: '/pages/books/books' });
  },

  // 展示币种切换（顶部按钮 → 币种选择器）
  openCurPicker() { this.setData({ curVisible: true }); },
  closeCurPicker() { this.setData({ curVisible: false }); },
  onCurPick(e) {
    const code = e.detail.code;
    this.setData({ curVisible: false });
    if (!code || code === this.data.curCode) return;
    const prev = { curCode: this.data.curCode, curSym: this.data.curSym };
    // 胶囊即时切换 + 即刻进入加载态；金额换算必须等服务器（口径在服务端），失败回滚胶囊
    this.setData({ curCode: code, curSym: fmt.symbolOf(code), loading: true });
    // 带 bookId：只改当前账本的展示币种（每账本各一套，PRD 待定 5 拍板）
    api.call('settings', 'update', { displayCurrency: code, bookId: this.data.currentBookId })
      .then(() => this.load())
      .catch((err) => { this.setData({ ...prev, loading: false }); api.toast(err); });
  },
});
