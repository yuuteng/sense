const api = require('../../utils/api');
const icons = require('../../utils/icons');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
// n 个月前的当月 1 号（n=0 即本月 1 号）
function firstDayMonthsAgo(n) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; }

const ROLE_LABEL = { owner: '所有者', admin: '管理员', rw: '读写', ro: '只读' };

Page({
  data: {
    ic: {},
    books: [],
    bookId: '',
    selBook: null,          // 当前选中账本（折叠行展示）
    bookSheetVisible: false, // 账本选择弹层
    // 时间范围
    ranges: [
      { key: 'all', label: '全部时间' },
      { key: 'month', label: '本月' },
      { key: 'quarter', label: '近三个月' },
      { key: 'year', label: '近一年' },
      { key: 'custom', label: '自定义' },
    ],
    rangeMode: 'all',
    dateFrom: '',
    dateTo: '',
    // 导出格式（标签精简保证单行放下，格式说明见下方注释文案）
    formats: [
      { key: 'excel', label: 'Excel' },
      { key: 'csv', label: 'CSV' },
      { key: 'json', label: 'JSON' },
      { key: 'pdf', label: 'PDF' },
    ],
    format: 'excel',
    // 下载方式
    delivery: 'local',
    email: '',
    // 日历
    calVisible: false,
    calTarget: 'from',
    calValue: '',
    submitting: false,
    loading: true,
  },

  onLoad() {
    this.setData({
      ic: {
        book: icons.get('book', '#0089c0', 1.7),
        bookSplit: icons.get('bookSplit', '#a47d06', 1.7),
        calendar: icons.get('calendar', '#748294', 1.7),
        download: icons.get('download', '#0089c0', 1.7),
        mail: icons.get('mail', '#0089c0', 1.7),
        check: icons.get('check', '#0089c0', 2.4),
        chevron: icons.get('chevron', '#748294', 2),
        chevronDown: icons.get('chevronDown', '#748294', 2.2),
      },
      email: wx.getStorageSync('exportEmail') || '',
    });
    this.load();
  },

  async load() {
    try {
      const books = await api.call('book', 'list');
      // 图标随账本类型：共享=蓝 book / 分账=黄 bookSplit（全局约定）
      const list = books.map((b) => ({
        bookId: b.bookId, name: b.name, typeLabel: b.typeLabel, roleLabel: ROLE_LABEL[b.myRole] || b.myRole,
        typeClass: b.type === 'split' ? 'book-type--split' : 'book-type--share',
        iconSrc: b.type === 'split' ? this.data.ic.bookSplit : this.data.ic.book,
        iconBg: b.type === 'split' ? 'rgba(255,205,47,0.16)' : 'rgba(0,204,249,0.12)',
        isCurrent: b.isCurrent || b.isDefault,
      }));
      const cur = list.find((b) => b.isCurrent) || list[0];
      this.setData({ books: list, bookId: cur ? cur.bookId : '', selBook: cur || null, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toast(e);
    }
  },

  // 账本选择：折叠行 → 弹层挑选（复用 book-switcher）
  openBookSheet() { if (this.data.books.length) this.setData({ bookSheetVisible: true }); },
  closeBookSheet() { this.setData({ bookSheetVisible: false }); },
  onBookPick(e) {
    const id = e.detail.bookId;
    const sel = this.data.books.find((b) => b.bookId === id);
    this.setData({ bookId: id, selBook: sel || this.data.selBook, bookSheetVisible: false });
  },

  pickRange(e) {
    const key = e.currentTarget.dataset.key;
    const patch = { rangeMode: key };
    if (key === 'all') { patch.dateFrom = ''; patch.dateTo = ''; }
    else if (key === 'month') { patch.dateFrom = firstDayMonthsAgo(0); patch.dateTo = todayStr(); }
    else if (key === 'quarter') { patch.dateFrom = firstDayMonthsAgo(2); patch.dateTo = todayStr(); }
    else if (key === 'year') { patch.dateFrom = firstDayMonthsAgo(11); patch.dateTo = todayStr(); }
    else if (key === 'custom') {
      if (!this.data.dateFrom) patch.dateFrom = firstDayMonthsAgo(0);
      if (!this.data.dateTo) patch.dateTo = todayStr();
    }
    this.setData(patch);
  },

  pickFormat(e) { this.setData({ format: e.currentTarget.dataset.key }); },

  pickDelivery(e) { this.setData({ delivery: e.currentTarget.dataset.key }); },
  onEmail(e) { this.setData({ email: e.detail.value }); },

  openCal(e) {
    const t = e.currentTarget.dataset.target;
    this.setData({ calTarget: t, calValue: t === 'from' ? this.data.dateFrom : this.data.dateTo, calVisible: true });
  },
  onCalPick(e) {
    const d = e.detail.date;
    const { calTarget, dateFrom, dateTo } = this.data;
    const patch = { calVisible: false, rangeMode: 'custom' };
    if (calTarget === 'from') { patch.dateFrom = d; if (dateTo && d > dateTo) patch.dateTo = d; }
    else { patch.dateTo = d; if (dateFrom && d < dateFrom) patch.dateFrom = d; }
    this.setData(patch);
  },
  onCalClose() { this.setData({ calVisible: false }); },

  onSubmit() {
    if (this.data.submitting) return;
    const { bookId, format, delivery, rangeMode, dateFrom, dateTo, email } = this.data;
    if (!bookId) { wx.showToast({ title: '请选择账本', icon: 'none' }); return; }
    if (rangeMode !== 'all' && (!dateFrom || !dateTo)) { wx.showToast({ title: '请选择完整时间段', icon: 'none' }); return; }
    const range = rangeMode === 'all' ? {} : { dateFrom, dateTo };

    if (delivery === 'email') {
      const to = (email || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { wx.showToast({ title: '请输入正确的邮箱', icon: 'none' }); return; }
      wx.setStorageSync('exportEmail', to);
      this.setData({ submitting: true });
      wx.showLoading({ title: '发送中…', mask: true });
      api.call('data', 'exportEmail', { bookId, format, email: to, ...range })
        .then((r) => {
          wx.hideLoading();
          this.setData({ submitting: false });
          wx.showModal({ title: '已发送', content: `已将 ${r.count} 条记录导出为 ${r.fileName}，作为附件发送至 ${r.to}`, showCancel: false });
        })
        .catch((e) => { wx.hideLoading(); this.setData({ submitting: false }); api.toast(e); });
      return;
    }

    // 本地存储：生成 → 下载到临时文件 → 预览 / 转发保存
    this.setData({ submitting: true });
    wx.showLoading({ title: '生成中…', mask: true });
    api.call('data', 'export', { bookId, format, ...range })
      .then((res) => {
        wx.cloud.downloadFile({ fileID: res.fileID }).then((dl) => {
          wx.hideLoading();
          this.setData({ submitting: false });
          this.deliverFile(dl.tempFilePath, res.fileType, res.fileName);
        }).catch(() => { wx.hideLoading(); this.setData({ submitting: false }); wx.showToast({ title: '下载失败', icon: 'none' }); });
      })
      .catch((e) => { wx.hideLoading(); this.setData({ submitting: false }); api.toast(e); });
  },

  // 交付文件：预览 或 转发/保存到微信
  deliverFile(filePath, fileType, fileName) {
    wx.showActionSheet({
      itemList: ['预览文件', '转发 / 保存到微信'],
      success: (r) => {
        if (r.tapIndex === 0) {
          wx.openDocument({
            filePath, fileType, showMenu: true,
            fail: () => wx.shareFileMessage({ filePath, fileName, fail: () => wx.showToast({ title: '该格式不支持预览，请选转发', icon: 'none' }) }),
          });
        } else {
          wx.shareFileMessage({ filePath, fileName, fail: () => wx.showToast({ title: '转发失败，可改用预览后保存', icon: 'none' }) });
        }
      },
    });
  },
});
