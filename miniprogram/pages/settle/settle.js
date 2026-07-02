const api = require('../../utils/api');
const fmt = require('../../utils/format');
const icons = require('../../utils/icons');

function comma(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

Page({
  data: {
    header: '',
    myNet: '',
    totalExpense: '', myPaid: '', myShare: '',
    transfers: [],
    members: [],
    splits: [],
    splitCount: 0,
    remain: '',
    allSettled: false,
    discOpen: false,
    ic: {},
  },

  onLoad(query) {
    this.bookId = query.bookId || '';
    this.setData({
      ic: {
        arrow: icons.get('arrowRight', '#9a9a9a', 2),
        check: icons.get('check', '#148c40', 2.4),
        chevron: icons.get('chevron', '#6b6b6b', 2),
        plus: icons.get('plus', '#ffffff', 2.4),
      },
    });
  },

  onShow() { this.load(); },

  async load() {
    try {
      if (!this.bookId) {
        const b = await api.call('book', 'getCurrent');
        this.bookId = b && b.bookId;
      }
      if (!this.bookId) return;
      const [book, s] = await Promise.all([
        api.call('book', 'getCurrent'),
        api.call('settle', 'get', { bookId: this.bookId }),
      ]);
      const bookName = (book && book.name) || '账本';
      const net = s.summary.myNet;
      this.setData({
        header: `${bookName} · ${s.members.length} 人 · 分账结算型`,
        myNet: `你应${net >= 0 ? '收' : '付'} ${fmt.signedTotal(net)}`,
        totalExpense: fmt.money(s.summary.totalExpense),
        myPaid: fmt.money(s.summary.myPaid),
        myShare: fmt.money(s.summary.myShare),
        transfers: s.transfers.map((t) => ({
          transferId: t.transferId, fromInitial: t.fromInitial, fromColor: t.fromColor, fromName: t.from,
          toInitial: t.toInitial, toColor: t.toColor, toName: t.to, amount: t.amount, amountText: fmt.money(t.amount), settled: false,
        })),
        members: s.members.map((m) => ({
          name: m.name, initial: m.initial, color: m.color,
          paid: fmt.money(m.paid), share: fmt.money(m.share),
          net: (m.net >= 0 ? '+' : '−') + comma(Math.abs(m.net)), pos: m.net >= 0,
        })),
        splits: s.splits.map((sp) => ({ ...sp, amountText: fmt.money(sp.amount) })),
        splitCount: s.splitCount,
      });
      this.refresh();
    } catch (e) { api.toast(e); }
  },

  refresh() {
    let left = 0, sum = 0;
    this.data.transfers.forEach((t) => { if (!t.settled) { left++; sum += t.amount; } });
    this.setData({
      remain: left ? `${left} 笔待结清 · 待收 ¥${comma(sum)}` : '已全部结清',
      allSettled: left === 0 && this.data.transfers.length > 0,
    });
  },

  toggleSettle(e) {
    const i = e.currentTarget.dataset.i;
    this.setData({ [`transfers[${i}].settled`]: !this.data.transfers[i].settled });
    if (this.bookId) {
      api.call('settle', 'markTransfer', { bookId: this.bookId, transferId: this.data.transfers[i].transferId, settled: this.data.transfers[i].settled }).catch(() => {});
    }
    this.refresh();
  },

  toggleDisc() { this.setData({ discOpen: !this.data.discOpen }); },
  goAdd() { wx.navigateTo({ url: '/pages/add/add' }); },
});
