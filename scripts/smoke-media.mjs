// 批次3 冒烟：文件上传 + 图片/文件消息
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

// 1. 上传一个 1x1 PNG（base64）
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const up = await req('POST', '/api/files/upload', { token: tA, body: { fileName: '测试图片.png', mime: 'image/png', data: pngB64 } });
check('上传图片成功', up.data?.ok === true && !!up.data.url);
const fileUrl = up.data.url;
check('返回文件名与大小', up.data.fileName.includes('测试图片') && up.data.size > 0);

// 2. 恶意文件名净化（路径穿越）
const badUp = await req('POST', '/api/files/upload', { token: tA, body: { fileName: '../../evil.txt', mime: 'text/plain', data: Buffer.from('x').toString('base64') } });
check('非法文件名被净化', badUp.data?.ok === true && !badUp.data.url.includes('..'));

// 3. 超大文件拒绝（9MB base64）
const big = Buffer.alloc(9 * 1024 * 1024, 1).toString('base64');
const bigUp = await req('POST', '/api/files/upload', { token: tA, body: { fileName: 'big.bin', mime: 'application/octet-stream', data: big } });
check('超大文件被拒', bigUp.data?.ok === false);

// 4. 未登录上传拒绝
const noAuth = await req('POST', '/api/files/upload', { body: { fileName: 'a.txt', data: 'eA==' } });
check('未登录上传被拒(401)', noAuth.status === 401);

// 5. 发图片私聊消息
const sImg = await req('POST', '/api/messages/send', { token: tA, body: { receiverId: B, content: '测试图片.png', type: 'image', fileUrl, fileName: '测试图片.png', fileSize: 86 } });
check('图片消息发送成功', sImg.data?.ok === true && sImg.data.message.type === 'image');
const imgId = sImg.data.message.id;

// 6. 发文件群消息
const sFile = await req('POST', '/api/groups/1/messages', { token: tB, body: { content: '文档.pdf', type: 'file', fileUrl: '/uploads/xx.pdf', fileName: '文档.pdf', fileSize: 2048 } });
check('群文件消息发送成功', sFile.data?.ok === true && sFile.data.message.type === 'file');
const fileId = sFile.data.message.id;

// 7. 对方拉取能看到文件字段
const got = await req('GET', `/api/messages?peerId=${A}&after=0`, { token: tB });
const imgMsg = got.data.messages.find(m => m.id === imgId);
check('对方可见图片消息字段', imgMsg && imgMsg.fileUrl === fileUrl && imgMsg.fileName);
const gotG = await req('GET', '/api/groups/1/messages?after=0', { token: tA });
check('群文件消息字段完整', gotG.data.messages.find(m => m.id === fileId)?.fileUrl === '/uploads/xx.pdf');

// 8. 上传的文件可访问
const dl = await fetch(BASE + fileUrl);
check('上传文件可下载(200)', dl.status === 200);

// 9. 清理测试消息
await req('DELETE', `/api/messages/${imgId}`, { token: tA });
await req('DELETE', `/api/groups/1/messages/${fileId}`, { token: tA });

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
