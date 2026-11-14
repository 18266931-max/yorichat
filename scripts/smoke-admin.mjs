// 新功能与权限矩阵实测（用真实服务，测试后清理）
const BASE = 'http://localhost:3001';
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
  const ct = res.headers.get('content-type') || '';
  let data = null;
  try { data = ct.includes('json') ? await res.json() : await res.text(); } catch {}
  return { status: res.status, data, ct };
}
const login = (u, p) => req('POST', '/api/login', { body: { username: u, password: p } }).then(r => r.data.user);

const sup = await login('admin', 'admin123');       // 超级管理员
const ord = await login('testuser123', '123456');   // 普通管理员
const ord2 = await login('testuser456', '123456');  // 普通管理员2

// ── 公告 / 注册开关 ──
let r = await req('GET', '/api/settings');
check('公开读取设置', r.data?.ok === true);
r = await req('POST', '/api/admin/settings', { token: ord.token, body: { announcement: 'x' } });
check('普通管理员不能改系统设置', r.data?.ok === false && r.data.msg.includes('超级管理员'), r.data?.msg);
r = await req('POST', '/api/admin/settings', { token: sup.token, body: { announcement: '今晚22点维护', registrationOpen: true } });
check('超级管理员保存公告', r.data?.ok === true);
r = await req('GET', '/api/settings');
check('公告已生效', r.data?.announcement === '今晚22点维护');

r = await req('POST', '/api/admin/settings', { token: sup.token, body: { registrationOpen: false } });
check('关闭注册', r.data?.ok === true);
const regClosed = await req('POST', '/api/register', { body: { username: 'regprobe', password: '123456' } });
check('关闭后注册被拒', regClosed.data?.ok === false && regClosed.data.msg.includes('关闭注册'), regClosed.data?.msg);

// ── 群聊管理 ──
const created = await req('POST', '/api/groups/create', { token: ord.token, body: { name: '临时测试群', memberIds: [sup.id] } });
const gid = created.data?.group?.id;
check('创建测试群', created.data?.ok === true && !!gid);
r = await req('GET', '/api/admin/groups', { token: ord.token });
check('普通管理员可看群聊管理', r.data?.ok === true && Array.isArray(r.data.groups));
check('群列表含新群', (r.data.groups || []).some(g => g.id === gid));
const target = (r.data.groups || []).find(g => g.id === gid);
check('群信息含成员数', target && target.memberCount >= 2, JSON.stringify(target));
r = await req('POST', `/api/admin/groups/${gid}/dissolve`, { token: ord.token, body: {} });
check('不带群名确认不能解散', r.data?.ok === false && r.data.msg.includes('群名'), r.data?.msg);
r = await req('POST', `/api/admin/groups/${gid}/dissolve`, { token: ord.token, body: { confirmName: '临时测试群' } });
check('普通管理员可解散群', r.data?.ok === true, r.data?.msg);
r = await req('GET', '/api/admin/groups', { token: ord.token });
check('群已从列表移除', !(r.data.groups || []).some(g => g.id === gid));

// ── 数据备份 ──
r = await req('GET', `/api/admin/backup?userId=${ord.id}`, { token: ord.token });
check('普通管理员不能导出备份', r.data?.ok === false, JSON.stringify(r.data).slice(0, 60));
r = await req('GET', `/api/admin/backup?userId=${sup.id}`, { token: sup.token });
check('超级管理员可导出备份', r.status === 200 && r.ct.includes('application/json'), r.ct);
check('备份含核心数据', r.data && r.data.data && Object.keys(r.data.data).length >= 10 && Array.isArray(r.data.data.users) && Array.isArray(r.data.data.messages));

// ── 权限矩阵（普通管理员）──
// 1) 可以禁用/启用管理员
r = await req('POST', `/api/admin/users/${ord2.id}/disable`, { token: ord.token, body: {} });
check('普通管理员可禁用管理员', r.data?.ok === true, r.data?.msg);
r = await req('POST', `/api/admin/users/${ord2.id}/enable`, { token: ord.token, body: {} });
check('普通管理员可启用管理员', r.data?.ok === true, r.data?.msg);
// 2) 可以改角色（降级再恢复）
r = await req('POST', `/api/admin/users/${ord2.id}/set-admin`, { token: ord.token, body: {} });
check('普通管理员可取消管理员', r.data?.ok === true && r.data.role === 'user', r.data?.msg);
r = await req('POST', `/api/admin/users/${ord2.id}/set-admin`, { token: ord.token, body: {} });
check('普通管理员可恢复管理员', r.data?.ok === true && r.data.role === 'admin', r.data?.msg);
// 3) 普通管理员不能设置超级管理员（设为/取消都只能超管操作）
r = await req('POST', `/api/admin/users/${ord2.id}/set-super`, { token: ord.token, body: {} });
check('普通管理员不能设超级管理员', r.data?.ok === false && r.data.msg.includes('只有超级管理员'), r.data?.msg);
// 4) 超级管理员可以设置
r = await req('POST', `/api/admin/users/${ord2.id}/set-super`, { token: sup.token, body: {} });
check('超级管理员可设超级管理员', r.data?.ok === true && r.data.role === 'superadmin', r.data?.msg);
// 5) 普通管理员不能罢免超级管理员
r = await req('POST', `/api/admin/users/${ord2.id}/set-super`, { token: ord.token, body: {} });
check('普通管理员不能罢免超级管理员', r.data?.ok === false && r.data.msg.includes('只有超级管理员'), r.data?.msg);
// 6) 普通管理员不能禁用超级管理员
r = await req('POST', `/api/admin/users/${ord2.id}/disable`, { token: ord.token, body: {} });
check('普通管理员不能禁用超级管理员', r.data?.ok === false && r.data.msg.includes('罢免'), r.data?.msg);
// 7) 超级管理员可以罢免
r = await req('POST', `/api/admin/users/${ord2.id}/set-super`, { token: sup.token, body: {} });
check('超级管理员可罢免超级管理员', r.data?.ok === true && r.data.role === 'admin', r.data?.msg);

// ── 清理：恢复公告/注册开关，删除测试用户 ──
await req('POST', '/api/admin/settings', { token: sup.token, body: { announcement: '', registrationOpen: true } });
await req('POST', '/api/admin/settings', { token: sup.token, body: { registrationOpen: true } });
const fs = await import('fs');
const usersFile = 'E:\\ai编程\\20260404181618\\app\\server\\users.json';
const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
const kept = users.filter(u => u.username !== 'regprobe');
if (kept.length !== users.length) fs.writeFileSync(usersFile, JSON.stringify(kept, null, 2), 'utf-8');
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
