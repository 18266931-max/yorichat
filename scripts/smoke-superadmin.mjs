// 超级管理员高危操作测试（务必对临时 DATA_DIR 运行）
const BASE = process.env.BASE_URL || 'http://localhost:3002';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = (u, p) => req('POST', '/api/login', { body: { username: u, password: p } }).then(r => r.data.user);

const sup = await login('admin', 'admin123');
const ord = await login('testuser123', '123456');
const victim = await login('testuser456', '123456');

// 先导出备份（用于最后验证恢复）
const backup = await req('GET', `/api/admin/backup?userId=${sup.id}`, { token: sup.token });
const backupPayload = backup.data?.data ? backup.data.data : backup.data;

// 先给 victim 发条私聊消息，供审查
await req('POST', '/api/messages/send', { token: ord.token, body: { receiverId: victim.id, content: 'AUDIT-TEST-MSG' } });

// ── 消息审查 ──
let r = await req('GET', '/api/admin/audit/conversations?userId=' + ord.id, { token: ord.token });
check('普通管理员不能看消息审查', r.data?.ok === false, r.data?.msg);
r = await req('GET', `/api/admin/audit/conversations?userId=${sup.id}`, { token: sup.token });
check('超级管理员可列出会话', r.data?.ok === true && Array.isArray(r.data.conversations));
const conv = (r.data.conversations || []).find(c =>
  (c.userA === ord.id && c.userB === victim.id) || (c.userA === victim.id && c.userB === ord.id));
check('会话包含双方', !!conv, JSON.stringify(r.data.conversations?.slice(0, 2)));
r = await req('GET', `/api/admin/audit/messages?userA=${ord.id}&userB=${victim.id}&userId=${sup.id}`, { token: sup.token });
check('可读取私聊内容', r.data?.ok === true && r.data.messages.some(m => m.content === 'AUDIT-TEST-MSG'));

// ── 彻底删除用户 ──
r = await req('POST', `/api/admin/users/${victim.id}/purge`, { token: ord.token, body: { confirmUsername: victim.username } });
check('普通管理员不能彻底删除', r.data?.ok === false, r.data?.msg);
r = await req('POST', `/api/admin/users/${victim.id}/purge`, { token: sup.token, body: { confirmUsername: 'wrong-name' } });
check('错误用户名不能删除', r.data?.ok === false && r.data.msg.includes('用户名'), r.data?.msg);
r = await req('POST', `/api/admin/users/${victim.id}/purge`, { token: sup.token, body: { confirmUsername: victim.username } });
check('超级管理员彻底删除用户', r.data?.ok === true, r.data?.msg);
const loginAfter = await req('POST', '/api/login', { body: { username: victim.username, password: '123456' } });
check('被删除用户无法登录', loginAfter.data?.ok === false);
r = await req('GET', `/api/admin/audit/conversations?userId=${sup.id}`, { token: sup.token });
const stillConv = (r.data.conversations || []).some(c =>
  (c.userA === ord.id && c.userB === victim.id) || (c.userA === victim.id && c.userB === ord.id));
check('删除后其私聊记录被清除', !stillConv);

// ── 清空市场 ──
r = await req('POST', '/api/admin/market/reset', { token: ord.token, body: { confirm: 'RESET_MARKET' } });
check('普通管理员不能清空市场', r.data?.ok === false, r.data?.msg);
r = await req('POST', '/api/admin/market/reset', { token: sup.token, body: { confirm: 'WRONG' } });
check('需要正确确认参数', r.data?.ok === false);
r = await req('POST', '/api/admin/market/reset', { token: sup.token, body: { confirm: 'RESET_MARKET' } });
check('超级管理员清空市场', r.data?.ok === true, r.data?.msg);
const market = await req('GET', '/api/market', { token: sup.token });
check('市场商品已清空', (market.data.items || []).length === 0);
const cats = await req('GET', '/api/categories');
check('分类保留', (cats.data.categories || []).length > 0);

// ── 恢复备份 ──
check('导出备份可用', backupPayload && Array.isArray(backupPayload.users));
r = await req('POST', '/api/admin/restore', { token: ord.token, body: { confirm: 'RESTORE', data: backupPayload } });
check('普通管理员不能恢复备份', r.data?.ok === false, r.data?.msg);
r = await req('POST', '/api/admin/restore', { token: sup.token, body: { confirm: 'RESTORE', data: backupPayload } });
check('超级管理员恢复备份', r.data?.ok === true, r.data?.msg);
const back = await req('POST', '/api/login', { body: { username: victim.username, password: '123456' } });
check('恢复后被删用户可重新登录', back.data?.ok === true, back.data?.msg);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
