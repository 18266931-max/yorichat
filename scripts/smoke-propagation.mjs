// 专项冒烟：撤回 / 删除 / 已读 变更同步（changedAfter 传播）
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

// 0. 获取当前双方最大消息 id，避免污染旧消息
const getMax = async (who, peer) => {
  const r = await req('GET', `/api/messages?peerId=${peer}&after=0`, { token: who });
  return r.data.messages.reduce((mx, m) => Math.max(mx, m.id), 0);
};
const startMax = Math.max(await getMax(tA, B), await getMax(tB, A));

// 1. A 发消息 → B 首次拉取（模拟 B 已看到）
const s1 = await req('POST', '/api/messages/send', { token: tA, body: { receiverId: B, content: 'PROP-RECALL-1' } });
check('A 发送消息', s1.data?.ok === true);
const m1 = s1.data.message.id;
const tSeen = Date.now(); // B "看到"该消息的时间点
const b1 = await req('GET', `/api/messages?peerId=${A}&after=0&changedAfter=${tSeen}`, { token: tB });
check('B 首次拉取可见原内容', b1.data.messages.some(m => m.id === m1 && m.content === 'PROP-RECALL-1'));

// 2. A 撤回 → B 增量拉取（after=m1 即 B 已见的 maxId，changedAfter 晚于 tSeen）→ 应收到 recalled
const r1 = await req('POST', `/api/messages/${m1}/recall`, { token: tA });
check('A 撤回成功', r1.data?.ok === true);
const b2 = await req('GET', `/api/messages?peerId=${A}&after=${m1}&changedAfter=${tSeen}`, { token: tB });
const rec = b2.data.changed.find(m => m.id === m1);
check('B 增量拉取收到撤回变更', rec && rec.recalled === true);
check('撤回后服务端内容已清空', rec && rec.content === '');
check('撤回消息不再作为新消息返回', !b2.data.messages.some(m => m.id === m1));

// 3. 删除传播：A 发 m2，B 看到，A 删除，B 增量拉取收到 deleted
const s2 = await req('POST', '/api/messages/send', { token: tA, body: { receiverId: B, content: 'PROP-DEL-1' } });
const m2 = s2.data.message.id;
const tSeen2 = Date.now();
await req('GET', `/api/messages?peerId=${A}&after=0&changedAfter=${tSeen2}`, { token: tB });
const d1 = await req('DELETE', `/api/messages/${m2}`, { token: tA });
check('A 删除成功', d1.data?.ok === true);
const b3 = await req('GET', `/api/messages?peerId=${A}&after=${m2}&changedAfter=${tSeen2}`, { token: tB });
const delMsg = b3.data.changed.find(m => m.id === m2);
check('B 增量拉取收到删除标记', delMsg && delMsg.deleted === true);
check('已删消息不再作为新消息返回', !b3.data.messages.some(m => m.id === m2));

// 4. 已读传播：B 标记已读 → A 增量拉取看到 read=true
const s3 = await req('POST', '/api/messages/send', { token: tA, body: { receiverId: B, content: 'PROP-READ-1' } });
const m3 = s3.data.message.id;
const tSeen3 = Date.now();
await req('GET', `/api/messages?peerId=${A}&after=0&changedAfter=${tSeen3}`, { token: tB });
const rd = await req('POST', '/api/messages/read', { token: tB, body: { peerId: A } });
check('B 标记已读 ok', rd.data?.ok === true);
const a1 = await req('GET', `/api/messages?peerId=${B}&after=${m3}&changedAfter=${tSeen3}`, { token: tA });
const readMsg = a1.data.changed.find(m => m.id === m3);
check('A 增量拉取看到 read=true（已读实时同步）', readMsg && readMsg.read === true);

// 5. 群聊撤回传播
const gs = await req('POST', '/api/groups/1/messages', { token: tA, body: { content: 'PROP-GROUP-RECALL' } });
check('群消息发送成功', gs.data?.ok === true);
const gm1 = gs.data.message.id;
const tSeenG = Date.now();
await req('GET', `/api/groups/1/messages?after=0&changedAfter=${tSeenG}`, { token: tB });
const gr = await req('POST', `/api/groups/1/messages/${gm1}/recall`, { token: tA });
check('群消息撤回成功', gr.data?.ok === true);
const gb = await req('GET', `/api/groups/1/messages?after=${gm1}&changedAfter=${tSeenG}`, { token: tB });
const gRec = gb.data.changed.find(m => m.id === gm1);
check('B 群增量拉取收到撤回变更', gRec && gRec.recalled === true);

// 6. 清理（删除墓碑）
await req('DELETE', `/api/messages/${m1}`, { token: tA });
await req('DELETE', `/api/messages/${m2}`, { token: tA });
await req('DELETE', `/api/messages/${m3}`, { token: tA });
await req('DELETE', `/api/groups/1/messages/${gm1}`, { token: tA });

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
