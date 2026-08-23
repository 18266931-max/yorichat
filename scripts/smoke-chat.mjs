// 批次1 冒烟：引用回复 / 已读 / 搜索 / 单条删除 / 撤回
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
const u2 = await login('testuser123', '123456');
const A = admin.id, B = u2.id, tA = admin.token, tB = u2.token;
console.log(`A=${A} B=${B}`);

// 1. A → B 发一条测试消息
const s1 = await req('POST', '/api/messages/send', { token: tA, body: { receiverId: B, content: 'SMOKE-REPLY-1' } });
check('A 发送消息', s1.data?.ok === true);
const m1 = s1.data.message.id;

// 2. B → A 引用回复 m1
const s2 = await req('POST', '/api/messages/send', { token: tB, body: { receiverId: A, content: '回复测试', replyToId: m1 } });
check('B 引用回复发送成功', s2.data?.ok === true && s2.data.message.replyToId === m1);
const m2 = s2.data.message.id;

// 3. 引用不存在的消息 → 拒绝
const sBad = await req('POST', '/api/messages/send', { token: tA, body: { receiverId: B, content: 'x', replyToId: 999999 } });
check('引用不存在的消息被拒', sBad.data?.ok === false);

// 4. A 拉取会话 → 消息带 replyTo 预览
const got = await req('GET', `/api/messages?peerId=${B}&after=0`, { token: tA });
const got2 = got.data.messages.find(m => m.id === m2);
check('GET 消息含 replyTo 预览', got2 && got2.replyTo && got2.replyTo.content === 'SMOKE-REPLY-1' && got2.replyTo.senderName);

// 5. 已读：B 标记与 A 的消息已读
const rd = await req('POST', '/api/messages/read', { token: tB, body: { peerId: A } });
check('已读上报 ok', rd.data?.ok === true);
const gotB = await req('GET', `/api/messages?peerId=${A}&after=0`, { token: tB });
const m1Read = gotB.data.messages.find(m => m.id === m1);
check('对方消息 read=true', m1Read && m1Read.read === true);

// 6. 搜索
const sr = await req('GET', `/api/messages/search?q=${encodeURIComponent('SMOKE-REPLY')}`, { token: tA });
check('搜索命中', sr.data?.ok === true && sr.data.results.length >= 1);
check('搜索结果含发送方信息', sr.data.results.some(r => r.peerId === B));

// 7. 撤回：B 撤回 A 的消息 → 拒绝
const rBad = await req('POST', `/api/messages/${m1}/recall`, { token: tB });
check('非发送者撤回被拒', rBad.data?.ok === false);
// A 撤回自己的 m1
const r1 = await req('POST', `/api/messages/${m1}/recall`, { token: tA });
check('发送者 5 分钟内可撤回', r1.data?.ok === true);
const r2 = await req('POST', `/api/messages/${m1}/recall`, { token: tA });
check('重复撤回被拒', r2.data?.ok === false);

// 8. 单条删除：A 删除 B 的 m2
const d1 = await req('DELETE', `/api/messages/${m2}`, { token: tA });
check('会话双方可删单条消息', d1.data?.ok === true);
const got3 = await req('GET', `/api/messages?peerId=${B}&after=0`, { token: tA });
check('删除后消息消失', got3.data.messages.every(m => m.id !== m2));

// 9. 清理：删除剩余的 m1（已撤回的那条）
await req('DELETE', `/api/messages/${m1}`, { token: tA });

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
