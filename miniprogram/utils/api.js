// 云函数调用封装：api.call('record', 'list', { bookId }) → Promise<data>
// 路由键 resource/type 放在展开之后：业务参数若撞名（如筛选字段 type），路由永远赢，
// 否则会出现「未知接口 record.income」这类被 payload 覆盖路由的事故

// 运行渠道（develop 开发版 / trial 体验版 / release 正式版）：每次调用随参上报，
// 服务端用于新建数据打标与测试数据清理；前端值可伪造，绝不作权限依据
let ENV_VERSION = 'unknown';
try { ENV_VERSION = ((wx.getAccountInfoSync() || {}).miniProgram || {}).envVersion || 'unknown'; } catch (e) { /* 忽略 */ }

function call(resource, type, params = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'api',
      data: { ...params, resource, type, envVersion: ENV_VERSION },
    }).then((res) => {
      const r = res.result || {};
      if (r.success) resolve(r.data);
      else reject(r);
    }).catch((err) => {
      reject({ success: false, code: 'CALL_FAIL', errMsg: (err && err.errMsg) || '网络错误' });
    });
  });
}

// 统一错误提示：给用户看人话，不透传技术细节。
// 规则：已知 code 用映射；服务端业务文案（含中文）原样显示；纯英文/技术串一律兜底话术。
const FRIENDLY = {
  CALL_FAIL: '网络不给力，请检查网络后重试',
  NOT_MEMBER: '你不在这个账本里，或账本已被解散',
  FORBIDDEN: '没有权限进行这个操作',
  PERM_DENIED: '没有权限进行这个操作',
  INVALID_PARAM: '内容不完整或格式不对，请检查后重试',
};
function toast(err) {
  const code = err && err.code;
  const raw = (err && err.errMsg) || '';
  let msg = FRIENDLY[code];
  if (!msg) msg = /[一-龥]/.test(raw) ? raw : '操作失败，请稍后重试';
  wx.showToast({ title: msg, icon: 'none' });
}

module.exports = { call, toast };
