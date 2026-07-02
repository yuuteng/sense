// 心数 Sense 后端主云函数：按 { resource, type } 路由
const { cloud, AppError } = require('./lib');
const handlers = require('./handlers');

exports.main = async (event) => {
  const { resource, type, ...params } = event || {};
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) throw new AppError('UNAUTHENTICATED', '未获取到用户身份');

    const group = handlers[resource];
    const fn = group && group[type];
    if (!fn) throw new AppError('INVALID_PARAM', `未知接口：${resource}.${type}`);

    const data = await fn(params, { openid });
    return { success: true, data };
  } catch (e) {
    console.error(`[${resource}.${type}]`, e);
    return { success: false, code: e.code || 'INTERNAL', errMsg: e.message || String(e) };
  }
};
