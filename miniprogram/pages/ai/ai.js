const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

function richify(html) {
  return (html || '').replace(/class="b"/g, 'style="font-weight:700"');
}

// 后端消息 → 前端渲染结构（id 保留：卡片状态回写数据库要用）
function normalize(m) {
  if (m.role === 'card' || m.card) {
    const c = m.card || m;
    return { role: 'card', id: m._id || '', kind: c.kind, rows: c.rows, state: c.state || 'pending', draft: c.draft || null };
  }
  if (m.role === 'ai') return { role: 'ai', html: richify(m.html || m.text || '') };
  // user
  if (m.receipt) return { role: 'me', receipt: true, image: m.fileID || '' };
  return { role: 'me', text: m.text || '' };
}

Page({
  data: {
    messages: [],
    input: '',
    ic: {},
    bookName: '',
    // 展示币种胶囊（与首页/统计一致）
    curCode: 'CNY',
    curSym: '¥',
    curVisible: false,
    chevronDown: '',
    loading: true,
    placeholder: '问一句，或说「昨天打车 35」记一笔…',
    // 语音输入：按住说话（recording）→ 松开识别（recognizing）；上滑取消（recCancel）
    recording: false,
    recognizing: false,
    recCancel: false,
    // 账本切换面板（与首页/统计一致）
    switcherVisible: false,
    currentBookId: '',
    books: [],
  },

  onLoad() {
    this.setData({
      chevronDown: icons.get('chevronDown', '#748294', 2.2),
      bookIcon: icons.get('book', '#0089c0', 1.7),
      splitIcon: icons.get('bookSplit', '#a47d06', 1.7),
      ic: {
        camera: icons.get('camera', '#748294', 1.8),
        mic: icons.get('mic', '#748294', 1.8),
        micBig: icons.get('mic', '#7fe6ff', 1.8),
        micCancel: icons.get('trash', '#ffffff', 1.8),
        send: icons.get('send', '#ffffff', 2),
        checkbox: icons.get('checkbox', '#0089c0', 2),
        clock: icons.get('clock', '#0089c0', 2),
        checkDone: icons.get('check', '#5c9a0e', 2.4),
      },
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2, hidden: false });
    }
    this.load();
  },

  async load() {
    try {
      const book = await api.call('book', 'getCurrent');
      if (!book) { this.setData({ loading: false }); return; }
      this.bookId = book.bookId;
      this.canWrite = book.myRole !== 'ro'; // 只读成员：可问答，不产生入账
      const cur = book.displayCurrency || 'CNY';
      const msgs = await api.call('ai', 'listMessages', { bookId: book.bookId });
      this.setData({
        currentBookId: book.bookId,
        bookName: book.name,
        curCode: cur,
        curSym: fmt.symbolOf(cur),
        placeholder: this.canWrite ? '问一句，或说「昨天打车 35」记一笔…' : '问一句，如「本月支出多少」…',
        messages: msgs.map(normalize),
        loading: false,
      });
      this.scrollBottom();
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  // 顶栏账本切换（与首页一致）：切换后重载该账本的会话
  async openSwitcher() {
    try {
      const list = await api.call('book', 'list');
      this.setData({
        books: list.map((b) => ({
          bookId: b.bookId, name: b.name, typeLabel: b.typeLabel,
          typeClass: b.type === 'split' ? 'book-type--split' : 'book-type--share',
          iconSrc: b.type === 'split' ? this.data.splitIcon : this.data.bookIcon,
          iconBg: b.type === 'split' ? 'rgba(255,205,47,0.16)' : 'rgba(0,204,249,0.12)',
        })),
        switcherVisible: true,
      });
    } catch (e) { api.toast(e); }
  },
  async onSwitcherSelect(e) {
    const { bookId } = e.detail;
    this.setData({ switcherVisible: false });
    if (!bookId || bookId === this.data.currentBookId) return;
    try {
      await api.call('book', 'setDefault', { bookId });
      this.setData({ loading: true, messages: [] });
      await this.load();
      wx.showToast({ title: '已切换账本', icon: 'none' });
    } catch (e2) { api.toast(e2); }
  },
  onSwitcherClose() { this.setData({ switcherVisible: false }); },

  // 展示币种切换（与首页一致）：历史消息不含换算金额，无需整页重载；
  // 乐观更新胶囊，失败回滚。之后的 AI 回答由服务端按新口径计算。
  openCurPicker() { this.setData({ curVisible: true }); },
  closeCurPicker() { this.setData({ curVisible: false }); },
  onCurPick(e) {
    const code = e.detail.code;
    this.setData({ curVisible: false });
    if (!code || code === this.data.curCode) return;
    const prev = { curCode: this.data.curCode, curSym: this.data.curSym };
    this.setData({ curCode: code, curSym: fmt.symbolOf(code) });
    api.call('settings', 'update', { displayCurrency: code })
      .catch((err) => { this.setData(prev); api.toast(err); });
  },
  goManageBooks() {
    this.setData({ switcherVisible: false });
    wx.navigateTo({ url: '/pages/books/books' });
  },

  scrollBottom() {
    wx.nextTick(() => wx.pageScrollTo({ scrollTop: 1000000, duration: 200 }));
  },

  onInput(e) { this.setData({ input: e.detail.value }); },

  push(msg) {
    this.setData({ messages: this.data.messages.concat([msg]) });
    this.scrollBottom();
  },
  replaceLastTyping(msg) {
    const messages = this.data.messages.slice();
    const i = messages.map((m) => m.typing).lastIndexOf(true);
    if (i > -1) messages.splice(i, 1);
    messages.push(msg);
    this.setData({ messages });
    this.scrollBottom();
  },

  // 会话持久化（滚动上限由后端控制）；卡片需要返回的消息 id 做状态回写
  persist(message) {
    return api.call('ai', 'appendMessage', { bookId: this.bookId, message })
      .then((r) => (r && r.id) || '').catch(() => '');
  },
  // AI 回复（文本或预填卡）统一上屏 + 落库
  async pushAiResult(res, cardLead) {
    if (res.card) {
      const lead = cardLead || '已解析成一条<span style="font-weight:700">预填记录</span>，确认无误可直接入账，或编辑后再入账：';
      this.replaceLastTyping({ role: 'ai', html: lead });
      await this.persist({ role: 'ai', html: lead }); // 先落引导语再落卡片，保证重载后顺序不乱
      const card = { role: 'card', kind: res.card.kind, rows: res.card.rows, state: 'pending', draft: res.card.draft || null };
      card.id = await this.persist({ role: 'card', card: { kind: card.kind, rows: card.rows, state: 'pending', draft: card.draft } });
      this.push(card);
    } else {
      const html = richify(res.answer || '');
      this.replaceLastTyping({ role: 'ai', html });
      this.persist({ role: 'ai', html });
    }
  },

  async onSend() {
    const t = (this.data.input || '').trim();
    if (!t || !this.bookId) return;
    this.push({ role: 'me', text: t });
    this.setData({ input: '' });
    this.persist({ role: 'me', text: t });
    this.push({ role: 'ai', typing: true });
    try {
      const res = await api.call('ai', 'chat', { bookId: this.bookId, text: t });
      await this.pushAiResult(res);
    } catch (e) {
      this.replaceLastTyping({ role: 'ai', html: '出错了，请稍后再试。' });
      api.toast(e);
    }
  },

  // 上传收据：选图 → 传云存储 → 会话内显示真实图片 → 调用 AI 识别生成预填卡
  onUpload() {
    if (!this.bookId) return;
    if (!this.canWrite) { wx.showToast({ title: '只读成员不能记账，可直接提问账本数据', icon: 'none' }); return; }
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (file && file.tempFilePath) this.uploadAndRecognize(file.tempFilePath);
      },
    });
  },

  uploadAndRecognize(tempFilePath) {
    wx.showLoading({ title: '上传中…', mask: true });
    wx.cloud.uploadFile({
      cloudPath: `receipts/${this.bookId}-${Date.now()}.jpg`,
      filePath: tempFilePath,
    }).then((up) => {
      wx.hideLoading();
      this.push({ role: 'me', receipt: true, image: tempFilePath });
      this.persist({ role: 'me', receipt: true, fileID: up.fileID });
      this.push({ role: 'ai', typing: true });
      api.call('ai', 'parseReceipt', { bookId: this.bookId, fileID: up.fileID })
        .then((res) => this.pushAiResult(res, '识别到一张收据，已生成<span style="font-weight:700">预填记录</span>，确认无误可直接入账，或编辑后再入账：'))
        .catch((e) => {
          this.replaceLastTyping({ role: 'ai', html: '识别失败：' + ((e && e.errMsg) || '请稍后再试') });
        });
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '图片上传失败，请重试', icon: 'none' });
    });
  },

  // 打开记账页并用 AI 预填草稿填充，用户可改任意字段再真正保存入账
  editDraft(e) {
    const m = this.data.messages[e.currentTarget.dataset.i];
    if (!m || !m.draft) { wx.showToast({ title: '无预填数据', icon: 'none' }); return; }
    // 带上消息 id：记账页保存成功后回写卡片为「已入账」，返回本页 onShow 刷新即可见
    const mid = m.id ? '&m=' + m.id : '';
    wx.navigateTo({ url: '/pages/add/add?d=' + encodeURIComponent(JSON.stringify(m.draft)) + mid });
  },
  // 确认入账：预填卡一键入账（服务端解析分类并复用记账链路），成功后卡片置为已入账
  async confirmCard(e) {
    const i = e.currentTarget.dataset.i;
    const m = this.data.messages[i];
    if (!m || !m.draft) { wx.showToast({ title: '无预填数据', icon: 'none' }); return; }
    if (this._confirming) return;
    this._confirming = true;
    wx.showLoading({ title: '入账中…', mask: true });
    try {
      await api.call('ai', 'confirmDraft', { bookId: this.bookId, draft: m.draft, msgId: m.id || '' });
      wx.hideLoading();
      this.setData({ [`messages[${i}].state`]: 'done' });
      wx.showToast({ title: '已入账', icon: 'success' });
    } catch (e2) {
      wx.hideLoading();
      api.toast(e2);
    }
    this._confirming = false;
  },
  dropCard(e) {
    const i = e.currentTarget.dataset.i;
    const m = this.data.messages[i];
    this.setData({ [`messages[${i}].state`]: 'dropped' });
    if (m && m.id) api.call('ai', 'setCardState', { bookId: this.bookId, msgId: m.id, state: 'dropped' }).catch(() => {});
  },
  goHome() { wx.switchTab({ url: '/pages/home/home' }); },

  // —— 语音输入：按住说话 → 云存储中转 → 云函数调腾讯云一句话识别 → 文本填入输入框 ——
  getRecorder() {
    if (this._recorder) return this._recorder;
    const rec = wx.getRecorderManager();
    rec.onStop((res) => this.onRecStop(res));
    rec.onError(() => {
      this._recActive = false;
      this.setData({ recording: false, recCancel: false });
      wx.showToast({ title: '录音失败，请重试', icon: 'none' });
    });
    this._recorder = rec;
    return rec;
  },

  micStart(e) {
    if (this.data.recognizing) return;
    this._touchY = (e.touches && e.touches[0]) ? e.touches[0].clientY : 0;
    if (this._authOk) { this.beginRecord(); return; }
    wx.getSetting({
      success: (s) => {
        if (s.authSetting['scope.record']) { this._authOk = true; this.beginRecord(); return; }
        // 首次授权弹窗会打断长按手势：授权成功后提示用户重新按住
        wx.authorize({
          scope: 'scope.record',
          success: () => { this._authOk = true; wx.showToast({ title: '已授权，请按住说话', icon: 'none' }); },
          fail: () => wx.showModal({
            title: '需要麦克风权限',
            content: '语音输入需要使用麦克风，请在设置中允许。',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting(); },
          }),
        });
      },
    });
  },
  beginRecord() {
    if (this._recActive) return;
    this._recActive = true;
    this.setData({ recording: true, recCancel: false });
    // 一句话识别上限 60s；16k 采样单声道 mp3，识别引擎 16k_zh 对应
    this.getRecorder().start({ duration: 60000, format: 'mp3', sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000 });
  },
  micMove(e) {
    if (!this._recActive) return;
    const y = (e.touches && e.touches[0]) ? e.touches[0].clientY : this._touchY;
    const cancel = this._touchY - y > 80;
    if (cancel !== this.data.recCancel) this.setData({ recCancel: cancel });
  },
  micEnd() {
    if (!this._recActive) return;
    this._recActive = false;
    this.getRecorder().stop(); // 结果在 onRecStop 统一处理（含取消判断）
  },
  micCancel() {
    // 系统打断（来电/切后台）：一律按取消处理
    if (!this._recActive) return;
    this._recActive = false;
    this.setData({ recCancel: true });
    this.getRecorder().stop();
  },

  onRecStop(res) {
    const cancelled = this.data.recCancel;
    this.setData({ recording: false, recCancel: false });
    if (cancelled) return;
    if (!res || !res.tempFilePath || (res.duration || 0) < 600) {
      wx.showToast({ title: '说话时间太短', icon: 'none' });
      return;
    }
    this.recognize(res.tempFilePath);
  },

  recognize(tempFilePath) {
    this.setData({ recognizing: true });
    wx.cloud.uploadFile({
      cloudPath: `asr/${Date.now()}-${Math.floor(Math.random() * 1e6)}.mp3`,
      filePath: tempFilePath,
    })
      .then((up) => api.call('asr', 'sentence', { fileID: up.fileID }))
      .then((r) => {
        this.setData({ recognizing: false });
        const text = (r.text || '').trim();
        if (!text) { wx.showToast({ title: '没听清，请再说一次', icon: 'none' }); return; }
        // 填入输入框而非直接发送：用户可改错字，也和「AI 绝不自动入账」一致
        this.setData({ input: (this.data.input || '') + text });
      })
      .catch((e) => {
        this.setData({ recognizing: false });
        api.toast(e);
      });
  },
});
