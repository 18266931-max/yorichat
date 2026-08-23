// Tang People Chat API 冒烟测试：验证 bug 修复后的关键行为
// 运行前提：服务器以独立 DATA_DIR（临时副本）启动，BASE_URL 指向该服务器
import { readFileSync } from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:3002';
const DATA_DIR = process.env.DATA_DIR || '';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

const suffix = Date.now().toString(36);
const userA = `smokeA_${suffix}`;
const userB = `smokeB_${suffix}`;
const userC = `smokeC_${suffix}`;
const pw = 'secret123';

console.log('== 1. 部署与公开端点 ==');
const root = await fetch(BASE + '/');
check('生产服务器托管前端 (GET / → 200 HTML)', root.status === 200, `status=${root.status}`);
const rootHtml = await root.text();
check('前端 HTML 含 root 挂载点', rootHtml.includes('<div id="root">'));

const h = await req('GET', '/api/health');
check('health 公开可达', h.status === 200 && h.data.ok === true);

const market = await req('GET', '/api/market');
check('market 公开浏览', market.status === 200 && market.data.ok === true);

console.log('== 2. 鉴权（token 必需，冒充被拒）==');
const noAuth = await req('GET', '/api/friends');
check('无 token 访问受保护接口 → 401', noAuth.status === 401);

const fake = await req('GET', '/api/friends', { token: 'tpc.1.deadbeef' });
check('伪造 token → 401', fake.status === 401);

const spoof = await fetch(BASE + '/api/messages?peerId=2&after=0', { headers: { 'X-User-Id': '1' } });
check('裸 X-User-Id 冒充 → 401', spoof.status === 401);

console.log('== 3. 注册 / 登录 / 密码 ==');
const regA = await req('POST', '/api/register', { body: { username: userA, password: pw } });
check('注册 A 成功并返回 token', regA.status === 200 && regA.data?.ok === true && !!regA.data.user.token);
const tokenA = regA.data.user.token;

const regB = await req('POST', '/api/register', { body: { username: userB, password: pw } });
check('注册 B 成功', regB.status === 200 && regB.data?.ok === true && !!regB.data.user.token);
const tokenB = regB.data.user.token;

const badLogin = await req('POST', '/api/login', { body: { username: userA, password: 'wrongpw1' } });
check('错误密码登录被拒', badLogin.data?.ok === false);

const login = await req('POST', '/api/login', { body: { username: userA, password: pw } });
check('正确密码登录成功', login.data?.ok === true && !!login.data.user.token);
check('登录响应不含密码字段', login.data.user.password === undefined);

const legacyLogin = await req('POST', '/api/login', { body: { username: 'testuser456', password: '123456' } });
check('旧明文账号可登录', legacyLogin.data?.ok === true);
if (DATA_DIR) {
  const usersJson = JSON.parse(readFileSync(DATA_DIR + '/users.json', 'utf-8'));
  const migrated = usersJson.find(u => u.username === 'testuser456');
  check('明文密码已迁移为 scrypt 哈希', migrated && migrated.password.startsWith('scrypt$'));
}

console.log('== 4. 转账（NaN/负数/自己/超余额）==');
const selfTransfer = await req('POST', '/api/transfer', { token: tokenA, body: { targetId: regA.data.user.id, amount: 5 } });
check('给自己转账被拒', selfTransfer.data?.ok === false);
const nanTransfer = await req('POST', '/api/transfer', { token: tokenA, body: { targetId: regB.data.user.id, amount: 'abc' } });
check('NaN 金额被拒', nanTransfer.data?.ok === false);
const negTransfer = await req('POST', '/api/transfer', { token: tokenA, body: { targetId: regB.data.user.id, amount: -10 } });
check('负数金额被拒', negTransfer.data?.ok === false);
const okTransfer = await req('POST', '/api/transfer', { token: tokenA, body: { targetId: regB.data.user.id, amount: 20 } });
check('正常转账成功且扣减正确', okTransfer.data?.ok === true && okTransfer.data.credits === 80);
const overTransfer = await req('POST', '/api/transfer', { token: tokenA, body: { targetId: regB.data.user.id, amount: 99999 } });
check('余额不足被拒', overTransfer.data?.ok === false);

console.log('== 5. 红包 ==');
const rp1 = await req('POST', '/api/redpackets/send', { token: tokenA, body: { receiverId: regB.data.user.id, amount: 10, count: 2.5 } });
check('count 小数被拒', rp1.data?.ok === false);
const rp2 = await req('POST', '/api/redpackets/send', { token: tokenA, body: { receiverId: regB.data.user.id, amount: 3, count: 5 } });
check('金额<数量被拒', rp2.data?.ok === false);
const rp3 = await req('POST', '/api/redpackets/send', { token: tokenA, body: { receiverId: regB.data.user.id, amount: 10, count: 3 } });
check('单聊红包 count 收敛为 1（防资金锁死）', rp3.data?.ok === true && rp3.data.redpacket.count === 1 && rp3.data.redpacket.remainder === 0);
const rpId = rp3.data.redpacket.id;
const claim = await req('POST', '/api/redpackets/claim', { token: tokenB, body: { redpacketId: rpId } });
check('单聊红包领取全额 10', claim.data?.ok === true && claim.data.amount === 10);
const claim2 = await req('POST', '/api/redpackets/claim', { token: tokenB, body: { redpacketId: rpId } });
check('重复领取被拒', claim2.data?.ok === false);

const g = await req('POST', '/api/groups/create', { token: tokenA, body: { name: 'smoke-group', memberIds: [regB.data.user.id] } });
check('建群成功', g.data?.ok === true);
const groupId = g.data.group.id;
const bAdd = await req('POST', `/api/groups/${groupId}/members`, { token: tokenB, body: { memberIds: [regA.data.user.id] } });
check('非群主拉人被拒', bAdd.data?.ok === false);

const grpRp = await req('POST', '/api/redpackets/send', { token: tokenA, body: { groupId, amount: 32, count: 3 } });
check('群红包发送（perAmount=10, remainder=2）', grpRp.data?.ok === true && grpRp.data.redpacket.perAmount === 10 && grpRp.data.redpacket.remainder === 2);
const selfClaim = await req('POST', '/api/redpackets/claim', { token: tokenA, body: { redpacketId: grpRp.data.redpacket.id } });
check('群红包自抢被拒', selfClaim.data?.ok === false);
const grpClaim = await req('POST', '/api/redpackets/claim', { token: tokenB, body: { redpacketId: grpRp.data.redpacket.id } });
check('B 抢群红包成功', grpClaim.data?.ok === true);

console.log('== 6. 市场 / 购物车 ==');
const pub = await req('POST', '/api/market/publish', { token: tokenA, body: { title: 'smoke-item', description: 'd', price: 'abc' } });
check('NaN 价格被拒', pub.data?.ok === false);
const pub2 = await req('POST', '/api/market/publish', { token: tokenA, body: { title: 'smoke-item', description: 'd', price: 50 } });
check('发布商品成功', pub2.data?.ok === true);
const itemId = pub2.data.item.id;
const selfBuy = await req('POST', '/api/market/buy', { token: tokenA, body: { itemId } });
check('不能买自己的商品', selfBuy.data?.ok === false);
const buy = await req('POST', '/api/market/buy', { token: tokenB, body: { itemId } });
check('B 购买成功', buy.data?.ok === true);
const ordersB = await req('GET', '/api/market/orders', { token: tokenB });
const theOrder = (ordersB.data.orders || []).find(o => o.itemId === itemId);
check('订单含 sellerEarning/tax', theOrder && theOrder.sellerEarning === 40 && theOrder.tax === 10);
const buy2 = await req('POST', '/api/market/buy', { token: tokenB, body: { itemId } });
check('重复购买被拒', buy2.data?.ok === false);

const pub3 = await req('POST', '/api/market/publish', { token: tokenA, body: { title: 'smoke-item2', description: 'd', price: 10 } });
const itemId2 = pub3.data.item.id;
await req('POST', '/api/cart/add', { token: tokenB, body: { itemId: itemId2 } });
const checkout = await req('POST', '/api/cart/checkout', { token: tokenB });
check('购物车结算成功', checkout.data?.ok === true && checkout.data.results.some(r => r.status === 'ok'));

console.log('== 7. 好友 / 资料 ==');
const addF = await req('POST', '/api/friends/add', { token: tokenA, body: { friendId: regB.data.user.id } });
check('加好友成功', addF.data?.ok === true);
const delF = await req('DELETE', `/api/friends/${regB.data.user.id}?userId=${regA.data.user.id}`, { token: tokenA });
check('删除好友成功（apiDelete 带 userId）', delF.data?.ok === true);
const prof = await req('PUT', '/api/user/profile', { token: tokenA, body: { nickname: 'smoke-nick' } });
check('资料更新 PUT 成功', prof.data?.ok === true && prof.data.user.nickname === 'smoke-nick');

console.log('== 8. 管理 / 禁用 ==');
const adminLogin = await req('POST', '/api/login', { body: { username: 'admin', password: 'admin123' } });
check('内置 admin 登录成功', adminLogin.data?.ok === true);
const adminToken = adminLogin.data.user.token;
const dis = await req('POST', `/api/admin/users/${regB.data.user.id}/disable`, { token: adminToken });
check('管理员禁用 B', dis.data?.ok === true);
const bAfter = await req('GET', '/api/user/credits?userId=' + regB.data.user.id, { token: tokenB });
check('禁用用户被中间件拦截 (403)', bAfter.status === 403);
const bLogin = await req('POST', '/api/login', { body: { username: userB, password: pw } });
check('禁用用户无法登录', bLogin.data?.ok === false);

const regC = await req('POST', '/api/register', { body: { username: userC, password: pw } });
const cNoAdmin = await req('GET', '/api/admin/stats?userId=' + regC.data.user.id, { token: regC.data.user.token });
check('非管理员访问 admin API 被拒', cNoAdmin.data?.ok === false);

console.log('== 9. 消息 ==');
const msg = await req('POST', '/api/messages/send', { token: tokenA, body: { receiverId: regC.data.user.id, content: 'hello smoke' } });
check('发消息成功', msg.data?.ok === true);
const poll = await req('GET', '/api/messages?peerId=' + regC.data.user.id + '&after=0', { token: tokenA });
check('增量拉取消息', poll.data?.ok === true && poll.data.messages.length > 0);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
