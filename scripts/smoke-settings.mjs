// 批次4 冒烟：会话置顶 / 免打扰
const BASE = process.env.BASE_URL || 'http://localhost:3001';
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
const login = async (u, p) => (await req('POST', '/api/login', { body: { username: u, password: p } })).data.user;
const admin = await login('admin', 'admin123');

// 1. 设置 peerId=2 pinned
const s1 = await req('POST', '/api/conv-settings', { token: admin.token, body: { peerId: 2, pinned: true } });
check('设置置顶 ok', s1.data?.ok === true);
// 2. 设置 peerId=3 muted
const s2 = await req('POST', '/api/conv-settings', { token: admin.token, body: { peerId: 3, muted: true } });
check('设置免打扰 ok', s2.data?.ok === true);
// 3. 查询
const g = await req('GET', `/api/conv-settings?userId=${admin.id}`, { token: admin.token });
check('查询返回 2 条设置', g.data?.ok === true && g.data.settings.length >= 2);
const s2_ = g.data.settings.find(s => s.peerId === 2);
const s3_ = g.data.settings.find(s => s.peerId === 3);
check('peer2 pinned=true', s2_ && s2_.pinned === true);
check('peer3 muted=true', s3_ && s3_.muted === true);
// 4. 取消置顶
const s3 = await req('POST', '/api/conv-settings', { token: admin.token, body: { peerId: 2, pinned: false } });
check('取消置顶 ok', s3.data?.ok === true);
const g2 = await req('GET', `/api/conv-settings?userId=${admin.id}`, { token: admin.token });
check('peer2 pinned=false', g2.data.settings.find(s => s.peerId === 2)?.pinned === false);
// 5. 未登录访问被拒
const noAuth = await req('GET', '/api/conv-settings?userId=1');
check('未登录访问被拒(401)', noAuth.status === 401);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
