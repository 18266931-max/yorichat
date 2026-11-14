import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from 'fs';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' })); // 容纳 base64 文件上传（业务层仍限制 8MB）

// 数据目录：默认本文件所在目录（server/），可用环境变量 DATA_DIR 覆盖
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : __dirname;

const USERS_FILE = join(DATA_DIR, 'users.json');
const FRIENDS_FILE = join(DATA_DIR, 'friends.json');
const MESSAGES_FILE = join(DATA_DIR, 'messages.json');
const BLOCKS_FILE = join(DATA_DIR, 'blocks.json');
const ITEMS_FILE = join(DATA_DIR, 'items.json');
const ORDERS_FILE = join(DATA_DIR, 'orders.json');
const CART_FILE = join(DATA_DIR, 'cart.json');
const RATINGS_FILE = join(DATA_DIR, 'ratings.json');
const TRANSFERS_FILE = join(DATA_DIR, 'transfers.json');
const CATEGORIES_FILE = join(DATA_DIR, 'categories.json');
const REDPACKETS_FILE = join(DATA_DIR, 'redpackets.json');
const GROUPS_FILE = join(DATA_DIR, 'groups.json');
const GROUP_MEMBERS_FILE = join(DATA_DIR, 'group_members.json');
const GROUP_MESSAGES_FILE = join(DATA_DIR, 'group_messages.json');
const CONV_SETTINGS_FILE = join(DATA_DIR, 'conv_settings.json');
const COUNTER_FILE = join(DATA_DIR, 'counter.json');

/* ─── 单调递增 ID 计数器 ───
   避免"全表 max+1"在最高 id 被物理删除后回退：消息会永不投递，商品/订单会因 id 复用出现幽灵"已购买"记录 */
const ID_KEYS = ['messages', 'groupMessages', 'items', 'orders', 'redpackets', 'transfers', 'ratings', 'categories', 'users', 'groups'];
let idCounter = Object.fromEntries(ID_KEYS.map(k => [k, 0]));
try {
  if (existsSync(COUNTER_FILE)) {
    const saved = JSON.parse(readFileSync(COUNTER_FILE, 'utf-8')) || {};
    for (const k of ID_KEYS) if (typeof saved[k] === 'number') idCounter[k] = saved[k];
  }
} catch { idCounter = Object.fromEntries(ID_KEYS.map(k => [k, 0])); }

function saveCounter() {
  writeFileSync(COUNTER_FILE, JSON.stringify(idCounter), 'utf-8');
}

function initCounter() {
  try {
    const seeds = {
      messages: MESSAGES_FILE,
      groupMessages: GROUP_MESSAGES_FILE,
      items: ITEMS_FILE,
      orders: ORDERS_FILE,
      redpackets: REDPACKETS_FILE,
      transfers: TRANSFERS_FILE,
      ratings: RATINGS_FILE,
      categories: CATEGORIES_FILE,
      users: USERS_FILE,
      groups: GROUPS_FILE,
    };
    for (const [key, file] of Object.entries(seeds)) {
      const maxId = readJSON(file).reduce((m, x) => Math.max(m, x.id || 0), 0);
      idCounter[key] = Math.max(idCounter[key] || 0, maxId);
    }
    // 商品 id 还要避开历史订单/评价/购物车引用的 itemId，否则新商品会与旧订单"撞号"
    const refMax = [
      ...readJSON(ORDERS_FILE).map(o => o.itemId || 0),
      ...readJSON(RATINGS_FILE).map(r => r.itemId || 0),
      ...readJSON(CART_FILE).map(c => c.itemId || 0),
    ].reduce((m, x) => Math.max(m, x), 0);
    idCounter.items = Math.max(idCounter.items || 0, refMax);
    saveCounter();
  } catch (err) {
    console.error(`[counter] 初始化失败: ${err.message}`);
  }
}

// 通用单调 ID 分配
function allocId(key) {
  idCounter[key] = (idCounter[key] || 0) + 1;
  saveCounter();
  return idCounter[key];
}

function nextMessageId() { return allocId('messages'); }
function nextGroupMessageId() { return allocId('groupMessages'); }

// ─── 文件上传（base64 JSON 方式，无额外依赖）───
const UPLOADS_DIR = join(DATA_DIR, 'uploads');
try { mkdirSync(UPLOADS_DIR, { recursive: true }); } catch {}
// 注意：不含 svg（同源存储型 XSS 风险）
const ALLOWED_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp','txt','pdf','doc','docx','xls','xlsx','ppt','pptx','zip','rar','7z','tar','gz','mp3','mp4','webm','mov','json','csv','md']);
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp']);
// 静态托管：加 nosniff；非图片强制下载，避免 HTML/SVG 类内容在同源内被解析执行
app.use('/uploads', (req, res, next) => {
  const ext = (req.path.match(/\.([A-Za-z0-9]+)$/) || [])[1];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!ext || !IMAGE_EXTS.has(ext.toLowerCase())) {
    res.setHeader('Content-Disposition', 'attachment');
  }
  next();
}, express.static(UPLOADS_DIR));

// 税率：卖家获得 80%
const SELLER_RATE = 0.8;

function readJSON(file) {
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    // 数据文件损坏：先备份为 .corrupt-<时间戳> 保全数据，再以空数据继续（不让整个服务崩溃）
    console.error(`[readJSON] 解析失败 ${file}: ${err.message}`);
    try {
      const backup = `${file}.corrupt-${Date.now()}`;
      renameSync(file, backup);
      console.error(`[readJSON] 已备份损坏文件到 ${backup}`);
    } catch (e2) {
      console.error(`[readJSON] 备份失败: ${e2.message}`);
    }
    return [];
  }
}
function writeJSON(file, data) {
  // 原子写：先写临时文件再重命名（Windows rename 会覆盖目标），失败则抛出由上层处理
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, file);
}

// 给消息列表附加红包状态（active / claimed / expired / my_claimed）
function attachRedpacketStatus(messages, userId) {
  if (!messages.some(m => m.type === 'redpacket')) return messages;
  const redpackets = readJSON(REDPACKETS_FILE);
  return messages.map(m => {
    if (m.type !== 'redpacket' || !m.redpacketId) return m;
    const rp = redpackets.find(r => r.id === m.redpacketId);
    if (!rp) return { ...m, redpacketStatus: 'expired' };
    let redpacketStatus = rp.status; // active | claimed
    if (rp.status === 'active' && Array.isArray(rp.claims) && rp.claims.some(c => c.userId === userId)) {
      redpacketStatus = 'my_claimed';
    }
    return { ...m, redpacketStatus };
  });
}

let users = readJSON(USERS_FILE);
// 用户 id 由单调计数器分配（见 nextId）

/* ═══════════════════════════════════════
   密码哈希（scrypt，兼容旧明文自动迁移）
   ═══════════════════════════════════════ */
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const [, salt, hash] = parts;
    try {
      const test = scryptSync(String(password), salt, 64);
      const expected = Buffer.from(hash, 'hex');
      if (test.length !== expected.length) return false;
      return timingSafeEqual(test, expected);
    } catch { return false; }
  }
  // 旧数据：明文密码（首次登录成功后会自动升级为哈希）
  return stored === password;
}

/* ═══════════════════════════════════════
   登录令牌：HMAC-SHA256 签名（tpc.<userId>.<sig>）
   密钥持久化到 DATA_DIR/.secret，重启后令牌仍有效
   ═══════════════════════════════════════ */
const SECRET_FILE = join(DATA_DIR, '.secret');
function loadSecret() {
  try {
    if (existsSync(SECRET_FILE)) {
      const s = readFileSync(SECRET_FILE, 'utf-8').trim();
      if (s.length >= 32) return s;
    }
  } catch {}
  const s = randomBytes(32).toString('hex');
  try { writeFileSync(SECRET_FILE, s, 'utf-8'); } catch {}
  return s;
}
const SECRET = loadSecret();

function signToken(userId) {
  const sig = createHmac('sha256', SECRET).update(String(userId)).digest('hex');
  return `tpc.${userId}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return 0;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'tpc') return 0;
  // 严格数字解析：拒绝 "01" 这类变体
  if (!/^\d+$/.test(parts[1])) return 0;
  const uid = Number(parts[1]);
  if (!uid) return 0;
  const expected = createHmac('sha256', SECRET).update(String(uid)).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length) return 0;
  return timingSafeEqual(a, b) ? uid : 0;
}

// 给前端返回的用户对象：剥离密码、附带令牌
function publicUser(user) {
  const { password: _, ...rest } = user;
  return { ...rest, token: signToken(user.id) };
}

/* ═══════════════════════════════════════
   全局鉴权中间件
   - 公开端点：register / login / health / categories / ratings详情 / redpacket详情 / market浏览
   - 其余端点必须携带有效 Bearer token；
   - 校验通过后把可信 userId 注入 req.headers['x-user-id'] 与 req.query.userId，
     handler 无需改动即可拿到校验过的身份；
   - 禁用用户一律拒绝（403）。
   ═══════════════════════════════════════ */
app.use((req, res, next) => {
  // 身份只信任中间件注入：先剥掉客户端自带的伪造头
  delete req.headers['x-user-id'];

  // 大小写不敏感匹配 /api（Express 路由默认大小写不敏感，避免 /API/... 绕过鉴权）
  if (!/^\/api(\/|$)/i.test(req.path)) return next();
  const p = req.path.slice(4); // 去掉 /api 前缀
  const method = req.method;

  const isPublic = (method === 'POST' && (p === '/register' || p === '/login'))
    || (method === 'GET' && (
      p === '/health'
      || p === '/version'
      || p === '/categories'
      || p === '/market'
      || /^\/ratings\/\d+$/.test(p)
      || /^\/redpackets\/\d+$/.test(p)
    ));

  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const uid = verifyToken(token);

  if (!isPublic) {
    if (!uid) return res.status(401).json({ ok: false, msg: '未登录或登录已过期，请重新登录' });
    const u = readJSON(USERS_FILE).find(x => x.id === uid);
    if (!u) return res.status(401).json({ ok: false, msg: '用户不存在' });
    if (u.disabled) return res.status(403).json({ ok: false, msg: '该账号已被禁用，请联系管理员' });
    injectIdentity(req, uid);
    req.user = u;
    return next();
  }

  // 公开端点：若带了有效 token 也注入身份（用于 market 的 bought、redpacket 的 claimStatus 等）；
  // 无 token 时把 userId 归零，避免匿名查询他人私有状态
  if (uid) injectIdentity(req, uid);
  else {
    const q = Object.assign({}, req.query, { userId: '0' });
    Object.defineProperty(req, 'query', { value: q, enumerable: true, configurable: true, writable: true });
  }
  next();
});

// 统一 JSON 错误处理（避免 HTML 错误页 + 堆栈泄露）
app.use((err, req, res, next) => {
  console.error('[error]', err && err.message);
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, msg: '请求体过大' });
  }
  res.status(500).json({ ok: false, msg: '服务器内部错误' });
});

function injectIdentity(req, userId) {
  req.headers['x-user-id'] = String(userId);
  // Express 的 req.query 是惰性 getter，覆盖为注入后的快照以保证 handler 读到可信 userId
  const q = Object.assign({}, req.query, { userId: String(userId) });
  Object.defineProperty(req, 'query', { value: q, enumerable: true, configurable: true, writable: true });
}

// 文件上传（必须在鉴权中间件之后注册）
app.post('/api/files/upload', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { fileName, mime, data } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!data) return res.json({ ok: false, msg: '缺少文件数据' });

  // 严格 base64 校验（Node 的 Buffer.from 会宽容忽略非法字符，需自行验证）
  const b64 = String(data).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0 || b64.length === 0) {
    return res.json({ ok: false, msg: '文件数据无效' });
  }

  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return res.json({ ok: false, msg: '文件数据无效' }); }
  if (!buf || buf.length === 0) return res.json({ ok: false, msg: '文件为空' });
  if (buf.length > 8 * 1024 * 1024) return res.json({ ok: false, msg: '文件不能超过 8MB' });

  // 文件名净化：去非法字符、限制长度
  const safeName = (String(fileName || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80)) || 'file';
  const extMatch = /\.([A-Za-z0-9]+)$/.exec(safeName);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'bin';
  const stored = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ALLOWED_EXTS.has(ext) ? ext : 'bin'}`;

  writeFileSync(join(UPLOADS_DIR, stored), buf);
  res.json({ ok: true, url: '/uploads/' + stored, fileName: safeName, mime: mime || 'application/octet-stream', size: buf.length });
});

// ─── Auth APIs ───

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, msg: '请填写用户名和密码' });
  if (typeof username !== 'string' || username.trim().length < 2) return res.json({ ok: false, msg: '用户名至少2个字符' });
  if (username.trim().length > 20) return res.json({ ok: false, msg: '用户名不能超过20个字符' });
  if (typeof password !== 'string' || password.length < 6) return res.json({ ok: false, msg: '密码至少6个字符' });

  users = readJSON(USERS_FILE);
  if (users.find(u => u.username === username.trim())) {
    return res.json({ ok: false, msg: '用户名已存在' });
  }

  // 首个注册用户自动成为超级管理员（避免无种子管理员）
  const isFirstUser = users.length === 0;
  const newUser = {
    id: allocId('users'),
    username: username.trim(),
    password: hashPassword(password),
    nickname: username.trim(),
    role: isFirstUser ? ROLE_SUPER : 'user',
    credits: 100,
    disabled: false,
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  writeJSON(USERS_FILE, users);

  res.json({ ok: true, user: publicUser(newUser) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, msg: '请填写用户名和密码' });

  users = readJSON(USERS_FILE);
  const user = users.find(u => u.username === username);
  if (!user || !verifyPassword(password, user.password)) {
    return res.json({ ok: false, msg: '用户名或密码错误' });
  }
  if (user.disabled) return res.json({ ok: false, msg: '该账号已被禁用，请联系管理员' });

  // 旧明文密码 → 登录成功后自动升级为哈希存储
  if (!user.password.startsWith('scrypt$')) {
    user.password = hashPassword(password);
    writeJSON(USERS_FILE, users);
  }

  res.json({ ok: true, user: publicUser(user) });
});

// ─── Friend APIs ───

app.get('/api/users/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ ok: false, msg: '请输入搜索内容' });

  users = readJSON(USERS_FILE);
  const results = users
    .filter(u => u.username.toLowerCase().includes(q.toLowerCase()))
    .map(u => ({ id: u.id, username: u.username, nickname: u.nickname }));
  res.json({ ok: true, users: results });
});

app.post('/api/friends/add', (req, res) => {
  const { friendId } = req.body;
  const userId = parseInt(req.headers['x-user-id']) || 0;
  if (!friendId) return res.json({ ok: false, msg: '缺少参数' });
  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (userId === friendId) return res.json({ ok: false, msg: '不能加自己' });

  let friends = readJSON(FRIENDS_FILE);
  const exists = friends.some(
    f => (f.userId === userId && f.friendId === friendId) || (f.userId === friendId && f.friendId === userId)
  );
  if (exists) return res.json({ ok: false, msg: '已经是好友' });

  friends.push({ userId, friendId, addedBy: userId, confirmed: false });
  friends.push({ userId: friendId, friendId: userId, addedBy: userId, confirmed: false });
  writeJSON(FRIENDS_FILE, friends);
  res.json({ ok: true });
});

app.get('/api/friends', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: true, friends: [] });

  let friends = readJSON(FRIENDS_FILE);
  users = readJSON(USERS_FILE);

  const friendIds = friends
    .filter(f => f.userId === userId)
    .map(f => f.friendId);

  const result = users
    .filter(u => friendIds.includes(u.id))
    .map(u => {
      const rel = friends.find(f => f.userId === userId && f.friendId === u.id);
      return { id: u.id, username: u.username, nickname: u.nickname, addedBy: rel?.addedBy || null, confirmed: !!rel?.confirmed };
    });
  res.json({ ok: true, friends: result });
});

app.delete('/api/friends/:friendId', (req, res) => {
  const friendId = parseInt(req.params.friendId);
  const userId = parseInt(req.query.userId) || 0;

  let friends = readJSON(FRIENDS_FILE);
  friends = friends.filter(
    f => !((f.userId === userId && f.friendId === friendId) || (f.userId === friendId && f.friendId === userId))
  );
  writeJSON(FRIENDS_FILE, friends);
  res.json({ ok: true });
});

// ─── Message APIs ───

// 获取两个用户之间的消息
// ─── 私聊消息 APIs ───

// 给消息附加引用预览（replyTo），前端直接渲染；sourceMessages 为消息源全量
function attachReplyPreview(messages, sourceMessages) {
  const withReply = messages.some(m => m.replyToId);
  if (!withReply) return messages;
  const byId = new Map(sourceMessages.map(m => [m.id, m]));
  users = readJSON(USERS_FILE);
  return messages.map(m => {
    if (!m.replyToId) return m;
    const replied = byId.get(m.replyToId);
    if (!replied) return { ...m, replyTo: null };
    const sender = users.find(u => u.id === replied.senderId);
    return {
      ...m,
      replyTo: {
        id: replied.id,
        senderId: replied.senderId,
        senderName: sender ? (sender.nickname || sender.username) : '未知',
        content: replied.deleted ? '该消息已删除' : (replied.recalled ? '该消息已撤回' : (replied.content || (replied.type === 'redpacket' ? '[红包]' : ''))),
        type: replied.type || 'text',
      },
    };
  });
}

// 解析群消息里的 @用户名/@昵称 提及（返回群成员 userId 列表）
function parseMentions(content, groupId) {
  const tokens = new Set();
  const re = /@([\u4e00-\u9fa5A-Za-z0-9_\-]+)/g;
  let m;
  while ((m = re.exec(content || ''))) tokens.add(m[1]);
  if (tokens.size === 0) return [];
  const groupMemberIds = readJSON(GROUP_MEMBERS_FILE)
    .filter(g => g.groupId === groupId)
    .map(g => g.userId);
  const users = readJSON(USERS_FILE);
  return groupMemberIds.filter(id => {
    const u = users.find(x => x.id === id);
    return u && (tokens.has(u.username) || (u.nickname && tokens.has(u.nickname)));
  });
}

// 获取与某好友的增量消息（含变更同步：changedAfter 返回 updatedAt 之后有变更的旧消息）
app.get('/api/messages', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  const peerId = parseInt(req.query.peerId) || 0;
  const after = parseInt(req.query.after) || 0; // 返回 id 大于 after 的消息
  const changedAfter = parseInt(req.query.changedAfter) || 0; // 返回 updatedAt 之后变更过的消息（撤回/已读/删除）

  if (!userId || !peerId) return res.json({ ok: true, messages: [], changed: [], serverTime: Date.now() });

  const all = readJSON(MESSAGES_FILE);
  const related = all.filter(m =>
    (m.senderId === userId && m.receiverId === peerId) ||
    (m.senderId === peerId && m.receiverId === userId)
  );

  // 新消息（id > after，已删除的不返回）
  let fresh = related.filter(m => m.id > after && !m.deleted);
  // 变更消息（id <= after 且 updatedAt 在 changedAfter 之后；已删除的也返回，供对端清除）
  const changed = changedAfter
    ? related.filter(m => m.id <= after && (m.updatedAt || 0) >= changedAfter)
    : [];

  fresh = attachRedpacketStatus(fresh, userId);
  fresh = attachReplyPreview(fresh, all);
  const changedOut = attachReplyPreview(changed, all).map(m => attachRedpacketStatus([m], userId)[0]);

  res.json({ ok: true, messages: fresh, changed: changedOut, serverTime: Date.now() });
});

// 发送消息（支持引用回复 replyToId）
app.post('/api/messages/send', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const receiverId = parseInt(req.body.receiverId) || 0;
  const { content, type, redpacketId, replyToId, fileUrl, fileName, fileSize } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!receiverId) return res.json({ ok: false, msg: '缺少接收者' });
  // 类型与长度校验，避免 500 / 超长内容入库
  if (typeof content !== 'string' || !content.trim()) return res.json({ ok: false, msg: '消息不能为空' });
  if (content.length > 4000) return res.json({ ok: false, msg: '消息不能超过4000字' });
  if (fileName != null && (typeof fileName !== 'string' || fileName.length > 255)) {
    return res.json({ ok: false, msg: '文件名过长或无效' });
  }
  if (fileSize != null && (!Number.isFinite(Number(fileSize)) || Number(fileSize) < 0)) {
    return res.json({ ok: false, msg: '文件大小无效' });
  }
  if (fileUrl != null && (typeof fileUrl !== 'string' || !fileUrl.startsWith('/uploads/'))) {
    return res.json({ ok: false, msg: '文件地址无效' });
  }
  // 接收者必须存在
  if (!readJSON(USERS_FILE).some(u => u.id === receiverId)) {
    return res.json({ ok: false, msg: '接收者不存在' });
  }

  // 检查是否被对方拉黑（对方拉黑了我 → 我不能发给对方）
  const blocks = readJSON(BLOCKS_FILE);
  if (blocks.some(b => b.blockerId === receiverId && b.blockedId === userId)) {
    return res.json({ ok: false, msg: '你已被对方拉黑，无法发送消息' });
  }

  // 引用校验：被引用的消息必须存在于该会话中
  let validReplyToId = null;
  if (replyToId) {
    const allMsgs = readJSON(MESSAGES_FILE);
    const replied = allMsgs.find(m => m.id === replyToId);
    const inConv = replied && (
      (replied.senderId === userId && replied.receiverId === receiverId) ||
      (replied.senderId === receiverId && replied.receiverId === userId)
    );
    if (!inConv) return res.json({ ok: false, msg: '引用的消息不存在' });
    validReplyToId = replyToId;
  }

  // 发送消息后，将双方好友关系标记为已确认（不再是"新添加"状态）
  let friends = readJSON(FRIENDS_FILE);
  let friendUpdated = false;
  friends.forEach(f => {
    if ((f.userId === userId && f.friendId === receiverId) || (f.userId === receiverId && f.friendId === userId)) {
      if (!f.confirmed) { f.confirmed = true; friendUpdated = true; }
    }
  });
  if (friendUpdated) writeJSON(FRIENDS_FILE, friends);

  let messages = readJSON(MESSAGES_FILE);
  const nextId = nextMessageId();

  const msg = {
    id: nextId,
    senderId: userId,
    receiverId,
    content: content.trim(),
    type: type || 'text',
    redpacketId: redpacketId || null,
    replyToId: validReplyToId,
    fileUrl: fileUrl || null,
    fileName: fileName || null,
    fileSize: fileSize || null,
    read: false,
    timestamp: Date.now(),
  };

  messages.push(msg);
  writeJSON(MESSAGES_FILE, messages);
  res.json({ ok: true, message: msg });
});

// 删除单条消息（会话双方均可删除，删除后对双方不可见）
app.delete('/api/messages/:messageId', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const messageId = parseInt(req.params.messageId);

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!messageId) return res.json({ ok: false, msg: '缺少消息ID' });

  let messages = readJSON(MESSAGES_FILE);
  const msg = messages.find(m => m.id === messageId);
  if (!msg) return res.json({ ok: false, msg: '消息不存在' });
  if (msg.deleted) return res.json({ ok: false, msg: '消息已删除' });
  if (msg.senderId !== userId && msg.receiverId !== userId) {
    return res.json({ ok: false, msg: '无权删除该消息' });
  }

  // 墓碑标记：清空内容并置 deleted，对端轮询到变更后本地移除
  msg.deleted = true;
  msg.content = '';
  msg.fileUrl = null;
  msg.fileName = null;
  msg.fileSize = null;
  msg.updatedAt = Date.now();
  writeJSON(MESSAGES_FILE, messages);
  res.json({ ok: true });
});

// 撤回消息（发送者 5 分钟内可撤回文本消息）
app.post('/api/messages/:messageId/recall', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const messageId = parseInt(req.params.messageId);

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!messageId) return res.json({ ok: false, msg: '缺少消息ID' });

  let messages = readJSON(MESSAGES_FILE);
  const msg = messages.find(m => m.id === messageId);
  if (!msg) return res.json({ ok: false, msg: '消息不存在' });
  if (msg.senderId !== userId) return res.json({ ok: false, msg: '只能撤回自己的消息' });
  if (msg.type === 'redpacket' || msg.redpacketId) return res.json({ ok: false, msg: '红包消息不能撤回' });
  if (msg.deleted) return res.json({ ok: false, msg: '消息已删除' });
  if (msg.recalled) return res.json({ ok: false, msg: '消息已撤回' });
  if (!Number.isFinite(msg.timestamp) || Date.now() - msg.timestamp > 5 * 60 * 1000) {
    return res.json({ ok: false, msg: '超过5分钟，无法撤回' });
  }

  msg.recalled = true;
  msg.content = '';
  msg.fileUrl = null;
  msg.fileName = null;
  msg.fileSize = null;
  msg.updatedAt = Date.now();
  writeJSON(MESSAGES_FILE, messages);
  res.json({ ok: true, message: msg });
});

// 标记与某好友的消息为已读
app.post('/api/messages/read', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const peerId = parseInt(req.body.peerId) || 0;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!peerId) return res.json({ ok: false, msg: '缺少参数' });

  let messages = readJSON(MESSAGES_FILE);
  let marked = 0;
  const now = Date.now();
  messages.forEach(m => {
    if (m.senderId === peerId && m.receiverId === userId && !m.read) {
      m.read = true;
      m.updatedAt = now;
      marked++;
    }
  });
  if (marked > 0) writeJSON(MESSAGES_FILE, messages);
  res.json({ ok: true, marked });
});

// 搜索消息（可选限定好友 peerId；返回按时间倒序的最近 50 条）
app.get('/api/messages/search', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  const q = (req.query.q || '').trim();
  const peerId = parseInt(req.query.peerId) || 0;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!q) return res.json({ ok: true, results: [] });

  const lower = q.toLowerCase();
  let messages = readJSON(MESSAGES_FILE);
  messages = messages.filter(m =>
    (m.senderId === userId || m.receiverId === userId) &&
    m.content && typeof m.content === 'string' && m.content.toLowerCase().includes(lower)
  );
  if (peerId) {
    messages = messages.filter(m => m.senderId === peerId || m.receiverId === peerId);
  }
  // 按时间倒序取最近 50 条（此前按文件顺序，不可靠）
  messages = messages
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, 50);

  users = readJSON(USERS_FILE);
  const results = messages.map(m => {
    const peer = users.find(u => u.id === (m.senderId === userId ? m.receiverId : m.senderId));
    return {
      message: attachReplyPreview([m], readJSON(MESSAGES_FILE))[0],
      peerId: m.senderId === userId ? m.receiverId : m.senderId,
      peerName: peer ? (peer.nickname || peer.username) : '未知',
      mine: m.senderId === userId,
    };
  });
  res.json({ ok: true, results });
});

// 删除两个用户之间的整个聊天记录
app.delete('/api/messages', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const peerId = parseInt(req.query.peerId) || 0;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!peerId) return res.json({ ok: false, msg: '缺少参数' });

  let messages = readJSON(MESSAGES_FILE);
  const originalCount = messages.length;
  messages = messages.filter(m => !((m.senderId === userId && m.receiverId === peerId) || (m.senderId === peerId && m.receiverId === userId)));
  writeJSON(MESSAGES_FILE, messages);
  res.json({ ok: true, deleted: originalCount - messages.length });
});

// ─── 会话设置（置顶 / 免打扰）───

// 获取我的会话设置
app.get('/api/conv-settings', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: false, msg: '未登录' });

  const settings = readJSON(CONV_SETTINGS_FILE)
    .filter(s => s.userId === userId)
    .map(s => ({ peerId: s.peerId, pinned: !!s.pinned, muted: !!s.muted }));
  res.json({ ok: true, settings });
});

// 更新会话设置（pinned / muted）
app.post('/api/conv-settings', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const peerId = parseInt(req.body.peerId) || 0;
  const { pinned, muted } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!peerId) return res.json({ ok: false, msg: '缺少参数' });

  let settings = readJSON(CONV_SETTINGS_FILE);
  const existing = settings.find(s => s.userId === userId && s.peerId === peerId);
  if (existing) {
    if (pinned !== undefined) existing.pinned = !!pinned;
    if (muted !== undefined) existing.muted = !!muted;
  } else {
    settings.push({ userId, peerId, pinned: !!pinned, muted: !!muted });
  }
  writeJSON(CONV_SETTINGS_FILE, settings);
  res.json({ ok: true });
});

// ─── Block APIs ───

// 拉黑用户
app.post('/api/block', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { targetId } = req.body;
  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!targetId) return res.json({ ok: false, msg: '缺少参数' });
  if (userId === targetId) return res.json({ ok: false, msg: '不能拉黑自己' });

  let blocks = readJSON(BLOCKS_FILE);
  if (blocks.some(b => b.blockerId === userId && b.blockedId === targetId)) {
    return res.json({ ok: false, msg: '已经拉黑' });
  }

  blocks.push({ blockerId: userId, blockedId: targetId });
  writeJSON(BLOCKS_FILE, blocks);
  res.json({ ok: true, msg: '已拉黑' });
});

// 取消拉黑
app.post('/api/unblock', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { targetId } = req.body;
  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!targetId) return res.json({ ok: false, msg: '缺少参数' });

  let blocks = readJSON(BLOCKS_FILE);
  blocks = blocks.filter(b => !(b.blockerId === userId && b.blockedId === targetId));
  writeJSON(BLOCKS_FILE, blocks);
  res.json({ ok: true, msg: '已取消拉黑' });
});

// 获取拉黑列表
app.get('/api/blocks', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: true, blocks: [] });

  const blocks = readJSON(BLOCKS_FILE);
  users = readJSON(USERS_FILE);

  const blockedIds = blocks
    .filter(b => b.blockerId === userId)
    .map(b => b.blockedId);

  const result = users
    .filter(u => blockedIds.includes(u.id))
    .map(u => ({ id: u.id, username: u.username, nickname: u.nickname }));
  res.json({ ok: true, blocks: result });
});

// 检查是否被某人拉黑（批量）
app.get('/api/blocks/check', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: true, blockedBy: [] });

  const blocks = readJSON(BLOCKS_FILE);
  // 返回拉黑了当前用户的人的 ID 列表
  const blockedBy = blocks
    .filter(b => b.blockedId === userId)
    .map(b => b.blockerId);
  res.json({ ok: true, blockedBy });
});

// ─── Admin helper ───

const ROLE_SUPER = 'superadmin';
const ROLE_ADMIN = 'admin';

function isAdmin(userId) {
  users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  return !!user && (user.role === ROLE_ADMIN || user.role === ROLE_SUPER);
}

function isSuperAdmin(userId) {
  users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  return !!user && user.role === ROLE_SUPER;
}

// 启动迁移：确保至少有一个超级管理员（把最早的管理员提升为超级管理员）
function migrateSuperAdmin() {
  const list = readJSON(USERS_FILE);
  if (list.some(u => u.role === ROLE_SUPER)) return;
  const firstAdmin = list.filter(u => u.role === ROLE_ADMIN).sort((a, b) => a.id - b.id)[0];
  if (!firstAdmin) return;
  firstAdmin.role = ROLE_SUPER;
  writeJSON(USERS_FILE, list);
  console.log(`[roles] 已将 ${firstAdmin.username} 提升为超级管理员`);
}

// ─── Admin APIs ───

// 获取所有用户列表（管理员）
app.get('/api/admin/users', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId || !isAdmin(userId)) return res.json({ ok: false, msg: '无权限' });

  users = readJSON(USERS_FILE);
  const list = users.map(u => ({
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    role: u.role || 'user',
    disabled: !!u.disabled,
    credits: u.credits || 0,
    createdAt: u.createdAt || null,
  }));
  res.json({ ok: true, users: list, isSuperAdmin: isSuperAdmin(userId) });
});

// 注销用户账号（管理员）
app.post('/api/admin/users/:targetId/disable', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const targetId = parseInt(req.params.targetId);
  if (!userId || !isAdmin(userId)) return res.json({ ok: false, msg: '无权限' });
  if (userId === targetId) return res.json({ ok: false, msg: '不能操作自己的账号' });

  users = readJSON(USERS_FILE);
  const target = users.find(u => u.id === targetId);
  if (!target) return res.json({ ok: false, msg: '用户不存在' });
  if (target.role === ROLE_SUPER) return res.json({ ok: false, msg: '不能注销超级管理员账号' });
  if (target.role === ROLE_ADMIN && !isSuperAdmin(userId)) {
    return res.json({ ok: false, msg: '普通管理员不能操作管理员账号，请联系超级管理员' });
  }

  target.disabled = true;
  writeJSON(USERS_FILE, users);

  // 删除被注销用户的所有消息
  let messages = readJSON(MESSAGES_FILE);
  messages = messages.filter(m => m.senderId !== targetId && m.receiverId !== targetId);
  writeJSON(MESSAGES_FILE, messages);

  // 删除被注销用户的好友关系
  let friends = readJSON(FRIENDS_FILE);
  friends = friends.filter(f => f.userId !== targetId && f.friendId !== targetId);
  writeJSON(FRIENDS_FILE, friends);

  res.json({ ok: true, msg: '已注销用户 ' + target.username });
});

// 启用用户账号（管理员）
app.post('/api/admin/users/:targetId/enable', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const targetId = parseInt(req.params.targetId);
  if (!userId || !isAdmin(userId)) return res.json({ ok: false, msg: '无权限' });

  users = readJSON(USERS_FILE);
  const target = users.find(u => u.id === targetId);
  if (!target) return res.json({ ok: false, msg: '用户不存在' });
  if (target.role === ROLE_SUPER) return res.json({ ok: false, msg: '不能操作超级管理员账号' });
  if (target.role === ROLE_ADMIN && !isSuperAdmin(userId)) {
    return res.json({ ok: false, msg: '普通管理员不能操作管理员账号，请联系超级管理员' });
  }

  target.disabled = false;
  target.role = target.role || 'user';
  writeJSON(USERS_FILE, users);
  res.json({ ok: true, msg: '已启用用户 ' + target.username });
});

// 设置/取消普通管理员（仅超级管理员）
app.post('/api/admin/users/:targetId/set-admin', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const targetId = parseInt(req.params.targetId);
  if (!userId || !isSuperAdmin(userId)) return res.json({ ok: false, msg: '只有超级管理员可以修改他人身份' });

  users = readJSON(USERS_FILE);
  const target = users.find(u => u.id === targetId);
  if (!target) return res.json({ ok: false, msg: '用户不存在' });
  if (targetId === userId) return res.json({ ok: false, msg: '不能修改自己的身份' });
  if (target.role === ROLE_SUPER) return res.json({ ok: false, msg: '请使用"设为超级管理员"来调整超级管理员' });

  const newRole = target.role === ROLE_ADMIN ? 'user' : ROLE_ADMIN;
  target.role = newRole;
  // 设为管理员时自动解除禁用
  if (newRole === ROLE_ADMIN) target.disabled = false;
  writeJSON(USERS_FILE, users);
  res.json({ ok: true, msg: newRole === ROLE_ADMIN ? '已设为管理员' : '已取消管理员', role: newRole });
});

// 设置/取消超级管理员（仅超级管理员；至少保留一个超级管理员）
app.post('/api/admin/users/:targetId/set-super', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const targetId = parseInt(req.params.targetId);
  if (!userId || !isSuperAdmin(userId)) return res.json({ ok: false, msg: '只有超级管理员可以操作' });

  users = readJSON(USERS_FILE);
  const target = users.find(u => u.id === targetId);
  if (!target) return res.json({ ok: false, msg: '用户不存在' });
  if (targetId === userId) return res.json({ ok: false, msg: '不能修改自己的超级管理员身份' });

  if (target.role === ROLE_SUPER) {
    // 降级为普通管理员前，确保还有别的超级管理员
    const superCount = users.filter(u => u.role === ROLE_SUPER).length;
    if (superCount <= 1) return res.json({ ok: false, msg: '至少需要保留一个超级管理员' });
    target.role = ROLE_ADMIN;
    writeJSON(USERS_FILE, users);
    return res.json({ ok: true, msg: `已取消 ${target.username} 的超级管理员（降为普通管理员）`, role: ROLE_ADMIN });
  }

  target.role = ROLE_SUPER;
  target.disabled = false;
  writeJSON(USERS_FILE, users);
  res.json({ ok: true, msg: `已将 ${target.username} 设为超级管理员`, role: ROLE_SUPER });
});

// 重置用户密码（管理员；超级管理员可重置管理员）
app.post('/api/admin/users/:targetId/reset-password', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const targetId = parseInt(req.params.targetId);
  const { newPassword } = req.body;
  if (!userId || !isAdmin(userId)) return res.json({ ok: false, msg: '无权限' });
  if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 64) {
    return res.json({ ok: false, msg: '密码至少6个字符' });
  }
  if (targetId === userId) return res.json({ ok: false, msg: '请使用"修改密码"功能修改自己的密码' });

  users = readJSON(USERS_FILE);
  const target = users.find(u => u.id === targetId);
  if (!target) return res.json({ ok: false, msg: '用户不存在' });
  if (target.role === ROLE_SUPER) return res.json({ ok: false, msg: '不能重置超级管理员的密码' });
  if (target.role === ROLE_ADMIN && !isSuperAdmin(userId)) {
    return res.json({ ok: false, msg: '普通管理员不能重置管理员密码，请联系超级管理员' });
  }

  target.password = hashPassword(newPassword);
  writeJSON(USERS_FILE, users);
  res.json({ ok: true, msg: '已重置密码' });
});

// 清空所有消息（管理员）：私聊 + 群聊
app.post('/api/admin/clear-messages', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  if (!userId || !isAdmin(userId)) return res.json({ ok: false, msg: '无权限' });

  const privateCount = readJSON(MESSAGES_FILE).length;
  writeJSON(MESSAGES_FILE, []);
  let groupCount = 0;
  try {
    groupCount = readJSON(GROUP_MESSAGES_FILE).length;
    writeJSON(GROUP_MESSAGES_FILE, []);
  } catch (err) {
    console.error('[clear-messages] 清理群消息失败:', err.message);
  }
  res.json({ ok: true, msg: `已清空私聊 ${privateCount} 条、群聊 ${groupCount} 条消息` });
});

// 获取服务器统计（管理员）
app.get('/api/admin/stats', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId || !isAdmin(userId)) return res.json({ ok: false, msg: '无权限' });

  users = readJSON(USERS_FILE);
  const messages = readJSON(MESSAGES_FILE);
  const friends = readJSON(FRIENDS_FILE);

  res.json({
    ok: true,
    stats: {
      totalUsers: users.length,
      activeUsers: users.filter(u => !u.disabled).length,
      disabledUsers: users.filter(u => u.disabled).length,
      adminCount: users.filter(u => u.role === ROLE_ADMIN || u.role === ROLE_SUPER).length,
      superAdminCount: users.filter(u => u.role === ROLE_SUPER).length,
      totalMessages: messages.length,
      totalFriendships: new Set(friends.map(f => `${Math.min(f.userId, f.friendId)}-${Math.max(f.userId, f.friendId)}`)).size,
    },
  });
});

// ─── User status check API ───
app.get('/api/user/status', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: false, msg: '未登录' });

  users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) return res.json({ ok: false, msg: '用户不存在' });
  if (user.disabled) return res.json({ ok: false, msg: '该账号已被禁用' });

  res.json({ ok: true, user: publicUser(user) });
});

// ─── Credits APIs ───

// 查询我的积分
app.get('/api/user/credits', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: false, msg: '未登录' });

  users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) return res.json({ ok: false, msg: '用户不存在' });

  res.json({ ok: true, credits: user.credits || 0 });
});

// 管理员调整用户积分
app.post('/api/admin/users/:targetId/credits', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const targetId = parseInt(req.params.targetId);
  const { amount } = req.body; // amount 可正可负
  if (!userId || !isAdmin(userId)) return res.json({ ok: false, msg: '无权限' });
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount === 0) return res.json({ ok: false, msg: '请输入有效的积分数额' });

  users = readJSON(USERS_FILE);
  const target = users.find(u => u.id === targetId);
  if (!target) return res.json({ ok: false, msg: '用户不存在' });
  if (target.role === ROLE_SUPER) return res.json({ ok: false, msg: '不能调整超级管理员的积分' });
  if (target.role === ROLE_ADMIN && !isSuperAdmin(userId)) {
    return res.json({ ok: false, msg: '普通管理员不能调整管理员积分，请联系超级管理员' });
  }

  target.credits = Math.max(0, (target.credits || 0) + numAmount);
  writeJSON(USERS_FILE, users);
  res.json({ ok: true, msg: '已调整积分', credits: target.credits });
});

// ─── Market APIs ───

// 获取市场商品列表（分页 + 搜索 + 分类筛选）
app.get('/api/market', (req, res) => {
  const q = (req.query.q || '').trim();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const currentUserId = parseInt(req.query.userId) || 0;
  const categoryId = req.query.categoryId ? parseInt(req.query.categoryId) : null;

  let items = readJSON(ITEMS_FILE);
  users = readJSON(USERS_FILE);
  const ratings = readJSON(RATINGS_FILE);
  const categories = readJSON(CATEGORIES_FILE);

  // 只显示在售商品
  items = items.filter(i => i.status === 'active');

  // 分类筛选
  if (categoryId) {
    items = items.filter(i => i.categoryId === categoryId);
  }

  // 获取当前用户已购买的商品ID
  const orders = readJSON(ORDERS_FILE);
  const boughtItemIds = currentUserId
    ? new Set(orders.filter(o => o.buyerId === currentUserId).map(o => o.itemId))
    : new Set();

  // 搜索
  if (q) {
    const lower = q.toLowerCase();
    items = items.filter(i => i.title.toLowerCase().includes(lower) || i.description.toLowerCase().includes(lower));
  }

  // 按时间倒序
  items.sort((a, b) => b.createdAt - a.createdAt);

  // 分页
  const total = items.length;
  const start = (page - 1) * limit;
  const paged = items.slice(start, start + limit);

  const result = paged.map(i => {
    const seller = users.find(u => u.id === i.sellerId);
    const itemRatings = ratings.filter(r => r.itemId === i.id);
    const avgRating = itemRatings.length > 0
      ? itemRatings.reduce((s, r) => s + r.rating, 0) / itemRatings.length
      : 0;
    const category = categories.find(c => c.id === i.categoryId);
    return {
      id: i.id,
      sellerId: i.sellerId,
      sellerName: seller ? seller.username : '未知',
      title: i.title,
      description: i.description.substring(0, 100),
      price: i.price,
      stock: i.stock === undefined ? null : i.stock,
      soldCount: i.soldCount || 0,
      bought: boughtItemIds.has(i.id),
      categoryId: i.categoryId,
      categoryName: category ? category.name : null,
      avgRating: Math.round(avgRating * 10) / 10,
      ratingCount: itemRatings.length,
      createdAt: i.createdAt,
    };
  });

  res.json({ ok: true, items: result, total, page, limit });
});

// 获取我的订单（购买和售出）- 必须在 :itemId 通配路由之前
app.get('/api/market/orders', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: true, orders: [] });

  let orders = readJSON(ORDERS_FILE);
  // 同时返回买和卖的订单，附带 type 字段
  orders = orders
    .filter(o => o.buyerId === userId || o.sellerId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(o => ({
      ...o,
      type: o.buyerId === userId ? 'buy' : 'sell',
    }));
  res.json({ ok: true, orders });
});

// 获取我上架的商品 - 必须在 :itemId 通配路由之前
app.get('/api/market/my', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: true, items: [] });

  let items = readJSON(ITEMS_FILE);
  const orders = readJSON(ORDERS_FILE);
  items = items.filter(i => i.sellerId === userId).sort((a, b) => b.createdAt - a.createdAt);

  // 为每个商品计算销量
  const result = items.map(i => {
    const sales = orders.filter(o => o.itemId === i.id).length;
    return { ...i, sales };
  });

  res.json({ ok: true, items: result });
});

// 获取单个商品详情
app.get('/api/market/:itemId', (req, res) => {
  const itemId = parseInt(req.params.itemId);
  let items = readJSON(ITEMS_FILE);
  users = readJSON(USERS_FILE);

  const item = items.find(i => i.id === itemId);
  if (!item) return res.json({ ok: false, msg: '商品不存在' });

  const seller = users.find(u => u.id === item.sellerId);
  res.json({
    ok: true,
    item: {
      id: item.id,
      sellerId: item.sellerId,
      sellerName: seller ? seller.username : '未知',
      title: item.title,
      description: item.description,
      price: item.price,
      stock: item.stock === undefined ? null : item.stock,
      soldCount: item.soldCount || 0,
      status: item.status,
      createdAt: item.createdAt,
    },
  });
});

// 上架商品（可选库存数量：不填 = 无限量）
app.post('/api/market/publish', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { title, description, price, postBuyMessage, categoryId, stock } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!title || !title.trim()) return res.json({ ok: false, msg: '请输入标题' });
  if (!description || !description.trim()) return res.json({ ok: false, msg: '请输入描述' });
  const numPrice = Number(price);
  if (!Number.isInteger(numPrice) || numPrice <= 0) return res.json({ ok: false, msg: '价格必须为大于0的整数' });

  // 库存：留空表示无限量；填了必须是正整数
  let stockVal = null;
  if (stock !== undefined && stock !== null && String(stock).trim() !== '') {
    const n = Number(stock);
    if (!Number.isInteger(n) || n <= 0) {
      return res.json({ ok: false, msg: '库存数量必须是大于0的整数（不填为无限量）' });
    }
    stockVal = n;
  }

  let items = readJSON(ITEMS_FILE);
  const nextId = allocId('items');

  const item = {
    id: nextId,
    sellerId: userId,
    title: title.trim(),
    description: description.trim(),
    price: numPrice,
    stock: stockVal,
    soldCount: 0,
    postBuyMessage: (postBuyMessage || '').trim(),
    categoryId: categoryId || null,
    status: 'active',
    createdAt: Date.now(),
  };

  items.push(item);
  writeJSON(ITEMS_FILE, items);
  res.json({ ok: true, msg: '上架成功', item });
});

// 购买商品
app.post('/api/market/buy', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { itemId } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!itemId) return res.json({ ok: false, msg: '缺少商品ID' });

  users = readJSON(USERS_FILE);
  const buyer = users.find(u => u.id === userId);
  if (!buyer) return res.json({ ok: false, msg: '用户不存在' });

  let items = readJSON(ITEMS_FILE);
  const item = items.find(i => i.id === itemId);
  if (!item) return res.json({ ok: false, msg: '商品不存在' });
  if (item.status !== 'active') return res.json({ ok: false, msg: '商品已下架' });
  if (item.sellerId === userId) return res.json({ ok: false, msg: '不能买自己的商品' });

  // 检查是否已购买过
  let orders = readJSON(ORDERS_FILE);
  const alreadyBought = orders.some(o => o.buyerId === userId && o.itemId === itemId);
  if (alreadyBought) return res.json({ ok: false, msg: '你已经购买过该商品了' });

  // 库存检查（null/undefined = 无限量）
  if (item.stock !== undefined && item.stock !== null && item.stock <= 0) {
    return res.json({ ok: false, msg: '该商品已售罄' });
  }

  const price = item.price;
  if ((buyer.credits || 0) < price) return res.json({ ok: false, msg: '积分不足' });

  // 扣买家积分
  buyer.credits = (buyer.credits || 0) - price;

  // 扣库存
  if (item.stock !== undefined && item.stock !== null) {
    item.stock -= 1;
    item.soldCount = (item.soldCount || 0) + 1;
  }

  // 加卖家积分（扣除 20% 税，卖家实际获得 80%）
  const seller = users.find(u => u.id === item.sellerId);
  const sellerEarning = Math.floor(price * SELLER_RATE);
  const tax = price - sellerEarning;
  if (seller) seller.credits = (seller.credits || 0) + sellerEarning;

  writeJSON(USERS_FILE, users);

  // 不再标记商品为已售，商品持续在售
  writeJSON(ITEMS_FILE, items);

  // 创建订单
  const nextOrderId = allocId('orders');
  orders.push({
    id: nextOrderId,
    buyerId: userId,
    sellerId: item.sellerId,
    itemId: item.id,
    title: item.title,
    description: item.description,
    price: item.price,
    sellerEarning,
    tax,
    postBuyMessage: item.postBuyMessage || '',
    createdAt: Date.now(),
  });
  writeJSON(ORDERS_FILE, orders);

  res.json({ ok: true, msg: '购买成功', credits: buyer.credits, postBuyMessage: item.postBuyMessage || '', tax, sellerEarning });
});

// 下架商品
app.post('/api/market/remove', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { itemId } = req.body;
  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!itemId) return res.json({ ok: false, msg: '缺少商品ID' });

  let items = readJSON(ITEMS_FILE);
  const item = items.find(i => i.id === itemId);
  if (!item) return res.json({ ok: false, msg: '商品不存在' });
  if (item.sellerId !== userId) return res.json({ ok: false, msg: '只能下架自己的商品' });
  if (item.status === 'sold') return res.json({ ok: false, msg: '已售出的商品不能下架' });

  items = items.filter(i => i.id !== itemId);
  writeJSON(ITEMS_FILE, items);
  res.json({ ok: true, msg: '已下架' });
});

// ─── Cart APIs ───

// 获取购物车
app.get('/api/cart', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: true, items: [] });

  let cart = readJSON(CART_FILE);
  let items = readJSON(ITEMS_FILE);
  users = readJSON(USERS_FILE);

  // 只取该用户的购物车项
  const cartItems = cart.filter(c => c.userId === userId);

  // 获取当前用户已购买的商品ID
  const orders = readJSON(ORDERS_FILE);
  const boughtItemIds = new Set(orders.filter(o => o.buyerId === userId).map(o => o.itemId));

  const result = cartItems.map(c => {
    const item = items.find(i => i.id === c.itemId);
    if (!item || item.status !== 'active') return null;
    const seller = users.find(u => u.id === item.sellerId);
    return {
      ...item,
      sellerName: seller ? seller.username : '未知',
      bought: boughtItemIds.has(item.id),
      addedAt: c.addedAt,
    };
  }).filter(Boolean);

  res.json({ ok: true, items: result });
});

// 添加到购物车
app.post('/api/cart/add', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { itemId } = req.body;
  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!itemId) return res.json({ ok: false, msg: '缺少商品ID' });

  let items = readJSON(ITEMS_FILE);
  const item = items.find(i => i.id === itemId);
  if (!item) return res.json({ ok: false, msg: '商品不存在' });
  if (item.status !== 'active') return res.json({ ok: false, msg: '商品已下架' });
  if (item.sellerId === userId) return res.json({ ok: false, msg: '不能加自己的商品' });
  // 库存为 0 → 已售罄
  if (item.stock !== undefined && item.stock !== null && item.stock <= 0) {
    return res.json({ ok: false, msg: '该商品已售罄' });
  }

  // 检查是否已购买过
  let orders = readJSON(ORDERS_FILE);
  const alreadyBought = orders.some(o => o.buyerId === userId && o.itemId === itemId);
  if (alreadyBought) return res.json({ ok: false, msg: '你已经购买过该商品了' });

  let cart = readJSON(CART_FILE);
  // 检查是否已在购物车中
  const exists = cart.some(c => c.userId === userId && c.itemId === itemId);
  if (exists) return res.json({ ok: false, msg: '商品已在购物车中' });

  cart.push({ userId, itemId, addedAt: Date.now() });
  writeJSON(CART_FILE, cart);
  res.json({ ok: true, msg: '已加入购物车' });
});

// 从购物车移除
app.post('/api/cart/remove', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { itemId } = req.body;
  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!itemId) return res.json({ ok: false, msg: '缺少商品ID' });

  let cart = readJSON(CART_FILE);
  cart = cart.filter(c => !(c.userId === userId && c.itemId === itemId));
  writeJSON(CART_FILE, cart);
  res.json({ ok: true, msg: '已从购物车移除' });
});

// 购物车批量结算
app.post('/api/cart/checkout', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  if (!userId) return res.json({ ok: false, msg: '未登录' });

  let cart = readJSON(CART_FILE);
  let items = readJSON(ITEMS_FILE);
  let orders = readJSON(ORDERS_FILE);
  users = readJSON(USERS_FILE);

  const buyer = users.find(u => u.id === userId);
  if (!buyer) return res.json({ ok: false, msg: '用户不存在' });

  // 获取该用户购物车中有效商品
  const cartItems = cart.filter(c => c.userId === userId);
  const validItems = cartItems.map(c => {
    const item = items.find(i => i.id === c.itemId);
    return item && item.status === 'active' ? item : null;
  }).filter(Boolean);

  if (validItems.length === 0) return res.json({ ok: false, msg: '购物车为空或商品已失效' });

  // 已购买过 / 已售罄的商品不参与本次结算
  const alreadyBoughtItems = validItems.filter(item => orders.some(o => o.buyerId === userId && o.itemId === item.id));
  const soldOutItems = validItems.filter(item =>
    !alreadyBoughtItems.includes(item) &&
    item.stock !== undefined && item.stock !== null && item.stock <= 0
  );
  const pendingItems = validItems.filter(item => !alreadyBoughtItems.includes(item) && !soldOutItems.includes(item));

  // 计算总价（只算真正要买的）
  const totalPrice = pendingItems.reduce((sum, item) => sum + item.price, 0);
  if (pendingItems.length > 0 && (buyer.credits || 0) < totalPrice) {
    return res.json({ ok: false, msg: `积分不足，需要 ${totalPrice} 积分，当前 ${buyer.credits || 0} 积分`, totalPrice });
  }

  // 逐个处理购买
  const results = [];
  let totalTax = 0;
  let totalSellerEarning = 0;
  let postBuyMessages = [];

  for (const item of alreadyBoughtItems) {
    results.push({ itemId: item.id, title: item.title, status: 'skipped', reason: '已购买过' });
  }
  for (const item of soldOutItems) {
    results.push({ itemId: item.id, title: item.title, status: 'skipped', reason: '已售罄' });
  }

  for (const item of pendingItems) {
    // 扣买家积分
    buyer.credits = (buyer.credits || 0) - item.price;

    // 扣库存（null/undefined = 无限量）
    if (item.stock !== undefined && item.stock !== null) {
      item.stock -= 1;
      item.soldCount = (item.soldCount || 0) + 1;
    }

    // 加卖家积分（80%）
    const seller = users.find(u => u.id === item.sellerId);
    const sellerEarning = Math.floor(item.price * SELLER_RATE);
    const tax = item.price - sellerEarning;
    totalTax += tax;
    totalSellerEarning += sellerEarning;
    if (seller) seller.credits = (seller.credits || 0) + sellerEarning;

    // 创建订单
    const nextOrderId = allocId('orders');
    orders.push({
      id: nextOrderId,
      buyerId: userId,
      sellerId: item.sellerId,
      itemId: item.id,
      title: item.title,
      description: item.description,
      price: item.price,
      sellerEarning,
      tax,
      postBuyMessage: item.postBuyMessage || '',
      createdAt: Date.now(),
    });

    if (item.postBuyMessage) {
      postBuyMessages.push({ title: item.title, message: item.postBuyMessage });
    }

    results.push({ itemId: item.id, title: item.title, status: 'ok' });
  }

  writeJSON(USERS_FILE, users);
  writeJSON(ORDERS_FILE, orders);

  // 清除已结算的购物车项
  const checkedItemIds = new Set(validItems.map(i => i.id));
  cart = cart.filter(c => !(c.userId === userId && checkedItemIds.has(c.itemId)));
  writeJSON(CART_FILE, cart);

  const successCount = results.filter(r => r.status === 'ok').length;
  res.json({
    ok: true,
    msg: `成功购买 ${successCount} 件商品`,
    credits: buyer.credits,
    results,
    postBuyMessages,
    totalTax,
    totalSellerEarning,
  });
});

// ─── User Profile APIs ───

app.put('/api/user/profile', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { nickname, avatar, bio } = req.body;
  if (!userId) return res.json({ ok: false, msg: '未登录' });

  // 类型与长度校验（避免非字符串导致 500、超长内容入库）
  if (nickname !== undefined && (typeof nickname !== 'string' || nickname.trim().length > 20)) {
    return res.json({ ok: false, msg: '昵称必须是1-20个字符的文本' });
  }
  // 头像支持 emoji/文字（≤8 字符）或上传图片地址（/uploads/...）
  if (avatar !== undefined) {
    const okAvatar = typeof avatar === 'string' &&
      (avatar.startsWith('/uploads/') ? avatar.length <= 160 : avatar.length <= 8);
    if (!okAvatar) return res.json({ ok: false, msg: '头像格式无效' });
  }
  if (bio !== undefined && (typeof bio !== 'string' || bio.length > 200)) {
    return res.json({ ok: false, msg: '简介不能超过200字' });
  }

  users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) return res.json({ ok: false, msg: '用户不存在' });

  if (nickname !== undefined) user.nickname = nickname.trim() || user.username;
  if (avatar !== undefined) user.avatar = avatar;
  if (bio !== undefined) user.bio = bio.trim();

  writeJSON(USERS_FILE, users);

  res.json({ ok: true, user: publicUser(user) });
});

app.get('/api/user/profile', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: false, msg: '缺少用户ID' });

  users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) return res.json({ ok: false, msg: '用户不存在' });

  res.json({ ok: true, user: publicUser(user) });
});

// 修改自己的密码（校验原密码）
app.post('/api/user/password', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { oldPassword, newPassword } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
    return res.json({ ok: false, msg: '参数无效' });
  }
  if (newPassword.length < 6 || newPassword.length > 64) {
    return res.json({ ok: false, msg: '新密码需为6-64个字符' });
  }
  if (oldPassword === newPassword) return res.json({ ok: false, msg: '新密码不能与原密码相同' });

  users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) return res.json({ ok: false, msg: '用户不存在' });
  if (!verifyPassword(oldPassword, user.password)) {
    return res.json({ ok: false, msg: '原密码错误' });
  }

  user.password = hashPassword(newPassword);
  writeJSON(USERS_FILE, users);
  res.json({ ok: true, msg: '密码已修改，下次登录请使用新密码' });
});

// ─── Categories APIs ───

app.get('/api/categories', (req, res) => {
  const categories = readJSON(CATEGORIES_FILE);
  res.json({ ok: true, categories });
});

app.post('/api/categories', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  if (!userId || !isAdmin(userId)) return res.json({ ok: false, msg: '无权限' });

  const { name, icon, color } = req.body;
  if (!name || !name.trim()) return res.json({ ok: false, msg: '分类名称不能为空' });

  let categories = readJSON(CATEGORIES_FILE);
  const nextId = allocId('categories');

  const category = { id: nextId, name: name.trim(), icon: icon || '📦', color: color || '#1890ff' };
  categories.push(category);
  writeJSON(CATEGORIES_FILE, categories);
  res.json({ ok: true, category });
});

app.delete('/api/categories/:id', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  if (!userId || !isAdmin(userId)) return res.json({ ok: false, msg: '无权限' });

  const id = parseInt(req.params.id);
  let categories = readJSON(CATEGORIES_FILE);
  categories = categories.filter(c => c.id !== id);
  writeJSON(CATEGORIES_FILE, categories);
  res.json({ ok: true });
});

// ─── Ratings APIs ───

app.get('/api/ratings/:itemId', (req, res) => {
  const itemId = parseInt(req.params.itemId);
  if (!itemId) return res.json({ ok: false, msg: '缺少商品ID' });

  const ratings = readJSON(RATINGS_FILE);
  const itemRatings = ratings.filter(r => r.itemId === itemId);

  const users = readJSON(USERS_FILE);
  const result = itemRatings.map(r => {
    const user = users.find(u => u.id === r.userId);
    return {
      ...r,
      username: user ? user.username : '未知',
      nickname: user ? user.nickname : '未知',
    };
  });

  const avgRating = itemRatings.length > 0
    ? itemRatings.reduce((s, r) => s + r.rating, 0) / itemRatings.length
    : 0;

  res.json({ ok: true, ratings: result, avgRating: Math.round(avgRating * 10) / 10, count: itemRatings.length });
});

app.post('/api/ratings', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { itemId, rating, comment } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!itemId) return res.json({ ok: false, msg: '缺少商品ID' });
  if (!rating || rating < 1 || rating > 5) return res.json({ ok: false, msg: '评分必须是1-5之间的整数' });

  const orders = readJSON(ORDERS_FILE);
  const hasBought = orders.some(o => o.buyerId === userId && o.itemId === itemId);
  if (!hasBought) return res.json({ ok: false, msg: '只有购买过该商品才能评价' });

  let ratings = readJSON(RATINGS_FILE);
  const existing = ratings.find(r => r.userId === userId && r.itemId === itemId);
  if (existing) {
    existing.rating = rating;
    existing.comment = (comment || '').trim();
    existing.updatedAt = Date.now();
    writeJSON(RATINGS_FILE, ratings);
    return res.json({ ok: true, msg: '评价已更新', rating: existing });
  }

  const nextId = allocId('ratings');
  const newRating = {
    id: nextId,
    userId,
    itemId,
    rating,
    comment: (comment || '').trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  ratings.push(newRating);
  writeJSON(RATINGS_FILE, ratings);
  res.json({ ok: true, msg: '评价成功', rating: newRating });
});

app.get('/api/ratings/user/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  if (!userId) return res.json({ ok: false, msg: '缺少用户ID' });

  const ratings = readJSON(RATINGS_FILE);
  const userRatings = ratings.filter(r => r.userId === userId);

  const items = readJSON(ITEMS_FILE);
  const result = userRatings.map(r => {
    const item = items.find(i => i.id === r.itemId);
    return {
      ...r,
      itemTitle: item ? item.title : '未知商品',
    };
  });

  res.json({ ok: true, ratings: result });
});

// ─── Transfer APIs ───

app.post('/api/transfer', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { targetId, amount, note } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!targetId) return res.json({ ok: false, msg: '缺少目标用户' });
  if (userId === targetId) return res.json({ ok: false, msg: '不能给自己转账' });
  const numAmount = Number(amount);
  if (!Number.isInteger(numAmount) || numAmount <= 0) return res.json({ ok: false, msg: '转账金额必须为大于0的整数' });

  users = readJSON(USERS_FILE);
  const sender = users.find(u => u.id === userId);
  const receiver = users.find(u => u.id === targetId);

  if (!sender) return res.json({ ok: false, msg: '用户不存在' });
  if (!receiver) return res.json({ ok: false, msg: '目标用户不存在' });
  if ((sender.credits || 0) < numAmount) return res.json({ ok: false, msg: '积分不足' });

  sender.credits = (sender.credits || 0) - numAmount;
  receiver.credits = (receiver.credits || 0) + numAmount;
  writeJSON(USERS_FILE, users);

  let transfers = readJSON(TRANSFERS_FILE);
  const transferIds = Array.isArray(transfers) ? transfers.map(t => t.id).filter(id => typeof id === 'number') : [];
  const nextId = allocId('transfers');
  const transfer = {
    id: nextId,
    senderId: userId,
    receiverId: targetId,
    amount,
    note: (note || '').trim(),
    createdAt: Date.now(),
  };
  transfers.push(transfer);
  writeJSON(TRANSFERS_FILE, transfers);

  res.json({ ok: true, msg: '转账成功', credits: sender.credits, transfer });
});

app.get('/api/transfers', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: false, msg: '未登录' });

  let transfers = readJSON(TRANSFERS_FILE);
  if (!Array.isArray(transfers)) transfers = [];
  const userTransfers = transfers.filter(t => t.senderId === userId || t.receiverId === userId);

  const users = readJSON(USERS_FILE);
  const result = userTransfers.map(t => {
    const sender = users.find(u => u.id === t.senderId);
    const receiver = users.find(u => u.id === t.receiverId);
    return {
      ...t,
      senderName: sender ? sender.username : '未知',
      receiverName: receiver ? receiver.username : '未知',
      type: t.senderId === userId ? 'out' : 'in',
    };
  }).sort((a, b) => b.createdAt - a.createdAt);

  res.json({ ok: true, transfers: result });
});

// ─── Redpacket APIs ───

app.post('/api/redpackets/send', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { receiverId, groupId, amount, count, note } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  // 单聊红包与群红包互斥，避免两种模式校验互相跳过
  if (!receiverId && !groupId) return res.json({ ok: false, msg: '缺少接收者' });
  if (receiverId && groupId) return res.json({ ok: false, msg: '不能同时指定好友和群聊' });
  const numAmount = Number(amount);
  if (!Number.isInteger(numAmount) || numAmount <= 0) return res.json({ ok: false, msg: '金额必须为大于0的整数' });
  const rawCount = Number(count);
  if (!Number.isInteger(rawCount) || rawCount < 1 || rawCount > 100) return res.json({ ok: false, msg: '红包数量必须为1-100的整数' });

  // 先按用户输入的 count 校验金额充足
  if (numAmount < rawCount) return res.json({ ok: false, msg: '金额必须大于等于红包数量' });

  // 单聊红包只有一个接收者，强制 count=1，避免资金锁死（此前 count>1 只有首份可领）
  const finalCount = (receiverId && !groupId) ? 1 : rawCount;

  users = readJSON(USERS_FILE);
  const sender = users.find(u => u.id === userId);
  
  if (!sender) return res.json({ ok: false, msg: '用户不存在' });
  if ((sender.credits || 0) < numAmount) return res.json({ ok: false, msg: '积分不足' });

  // 单聊红包检查
  if (receiverId && !groupId) {
    if (userId === receiverId) return res.json({ ok: false, msg: '不能给自己发红包' });
    const receiver = users.find(u => u.id === receiverId);
    if (!receiver) return res.json({ ok: false, msg: '接收者不存在' });
    // 对方已拉黑我 → 红包消息发不出去，提前拒绝，避免扣了积分对方收不到
    const blocks = readJSON(BLOCKS_FILE);
    if (blocks.some(b => b.blockerId === receiverId && b.blockedId === userId)) {
      return res.json({ ok: false, msg: '你已被对方拉黑，无法发红包' });
    }
  }

  // 群聊红包检查
  if (groupId && !receiverId) {
    const groupMembers = readJSON(GROUP_MEMBERS_FILE);
    const userInGroup = groupMembers.find(m => m.groupId === groupId && m.userId === userId);
    if (!userInGroup) return res.json({ ok: false, msg: '你不在该群聊中' });
  }

  sender.credits = (sender.credits || 0) - numAmount;
  writeJSON(USERS_FILE, users);

  let redpackets = readJSON(REDPACKETS_FILE);
  const nextId = allocId('redpackets');
  
  const perAmount = Math.floor(numAmount / finalCount);
  const remainder = numAmount - perAmount * finalCount; // 整除余数，由最后一个领取者带走

  const redpacket = {
    id: nextId,
    senderId: userId,
    receiverId: receiverId || null,
    groupId: groupId || null,
    totalAmount: numAmount,
    perAmount,
    remainder,
    count: finalCount,
    remaining: finalCount,
    note: (note || '').trim(),
    createdAt: Date.now(),
    status: 'active',
    claims: [],
  };

  redpackets.push(redpacket);
  writeJSON(REDPACKETS_FILE, redpackets);

  res.json({ ok: true, msg: '红包已发送', redpacket });
});

app.post('/api/redpackets/claim', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { redpacketId } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!redpacketId) return res.json({ ok: false, msg: '缺少红包ID' });

  let redpackets = readJSON(REDPACKETS_FILE);
  const redpacket = redpackets.find(r => r.id === redpacketId);

  if (!redpacket) return res.json({ ok: false, msg: '红包不存在' });
  if (redpacket.status !== 'active') return res.json({ ok: false, msg: '红包已失效' });
  if (redpacket.remaining <= 0) return res.json({ ok: false, msg: '红包已领完' });

  // 检查是否已经领取过
  if (Array.isArray(redpacket.claims) && redpacket.claims.some(c => c.userId === userId)) {
    return res.json({ ok: false, msg: '你已经领取过这个红包了' });
  }

  // 验证领取权限
  if (redpacket.groupId) {
    // 群聊红包：检查是否在群里 + 不能抢自己发的红包
    if (redpacket.senderId === userId) return res.json({ ok: false, msg: '不能领取自己发的红包' });
    const groupMembers = readJSON(GROUP_MEMBERS_FILE);
    const inGroup = groupMembers.some(m => m.groupId === redpacket.groupId && m.userId === userId);
    if (!inGroup) return res.json({ ok: false, msg: '你不在该群聊中' });
  } else if (redpacket.receiverId) {
    // 单聊红包
    if (redpacket.receiverId !== userId) return res.json({ ok: false, msg: '这不是你的红包' });
  } else {
    return res.json({ ok: false, msg: '红包无效' });
  }

  users = readJSON(USERS_FILE);
  const receiver = users.find(u => u.id === userId);
  if (!receiver) return res.json({ ok: false, msg: '用户不存在' });

  // 最后一个领取者额外带走整除余数，保证总金额分毫不差
  const isLast = redpacket.remaining === 1;
  const claimAmount = redpacket.perAmount + (isLast ? (redpacket.remainder || 0) : 0);
  receiver.credits = (receiver.credits || 0) + claimAmount;
  redpacket.remaining--;

  // 记录领取
  if (!Array.isArray(redpacket.claims)) {
    redpacket.claims = [];
  }
  redpacket.claims.push({
    userId,
    amount: claimAmount,
    claimedAt: Date.now()
  });

  if (redpacket.remaining <= 0) {
    redpacket.status = 'claimed';
  }

  writeJSON(USERS_FILE, users);
  writeJSON(REDPACKETS_FILE, redpackets);

  res.json({ ok: true, msg: `领取成功，获得 ${claimAmount} 积分`, amount: claimAmount, remaining: redpacket.remaining, claims: redpacket.claims });
});

app.get('/api/redpackets/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const userId = parseInt(req.query.userId) || 0;
  if (!id) return res.json({ ok: false, msg: '缺少红包ID' });

  const redpackets = readJSON(REDPACKETS_FILE);
  const redpacket = redpackets.find(r => r.id === id);

  if (!redpacket) return res.json({ ok: false, msg: '红包不存在' });

  users = readJSON(USERS_FILE);
  const sender = users.find(u => u.id === redpacket.senderId);

  // 领取明细只对参与者可见（发送者 / 单聊接收者 / 领取过的人 / 群成员），避免匿名窥探
  const isParticipant = !!userId && (
    redpacket.senderId === userId ||
    redpacket.receiverId === userId ||
    (Array.isArray(redpacket.claims) && redpacket.claims.some(c => c.userId === userId)) ||
    (redpacket.groupId ? readJSON(GROUP_MEMBERS_FILE).some(m => m.groupId === redpacket.groupId && m.userId === userId) : false)
  );
  const claimsWithUserInfo = isParticipant && Array.isArray(redpacket.claims) ? redpacket.claims.map(c => {
    const user = users.find(u => u.id === c.userId);
    return {
      ...c,
      username: user ? user.username : '未知',
      nickname: user ? user.nickname : '未知'
    };
  }) : [];
  const { claims: _rawClaims, ...redpacketPublic } = redpacket;

  // 检查当前用户是否可以领取
  let canClaim = false;
  let claimStatus = 'unknown';
  if (userId) {
    const alreadyClaimed = Array.isArray(redpacket.claims) && redpacket.claims.some(c => c.userId === userId);
    if (alreadyClaimed) {
      claimStatus = 'claimed';
    } else if (redpacket.status !== 'active') {
      claimStatus = 'expired';
    } else if (redpacket.remaining <= 0) {
      claimStatus = 'empty';
    } else {
      // 检查领取权限
      if (redpacket.groupId) {
        const groupMembers = readJSON(GROUP_MEMBERS_FILE);
        const inGroup = groupMembers.some(m => m.groupId === redpacket.groupId && m.userId === userId);
        canClaim = inGroup;
        claimStatus = canClaim ? 'available' : 'not_allowed';
      } else if (redpacket.receiverId === userId) {
        canClaim = true;
        claimStatus = 'available';
      } else {
        claimStatus = 'not_allowed';
      }
    }
  }

  res.json({
    ok: true,
    redpacket: {
      ...redpacketPublic,
      senderName: sender ? sender.username : '未知',
      senderNickname: sender ? sender.nickname : '未知',
      claims: claimsWithUserInfo,
      claimStatus,
      canClaim
    }
  });
});

// ─── Group APIs ───

// 创建群聊
app.post('/api/groups/create', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const { name, memberIds } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (typeof name !== 'string' || !name.trim()) return res.json({ ok: false, msg: '群聊名称不能为空' });
  if (name.trim().length > 30) return res.json({ ok: false, msg: '群聊名称不能超过30个字符' });
  if (!Array.isArray(memberIds) || memberIds.length === 0) return res.json({ ok: false, msg: '至少需要添加一个成员' });

  // 验证成员是否存在
  users = readJSON(USERS_FILE);
  const validMembers = memberIds.filter(id => users.some(u => u.id === id));
  if (validMembers.length === 0) return res.json({ ok: false, msg: '没有有效的成员' });

  // 创建群聊
  let groups = readJSON(GROUPS_FILE);
  const nextGroupId = allocId('groups');
  
  const group = {
    id: nextGroupId,
    name: name.trim(),
    creatorId: userId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  groups.push(group);
  writeJSON(GROUPS_FILE, groups);

  // 添加群成员（包括创建者）
  let groupMembers = readJSON(GROUP_MEMBERS_FILE);
  const allMemberIds = [...new Set([userId, ...validMembers])]; // 去重，确保创建者也在成员列表中
  
  allMemberIds.forEach(memberId => {
    groupMembers.push({
      groupId: nextGroupId,
      userId: memberId,
      role: memberId === userId ? 'owner' : 'member',
      joinedAt: Date.now()
    });
  });
  writeJSON(GROUP_MEMBERS_FILE, groupMembers);

  res.json({ ok: true, group });
});

// 添加群成员
app.post('/api/groups/:groupId/members', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const groupId = parseInt(req.params.groupId);
  const { memberIds } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!groupId) return res.json({ ok: false, msg: '缺少群聊ID' });
  if (!Array.isArray(memberIds) || memberIds.length === 0) return res.json({ ok: false, msg: '至少需要添加一个成员' });

  // 检查用户是否是群聊成员，且只有群主能拉人
  let groupMembers = readJSON(GROUP_MEMBERS_FILE);
  const userMembership = groupMembers.find(m => m.groupId === groupId && m.userId === userId);
  if (!userMembership) return res.json({ ok: false, msg: '你不是该群聊的成员' });
  if (userMembership.role !== 'owner') return res.json({ ok: false, msg: '只有群主才能添加成员' });

  // 验证成员是否存在
  users = readJSON(USERS_FILE);
  const validMembers = memberIds.filter(id => users.some(u => u.id === id));
  if (validMembers.length === 0) return res.json({ ok: false, msg: '没有有效的成员' });

  // 检查成员是否已经在群里
  const existingMembers = groupMembers.filter(m => m.groupId === groupId).map(m => m.userId);
  const newMembers = validMembers.filter(id => !existingMembers.includes(id));

  if (newMembers.length === 0) return res.json({ ok: false, msg: '所有成员都已经在群里了' });

  // 添加新成员
  newMembers.forEach(memberId => {
    groupMembers.push({
      groupId,
      userId: memberId,
      role: 'member',
      joinedAt: Date.now()
    });
  });
  writeJSON(GROUP_MEMBERS_FILE, groupMembers);

  res.json({ ok: true, added: newMembers.length });
});

// 获取用户的群聊列表
app.get('/api/groups', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  if (!userId) return res.json({ ok: true, groups: [] });

  let groupMembers = readJSON(GROUP_MEMBERS_FILE);
  let groups = readJSON(GROUPS_FILE);
  
  // 获取用户加入的群聊 ID
  const userGroups = groupMembers
    .filter(m => m.userId === userId)
    .map(m => m.groupId);

  // 获取群聊详情
  const result = groups
    .filter(g => userGroups.includes(g.id))
    .map(g => {
      // 获取群成员数量
      const memberCount = groupMembers.filter(m => m.groupId === g.id).length;
      return {
        ...g,
        memberCount
      };
    });

  res.json({ ok: true, groups: result });
});

// 获取群聊详情
app.get('/api/groups/:groupId', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  const groupId = parseInt(req.params.groupId);

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!groupId) return res.json({ ok: false, msg: '缺少群聊ID' });

  // 检查用户是否是群聊成员
  let groupMembers = readJSON(GROUP_MEMBERS_FILE);
  const userMembership = groupMembers.find(m => m.groupId === groupId && m.userId === userId);
  if (!userMembership) return res.json({ ok: false, msg: '你不是该群聊的成员' });

  // 获取群聊信息
  let groups = readJSON(GROUPS_FILE);
  const group = groups.find(g => g.id === groupId);
  if (!group) return res.json({ ok: false, msg: '群聊不存在' });

  // 获取群成员信息
  users = readJSON(USERS_FILE);
  const members = groupMembers
    .filter(m => m.groupId === groupId)
    .map(m => {
      const user = users.find(u => u.id === m.userId);
      return {
        id: m.userId,
        username: user ? user.username : '未知',
        nickname: user ? user.nickname : '未知',
        role: m.role
      };
    });

  res.json({ ok: true, group: { ...group, members } });
});

// 修改群聊名称
app.put('/api/groups/:groupId', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const groupId = parseInt(req.params.groupId);
  const { name } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!groupId) return res.json({ ok: false, msg: '缺少群聊ID' });
  if (typeof name !== 'string' || !name.trim()) return res.json({ ok: false, msg: '群聊名称不能为空' });
  if (name.trim().length > 30) return res.json({ ok: false, msg: '群聊名称不能超过30个字符' });

  // 检查用户是否是群主
  let groupMembers = readJSON(GROUP_MEMBERS_FILE);
  const userMembership = groupMembers.find(m => m.groupId === groupId && m.userId === userId);
  if (!userMembership) return res.json({ ok: false, msg: '你不是该群聊的成员' });
  if (userMembership.role !== 'owner') return res.json({ ok: false, msg: '只有群主才能修改群聊名称' });

  // 修改群聊名称
  let groups = readJSON(GROUPS_FILE);
  const group = groups.find(g => g.id === groupId);
  if (!group) return res.json({ ok: false, msg: '群聊不存在' });

  group.name = name.trim();
  group.updatedAt = Date.now();
  writeJSON(GROUPS_FILE, groups);

  res.json({ ok: true, group });
});

// 发送群消息（支持引用回复 replyToId 与 @提及）
app.post('/api/groups/:groupId/messages', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const groupId = parseInt(req.params.groupId);
  const { content, type, redpacketId, replyToId, fileUrl, fileName, fileSize } = req.body;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!groupId) return res.json({ ok: false, msg: '缺少群聊ID' });
  if (typeof content !== 'string' || !content.trim()) return res.json({ ok: false, msg: '消息不能为空' });
  if (content.length > 4000) return res.json({ ok: false, msg: '消息不能超过4000字' });
  if (fileName != null && (typeof fileName !== 'string' || fileName.length > 255)) {
    return res.json({ ok: false, msg: '文件名过长或无效' });
  }
  if (fileSize != null && (!Number.isFinite(Number(fileSize)) || Number(fileSize) < 0)) {
    return res.json({ ok: false, msg: '文件大小无效' });
  }
  if (fileUrl != null && (typeof fileUrl !== 'string' || !fileUrl.startsWith('/uploads/'))) {
    return res.json({ ok: false, msg: '文件地址无效' });
  }

  // 检查用户是否是群聊成员
  let groupMembers = readJSON(GROUP_MEMBERS_FILE);
  const userMembership = groupMembers.find(m => m.groupId === groupId && m.userId === userId);
  if (!userMembership) return res.json({ ok: false, msg: '你不是该群聊的成员' });

  // 引用校验：被引用的消息必须存在于该群
  let validReplyToId = null;
  if (replyToId) {
    const allMsgs = readJSON(GROUP_MESSAGES_FILE);
    const replied = allMsgs.find(m => m.id === replyToId && m.groupId === groupId);
    if (!replied) return res.json({ ok: false, msg: '引用的消息不存在' });
    validReplyToId = replyToId;
  }

  // 发送群消息
  let groupMessages = readJSON(GROUP_MESSAGES_FILE);
  const nextId = nextGroupMessageId();

  const msg = {
    id: nextId,
    groupId,
    senderId: userId,
    content: content.trim(),
    type: type || 'text',
    redpacketId: redpacketId || null,
    replyToId: validReplyToId,
    mentions: parseMentions(content, groupId),
    fileUrl: fileUrl || null,
    fileName: fileName || null,
    fileSize: fileSize || null,
    timestamp: Date.now()
  };

  groupMessages.push(msg);
  writeJSON(GROUP_MESSAGES_FILE, groupMessages);

  res.json({ ok: true, message: msg });
});

// 获取群消息（含引用预览 / 红包状态 / 是否提及我 / 变更同步）
app.get('/api/groups/:groupId/messages', (req, res) => {
  const userId = parseInt(req.query.userId) || 0;
  const groupId = parseInt(req.params.groupId);
  const after = parseInt(req.query.after) || 0;
  const changedAfter = parseInt(req.query.changedAfter) || 0;

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!groupId) return res.json({ ok: false, msg: '缺少群聊ID' });

  // 检查用户是否是群聊成员
  let groupMembers = readJSON(GROUP_MEMBERS_FILE);
  const userMembership = groupMembers.find(m => m.groupId === groupId && m.userId === userId);
  if (!userMembership) return res.json({ ok: false, msg: '你不是该群聊的成员' });

  // 获取群消息
  let groupMessages = readJSON(GROUP_MESSAGES_FILE);
  const inGroup = groupMessages.filter(m => m.groupId === groupId);
  let messages = inGroup
    .filter(m => m.id > after && !m.deleted)
    .sort((a, b) => a.timestamp - b.timestamp);
  const changed = changedAfter
    ? inGroup.filter(m => m.id <= after && (m.updatedAt || 0) >= changedAfter)
    : [];

  // 添加发送者信息 + 红包状态 + 引用预览 + 提及标记
  const decorate = (list) => {
    users = readJSON(USERS_FILE);
    let out = list.map(m => {
      const sender = users.find(u => u.id === m.senderId);
      return {
        ...m,
        senderName: sender ? sender.username : '未知',
        senderNickname: sender ? sender.nickname : '未知',
        mentionedMe: Array.isArray(m.mentions) && m.mentions.includes(userId),
      };
    });
    out = attachRedpacketStatus(out, userId);
    out = attachReplyPreview(out, groupMessages);
    return out;
  };

  res.json({ ok: true, messages: decorate(messages), changed: decorate(changed), serverTime: Date.now() });
});

// 删除单条群消息（发送者或群主可删）
app.delete('/api/groups/:groupId/messages/:messageId', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const groupId = parseInt(req.params.groupId);
  const messageId = parseInt(req.params.messageId);

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!groupId || !messageId) return res.json({ ok: false, msg: '缺少参数' });

  let groupMessages = readJSON(GROUP_MESSAGES_FILE);
  const msg = groupMessages.find(m => m.id === messageId && m.groupId === groupId);
  if (!msg) return res.json({ ok: false, msg: '消息不存在' });
  if (msg.deleted) return res.json({ ok: false, msg: '消息已删除' });

  const groupMembers = readJSON(GROUP_MEMBERS_FILE);
  const membership = groupMembers.find(m => m.groupId === groupId && m.userId === userId);
  if (!membership) return res.json({ ok: false, msg: '你不是该群聊的成员' });
  if (msg.senderId !== userId && membership.role !== 'owner') {
    return res.json({ ok: false, msg: '只能删除自己的消息（群主可删任意）' });
  }

  // 墓碑标记：清空内容并置 deleted，对端轮询到变更后本地移除
  msg.deleted = true;
  msg.content = '';
  msg.fileUrl = null;
  msg.fileName = null;
  msg.fileSize = null;
  msg.updatedAt = Date.now();
  writeJSON(GROUP_MESSAGES_FILE, groupMessages);
  res.json({ ok: true });
});

// 撤回群消息（发送者 5 分钟内，文本消息）
app.post('/api/groups/:groupId/messages/:messageId/recall', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const groupId = parseInt(req.params.groupId);
  const messageId = parseInt(req.params.messageId);

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!groupId || !messageId) return res.json({ ok: false, msg: '缺少参数' });

  let groupMessages = readJSON(GROUP_MESSAGES_FILE);
  const msg = groupMessages.find(m => m.id === messageId && m.groupId === groupId);
  if (!msg) return res.json({ ok: false, msg: '消息不存在' });
  if (msg.deleted) return res.json({ ok: false, msg: '消息已删除' });
  if (msg.senderId !== userId) return res.json({ ok: false, msg: '只能撤回自己的消息' });
  if (msg.type === 'redpacket' || msg.redpacketId) return res.json({ ok: false, msg: '红包消息不能撤回' });
  if (msg.deleted) return res.json({ ok: false, msg: '消息已删除' });
  if (msg.recalled) return res.json({ ok: false, msg: '消息已撤回' });
  if (!Number.isFinite(msg.timestamp) || Date.now() - msg.timestamp > 5 * 60 * 1000) {
    return res.json({ ok: false, msg: '超过5分钟，无法撤回' });
  }

  msg.recalled = true;
  msg.content = '';
  msg.fileUrl = null;
  msg.fileName = null;
  msg.fileSize = null;
  msg.updatedAt = Date.now();
  writeJSON(GROUP_MESSAGES_FILE, groupMessages);
  res.json({ ok: true, message: msg });
});

// 退出群聊
app.delete('/api/groups/:groupId/members', (req, res) => {
  const userId = parseInt(req.headers['x-user-id']) || 0;
  const groupId = parseInt(req.params.groupId);

  if (!userId) return res.json({ ok: false, msg: '未登录' });
  if (!groupId) return res.json({ ok: false, msg: '缺少群聊ID' });

  // 检查用户是否是群聊成员
  let groupMembers = readJSON(GROUP_MEMBERS_FILE);
  const userMembership = groupMembers.find(m => m.groupId === groupId && m.userId === userId);
  if (!userMembership) return res.json({ ok: false, msg: '你不是该群聊的成员' });

  // 检查是否是群主
  if (userMembership.role === 'owner') {
    // 群主不能退出群聊，只能解散群聊
    return res.json({ ok: false, msg: '群主不能退出群聊，请解散群聊' });
  }

  // 移除成员
  groupMembers = groupMembers.filter(m => !(m.groupId === groupId && m.userId === userId));
  writeJSON(GROUP_MEMBERS_FILE, groupMembers);

  res.json({ ok: true });
});

// ─── Health ───
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'tang-chat-api', uptime: Math.round(process.uptime()), time: Date.now() });
});

// 当前前端构建版本（用于页面自动更新检测）
app.get('/api/version', (req, res) => {
  try {
    const assetsDir = join(__dirname, '..', 'dist', 'assets');
    const files = readdirSync(assetsDir).filter(f => /^index-.*\.js$/.test(f));
    res.json({ ok: true, appJs: files[0] || null });
  } catch {
    res.json({ ok: true, appJs: null });
  }
});

// ─── Start ───
export default app;

// 启动时清理过期墓碑消息（删除/撤回标记超过 7 天的记录），避免数据文件无限膨胀
function purgeStaleTombstones() {
  const now = Date.now();
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  for (const file of [MESSAGES_FILE, GROUP_MESSAGES_FILE]) {
    try {
      const list = readJSON(file);
      if (!Array.isArray(list) || list.length === 0) continue;
      const kept = list.filter(m => !(m.deleted && (now - (m.updatedAt || m.timestamp || 0)) > WEEK));
      if (kept.length !== list.length) {
        writeJSON(file, kept);
        console.log(`[purge] ${file}: 清理墓碑消息 ${list.length - kept.length} 条`);
      }
    } catch (err) {
      console.error(`[purge] ${file} 清理失败: ${err.message}`);
    }
  }
}
purgeStaleTombstones();
initCounter();
migrateSuperAdmin();

// 仅当直接运行本文件时才监听端口（被 server.prod.js import 时不重复监听）
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const PORT = parseInt(process.env.PORT, 10) || 3001;
  app.listen(PORT, () => {
    console.log('PureChat server running at http://localhost:' + PORT);
  });
}
