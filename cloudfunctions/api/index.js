// 心数 Sense 后端主云函数：按 { resource, type } 路由
const { cloud, AppError } = require('./lib');
const handlers = require('./handlers');

exports.main = async (event) => {
  // 每日定时触发器：更新汇率（无用户上下文）
  if (event && (event.Type === 'timer' || event.triggerName)) {
    try { return { success: true, data: await handlers.rate._refresh() }; }
    catch (e) { console.error('[timer rate]', e); return { success: false, errMsg: String(e) }; }
  }

  const { resource, type, envVersion, ...params } = event || {};
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) throw new AppError('UNAUTHENTICATED', '未获取到用户身份');

    const group = handlers[resource];
    const fn = group && group[type];
    if (!fn) throw new AppError('INVALID_PARAM', `未知接口：${resource}.${type}`);

    // 渠道标记：develop 开发版 / trial 体验版 / release 正式版。前端上报、可伪造，
    // 仅用于新建数据打标与测试数据清理（seed.purgeChannel），绝不作权限/计费依据
    const channel = ['develop', 'trial', 'release'].includes(envVersion) ? envVersion : 'unknown';
    const data = await fn(params, { openid, channel });
    return { success: true, data };
  } catch (e) {
    console.error(`[${resource}.${type}]`, e);
    return { success: false, code: e.code || 'INTERNAL', errMsg: e.message || String(e) };
  }
};
