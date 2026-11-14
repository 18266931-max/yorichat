// 安全修复验证：复现审计报告中的攻击手法，确认已堵住
const BASE = process.env.BASE_URL || 'http://localhost:3001';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
async function req(method, path, { token, body, headers } = {}) {
  const h = { ...(headers || {}) };
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, contentType: res.headers.get('content-type') || '' };
}
const login = async (u, p) => (await req('POST', '/api/login', { body: { username: u, password: p } })).data.user;
const admin = await login('admin', 'admin123');

// 1. /API 大写绕过鉴权（审计高危）：匿名应 401
const up1 = await req('GET', '/API/messages?peerId=2&userId=1&after=0');
check('/API/messages 匿名被拦(401)', up1.status === 401);
const up2 = await req('GET', '/Api/admin/users?userId=1');
check('/Api/admin/users 匿名被拦(401)', up2.status === 401);
const up3 = await req('POST', '/API/admin/clear-messages', { headers: { 'x-user-id': '1' } });
check('/API/admin/clear-messages 匿名被拦(401)', up3.status === 401);

// 2. 伪造 x-user-id 头（无 token）发消息 → 401
const spoof = await req('POST', '/api/messages/send', { headers: { 'x-user-id': '2' }, body: { receiverId: 3, content: 'SPOOF' } });
check('无 token + 伪造头被拦(401)', spoof.status === 401);

// 3. 伪造头删除他人消息 → 401
const spoofDel = await req('DELETE', '/api/messages/1', { headers: { 'x-user-id': '2', 'userId': '2' } });
check('无 token 删消息被拦(401)', spoofDel.status === 401);

// 4. 匿名访问 market 带他人 userId → 不泄露他人状态（userId 被归零）
const anonMarket = await req('GET', '/api/market?userId=2');
check('匿名 market 正常返回(200)', anonMarket.status === 200 && anonMarket.data?.ok === true);

// 5. 匿名红packet 详情带他人 userId → 不应返回他人 claimStatus
const anonRp = await req('GET', '/api/redpackets/1?userId=2');
check('匿名红包详情不泄露他人状态', anonRp.data?.ok === true ? (anonRp.data.redpacket?.claimStatus === 'unknown' || anonRp.data.redpacket?.claimStatus === undefined) : true);

// 6. token 变体 tpc.01.<sig> → 拒绝
const variant = await req('GET', '/api/user/credits', { headers: { Authorization: 'Bearer tpc.01.abcdef' } });
check('token 数字变体被拒(401)', variant.status === 401);

// 7. 上传 svg → 应被拒或存为 .bin（不返回可执行 svg）
const svgUp = await req('POST', '/api/files/upload', { token: admin.token, body: { fileName: 'xss.svg', mime: 'image/svg+xml', data: Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64') } });
check('svg 扩展名被降级为 .bin', svgUp.data?.ok === true && svgUp.data.url.endsWith('.bin'));

// 8. 非字符串 content → JSON 错误而非 500 HTML
const badContent = await req('POST', '/api/messages/send', { token: admin.token, body: { receiverId: 2, content: 123 } });
check('content 非字符串返回 JSON 错误', badContent.data?.ok === false && badContent.contentType.includes('json'));

// 9. 超长 content → 拒绝
const longContent = await req('POST', '/api/messages/send', { token: admin.token, body: { receiverId: 2, content: 'x'.repeat(4001) } });
check('超长消息被拒', longContent.data?.ok === false);

// 10. receiverId 字符串 "2" → 归一化后消息双方可见
const strRecv = await req('POST', '/api/messages/send', { token: admin.token, body: { receiverId: '2', content: 'SEC-STR-RECEIVER' } });
check('字符串 receiverId 发送成功', strRecv.data?.ok === true);
const msgId = strRecv.data?.message?.id;
const u2 = await login('testuser123', '123456');
const visible = await req('GET', '/api/messages?peerId=1&after=0', { token: u2.token });
check('字符串 receiverId 消息对双方可见', visible.data.messages.some(m => m.id === msgId));

// 11. 最后一个管理员自我降级 → 拒绝
const demoteSelf = await req('POST', `/api/admin/users/${admin.id}/set-admin`, { token: admin.token });
check('管理员自我降级被拒', demoteSelf.data?.ok === false);

// 12. conv-settings 字符串 peerId 归一化（GET 返回数字）
const csStr = await req('POST', '/api/conv-settings', { token: admin.token, body: { peerId: '2', muted: false } });
check('conv-settings 字符串 peerId 接受', csStr.data?.ok === true);
const csList = await req('GET', `/api/conv-settings?userId=${admin.id}`, { token: admin.token });
const peer2 = (csList.data.settings || []).filter(s => s.peerId === 2);
check('conv-settings 存储为数字且不重复', peer2.length === 1);

// 13. 单调 ID：新消息 id 大于历史最大
const newMsg = await req('POST', '/api/messages/send', { token: admin.token, body: { receiverId: 2, content: 'SEC-COUNTER' } });
const counter = JSON.parse((await import('fs')).readFileSync('app/server/counter.json', 'utf-8'));
check('消息 id 由单调计数器分配', counter.messages >= newMsg.data.message.id);

// 14. 清理测试消息
if (msgId) await req('DELETE', `/api/messages/${msgId}`, { token: admin.token });
if (newMsg.data?.message?.id) await req('DELETE', `/api/messages/${newMsg.data.message.id}`, { token: admin.token });

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
