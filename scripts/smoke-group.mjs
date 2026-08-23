// 批次2 冒烟：群聊 引用 / 撤回 / 单删 / @提及
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
const GROUP = 1;
const tA = admin.token, tB = u2.token;

// 1. A 发群消息 @testuser123
const s1 = await req('POST', `/api/groups/${GROUP}/messages`, { token: tA, body: { content: '@testuser123 冒烟提及 SMOKE-G1' } });
check('群消息发送成功', s1.data?.ok === true);
const g1 = s1.data.message.id;
check('群消息提及解析出 B', Array.isArray(s1.data.message.mentions) && s1.data.message.mentions.includes(u2.id));

// 2. B 拉取群消息 → mentionedMe=true
const gotB = await req('GET', `/api/groups/${GROUP}/messages?after=0`, { token: tB });
const mB = gotB.data.messages.find(m => m.id === g1);
check('B 视角 mentionedMe=true', mB && mB.mentionedMe === true);
const gotA = await req('GET', `/api/groups/${GROUP}/messages?after=0`, { token: tA });
const mA = gotA.data.messages.find(m => m.id === g1);
check('A 视角 mentionedMe=false', mA && mA.mentionedMe === false);

// 3. B 引用回复 g1
const s2 = await req('POST', `/api/groups/${GROUP}/messages`, { token: tB, body: { content: '群引用回复', replyToId: g1 } });
check('群引用回复成功', s2.data?.ok === true && s2.data.message.replyToId === g1);
const g2 = s2.data.message.id;

// 4. GET 带 replyTo 预览
const gotA2 = await req('GET', `/api/groups/${GROUP}/messages?after=0`, { token: tA });
const m2 = gotA2.data.messages.find(m => m.id === g2);
check('群消息含引用预览', m2 && m2.replyTo && m2.replyTo.content.includes('SMOKE-G1'));

// 5. 群主 A 删 B 的消息 g2 → 允许
const delOwner = await req('DELETE', `/api/groups/${GROUP}/messages/${g2}`, { token: tA });
check('群主可删任意消息', delOwner.data?.ok === true);

// 6. 非群主 B 撤回 A 的消息 g1 → 拒绝
const rBad = await req('POST', `/api/groups/${GROUP}/messages/${g1}/recall`, { token: tB });
check('非发送者撤回被拒', rBad.data?.ok === false);
// B 删自己的…g1 是 A 的，B 删 A 的 → 拒绝
const dBad = await req('DELETE', `/api/groups/${GROUP}/messages/${g1}`, { token: tB });
check('非群主删他人消息被拒', dBad.data?.ok === false);

// 7. A 撤回自己的 g1
const r1 = await req('POST', `/api/groups/${GROUP}/messages/${g1}/recall`, { token: tA });
check('发送者撤回群消息成功', r1.data?.ok === true);
const gotA3 = await req('GET', `/api/groups/${GROUP}/messages?after=0`, { token: tA });
check('群消息 recalled 生效', gotA3.data.messages.find(m => m.id === g1)?.recalled === true);

// 8. 清理：A 删掉已撤回的 g1
await req('DELETE', `/api/groups/${GROUP}/messages/${g1}`, { token: tA });

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
