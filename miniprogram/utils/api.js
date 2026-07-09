// 云函数调用封装：api.call('record', 'list', { bookId }) → Promise<data>
// 路由键 resource/type 放在展开之后：业务参数若撞名（如筛选字段 type），路由永远赢，
// 否则会出现「未知接口 record.income」这类被 payload 覆盖路由的事故
function call(resource, type, params = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'api',
      data: { ...params, resource, type },
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
