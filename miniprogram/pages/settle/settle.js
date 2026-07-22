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
    loading: true,
    curVisible: false,
    curCode: 'CNY',
  },

  onLoad(query) {
    this.bookId = query.bookId || '';
    this.setData({
      ic: {
        arrow: icons.get('arrowRight', '#748294', 2),
        check: icons.get('check', '#4a7d0b', 2.4),
        chevron: icons.get('chevron', '#748294', 2),
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
      if (!this.bookId) { this.setData({ loading: false }); return; }
      const [book, s] = await Promise.all([
        api.call('book', 'getCurrent'),
        api.call('settle', 'get', { bookId: this.bookId }),
      ]);
      const bookName = (book && book.name) || '账本';
      const net = s.summary.myNet;
      const cur = s.summary.currency || (book && book.baseCurrency) || 'CNY'; // 展示币种（服务端已按账本展示币种换算；内部欠款仍固化基准币）
      this.cur = cur;
      this.setData({
        header: `${bookName} · ${s.members.length} 人 · 分账账本`,
        myNet: `你应${net >= 0 ? '收' : '付'} ${fmt.signedTotal(net, cur)}`,
        totalExpense: fmt.money(s.summary.totalExpense, cur),
        myPaid: fmt.money(s.summary.myPaid, cur),
        myShare: fmt.money(s.summary.myShare, cur),
        // 待结清（服务端实时算出）在前，已结清（settlements 落库，可撤销）在后
        // initial/color 兜底：后端个别成员可能缺资料（未登记头像信息），避免头像圆圈透明「隐形」
        transfers: s.transfers.map((t) => ({
          key: t.transferId,
          fromOpenid: t.fromOpenid, toOpenid: t.toOpenid, // 标记结清时回传
          fromInitial: t.fromInitial || (t.from || '?').slice(0, 1), fromColor: t.fromColor || '#97a7b7', fromAvatar: t.fromAvatar || '', fromName: t.from,
          toInitial: t.toInitial || (t.to || '?').slice(0, 1), toColor: t.toColor || '#97a7b7', toAvatar: t.toAvatar || '', toName: t.to,
          // amount = 基准币（标记结清回传服务端）；amountDisp/cur = 该行结算币种视图；amountRef = 展示币种（合计用）
          amount: t.amount, amountDisp: t.amountDisp != null ? t.amountDisp : t.amount,
          cur: t.cur || cur, amountRef: t.amountRef != null ? t.amountRef : t.amount,
          amountText: fmt.money(t.amountDisp != null ? t.amountDisp : t.amount, t.cur || cur), settled: false, settlementId: '',
        })).concat((s.settled || []).map((t) => ({
          key: t.settlementId, settlementId: t.settlementId,
          fromInitial: t.fromInitial || (t.from || '?').slice(0, 1), fromColor: t.fromColor || '#97a7b7', fromAvatar: t.fromAvatar || '', fromName: t.from,
          toInitial: t.toInitial || (t.to || '?').slice(0, 1), toColor: t.toColor || '#97a7b7', toAvatar: t.toAvatar || '', toName: t.to,
          amount: t.amount, amountDisp: t.amountDisp != null ? t.amountDisp : t.amount,
          cur: t.cur || cur, amountRef: t.amountRef != null ? t.amountRef : t.amount,
          amountText: fmt.money(t.amountDisp != null ? t.amountDisp : t.amount, t.cur || cur), settled: true,
        }))),
        members: s.members.map((m) => ({
          name: m.name, initial: m.initial || (m.name || '?').slice(0, 1), color: m.color || '#97a7b7', avatarFileID: m.avatarFileID || '',
          paid: fmt.money(m.paid, cur), share: fmt.money(m.share, cur),
          net: (m.net >= 0 ? '+' : '-') + comma(Math.abs(m.net)), pos: m.net >= 0,
        })),
        splits: s.splits.map((sp) => ({ ...sp, amountText: fmt.money(sp.amount, cur) })),
        splitCount: s.splitCount,
        loading: false,
      });
      this.refresh();
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  refresh() {
    let left = 0, sum = 0;
    // 合计恒用展示币种口径（amountRef）：各行可选不同结算币种，混币不能直加
    this.data.transfers.forEach((t) => { if (!t.settled) { left++; sum += t.amountRef; } });
    this.setData({
      remain: left ? `${left} 笔待结清 · 折合 ${fmt.symbolOf(this.cur || 'CNY')}${comma(sum)}` : '已全部结清',
      allSettled: left === 0 && this.data.transfers.length > 0,
    });
  },

  // 标记结清 / 撤销：乐观翻转本地状态，服务端落/删抵扣（settlements），失败回滚
  toggleSettle(e) {
    const i = e.currentTarget.dataset.i;
    const t = this.data.transfers[i];
    if (!this.bookId) return;
    if (!t.settled) {
      this.setData({ [`transfers[${i}].settled`]: true });
      this.refresh();
      api.call('settle', 'mark', { bookId: this.bookId, from: t.fromOpenid, to: t.toOpenid, amount: t.amount, currency: t.cur, amountFx: t.amountDisp })
        .then((r) => { this.setData({ [`transfers[${i}].settlementId`]: r.settlementId }); })
        .catch((err) => { this.setData({ [`transfers[${i}].settled`]: false }); this.refresh(); api.toast(err); });
    } else {
      if (!t.settlementId) { wx.showToast({ title: '正在同步，稍候再试', icon: 'none' }); return; }
      const prevId = t.settlementId;
      this.setData({ [`transfers[${i}].settled`]: false, [`transfers[${i}].settlementId`]: '' });
      this.refresh();
      api.call('settle', 'unmark', { bookId: this.bookId, settlementId: prevId })
        .catch((err) => { this.setData({ [`transfers[${i}].settled`]: true, [`transfers[${i}].settlementId`]: prevId }); this.refresh(); api.toast(err); });
    }
  },

  toggleDisc() { this.setData({ discOpen: !this.data.discOpen }); },

  // 选该笔转账的结算币种（比如 A 想收欧元、B 想给人民币）：
  // 选择记在账本（双方看到同一口径），金额按最新汇率由服务端换算——服务端计算类，走短暂静默刷新
  pickCur(e) {
    const i = e.currentTarget.dataset.i;
    const t = this.data.transfers[i];
    if (!t || t.settled) return;
    this._curIdx = i;
    this.setData({ curVisible: true, curCode: t.cur });
  },
  onCurSelect(e) {
    const code = e.detail.code;
    const i = this._curIdx;
    const t = this.data.transfers[i];
    this.setData({ curVisible: false });
    if (!t || t.cur === code) return;
    // 乐观：先亮出所选币种，金额待服务端按汇率算回
    this.setData({ [`transfers[${i}].cur`]: code, [`transfers[${i}].amountText`]: '…' });
    api.call('settle', 'setCurrency', { bookId: this.bookId, from: t.fromOpenid, to: t.toOpenid, currency: code })
      .then(() => this.load())
      .catch((err) => { this.load(); api.toast(err); });
  },
  closeCurPick() { this.setData({ curVisible: false }); },
});
