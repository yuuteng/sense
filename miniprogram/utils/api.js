// 云函数调用封装：api.call('record', 'list', { bookId }) → Promise<data>
function call(resource, type, params = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'api',
      data: { resource, type, ...params },
    }).then((res) => {
      const r = res.result || {};
      if (r.success) resolve(r.data);
      else reject(r);
    }).catch((err) => {
      reject({ success: false, code: 'CALL_FAIL', errMsg: (err && err.errMsg) || '网络错误' });
    });
  });
}

// 统一错误提示
function toast(err) {
  const msg = (err && err.errMsg) || '操作失败';
  wx.showToast({ title: msg, icon: 'none' });
}

module.exports = { call, toast };
