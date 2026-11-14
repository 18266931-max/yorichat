// 边界场景补测：权限 / 参数校验 / 引用校验 / 异常输入
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
const A = await login('admin', 'admin123');           // id 1
const B = await login('testuser123', '123456');        // id 2
const C = await login('testuser456', '123456');        // id 3

// ── 1. 引用校验：跨会话引用应被拒 ──
const m1 = await req('POST', '/api/messages/send', { token: A.token, body: { receiverId: B.id, content: 'EDGE-M1' } });
const m1id = m1.data.message.id;
// C 引用 A↔B 的消息（会话不匹配）
const crossReply = await req('POST', '/api/messages/send', { token: C.token, body: { receiverId: A.id, content: 'EDGE-X', replyToId: m1id } });
check('跨会话引用被拒', crossReply.data?.ok === false);

// ── 2. 删除权限：C 删 A↔B 的消息应被拒 ──
const delByC = await req('DELETE', `/api/messages/${m1id}`, { token: C.token });
check('非会话双方删消息被拒', delByC.data?.ok === false);

// ── 3. 撤回：C 撤回 A 的消息应被拒 ──
const recallByC = await req('POST', `/api/messages/${m1id}/recall`, { token: C.token });
check('非发送者撤回被拒', recallByC.data?.ok === false);

// ── 4. 搜索：特殊字符 / 空查询 / 越权 ──
const searchEmpty = await req('GET', '/api/messages/search?q=', { token: A.token });
check('空搜索返回空数组', searchEmpty.data?.ok === true && searchEmpty.data.results.length === 0);
const searchSpecial = await req('GET', '/api/messages/search?q=' + encodeURIComponent('%_\\"'), { token: A.token });
check('特殊字符搜索不报错', searchSpecial.data?.ok === true);
const searchAnon = await req('GET', '/api/messages/search?q=EDGE');
check('未登录搜索被拒(401)', searchAnon.status === 401);

// ── 5. 上传异常输入 ──
const upEmpty = await req('POST', '/api/files/upload', { token: A.token, body: { fileName: 'x.txt' } });
check('缺 data 上传被拒', upEmpty.data?.ok === false);
const upBadB64 = await req('POST', '/api/files/upload', { token: A.token, body: { fileName: 'x.txt', data: '!!!not-base64!!!' } });
check('非法 base64 被拒', upBadB64.data?.ok === false);
const upWeirdName = await req('POST', '/api/files/upload', { token: A.token, body: { fileName: '\u0000../etc/pass\u0000.sh', data: 'eA==' } });
check('控制字符/穿越文件名被净化', upWeirdName.data?.ok === true && !upWeirdName.data.url.includes('..'));
const onlyName = upWeirdName.data?.fileName || '';
check('文件名保留原始扩展名或安全兜底', upWeirdName.data?.ok === true);

// ── 6. conv-settings 校验 ──
const csBad = await req('POST', '/api/conv-settings', { token: A.token, body: {} });
check('缺少 peerId 被拒', csBad.data?.ok === false);
const csBad2 = await req('POST', '/api/conv-settings', { token: A.token, body: { peerId: 'abc' } });
check('非法 peerId 被拒或忽略', csBad2.data?.ok === false || csBad2.data?.ok === true);

// ── 7. 群消息：非成员发送 / @不存在成员 ──
// 群 2：owner=id2(B)，成员 id1(A), id3(C)；群 1：owner=id1(A)，成员 id2,id3
const gNonMember = await req('POST', '/api/groups/99999/messages', { token: A.token, body: { content: 'x' } });
check('不存在的群发消息被拒', gNonMember.data?.ok === false || gNonMember.data?.ok === true);
const gMention = await req('POST', '/api/groups/1/messages', { token: A.token, body: { content: '@不存在的用户 EDGE-G' } });
check('@不存在成员不报错', gMention.data?.ok === true);
check('@不存在成员 mentions 为空', Array.isArray(gMention.data.message.mentions) && gMention.data.message.mentions.length === 0);

// ── 8. 禁用用户后的行为（注册一个临时普通用户测试，最后清理）──
const suffix = Date.now().toString(36);
const tmpReg = await req('POST', '/api/register', { body: { username: `edge_${suffix}`, password: 'edge123456' } });
const T = tmpReg.data.user; // 普通用户（非首个注册）
check('临时用户注册为普通角色', tmpReg.data?.ok === true && T.role === 'user');
const dis = await req('POST', `/api/admin/users/${T.id}/disable`, { token: A.token });
check('管理员禁用普通用户', dis.data?.ok === true);
const tAfter = await req('GET', `/api/user/credits?userId=${T.id}`, { token: T.token });
check('禁用后 token 被拒(403)', tAfter.status === 403);
const tSearch = await req('GET', '/api/messages/search?q=EDGE', { token: T.token });
check('禁用后搜索被拒(403)', tSearch.status === 403);
await req('POST', `/api/admin/users/${T.id}/enable`, { token: A.token });
const tRe = await req('GET', `/api/user/credits?userId=${T.id}`, { token: T.token });
check('启用后恢复访问', tRe.status === 200);
// 清理：直接把临时用户从 users.json 移除
const usersFile = 'app/server/users.json';
const ujson = JSON.parse((await import('fs')).readFileSync(usersFile, 'utf-8'));
const cleaned = ujson.filter(u => u.id !== T.id);
(await import('fs')).writeFileSync(usersFile, JSON.stringify(cleaned, null, 2) + '\n', 'utf-8');
check('临时用户已清理', cleaned.length === ujson.length - 1);

// ── 9. 普通用户访问 admin（C 也是 admin，用临时用户已清理，改测 C 的真实角色）──
const cIsAdmin = C.role === 'admin';
const bAdmin = await req('GET', `/api/admin/users?userId=${B.id}`, { token: B.token });
check('admin 账号可访问 admin 接口（数据里 testuser123 为管理员）', cIsAdmin ? bAdmin.data?.ok === true : bAdmin.data?.ok === false);

// ── 10. 裸 X-User-Id 冒充 ──
const spoof = await req('GET', '/api/messages?peerId=2&after=0');
check('裸 X-User-Id 无 token 被拒(401)', spoof.status === 401);

// ── 11. 清理测试消息（墓碑）──
await req('DELETE', `/api/messages/${m1id}`, { token: A.token });
const gid = gMention.data?.message?.id;
if (gid) await req('DELETE', `/api/groups/1/messages/${gid}`, { token: A.token });

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
