import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageCircle, Users, User, Settings, Smile,
  UserPlus, Search, Shield, Ban, RotateCcw, Trash2, UserCheck, UserX,
  Mic, ShoppingBag, Package, ShoppingCart, Plus, X, Coins,
  Star, ArrowRightLeft, Edit3, Heart, Gift, Check, Reply,
  Image as ImageIcon, Paperclip, FileText, Pin, Bell, BellOff, Download, Crown, Megaphone, Eye
} from 'lucide-react';

// 由 vite define 注入的构建时间（用于确认页面是否最新）
declare const __BUILD_TIME__: string;

/* ═══════════════════════════════════════
   Types
   ═══════════════════════════════════════ */
interface ChatUser {
  id: number;
  username: string;
  nickname: string;
  online?: boolean;
  role?: string;
  addedBy?: number | null;
  confirmed?: boolean;
  avatar?: string;
  bio?: string;
  credits?: number;
}

interface Message {
  id: string;
  senderId: number;
  content: string;
  timestamp: Date;
}

interface Conversation {
  id: string;
  peerId: number;
  peerName: string;
  peerColor: string;
  messages: ChatMessage[];
  unread: number;
  lastMessage?: { content: string; timestamp: Date };
}

interface AdminUser {
  id: number;
  username: string;
  nickname: string;
  role: string;
  disabled: boolean;
  createdAt: string | null;
  credits?: number;
}

interface ServerStats {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  adminCount: number;
  superAdminCount?: number;
  totalMessages: number;
  totalGroups?: number;
  totalFriendships: number;
  announcement?: string;
  registrationOpen?: boolean;
}

interface AdminGroup {
  id: number;
  name: string;
  memberCount: number;
  messageCount: number;
  ownerId: number | null;
  ownerName: string;
  createdAt: number | null;
}

interface Category {
  id: number;
  name: string;
  icon: string;
  color: string;
}

interface Rating {
  id: number;
  userId: number;
  itemId: number;
  rating: number;
  comment: string;
  username?: string;
  nickname?: string;
  createdAt: number;
  updatedAt?: number;
}

interface Transfer {
  id: number;
  senderId: number;
  receiverId: number;
  amount: number;
  note: string;
  senderName?: string;
  receiverName?: string;
  type: 'in' | 'out';
  createdAt: number;
}

interface Redpacket {
  id: number;
  senderId: number;
  receiverId: number;
  totalAmount: number;
  perAmount: number;
  count: number;
  remaining: number;
  note: string;
  senderName?: string;
  senderNickname?: string;
  status: 'active' | 'claimed' | 'expired';
  createdAt: number;
}

interface Group {
  id: number;
  name: string;
  creatorId: number;
  memberCount: number;
  members?: GroupMember[];
  createdAt: number;
  updatedAt: number;
}

interface GroupMember {
  id: number;
  username: string;
  nickname: string;
  role: 'owner' | 'member';
}

interface GroupMessage {
  id: number;
  groupId: number;
  senderId: number;
  senderName?: string;
  senderNickname?: string;
  content: string;
  type?: 'text' | 'redpacket' | 'image' | 'file';
  redpacketId?: number;
  redpacketStatus?: 'active' | 'claimed' | 'expired' | 'my_claimed';
  replyToId?: number | null;
  replyTo?: { id: number; senderId: number; senderName: string; content: string; type: string } | null;
  recalled?: boolean;
  mentions?: number[];
  mentionedMe?: boolean;
  deleted?: boolean;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  timestamp: number;
}

interface ChatMessage extends Message {
  type?: 'text' | 'redpacket' | 'image' | 'file';
  redpacketId?: number;
  redpacketStatus?: 'active' | 'claimed' | 'expired' | 'my_claimed';
  replyToId?: number | null;
  replyTo?: { id: number; senderId: number; senderName: string; content: string; type: string } | null;
  recalled?: boolean;
  read?: boolean;
  deleted?: boolean;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

/* ═══════════════════════════════════════
   Constants
   ═══════════════════════════════════════ */
const API = '/api';
const STORAGE_KEY = 'purechat_user';
const THEME_KEY = 'purechat_theme';
// 主题配色：id 对应 index.css 里的 :root[data-theme="id"]
const THEMES = [
  { id: 'mist', name: '晨雾绿', colors: ['#0ea371', '#10301f'] },
  { id: 'ocean', name: '海盐蓝', colors: ['#2f8fe0', '#0e2b44'] },
  { id: 'sakura', name: '樱粉', colors: ['#ec6fa5', '#3d1626'] },
  { id: 'sunset', name: '落日橙', colors: ['#f07d3c', '#3a2411'] },
  { id: 'peach', name: '蜜桃橙', colors: ['#ff9a6b', '#45281a'] },
  { id: 'white', name: '纯白', colors: ['#4b5563', '#ffffff'] },
  { id: 'night', name: '暗夜绿', colors: ['#2bb673', '#0d2417'] },
  { id: 'midnight', name: '午夜紫', colors: ['#8b5cf6', '#201630'] },
];
const EMOJIS = ['😀','😂','🤣','😊','😍','🥰','😘','😜','🤔','😅','😢','😭','🤗','😎','🥳','😴','👍','👎','❤️','🔥','⭐','🎉','💪','🙏','👋','✅','💯','🚀','☕','🍕','😎'];
const COLORS = ['#1890ff','#722ed1','#eb2f96','#fa8c16','#52c41a','#13c2c2','#f5222d','#2f54eb','#faad14','#a0d911'];
function pickColor(id: number) { return COLORS[id % COLORS.length]; }

// 头像内容：支持上传的图片地址（/uploads/...）或 emoji/文字
function AvatarContent({ avatar, fallback }: { avatar?: string | null; fallback: string }) {
  if (avatar && avatar.startsWith('/uploads/')) {
    return <img className="avatar-img" src={avatar} alt="头像" />;
  }
  return <>{avatar || fallback}</>;
}

// 下载文件/图片：用 Blob 触发浏览器下载，保留原始文件名（支持中文）
async function downloadFile(url: string, fileName?: string | null) {
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  } catch {
    // 兜底：直接打开（浏览器会按服务器 Content-Disposition 处理）
    window.open(url, '_blank');
  }
}

// 渲染消息内容，高亮 @提及（前向否定：避免把 email@x.com、a@b 这类误判为提及）
function renderWithMentions(content: string) {
  const parts = content.split(/(?<![\w.])@[\u4e00-\u9fa5A-Za-z0-9_\-]+/g);
  return (
    <>
      {parts.map((p, i) =>
        /^@[\u4e00-\u9fa5A-Za-z0-9_\-]+$/.test(p)
          ? <span key={i} className="msg-mention">{p}</span>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

// 工具栏里的图片/文件发送按钮（内部处理文件读取与上传）
function FileSendButton({ kind, onUpload, onPicked }: {
  kind: 'image' | 'file';
  onUpload: (file: File) => Promise<{ url: string; name: string; size: number } | null>;
  onPicked: (info: { url: string; name: string; size: number }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    const info = await onUpload(file);
    setBusy(false);
    if (info) onPicked(info);
  };
  return (
    <label className={`toolbar-btn ${busy ? 'file-btn-busy' : ''}`} title={kind === 'image' ? '发送图片' : '发送文件'}>
      <input type="file" accept={kind === 'image' ? 'image/*' : undefined} style={{ display: 'none' }} onChange={handle} disabled={busy} />
      {busy ? <span style={{ fontSize: 10, fontWeight: 700 }}>…</span> : (kind === 'image' ? <ImageIcon size={18} /> : <Paperclip size={18} />)}
    </label>
  );
}

/* ═══════════════════════════════════════
   API helpers
   ═══════════════════════════════════════ */

function getStoredUser(): any {
  try {
    const s = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function getStorageUserId(): number {
  return getStoredUser()?.id || 0;
}

function getAuthToken(): string {
  return getStoredUser()?.token || '';
}

// 统一的鉴权头：Bearer token + X-User-Id（兼容旧接口）
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const uid = getStorageUserId();
  if (uid) headers['X-User-Id'] = String(uid);
  return headers;
}

// 会话失效（未登录 / 令牌过期 / 账号被禁用）→ 清除本地登录态并回到登录页
function handleAuthFailure() {
  sessionStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}

async function apiPost(path: string, body: Record<string, unknown>, _userId?: number) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) { handleAuthFailure(); return { ok: false, msg: '未登录' }; }
  return res.json();
}

async function apiGet(path: string, userId?: number) {
  const uid = userId || getStorageUserId();
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}${path}${sep}userId=${uid}`, { headers: authHeaders() });
  if (res.status === 401 || res.status === 403) { handleAuthFailure(); return { ok: false, msg: '未登录' }; }
  return res.json();
}

async function apiPut(path: string, body: Record<string, unknown>, _userId?: number) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) { handleAuthFailure(); return { ok: false, msg: '未登录' }; }
  return res.json();
}

async function apiDelete(path: string, userId?: number) {
  const uid = userId || getStorageUserId();
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}${path}${sep}userId=${uid}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (res.status === 401 || res.status === 403) { handleAuthFailure(); return { ok: false, msg: '未登录' }; }
  return res.json();
}

/* ═══════════════════════════════════════
   Logo Component
   ═══════════════════════════════════════ */
function Logo() {
  return (
    <div className="logo-wrapper">
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#07c160" />
            <stop offset="100%" stopColor="#05a550" />
          </linearGradient>
        </defs>
        <circle cx="28" cy="28" r="26" fill="url(#logoGradient)" />
        <path d="M18 22C18 20.8954 18.8954 20 20 20H36C37.1046 20 38 20.8954 38 22V32C38 33.1046 37.1046 34 36 34H32L28 38L24 34H20C18.8954 34 18 33.1046 18 32V22Z" fill="white" />
        <circle cx="24" cy="27" r="2" fill="#07c160" />
        <circle cx="32" cy="27" r="2" fill="#07c160" />
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════
   Auth: Login
   ═══════════════════════════════════════ */
function LoginPage({ onLogin, onGoRegister }: { onLogin: (u: ChatUser) => void; onGoRegister: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) { setError('请填写用户名和密码'); return; }
    setLoading(true); setError('');
    try {
      const res = await apiPost('/login', { username: username.trim(), password });
      if (res.ok) { onLogin(res.user); }
      else { setError(res.msg || '登录失败'); }
    } catch { setError('网络错误，请检查后端是否启动'); }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
            <Logo />
            <h1>塔菲们的聊天</h1>
            <p>糖糖们的聊天室</p>
          </div>
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>用户名</label>
            <input placeholder="请输入用户名" value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div className="auth-field">
            <label>密码</label>
            <input type="password" placeholder="请输入密码" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <div className="auth-error">{error}</div>
          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
        <div className="auth-footer">
          没有账号？<a onClick={onGoRegister}>去注册</a>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════
   Auth: Register
   ═══════════════════════════════════════ */
function RegisterPage({ onLogin, onGoLogin }: { onLogin: (u: ChatUser) => void; onGoLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) { setError('请输入用户名'); return; }
    if (username.trim().length < 2) { setError('用户名至少2个字符'); return; }
    if (password.length < 6) { setError('密码至少6个字符'); return; }
    if (password !== confirm) { setError('两次密码不一致'); return; }
    setLoading(true); setError('');
    try {
      const res = await apiPost('/register', { username: username.trim(), password });
      if (res.ok) { onLogin(res.user); }
      else { setError(res.msg || '注册失败'); }
    } catch { setError('网络错误'); }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <Logo />
          <h1>塔菲们的聊天</h1>
          <p>加入糖糖们的聊天室</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>用户名</label>
            <input placeholder="2~20个字符" value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div className="auth-field">
            <label>密码</label>
            <input type="password" placeholder="至少6个字符" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <div className="auth-field">
            <label>确认密码</label>
            <input type="password" placeholder="再输入一次密码" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </div>
          <div className="auth-error">{error}</div>
          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? '注册中...' : '注册'}
          </button>
        </form>
        <div className="auth-footer">
          已有账号？<a onClick={onGoLogin}>去登录</a>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════
   ChatView
   ═══════════════════════════════════════ */
function ChatView({ conversation, currentUser, onSend, isBlockedByPeer, isPeerBlocked, onTransfer, onRedpacket, onRedpacketClick, onDeleteChat, onRead, onDeleteMessage, onRecallMessage, onUpload, onSendMedia, settings, onTogglePin, onToggleMute }: {
  conversation: Conversation; currentUser: ChatUser;
  onSend: (convId: string, content: string, replyToId?: number) => void;
  onTransfer: (peerId: number, peerName: string) => void;
  onRedpacket: (peerId: number, peerName: string) => void;
  onRedpacketClick: (redpacketId: number) => void;
  onDeleteChat: (peerId: number) => void;
  onRead: (peerId: number) => void;
  onDeleteMessage: (peerId: number, messageId: number) => void;
  onRecallMessage: (peerId: number, messageId: number) => void;
  onUpload: (file: File) => Promise<{ url: string; name: string; size: number } | null>;
  onSendMedia: (convId: string, info: { url: string; name: string; size: number }, kind: 'image' | 'file', replyToId?: number) => void;
  settings?: { pinned: boolean; muted: boolean };
  onTogglePin: (peerId: number) => void;
  onToggleMute: (peerId: number) => void;
  isBlockedByPeer?: boolean; isPeerBlocked?: boolean;
}) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // 定时刷新时间基准：让"5分钟可撤回"的按钮在超时后自动置灰（无需重新渲染触发）
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const recognitionRef = useRef<any>(null);
  const voiceBaseTextRef = useRef<string>('');
  const textRef = useRef(text);
  textRef.current = text;

  // 记录是否贴近底部：翻历史时不打扰，贴近底部才自动滚到最新
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => { nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (nearBottomRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.messages.length]);

  // 进入会话 / 收到新消息时上报已读
  useEffect(() => {
    onRead(conversation.peerId);
  }, [conversation.peerId, conversation.messages.length]);

  // 初始化语音识别
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceSupported(false); return; }
    setVoiceSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (e: any) => {
      // 取当前这一段识别的完整结果（最后一次的 transcript 最准确）
      const lastResult = e.results[e.results.length - 1];
      const transcript = lastResult[0].transcript;
      // 用录音前的文本 + 本次识别结果拼接（不重复追加）
      const base = voiceBaseTextRef.current;
      const separator = base && !base.endsWith(' ') && !transcript.startsWith(' ') ? ' ' : '';
      setText(base + separator + transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    return () => { recognition.abort(); };
  }, []);

  const toggleVoice = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
    } else {
      voiceBaseTextRef.current = textRef.current; // 记住录音前的文本
      setIsListening(true);
      recognition.start();
    }
  };

  const handleSend = () => {
    if (!text.trim()) return;
    // ChatMessage.id 是前端前缀字符串（server-<数字>），转成后端数字 id
    const replyToServerId = replyTo ? Number(String(replyTo.id).replace('server-', '')) || undefined : undefined;
    onSend(conversation.id, text, replyToServerId);
    setText(''); setShowEmoji(false); setReplyTo(null);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <>
      <div className="chat-header">
        <span>{conversation.peerName}</span>
        <div className="chat-header-btns">
          <button
            className={`chat-header-btn ${settings?.pinned ? 'is-active' : ''}`}
            onClick={() => onTogglePin(conversation.peerId)}
            title={settings?.pinned ? '取消置顶' : '置顶会话'}
          >
            <Pin size={16} />
          </button>
          <button
            className={`chat-header-btn ${settings?.muted ? 'is-active' : ''}`}
            onClick={() => onToggleMute(conversation.peerId)}
            title={settings?.muted ? '取消免打扰' : '开启免打扰'}
          >
            {settings?.muted ? <BellOff size={16} /> : <Bell size={16} />}
          </button>
          <button className="chat-header-btn" onClick={() => {
            if (confirm(`确定要删除与 ${conversation.peerName} 的聊天记录吗？`)) {
              onDeleteChat(conversation.peerId);
            }
          }} title="删除聊天记录">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="chat-messages" ref={listRef}>
        {isPeerBlocked && (
          <div className="block-notice">你已拉黑对方</div>
        )}
        {isBlockedByPeer && (
          <div className="block-notice blocked-by-notice">你已被对方拉黑，无法发送消息</div>
        )}
        {conversation.messages.map(msg => {
          const isSelf = msg.senderId === currentUser.id;
          const chatMsg = msg as ChatMessage;
          const msgAge = now - new Date(msg.timestamp).getTime();
          const canRecall = isSelf && chatMsg.type !== 'redpacket' && !chatMsg.recalled && msgAge < 5 * 60 * 1000;
          const recallExpired = isSelf && chatMsg.type !== 'redpacket' && !chatMsg.recalled && msgAge >= 5 * 60 * 1000;
          const msgKeyId = typeof msg.id === 'string' && msg.id.startsWith('server-') ? Number(msg.id.slice(7)) : (typeof msg.id === 'number' ? msg.id : 0);
          const canReply = msgKeyId > 0;
          const actions = (
            <div className="msg-actions">
              <button className="msg-action" title={canReply ? '回复' : '消息发送中，暂不可回复'} disabled={!canReply} onClick={() => canReply && setReplyTo(chatMsg)}>
                <Reply size={12} />
              </button>
              {(canRecall || recallExpired) && (
                <button
                  className={`msg-action ${recallExpired ? 'msg-action-disabled' : ''}`}
                  title={recallExpired ? '发送超过5分钟，无法撤回' : '撤回'}
                  disabled={recallExpired || msgKeyId <= 0}
                  onClick={() => onRecallMessage(conversation.peerId, msgKeyId)}
                >
                  <RotateCcw size={12} />
                </button>
              )}
              <button
                className="msg-action msg-action-danger"
                title="删除（双方都会删除）"
                disabled={msgKeyId <= 0}
                onClick={() => {
                  if (msgKeyId > 0 && confirm('删除这条消息？双方都会看不到（不可恢复）')) {
                    onDeleteMessage(conversation.peerId, msgKeyId);
                  }
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
          return (
            <div key={msg.id} className={`msg-row ${isSelf ? 'self' : ''}`}>
              <div className="msg-avatar" style={{ background: isSelf ? pickColor(currentUser.id) : conversation.peerColor }}>
                {isSelf ? currentUser.username[0].toUpperCase() : conversation.peerName[0].toUpperCase()}
              </div>
              <div className="msg-main">
                {chatMsg.recalled ? (
                  <div className="msg-content msg-recalled">
                    {isSelf ? '你撤回了一条消息' : '对方撤回了一条消息'}
                  </div>
                ) : chatMsg.type === 'redpacket' ? (
                  <div
                    className="msg-content redpacket-msg"
                    style={{cursor: 'pointer', background: chatMsg.redpacketStatus === 'active' ? '#fff3e0' : '#f5f5f5'}}
                    onClick={() => {
                      if (chatMsg.redpacketId) {
                        onRedpacketClick(chatMsg.redpacketId);
                      }
                    }}
                  >
                    <div style={{fontSize:'20px',marginBottom:'4px'}}>🧧</div>
                    <div style={{fontSize:'12px',color:'#888'}}>{msg.content}</div>
                  </div>
                ) : chatMsg.type === 'image' ? (
                  <div className="msg-bubble">
                    {chatMsg.replyTo && (
                      <div className="msg-reply">
                        <span className="msg-reply-name">{chatMsg.replyTo.senderName}</span>
                        <span className="msg-reply-content">{chatMsg.replyTo.content}</span>
                      </div>
                    )}
                    <div className="msg-image-wrap">
                      <img
                        className="msg-image"
                        src={chatMsg.fileUrl || undefined}
                        alt={chatMsg.fileName || '图片'}
                        onClick={() => chatMsg.fileUrl && window.open(chatMsg.fileUrl, '_blank')}
                      />
                      <button
                        className="msg-download-btn"
                        title="下载图片"
                        onClick={(e) => { e.stopPropagation(); downloadFile(chatMsg.fileUrl || '', chatMsg.fileName || '图片.png'); }}
                      >
                        <Download size={14} />
                      </button>
                    </div>
                    {actions}
                  </div>
                ) : chatMsg.type === 'file' ? (
                  <div className="msg-bubble">
                    {chatMsg.replyTo && (
                      <div className="msg-reply">
                        <span className="msg-reply-name">{chatMsg.replyTo.senderName}</span>
                        <span className="msg-reply-content">{chatMsg.replyTo.content}</span>
                      </div>
                    )}
                    <div className="msg-file">
                      <FileText size={20} onClick={() => chatMsg.fileUrl && window.open(chatMsg.fileUrl, '_blank')} />
                      <div className="msg-file-info" onClick={() => chatMsg.fileUrl && window.open(chatMsg.fileUrl, '_blank')}>
                        <div className="msg-file-name">{chatMsg.fileName || msg.content}</div>
                        {chatMsg.fileSize ? <div className="msg-file-size">{Math.round(chatMsg.fileSize / 1024)} KB</div> : null}
                      </div>
                      <button
                        className="msg-file-download"
                        title="下载文件"
                        onClick={(e) => { e.stopPropagation(); downloadFile(chatMsg.fileUrl || '', chatMsg.fileName || 'download'); }}
                      >
                        <Download size={15} />
                      </button>
                    </div>
                    {actions}
                  </div>
                ) : (
                  <div className="msg-bubble">
                    {chatMsg.replyTo && (
                      <div className="msg-reply">
                        <span className="msg-reply-name">{chatMsg.replyTo.senderName}</span>
                        <span className="msg-reply-content">{chatMsg.replyTo.content}</span>
                      </div>
                    )}
                    <div className="msg-content">{msg.content}</div>
                    {actions}
                  </div>
                )}
                {isSelf && !chatMsg.recalled && (
                  <div className="msg-status">{chatMsg.read ? '已读' : '未读'}</div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="chat-input-area">
        {replyTo && (
          <div className="reply-bar">
            <div className="reply-bar-info">
              <span className="reply-bar-name">
                <Reply size={11} /> 回复 {replyTo.senderId === currentUser.id ? '自己' : conversation.peerName}
              </span>
              <span className="reply-bar-content">{replyTo.content}</span>
            </div>
            <button className="reply-bar-close" onClick={() => setReplyTo(null)}><X size={14} /></button>
          </div>
        )}
        <div className="chat-toolbar">
          <div className="toolbar-wrapper">
            <button className="toolbar-btn redpacket-btn" onClick={() => {
              onRedpacket(conversation.peerId, conversation.peerName);
            }}>
              <Gift size={18} />
              <span className="btn-label">发红包</span>
            </button>
            <button className="toolbar-btn" onClick={() => setShowEmoji(v => !v)}><Smile size={18} /></button>
            <FileSendButton kind="image" onUpload={onUpload} onPicked={(info) => { onSendMedia(conversation.id, info, 'image', replyTo ? Number(String(replyTo.id).replace('server-', '')) : undefined); setReplyTo(null); }} />
            <FileSendButton kind="file" onUpload={onUpload} onPicked={(info) => { onSendMedia(conversation.id, info, 'file', replyTo ? Number(String(replyTo.id).replace('server-', '')) : undefined); setReplyTo(null); }} />
            {voiceSupported && (
              <button className={`toolbar-btn ${isListening ? 'voice-active' : ''}`} onClick={toggleVoice}>
                <Mic size={18} />
              </button>
            )}
            <button className="toolbar-btn" onClick={() => {
              onTransfer(conversation.peerId, conversation.peerName);
            }}>
              <Coins size={18} />
            </button>
            {showEmoji && (
              <div className="emoji-picker">
                {EMOJIS.map((e, i) => <button key={i} className="emoji-btn" onClick={() => setText(p => p + e)}>{e}</button>)}
              </div>
            )}
          </div>
        </div>
        <textarea className="chat-textarea" placeholder="输入消息..." value={text} onChange={e => setText(e.target.value)} onKeyDown={handleKey} rows={4} />
        <div className="chat-send-row">
          <button className="send-btn" disabled={!text.trim() || isBlockedByPeer} onClick={handleSend}>发送</button>
        </div>
      </div>
    </>
  );
}

function GroupChatView({ groupId, currentUser, groupMessages, onSend, onAddMember, onLeaveGroup, onRedpacketClick, groupName, onSendRedpacket, onShowMembers, onShowSettings, onDeleteMessage, onRecallMessage, onUpload, onSendMedia }: {
  groupId: number;
  currentUser: ChatUser;
  groupMessages: GroupMessage[];
  onSend: (groupId: number, content: string, replyToId?: number) => void;
  onAddMember: () => void;
  onLeaveGroup: (groupId: number) => void;
  onRedpacketClick: (redpacketId: number) => void;
  groupName?: string;
  onSendRedpacket?: (groupId: number, groupName: string) => void;
  onShowMembers?: () => void;
  onShowSettings?: () => void;
  onDeleteMessage: (groupId: number, messageId: number) => void;
  onRecallMessage: (groupId: number, messageId: number) => void;
  onUpload: (file: File) => Promise<{ url: string; name: string; size: number } | null>;
  onSendMedia: (groupId: number, info: { url: string; name: string; size: number }, kind: 'image' | 'file', replyToId?: number) => void;
}) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);
  // 定时刷新时间基准：让"5分钟可撤回"的按钮在超时后自动置灰
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const recognitionRef = useRef<any>(null);
  const voiceBaseTextRef = useRef<string>('');
  const textRef = useRef(text);
  textRef.current = text;

  // 翻历史时不强行拉回底部，贴近底部才自动滚动
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => { nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (nearBottomRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [groupMessages.length]);

  // 初始化语音识别
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceSupported(false); return; }
    setVoiceSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (e: any) => {
      // 取当前这一段识别的完整结果（最后一次的 transcript 最准确）
      const lastResult = e.results[e.results.length - 1];
      const transcript = lastResult[0].transcript;
      // 用录音前的文本 + 本次识别结果拼接（不重复追加）
      const base = voiceBaseTextRef.current;
      const separator = base && !base.endsWith(' ') && !transcript.startsWith(' ') ? ' ' : '';
      setText(base + separator + transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    return () => { recognition.abort(); };
  }, []);

  const toggleVoice = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
    } else {
      voiceBaseTextRef.current = textRef.current; // 记住录音前的文本
      setIsListening(true);
      recognition.start();
    }
  };

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(groupId, text, replyTo?.id);
    setText(''); setShowEmoji(false); setReplyTo(null);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <>
      <div className="chat-header">
        <span>{groupName || '群聊'}</span>
        <div className="chat-header-btns">
          <button className="chat-header-btn" onClick={onShowSettings} title="群设置">
            <Settings size={16} />
          </button>
          <button className="chat-header-btn" onClick={onShowMembers} title="群成员">
            <Users size={16} />
          </button>
          <button className="chat-header-btn" onClick={onAddMember} title="添加成员">
            <UserPlus size={16} />
          </button>
          <button className="chat-header-btn" onClick={() => {
            if (confirm('确定要退出群聊吗？')) {
              onLeaveGroup(groupId);
            }
          }} title="退出群聊">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
      <div className="chat-messages" ref={listRef}>
        {groupMessages.map(msg => {
          const isSelf = msg.senderId === currentUser.id;
          const msgAge = now - msg.timestamp;
          const canRecall = isSelf && msg.type !== 'redpacket' && !msg.recalled && msgAge < 5 * 60 * 1000;
          const recallExpired = isSelf && msg.type !== 'redpacket' && !msg.recalled && msgAge >= 5 * 60 * 1000;
          const canReply = Number.isFinite(msg.id) && msg.id > 0;
          const actions = (
            <div className="msg-actions">
              <button className="msg-action" title={canReply ? '回复' : '消息发送中，暂不可回复'} disabled={!canReply} onClick={() => canReply && setReplyTo(msg)}>
                <Reply size={12} />
              </button>
              {(canRecall || recallExpired) && (
                <button
                  className={`msg-action ${recallExpired ? 'msg-action-disabled' : ''}`}
                  title={recallExpired ? '发送超过5分钟，无法撤回' : '撤回'}
                  disabled={recallExpired || !canReply}
                  onClick={() => onRecallMessage(groupId, msg.id)}
                >
                  <RotateCcw size={12} />
                </button>
              )}
              <button
                className="msg-action msg-action-danger"
                title="删除（群内都会看不到）"
                disabled={!canReply}
                onClick={() => {
                  if (canReply && confirm('删除这条群消息？群内所有人都会看不到（不可恢复）')) {
                    onDeleteMessage(groupId, msg.id);
                  }
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
          return (
            <div key={msg.id} className={`msg-row ${isSelf ? 'self' : ''}`}>
              <div className="msg-avatar" style={{ background: pickColor(msg.senderId) }}>
                {msg.senderNickname?.[0]?.toUpperCase() || msg.senderName?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="msg-main">
                <div className="msg-sender">
                  {msg.senderNickname || msg.senderName}
                  {msg.mentionedMe && <span className="msg-mentioned-me">@了我</span>}
                </div>
                {msg.recalled ? (
                  <div className="msg-content msg-recalled">
                    {isSelf ? '你撤回了一条消息' : `${msg.senderNickname || msg.senderName} 撤回了一条消息`}
                  </div>
                ) : msg.type === 'redpacket' ? (
                  <div
                    className="msg-content redpacket-msg"
                    style={{cursor: 'pointer', background: msg.redpacketStatus === 'active' ? '#fff3e0' : '#f5f5f5'}}
                    onClick={() => {
                      if (msg.redpacketId) {
                        onRedpacketClick(msg.redpacketId);
                      }
                    }}
                  >
                    <div style={{fontSize:'20px',marginBottom:'4px'}}>🧧</div>
                    <div style={{fontSize:'12px',color:'#888'}}>{msg.content}</div>
                  </div>
                ) : msg.type === 'image' ? (
                  <div className="msg-bubble">
                    {msg.replyTo && (
                      <div className="msg-reply">
                        <span className="msg-reply-name">{msg.replyTo.senderName}</span>
                        <span className="msg-reply-content">{msg.replyTo.content}</span>
                      </div>
                    )}
                    <div className="msg-image-wrap">
                      <img
                        className="msg-image"
                        src={msg.fileUrl || undefined}
                        alt={msg.fileName || '图片'}
                        onClick={() => msg.fileUrl && window.open(msg.fileUrl, '_blank')}
                      />
                      <button
                        className="msg-download-btn"
                        title="下载图片"
                        onClick={(e) => { e.stopPropagation(); downloadFile(msg.fileUrl || '', msg.fileName || '图片.png'); }}
                      >
                        <Download size={14} />
                      </button>
                    </div>
                    {actions}
                  </div>
                ) : msg.type === 'file' ? (
                  <div className="msg-bubble">
                    {msg.replyTo && (
                      <div className="msg-reply">
                        <span className="msg-reply-name">{msg.replyTo.senderName}</span>
                        <span className="msg-reply-content">{msg.replyTo.content}</span>
                      </div>
                    )}
                    <div className="msg-file">
                      <FileText size={20} onClick={() => msg.fileUrl && window.open(msg.fileUrl, '_blank')} />
                      <div className="msg-file-info" onClick={() => msg.fileUrl && window.open(msg.fileUrl, '_blank')}>
                        <div className="msg-file-name">{msg.fileName || msg.content}</div>
                        {msg.fileSize ? <div className="msg-file-size">{Math.round(msg.fileSize / 1024)} KB</div> : null}
                      </div>
                      <button
                        className="msg-file-download"
                        title="下载文件"
                        onClick={(e) => { e.stopPropagation(); downloadFile(msg.fileUrl || '', msg.fileName || 'download'); }}
                      >
                        <Download size={15} />
                      </button>
                    </div>
                    {actions}
                  </div>
                ) : (
                  <div className="msg-bubble">
                    {msg.replyTo && (
                      <div className="msg-reply">
                        <span className="msg-reply-name">{msg.replyTo.senderName}</span>
                        <span className="msg-reply-content">{msg.replyTo.content}</span>
                      </div>
                    )}
                    <div className="msg-content">{renderWithMentions(msg.content)}</div>
                    {actions}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="chat-input-area">
        {replyTo && (
          <div className="reply-bar">
            <div className="reply-bar-info">
              <span className="reply-bar-name">
                <Reply size={11} /> 回复 {replyTo.senderId === currentUser.id ? '自己' : (replyTo.senderNickname || replyTo.senderName || '群成员')}
              </span>
              <span className="reply-bar-content">{replyTo.content}</span>
            </div>
            <button className="reply-bar-close" onClick={() => setReplyTo(null)}><X size={14} /></button>
          </div>
        )}
        <div className="chat-toolbar">
          <div className="toolbar-wrapper">
            <button className="toolbar-btn redpacket-btn" onClick={() => {
              if (onSendRedpacket) {
                onSendRedpacket(groupId, groupName || '群聊');
              }
            }}>
              <Gift size={18} />
              <span className="btn-label">发红包</span>
            </button>
            <button className="toolbar-btn" onClick={() => setShowEmoji(v => !v)}><Smile size={18} /></button>
            <FileSendButton kind="image" onUpload={onUpload} onPicked={(info) => { onSendMedia(groupId, info, 'image', replyTo?.id); setReplyTo(null); }} />
            <FileSendButton kind="file" onUpload={onUpload} onPicked={(info) => { onSendMedia(groupId, info, 'file', replyTo?.id); setReplyTo(null); }} />
            {voiceSupported && (
              <button className={`toolbar-btn ${isListening ? 'voice-active' : ''}`} onClick={toggleVoice}>
                <Mic size={18} />
              </button>
            )}
            {showEmoji && (
              <div className="emoji-picker">
                {EMOJIS.map((e, i) => <button key={i} className="emoji-btn" onClick={() => setText(p => p + e)}>{e}</button>)}
              </div>
            )}
          </div>
        </div>
        <textarea className="chat-textarea" placeholder="输入消息..." value={text} onChange={e => setText(e.target.value)} onKeyDown={handleKey} rows={4} />
        <div className="chat-send-row">
          <button className="send-btn" disabled={!text.trim()} onClick={handleSend}>发送</button>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════
   Main App
   ═══════════════════════════════════════ */
export default function App() {
  // Auth state
  const [currentUser, setCurrentUser] = useState<ChatUser | null>(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [page, setPage] = useState<'login' | 'register' | 'chat'>(() => {
    return (sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY)) ? 'chat' : 'login';
  });

  // 主题配色（持久化到 localStorage，html 根节点挂 data-theme 属性）
  const [theme, setTheme] = useState<string>(() => {
    try { return localStorage.getItem(THEME_KEY) || 'mist'; } catch { return 'mist'; }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  // Chat state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'chats' | 'groups' | 'friends' | 'addfriend' | 'settings' | 'admin' | 'market'>('chats');
  const [searchQuery, setSearchQuery] = useState('');
  const [msgSearchResults, setMsgSearchResults] = useState<any[]>([]);

  // Admin state
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminStats, setAdminStats] = useState<ServerStats | null>(null);
  // 群聊管理 / 系统设置
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [systemForm, setSystemForm] = useState({ announcement: '', registrationOpen: true });
  const [systemSaving, setSystemSaving] = useState(false);
  // 全站公告横幅
  const [announcement, setAnnouncement] = useState('');
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);
  // 超级管理员高危操作：消息审查
  const [auditConvs, setAuditConvs] = useState<{ userA: number; userB: number; nameA: string; nameB: string; count: number; lastAt: number; lastText: string }[]>([]);
  const [auditTarget, setAuditTarget] = useState<{ userA: number; userB: number; nameA: string; nameB: string } | null>(null);
  const [auditMessages, setAuditMessages] = useState<{ id: number; senderName: string; content: string; timestamp: number; read: boolean }[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminToast, setAdminToast] = useState('');
  const [resetPwdTarget, setResetPwdTarget] = useState<number | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState('');
  const [creditTarget, setCreditTarget] = useState<number | null>(null);
  const [creditValue, setCreditValue] = useState('');

  // Friends state
  const [friends, setFriends] = useState<ChatUser[]>([]);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState<ChatUser[]>([]);
  const [friendSearchHint, setFriendSearchHint] = useState('');
  const [addFriendError, setAddFriendError] = useState('');
  const [addedFriendIds, setAddedFriendIds] = useState<Set<number>>(new Set());
  const [lastMsgId, setLastMsgId] = useState<Record<number, number>>({});
  const [convSettings, setConvSettings] = useState<Record<number, { pinned: boolean; muted: boolean }>>({});
  const [blockedIds, setBlockedIds] = useState<Set<number>>(new Set());
  const [blockedBy, setBlockedBy] = useState<Set<number>>(new Set());

  // Market state
  const [credits, setCredits] = useState(0);
  const [marketTab, setMarketTab] = useState<'browse' | 'my' | 'cart' | 'orders'>('browse');
  const [marketItems, setMarketItems] = useState<any[]>([]);
  const [myItems, setMyItems] = useState<any[]>([]);
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [myOrders, setMyOrders] = useState<any[]>([]);
  const [marketSearch, setMarketSearch] = useState('');
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [buyItem, setBuyItem] = useState<any>(null);
  const [postBuyModalMsg, setPostBuyModalMsg] = useState('');
  const [showPostBuyModal, setShowPostBuyModal] = useState(false);
  const [publishForm, setPublishForm] = useState({ title: '', description: '', price: '', stock: '', postBuyMessage: '', categoryId: null as number | null });
  const [allPostBuyMessages, setAllPostBuyMessages] = useState<{title: string, message: string}[]>([]);
  const [postBuyMsgIndex, setPostBuyMsgIndex] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [showRedpacketModal, setShowRedpacketModal] = useState(false);
  const [redpacketTarget, setRedpacketTarget] = useState<{id: number, name: string, isGroup?: boolean} | null>(null);
  const [showRedpacketClaimModal, setShowRedpacketClaimModal] = useState(false);
  const [claimingRedpacket, setClaimingRedpacket] = useState<Redpacket | null>(null);
  
  const [showProfileModal, setShowProfileModal] = useState(false);
  // 修改密码
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [pwdError, setPwdError] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [profileForm, setProfileForm] = useState({ nickname: '', avatar: '', bio: '' });
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingItem, setRatingItem] = useState<any>(null);
  const [itemRatings, setItemRatings] = useState<Rating[]>([]);
  const [showRatingsListModal, setShowRatingsListModal] = useState(false);

  // Group state
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [groupMessages, setGroupMessages] = useState<Record<number, GroupMessage[]>>({});
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [createGroupForm, setCreateGroupForm] = useState({ name: '' });
  const [selectedFriends, setSelectedFriends] = useState<Set<number>>(new Set());
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [currentGroup, setCurrentGroup] = useState<Group | null>(null);
  const [lastGroupMsgId, setLastGroupMsgId] = useState<Record<number, number>>({});
  const [mentionedGroupIds, setMentionedGroupIds] = useState<Set<number>>(new Set());
  const [showGroupMembersModal, setShowGroupMembersModal] = useState(false);
  const [showGroupSettingsModal, setShowGroupSettingsModal] = useState(false);
  const [groupSettingsForm, setGroupSettingsForm] = useState({ name: '' });

  // 用 ref 避免轮询闭包陷阱
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const friendsRef = useRef(friends);
  friendsRef.current = friends;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const activeConvIdRef = useRef(activeConvId);
  activeConvIdRef.current = activeConvId;
  const lastMsgIdRef = useRef(lastMsgId);
  lastMsgIdRef.current = lastMsgId;

  // Group refs
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const activeGroupIdRef = useRef(activeGroupId);
  activeGroupIdRef.current = activeGroupId;
  const groupMessagesRef = useRef(groupMessages);
  groupMessagesRef.current = groupMessages;
  const lastGroupMsgIdRef = useRef(lastGroupMsgId);
  lastGroupMsgIdRef.current = lastGroupMsgId;
  // 轮询防重入：上一轮未跑完时跳过本轮，避免慢网络下请求堆积
  const pollingRef = useRef(false);
  // 搜索请求序号：防止快速输入时旧响应覆盖新结果
  const searchSeqRef = useRef(0);
  const searchTimerRef = useRef<number | null>(null);
  // 变更同步基准：上一轮服务端返回的 serverTime（用服务器时钟，避免客户端时钟偏差丢变更）
  const lastServerTimeRef = useRef(0);

  const activeConversation = conversations.find(c => c.id === activeConvId) ?? null;
  // 免打扰的会话不计入侧栏未读角标（避免红点数字找不到来源）
  const totalUnread = conversations.reduce((s, c) => s + (convSettings[c.peerId]?.muted ? 0 : c.unread), 0);

  // ─── Auth handlers ───
  const handleLogin = (user: ChatUser) => {
    setCurrentUser(user);
    // 同时写入 sessionStorage 和 localStorage（sessionStorage 用于同浏览器多标签隔离，localStorage 用于持久登录）
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    setPage('chat');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    // 清空所有业务状态，避免跨账号残留
    setConversations([]);
    setFriends([]);
    setActiveConvId(null);
    setActiveGroupId(null);
    setGroups([]);
    setGroupMessages({});
    setLastMsgId({});
    setLastGroupMsgId({});
    setBlockedIds(new Set());
    setBlockedBy(new Set());
    setCredits(0);
    setAdminUsers([]);
    setAdminStats(null);
    setTransfers([]);
    setMarketItems([]);
    setMyItems([]);
    setCartItems([]);
    setMyOrders([]);
    setConvSettings({});
    setMsgSearchResults([]);
    setMentionedGroupIds(new Set());
    setSearchQuery('');
    setActiveView('chats');
    setPage('login');
  };

  // ─── Admin functions ───
  // 自动更新：检测服务器前端构建是否变化，变化则自动刷新（避免一直用旧页面）
  useEffect(() => {
    const scriptEl = document.querySelector('script[type="module"][src]');
    const loadedSrc = scriptEl ? scriptEl.getAttribute('src') || '' : '';
    if (!loadedSrc) return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        const data = await res.json();
        if (!stopped && data.ok && data.appJs && !loadedSrc.endsWith(data.appJs)) {
          stopped = true;
          adminToastFn('检测到新版本，正在自动刷新…');
          setTimeout(() => window.location.reload(), 900);
        }
      } catch { /* 忽略网络错误 */ }
    };
    const t = setInterval(check, 60000);
    check();
    return () => { stopped = true; clearInterval(t); };
  }, []);

  const isAdminUser = currentUser?.role === 'admin' || currentUser?.role === 'superadmin';
  const isSuperAdminUser = currentUser?.role === 'superadmin';

  // ─── 全站公告 ───
  const loadAnnouncement = useCallback(async () => {
    try {
      const res = await fetch(`${API}/settings`, { cache: 'no-store' });
      const data = await res.json();
      if (data.ok && data.announcement) {
        setAnnouncement(data.announcement);
        const dismissed = localStorage.getItem('purechat_announcement_dismissed');
        setAnnouncementDismissed(dismissed === data.announcement);
      } else {
        setAnnouncement('');
      }
    } catch { /* 忽略 */ }
  }, []);

  const dismissAnnouncement = () => {
    setAnnouncementDismissed(true);
    try { localStorage.setItem('purechat_announcement_dismissed', announcement); } catch {}
  };

  useEffect(() => { loadAnnouncement(); }, [loadAnnouncement, currentUser]);

  // 群聊管理
  const loadAdminGroups = useCallback(async () => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) return;
    try {
      const res = await apiGet('/admin/groups', currentUser.id);
      if (res.ok) setAdminGroups(res.groups || []);
    } catch { /* 忽略 */ }
  }, [currentUser]);

  const handleDissolveGroup = async (group: AdminGroup) => {
    if (!currentUser) return;
    // 二次确认：必须输入群名，防止误点导致不可恢复的删除
    const typed = prompt(
      `解散后不可恢复！群内 ${group.memberCount} 名成员和 ${group.messageCount} 条消息都会被删除。\n\n请输入群名「${group.name}」以确认：`
    );
    if (typed === null) return;
    if (typed.trim() !== group.name) {
      adminToastFn('群名不一致，已取消解散');
      return;
    }
    const res = await apiPost(`/admin/groups/${group.id}/dissolve`, { confirmName: group.name }, currentUser.id);
    if (res.ok) {
      adminToastFn(res.msg || '已解散');
      loadAdminGroups();
      loadAdminData();
    } else {
      adminToastFn(res.msg || '解散失败');
    }
  };

  // 系统设置（超级管理员）
  const loadSystemForm = useCallback(async () => {
    try {
      const res = await fetch(`${API}/settings`, { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) {
        setSystemForm({
          announcement: data.announcement || '',
          registrationOpen: data.registrationOpen !== false,
        });
      }
    } catch { /* 忽略 */ }
  }, []);

  const handleSaveSystem = async () => {
    if (!currentUser || !isSuperAdminUser) return;
    setSystemSaving(true);
    try {
      const res = await apiPost('/admin/settings', {
        announcement: systemForm.announcement,
        registrationOpen: systemForm.registrationOpen,
      }, currentUser.id);
      if (res.ok) {
        adminToastFn(res.msg || '已保存');
        loadAnnouncement();
      } else {
        adminToastFn(res.msg || '保存失败');
      }
    } catch {
      adminToastFn('保存失败');
    }
    setSystemSaving(false);
  };

  const handleDownloadBackup = async () => {
    if (!currentUser || !isSuperAdminUser) return;
    try {
      const res = await fetch(`${API}/admin/backup?userId=${currentUser.id}`, { headers: authHeaders() });
      if (!res.ok) { adminToastFn('导出失败'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tangchat-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      adminToastFn('备份已开始下载');
    } catch {
      adminToastFn('导出失败');
    }
  };

  // ─── 超级管理员高危操作 ───

  // 彻底删除用户
  const handlePurgeUser = async (user: AdminUser) => {
    if (!currentUser || !isSuperAdminUser) return;
    const typed = prompt(`警告：将彻底删除用户「${user.username}」及其所有消息、好友、商品、订单，不可恢复！\n\n请输入用户名确认：`);
    if (typed === null) return;
    if (typed.trim() !== user.username) { adminToastFn('用户名不一致，已取消'); return; }
    const res = await apiPost(`/admin/users/${user.id}/purge`, { confirmUsername: user.username }, currentUser.id);
    if (res.ok) { adminToastFn(res.msg || '已删除'); loadAdminData(); }
    else adminToastFn(res.msg || '删除失败');
  };

  // 消息审查：加载所有私聊会话
  const loadAuditConversations = async () => {
    if (!currentUser || !isSuperAdminUser) return;
    setAuditLoading(true);
    try {
      const res = await apiGet('/admin/audit/conversations', currentUser.id);
      if (res.ok) setAuditConvs(res.conversations || []);
      else adminToastFn(res.msg || '加载失败');
    } catch { adminToastFn('加载失败'); }
    setAuditLoading(false);
  };

  // 消息审查：查看某两人的聊天记录
  const openAuditMessages = async (conv: { userA: number; userB: number; nameA: string; nameB: string }) => {
    if (!currentUser || !isSuperAdminUser) return;
    try {
      const res = await apiGet(`/admin/audit/messages?userA=${conv.userA}&userB=${conv.userB}`, currentUser.id);
      if (res.ok) {
        setAuditMessages(res.messages || []);
        setAuditTarget(conv);
      } else adminToastFn(res.msg || '加载失败');
    } catch { adminToastFn('加载失败'); }
  };

  // 清空市场数据
  const handleResetMarket = async () => {
    if (!currentUser || !isSuperAdminUser) return;
    const typed = prompt('将清空所有商品、订单、购物车、评价（不可恢复）。\n请输入 RESET 确认：');
    if (typed === null) return;
    if (typed.trim() !== 'RESET') { adminToastFn('未确认，已取消'); return; }
    const res = await apiPost('/admin/market/reset', { confirm: 'RESET_MARKET' }, currentUser.id);
    if (res.ok) { adminToastFn(res.msg || '已清空市场'); loadAdminData(); loadMarketItems(); }
    else adminToastFn(res.msg || '清空失败');
  };

  // 恢复备份
  const handleRestoreBackup = async (file: File) => {
    if (!currentUser || !isSuperAdminUser) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const data = parsed?.data || parsed;
      if (!data || typeof data !== 'object') { adminToastFn('备份文件格式无效'); return; }
      if (!confirm('恢复备份会覆盖当前所有数据（用户、消息、群聊、市场等），不可撤销！\n确定继续？')) return;
      const res = await apiPost('/admin/restore', { confirm: 'RESTORE', data }, currentUser.id);
      if (res.ok) {
        adminToastFn(res.msg || '恢复成功，正在刷新…');
        setTimeout(() => window.location.reload(), 1200);
      } else adminToastFn(res.msg || '恢复失败');
    } catch {
      adminToastFn('备份文件解析失败');
    }
  };

  const loadAdminData = useCallback(async () => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) return;
    setAdminLoading(true);
    try {
      const [usersRes, statsRes] = await Promise.all([
        apiGet('/admin/users', currentUser.id),
        apiGet('/admin/stats', currentUser.id),
      ]);
      if (usersRes.ok) {
        setAdminUsers(usersRes.users);
        // 以服务端返回的身份为准，修正本地可能过期的 role（否则管理按钮会忽隐忽现）
        if (typeof usersRes.isSuperAdmin === 'boolean') {
          const serverRole = usersRes.isSuperAdmin ? 'superadmin' : 'admin';
          if (currentUser.role !== serverRole) {
            const updated = { ...currentUser, role: serverRole };
            setCurrentUser(updated);
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          }
        }
      }
      if (statsRes.ok) setAdminStats(statsRes.stats);
    } catch {}
    setAdminLoading(false);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    if (activeView === 'admin') {
      loadAdminData();
      loadAdminGroups();
      loadSystemForm();
    }
    if (activeView === 'market') {
      apiGet('/user/credits', currentUser!.id).then((res: { ok: boolean; credits: number }) => {
        if (res.ok) setCredits(res.credits);
      }).catch(() => {});
      loadMarketItems();
      loadMyItems();
      loadCartItems();
      loadMyOrders();
      loadCategories();
    }
  }, [activeView, loadAdminData]);

  const adminToastFn = (msg: string) => {
    setAdminToast(msg);
    setTimeout(() => setAdminToast(''), 3000);
  };

  const handleDisableUser = async (targetId: number) => {
    const res = await apiPost(`/admin/users/${targetId}/disable`, {}, currentUser!.id);
    if (res.ok) { adminToastFn(res.msg); loadAdminData(); }
    else adminToastFn(res.msg || '操作失败');
  };

  const handleEnableUser = async (targetId: number) => {
    const res = await apiPost(`/admin/users/${targetId}/enable`, {}, currentUser!.id);
    if (res.ok) { adminToastFn(res.msg); loadAdminData(); }
    else adminToastFn(res.msg || '操作失败');
  };

  const handleToggleAdmin = async (targetId: number) => {
    const res = await apiPost(`/admin/users/${targetId}/set-admin`, {}, currentUser!.id);
    if (res.ok) { adminToastFn(res.msg); loadAdminData(); }
    else adminToastFn(res.msg || '操作失败');
  };

  // 超级管理员：设置/取消超级管理员
  const handleToggleSuperAdmin = async (targetId: number, username: string, isSuper: boolean) => {
    const tip = isSuper ? `取消 ${username} 的超级管理员（降为普通管理员）？` : `把 ${username} 设为超级管理员？超级管理员可以任免管理员。`;
    if (!confirm(tip)) return;
    const res = await apiPost(`/admin/users/${targetId}/set-super`, {}, currentUser!.id);
    if (res.ok) { adminToastFn(res.msg); loadAdminData(); }
    else adminToastFn(res.msg || '操作失败');
  };

  const handleResetPassword = async (targetId: number) => {
    if (!resetPwdValue || resetPwdValue.length < 6) {
      adminToastFn('密码至少6个字符');
      return;
    }
    const res = await apiPost(`/admin/users/${targetId}/reset-password`, { newPassword: resetPwdValue }, currentUser!.id);
    if (res.ok) { adminToastFn(res.msg); setResetPwdTarget(null); setResetPwdValue(''); }
    else adminToastFn(res.msg || '操作失败');
  };

  const handleAdjustCredits = async (targetId: number) => {
    const num = Number(creditValue);
    if (!creditValue || isNaN(num) || num === 0) {
      adminToastFn('请输入有效的积分数额（正数增加，负数扣减）');
      return;
    }
    const res = await apiPost(`/admin/users/${targetId}/credits`, { amount: num }, currentUser!.id);
    if (res.ok) {
      adminToastFn(`已调整积分：${num > 0 ? '+' : ''}${num}，当前积分：${res.credits}`);
      setCreditTarget(null); setCreditValue('');
      loadAdminData();
    } else {
      adminToastFn(res.msg || '操作失败');
    }
  };

  // ─── Market handlers ───

  const loadMarketItems = async (catOverride?: number | null) => {
    if (!currentUser) return;
    try {
      const q = marketSearch || '';
      // 分类以本次调用传入为准，避免 setState 后的 stale closure
      const cat = catOverride !== undefined ? catOverride : selectedCategory;
      let url = `${API}/market?q=${encodeURIComponent(q)}&limit=50&userId=${currentUser.id}`;
      if (cat) {
        url += `&categoryId=${cat}`;
      }
      const res = await fetch(url, { headers: authHeaders() });
      const data = await res.json();
      if (data.ok) setMarketItems(data.items);
    } catch {}
  };

  const loadMyItems = async () => {
    try {
      const res = await fetch(`${API}/market/my?userId=${currentUser!.id}`, { headers: authHeaders() });
      const data = await res.json();
      if (data.ok) setMyItems(data.items);
    } catch {}
  };

  const loadCartItems = async () => {
    try {
      const res = await fetch(`${API}/cart?userId=${currentUser!.id}`, { headers: authHeaders() });
      const data = await res.json();
      if (data.ok) setCartItems(data.items);
    } catch {}
  };

  const loadMyOrders = async () => {
    try {
      const res = await fetch(`${API}/market/orders?userId=${currentUser!.id}`, { headers: authHeaders() });
      const data = await res.json();
      if (data.ok) setMyOrders(data.orders);
    } catch {}
  };

  const handlePublish = async () => {
    const { title, description, price, stock, postBuyMessage, categoryId } = publishForm;
    if (!title.trim()) { adminToastFn('请输入标题'); return; }
    if (!description.trim()) { adminToastFn('请输入描述'); return; }
    if (!price || Number(price) <= 0) { adminToastFn('价格必须大于0'); return; }
    if (stock !== '' && (!Number.isInteger(Number(stock)) || Number(stock) <= 0)) {
      adminToastFn('库存数量必须是大于0的整数（不填为无限量）');
      return;
    }

    const res = await apiPost('/market/publish', {
      title, description, price: Number(price),
      stock: stock === '' ? null : Number(stock),
      postBuyMessage: postBuyMessage.trim(), categoryId,
    }, currentUser!.id);
    if (res.ok) {
      setShowPublishModal(false);
      setPublishForm({ title: '', description: '', price: '', stock: '', postBuyMessage: '', categoryId: null });
      adminToastFn('上架成功');
      loadMarketItems();
      loadMyItems();
      loadMyOrders();
    } else {
      adminToastFn(res.msg || '上架失败');
    }
  };

  const handleRemoveItem = async (itemId: number) => {
    const res = await apiPost('/market/remove', { itemId }, currentUser!.id);
    if (res.ok) {
      adminToastFn('已下架');
      loadMyItems();
      loadMarketItems();
    } else {
      adminToastFn(res.msg || '下架失败');
    }
  };

  const handleAddToCart = async (item: any) => {
    const res = await apiPost('/cart/add', { itemId: item.id }, currentUser!.id);
    if (res.ok) {
      adminToastFn('已加入购物车');
      loadCartItems();
    } else {
      adminToastFn(res.msg || '加入购物车失败');
    }
  };

  const handleDirectBuy = (item: any) => {
    setBuyItem(item);
    setShowBuyModal(true);
  };

  const confirmDirectBuy = async () => {
    if (!buyItem) return;
    const res = await apiPost('/market/buy', { itemId: buyItem.id }, currentUser!.id);
    if (res.ok) {
      setShowBuyModal(false);
      setBuyItem(null);
      const credRes = await apiGet('/user/credits', currentUser!.id) as { ok: boolean; credits: number };
      if (credRes.ok) setCredits(credRes.credits);
      loadMarketItems();
      loadMyItems();
      loadMyOrders();
      loadCartItems();
      adminToastFn('购买成功');

      // 如果有购买后消息，弹窗显示
      if (res.postBuyMessage) {
        setAllPostBuyMessages([{ title: buyItem.title, message: res.postBuyMessage }]);
        setPostBuyMsgIndex(0);
        setPostBuyModalMsg(res.postBuyMessage);
        setShowPostBuyModal(true);
      }
    } else {
      adminToastFn(res.msg || '购买失败');
    }
  };

  const handleRemoveFromCart = async (itemId: number) => {
    const res = await apiPost('/cart/remove', { itemId }, currentUser!.id);
    if (res.ok) {
      adminToastFn('已从购物车移除');
      loadCartItems();
    } else {
      adminToastFn(res.msg || '移除失败');
    }
  };

  const handleCheckout = () => {
    if (cartItems.length === 0) {
      adminToastFn('购物车是空的');
      return;
    }
    setShowCheckoutModal(true);
  };

  const confirmCheckout = async () => {
    if (checkoutLoading) return;
    setCheckoutLoading(true);
    try {
      const res = await apiPost('/cart/checkout', {}, currentUser!.id);
      if (res.ok) {
        setShowCheckoutModal(false);
        const credRes = await apiGet('/user/credits', currentUser!.id) as { ok: boolean; credits: number };
        if (credRes.ok) setCredits(credRes.credits);
        loadMarketItems();
        loadMyItems();
        loadCartItems();
        loadMyOrders();
        adminToastFn(res.msg || '结算成功');

        if (res.postBuyMessages && res.postBuyMessages.length > 0) {
          setAllPostBuyMessages(res.postBuyMessages);
          setPostBuyMsgIndex(0);
          setPostBuyModalMsg(res.postBuyMessages[0].message);
          setShowPostBuyModal(true);
        }
      } else {
        adminToastFn(res.msg || '结算失败');
      }
    } catch (error) {
      adminToastFn('网络错误，请重试');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handlePostBuyNext = () => {
    const nextIdx = postBuyMsgIndex + 1;
    if (nextIdx < allPostBuyMessages.length) {
      setPostBuyMsgIndex(nextIdx);
      setPostBuyModalMsg(allPostBuyMessages[nextIdx].message);
    } else {
      setShowPostBuyModal(false);
      setAllPostBuyMessages([]);
    }
  };

  const loadCategories = async () => {
    try {
      const res = await fetch(`${API}/categories`);
      const data = await res.json();
      if (data.ok) setCategories(data.categories);
    } catch {}
  };

  const loadTransfers = async () => {
    try {
      const res = await fetch(`${API}/transfers?userId=${currentUser!.id}`, { headers: authHeaders() });
      const data = await res.json();
      if (data.ok) setTransfers(data.transfers);
    } catch {}
  };

  const handleChatTransfer = (peerId: number, peerName: string) => {
    const transferData = {
      targetId: peerId,
      targetName: peerName
    };
    sessionStorage.setItem('transferTarget', JSON.stringify(transferData));
    setShowTransferModal(true);
    loadTransfers();
  };

  const handleChatRedpacket = (peerId: number, peerName: string) => {
    setRedpacketTarget({ id: peerId, name: peerName, isGroup: false });
    setShowRedpacketModal(true);
  };

  const handleSendRedpacket = async (amount: number, count: number, note: string) => {
    if (!redpacketTarget || !currentUser) {
      adminToastFn('错误：未选择红包目标');
      return;
    }
    
    // 保存当前的 redpacketTarget 到本地变量
    const target = redpacketTarget;
    
    // 1. 先乐观地添加消息到界面（立即显示）
    const tempMsgId = Date.now();
    const redpacketContent = `🧧 发送了一个红包${note ? `："${note}"` : ''}`;
    
    const optimisticMsg: GroupMessage = {
      id: tempMsgId,
      groupId: target.id,
      senderId: currentUser.id,
      senderName: currentUser.username,
      senderNickname: currentUser.nickname,
      content: redpacketContent,
      type: 'redpacket',
      redpacketId: tempMsgId,
      redpacketStatus: 'active',
      timestamp: Date.now()
    };
    
    // 如果是群聊，立即添加到状态
    if (target.isGroup) {
      setGroupMessages(prev => {
        const currentMessages = prev[target.id] || [];
        return {
          ...prev,
          [target.id]: [...currentMessages, optimisticMsg]
        };
      });
    }
    
    // 2. 发送红包到服务器
    const reqBody = target.isGroup 
      ? { groupId: target.id, amount, count, note }
      : { receiverId: target.id, amount, count, note };
      
    try {
      const res = await apiPost('/redpackets/send', reqBody, currentUser.id);
      
      if (!res.ok) {
        adminToastFn(res.msg || '发送红包失败');
        // 如果发送失败，移除刚才添加的消息
        if (target.isGroup) {
          setGroupMessages(prev => ({
            ...prev,
            [target.id]: (prev[target.id] || []).filter(m => m.id !== tempMsgId)
          }));
        }
        return;
      }
      
      const redpacket = res.redpacket;
      
      // 3. 如果是群聊，发送红包消息
      if (target.isGroup) {
        const gmRes = await apiPost(`/groups/${target.id}/messages`, {
          content: redpacketContent,
          type: 'redpacket',
          redpacketId: redpacket.id
        }, currentUser.id);

        // 4. 用服务端返回的真实消息（真实 id）替换乐观消息，并按 id 去重，
        //    避免轮询拉到同一消息后出现重复红包气泡
        const serverMsg = gmRes.ok ? gmRes.message : null;
        setGroupMessages(prev => {
          const list = prev[target.id] || [];
          const replaced = list.map(m =>
            m.id === tempMsgId
              ? { ...(serverMsg || optimisticMsg), redpacketId: redpacket.id, redpacketStatus: 'active' }
              : m
          );
          const seen = new Set<number>();
          return {
            ...prev,
            [target.id]: replaced.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true))),
          };
        });
      } else {
        // 单聊
        const conv = conversations.find(c => c.peerId === target.id);
        if (conv) {
          await apiPost('/messages/send', { 
            receiverId: target.id, 
            content: redpacketContent, 
            type: 'redpacket',
            redpacketId: redpacket.id
          }, currentUser.id);
        }
      }
      
      // 延迟关闭模态框
      setShowRedpacketModal(false);
      setTimeout(() => {
        setRedpacketTarget(null);
      }, 100);
      
      adminToastFn('红包已发送');
      
      // 5. 刷新积分
      const credRes = await apiGet('/user/credits', currentUser.id) as { ok: boolean; credits: number };
      if (credRes.ok) {
        setCredits(credRes.credits);
      }
      
    } catch (error) {
      adminToastFn('发送红包时发生错误');
    }
  };

  const handleClaimRedpacket = async (redpacketId: number) => {
    const res = await apiPost('/redpackets/claim', { redpacketId }, currentUser!.id);
    if (res.ok) {
      setShowRedpacketClaimModal(false);
      setClaimingRedpacket(null);
      adminToastFn(res.msg);
      const credRes = await apiGet('/user/credits', currentUser!.id) as { ok: boolean; credits: number };
      if (credRes.ok) setCredits(credRes.credits);
    } else {
      adminToastFn(res.msg || '领取失败');
    }
  };

  const loadRedpacketInfo = async (redpacketId: number) => {
    try {
      const res = await fetch(`${API}/redpackets/${redpacketId}?userId=${currentUser?.id || 0}`, { headers: authHeaders() });
      const data = await res.json();
      if (data.ok) {
        setClaimingRedpacket(data.redpacket);
        setShowRedpacketClaimModal(true);
      }
    } catch {}
  };

  const handleDeleteChat = async (peerId: number) => {
    if (!currentUser) {
      return;
    }
    const res = await apiDelete(`/messages?peerId=${peerId}`, currentUser.id);
    if (res.ok) {
      setConversations(prev => prev.map(c => {
        if (c.peerId !== peerId) return c;
        // 预览、未读计数、游标一并清空，避免列表残留旧内容
        return { ...c, messages: [], lastMessage: undefined, unread: 0 };
      }));
      setLastMsgId(prev => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      adminToastFn(`已删除 ${res.deleted} 条聊天记录`);
    } else {
      adminToastFn(res.msg || '删除失败');
    }
  };

  // Group handlers
  const handleCreateGroup = async () => {
    if (!currentUser) return;
    const memberIds = Array.from(selectedFriends);
    const res = await apiPost('/groups/create', {
      name: createGroupForm.name,
      memberIds
    }, currentUser.id);
    if (res.ok) {
      setShowCreateGroupModal(false);
      setCreateGroupForm({ name: '' });
      setSelectedFriends(new Set());
      adminToastFn('群聊创建成功');
      // 重新加载群聊列表
      loadGroups();
    } else {
      adminToastFn(res.msg || '创建失败');
    }
  };

  const handleAddGroupMember = async (groupId: number) => {
    if (!currentUser) return;
    const memberIds = Array.from(selectedFriends);
    const res = await apiPost(`/groups/${groupId}/members`, {
      memberIds
    }, currentUser.id);
    if (res.ok) {
      setShowAddMemberModal(false);
      setSelectedFriends(new Set());
      adminToastFn(`成功添加 ${res.added} 个成员`);
      // 重新加载群聊详情
      if (currentGroup?.id === groupId) {
        loadGroupDetails(groupId);
      }
    } else {
      adminToastFn(res.msg || '添加失败');
    }
  };

  const handleSendGroupMessage = async (groupId: number, content: string, replyToId?: number) => {
    if (!currentUser) return;
    const res = await apiPost(`/groups/${groupId}/messages`, {
      content,
      replyToId,
    }, currentUser.id);
    if (res.ok) {
      // 消息发送成功，会通过轮询更新
    } else {
      adminToastFn(res.msg || '发送失败');
    }
  };

  // 删除单条群消息
  const handleDeleteGroupMessage = async (groupId: number, messageId: number) => {
    if (!currentUser) return;
    const res = await apiDelete(`/groups/${groupId}/messages/${messageId}`, currentUser.id);
    if (res.ok) {
      setGroupMessages(prev => ({
        ...prev,
        [groupId]: (prev[groupId] || []).filter(m => m.id !== messageId),
      }));
    } else {
      adminToastFn(res.msg || '删除失败');
    }
  };

  // 撤回群消息（5 分钟内）
  const handleRecallGroupMessage = async (groupId: number, messageId: number) => {
    if (!currentUser) return;
    const res = await apiPost(`/groups/${groupId}/messages/${messageId}/recall`, {}, currentUser.id);
    if (res.ok) {
      setGroupMessages(prev => ({
        ...prev,
        [groupId]: (prev[groupId] || []).map(m => (m.id === messageId ? { ...m, recalled: true } : m)),
      }));
      adminToastFn('已撤回');
    } else {
      adminToastFn(res.msg || '撤回失败');
    }
  };

  // ─── 文件上传与媒体消息 ───
  const uploadFile = async (file: File): Promise<{ url: string; name: string; size: number } | null> => {
    try {
      if (file.size > 8 * 1024 * 1024) { adminToastFn('文件不能超过 8MB'); return null; }
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await apiPost('/files/upload', { fileName: file.name, mime: file.type, data }, currentUser?.id);
      if (res.ok) return { url: res.url, name: res.fileName, size: res.size };
      adminToastFn(res.msg || '上传失败');
      return null;
    } catch {
      adminToastFn('上传失败');
      return null;
    }
  };

  // 发送媒体消息（单聊，乐观更新 + 轮询去重）
  const handleSendMedia = async (convId: string, info: { url: string; name: string; size: number }, kind: 'image' | 'file', replyToId?: number) => {
    if (!currentUser) return;
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    const label = kind === 'image' ? '图片' : '文件';
    const msg: any = {
      id: `msg-${Date.now()}`,
      senderId: currentUser.id,
      content: info.name,
      type: kind,
      fileUrl: info.url,
      fileName: info.name,
      fileSize: info.size,
      timestamp: new Date(),
      read: false,
    };
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, messages: [...c.messages, msg], lastMessage: { content: `[${label}] ${info.name}`, timestamp: msg.timestamp } }
        : c
    ));
    try {
      const res = await apiPost('/messages/send', {
        receiverId: conv.peerId, content: info.name, type: kind,
        fileUrl: info.url, fileName: info.name, fileSize: info.size, replyToId,
      }, currentUser.id);
      if (res.ok) {
        // 替换乐观消息为服务端 id，并按 id 去重（轮询可能已先拉到同一条）
        setConversations(prev => prev.map(c => {
          if (c.id !== convId) return c;
          const replaced = c.messages.map(m => (m.id === msg.id ? { ...m, id: `server-${res.message.id}` } : m));
          const seen = new Set<string>();
          const unique = replaced.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)));
          return { ...c, messages: unique };
        }));
        // 不覆盖 lastMsgId：由轮询自然推进，避免跳过对方更早发出、尚未拉到的消息
      } else {
        setConversations(prev => prev.map(c =>
          c.id === convId ? { ...c, messages: c.messages.filter(m => m.id !== msg.id) } : c
        ));
        adminToastFn(res.msg || '发送失败');
      }
    } catch {
      // 网络异常：移除乐观消息并提示，避免残留一条发不出去的幽灵消息
      setConversations(prev => prev.map(c =>
        c.id === convId ? { ...c, messages: c.messages.filter(m => m.id !== msg.id) } : c
      ));
      adminToastFn('网络异常，发送失败');
    }
  };

  // 发送媒体消息（群聊，乐观更新）
  const handleSendMediaGroup = async (groupId: number, info: { url: string; name: string; size: number }, kind: 'image' | 'file', replyToId?: number) => {
    if (!currentUser) return;
    const tempMsg: GroupMessage = {
      id: Date.now(),
      groupId,
      senderId: currentUser.id,
      senderName: currentUser.username,
      senderNickname: currentUser.nickname,
      content: info.name,
      type: kind,
      fileUrl: info.url,
      fileName: info.name,
      fileSize: info.size,
      timestamp: Date.now(),
    };
    setGroupMessages(prev => ({
      ...prev,
      [groupId]: [...(prev[groupId] || []), tempMsg],
    }));
    try {
      const res = await apiPost(`/groups/${groupId}/messages`, {
        content: info.name, type: kind, fileUrl: info.url, fileName: info.name, fileSize: info.size, replyToId,
      }, currentUser.id);
      if (res.ok) {
        setGroupMessages(prev => {
          const list = prev[groupId] || [];
          return {
            ...prev,
            [groupId]: list
              .map(m => (m.id === tempMsg.id ? { ...res.message, senderName: m.senderName, senderNickname: m.senderNickname } : m))
              .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i),
          };
        });
        setLastGroupMsgId(prev => ({ ...prev, [groupId]: res.message.id }));
      } else {
        setGroupMessages(prev => ({
          ...prev,
          [groupId]: (prev[groupId] || []).filter(m => m.id !== tempMsg.id),
        }));
        adminToastFn(res.msg || '发送失败');
      }
    } catch {
      // 网络异常：移除乐观消息并提示
      setGroupMessages(prev => ({
        ...prev,
        [groupId]: (prev[groupId] || []).filter(m => m.id !== tempMsg.id),
      }));
      adminToastFn('网络异常，发送失败');
    }
  };

  const handleLeaveGroup = async (groupId: number) => {
    if (!currentUser) return;
    const res = await apiDelete(`/groups/${groupId}/members`, currentUser.id);
    if (res.ok) {
      adminToastFn('已退出群聊');
      setActiveGroupId(null);
      // 重新加载群聊列表
      loadGroups();
    } else {
      adminToastFn(res.msg || '退出失败');
    }
  };

  const handleUpdateGroupName = async (groupId: number, newName: string) => {
    if (!currentUser) return;
    // 自定义PUT请求，因为我们只有apiPost、apiGet和apiDelete
    try {
      const res = await fetch(`${API}/groups/${groupId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify({ name: newName })
      });
      const data = await res.json();
      if (data.ok) {
        adminToastFn('群聊名称已修改');
        // 重新加载群聊列表
        loadGroups();
        // 重新加载群聊详情
        loadGroupDetails(groupId);
        setShowGroupSettingsModal(false);
      } else {
        adminToastFn(data.msg || '修改失败');
      }
    } catch (e) {
      adminToastFn('网络错误');
    }
  };

  const loadGroups = async () => {
    if (!currentUser) return;
    const res = await apiGet('/groups', currentUser.id) as { ok: boolean; groups: Group[] };
    if (res.ok) {
      setGroups(res.groups);
    }
  };

  const loadGroupDetails = async (groupId: number) => {
    if (!currentUser) return;
    const res = await apiGet(`/groups/${groupId}`, currentUser.id) as { ok: boolean; group: Group };
    if (res.ok) {
      setCurrentGroup(res.group);
    }
  };

  const loadGroupMessages = async (groupId: number) => {
    if (!currentUser) return;
    const lastId = lastGroupMsgId[groupId] || 0;
    const res = await apiGet(`/groups/${groupId}/messages?after=${lastId}`, currentUser.id) as { ok: boolean; messages: GroupMessage[]; changed?: GroupMessage[] };
    if (res.ok && res.messages.length > 0) {
      // 去重：手动加载与轮询可能并发返回同一批消息
      setGroupMessages(prev => {
        const existing = prev[groupId] || [];
        const existingIds = new Set(existing.map(m => m.id));
        const unique = res.messages.filter(m => !existingIds.has(m.id));
        if (unique.length === 0) return prev;
        return { ...prev, [groupId]: [...existing, ...unique] };
      });
      const maxId = Math.max(...res.messages.map(m => m.id));
      setLastGroupMsgId(prev => ({
        ...prev,
        [groupId]: Math.max(maxId, prev[groupId] || 0),
      }));
    }
  };

  const handleUpdateProfile = async () => {
    const res = await apiPut('/user/profile', {
      nickname: profileForm.nickname,
      avatar: profileForm.avatar,
      bio: profileForm.bio,
    }, currentUser!.id);
    if (res.ok) {
      setCurrentUser(res.user);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(res.user));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(res.user));
      setShowProfileModal(false);
      adminToastFn('资料已更新');
    } else {
      adminToastFn(res.msg || '更新失败');
    }
  };

  // 修改自己的密码
  const handleChangePassword = async () => {
    setPwdError('');
    if (!currentUser) return;
    if (!pwdForm.oldPassword) { setPwdError('请输入原密码'); return; }
    if (pwdForm.newPassword.length < 6) { setPwdError('新密码至少6个字符'); return; }
    if (pwdForm.newPassword !== pwdForm.confirmPassword) { setPwdError('两次输入的新密码不一致'); return; }
    setPwdLoading(true);
    try {
      const res = await apiPost('/user/password', {
        oldPassword: pwdForm.oldPassword,
        newPassword: pwdForm.newPassword,
      }, currentUser.id);
      if (res.ok) {
        setShowPwdModal(false);
        setPwdForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
        adminToastFn('密码已修改，下次登录请使用新密码');
      } else {
        setPwdError(res.msg || '修改失败');
      }
    } catch {
      setPwdError('网络错误，请稍后重试');
    }
    setPwdLoading(false);
  };

  const handleTransfer = async (targetId: number, amount: number, note: string) => {
    const res = await apiPost('/transfer', {
      targetId,
      amount,
      note,
    }, currentUser!.id);
    if (res.ok) {
      setCredits(res.credits);
      loadTransfers();
      adminToastFn('转账成功');
    } else {
      adminToastFn(res.msg || '转账失败');
    }
  };

  const loadItemRatings = async (itemId: number) => {
    try {
      const res = await fetch(`${API}/ratings/${itemId}`);
      const data = await res.json();
      if (data.ok) {
        setItemRatings(data.ratings);
      }
    } catch {}
  };

  const handleSubmitRating = async (rating: number, comment: string) => {
    if (!ratingItem) return;
    const res = await apiPost('/ratings', {
      itemId: ratingItem.id,
      rating,
      comment,
    }, currentUser!.id);
    if (res.ok) {
      setShowRatingModal(false);
      setRatingItem(null);
      adminToastFn('评价成功');
      loadItemRatings(ratingItem.id);
    } else {
      adminToastFn(res.msg || '评价失败');
    }
  };

  const handleClearMessages = async () => {
    const res = await apiPost('/admin/clear-messages', {}, currentUser!.id);
    if (res.ok) { adminToastFn(res.msg); loadAdminData(); }
    else adminToastFn(res.msg || '操作失败');
  };

  // ─── Load friends & blocks on mount ───
  useEffect(() => {
    if (!currentUser) return;
    apiGet('/friends').then((res: { ok: boolean; friends: ChatUser[]; msg?: string }) => {
      if (res.ok) {
        setFriends(res.friends);
      }
    }).catch(() => {
      // 好友列表加载失败，静默处理
    });
    apiGet('/blocks', currentUser.id).then((res: { ok: boolean; blocks: ChatUser[] }) => {
      if (res.ok) setBlockedIds(new Set(res.blocks.map(b => b.id)));
    }).catch(() => {});
    apiGet('/blocks/check', currentUser.id).then((res: { ok: boolean; blockedBy: number[] }) => {
      if (res.ok) setBlockedBy(new Set(res.blockedBy));
    }).catch(() => {});
    apiGet('/user/credits', currentUser.id).then((res: { ok: boolean; credits: number }) => {
      if (res.ok) setCredits(res.credits);
    }).catch(() => {});
    // 加载群聊列表
    loadGroups();
    // 加载会话设置（置顶/免打扰）
    loadConvSettings();
  }, [currentUser]);

  // ─── Check user status on mount and on focus ───
  useEffect(() => {
    if (!currentUser || page !== 'chat') return;

    const checkStatus = async () => {
      try {
        const res = await apiGet('/user/status', currentUser.id);
        if (res.ok && res.user) {
          // 更新本地存储的用户信息（role、disabled 等）
          if (JSON.stringify(res.user) !== JSON.stringify(currentUser)) {
            setCurrentUser(res.user);
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(res.user));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(res.user));
          }
        } else if (!res.ok) {
          // 用户被禁用或不存在，强制退出
          handleLogout();
        }
      } catch {}
    };

    checkStatus();
    window.addEventListener('focus', checkStatus);
    return () => window.removeEventListener('focus', checkStatus);
  }, [currentUser, page]);

  // ─── Poll for new messages every 2 seconds ───
  useEffect(() => {
    if (!currentUser || page !== 'chat') return;
    const timer = setInterval(async () => {
      // 上一轮还没跑完就跳过，避免慢网络下请求堆积
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
      const user = currentUserRef.current;
      if (!user) return;
      const allFriends = friendsRef.current;
      const activeId = activeConvIdRef.current;
      // 变更同步基准：上一轮响应的 serverTime（服务器时钟，客户端时钟偏差也不会丢变更）
      const changedSince = lastServerTimeRef.current;

      // 拉取所有好友的新消息（新消息 + 变更同步）
      const allFriendIds = allFriends.map(f => f.id);
      for (const peerId of allFriendIds) {
        // 直接从 ref 读取最新的 afterId（不通过 setState 回调）
        const afterId = lastMsgIdRef.current[peerId] || 0;

        try {
          const res = await apiGet(`/messages?peerId=${peerId}&after=${afterId}&changedAfter=${changedSince}`, user.id);
          if (res.ok) {
            if (res.serverTime && res.serverTime > lastServerTimeRef.current) {
              lastServerTimeRef.current = res.serverTime;
            }
            const mapMsg = (m: any): ChatMessage => ({
              id: `server-${m.id}`,
              senderId: m.senderId,
              content: m.content,
              timestamp: new Date(m.timestamp),
              type: m.type || 'text',
              redpacketId: m.redpacketId || undefined,
              redpacketStatus: m.type === 'redpacket' ? (m.redpacketStatus || 'active') : undefined,
              replyToId: m.replyToId || undefined,
              replyTo: m.replyTo || undefined,
              recalled: m.recalled,
              read: m.read,
              deleted: m.deleted,
              fileUrl: m.fileUrl,
              fileName: m.fileName,
              fileSize: m.fileSize,
            });

            // 变更同步：对方撤回 / 已读 / 删除的旧消息，按 id 替换或移除
            const changedMsgs: ChatMessage[] = (res.changed || []).map(mapMsg);
            if (changedMsgs.length > 0) {
              setConversations(prev => prev.map(c => {
                if (c.peerId !== peerId) return c;
                const byId = new Map(changedMsgs.map(m => [m.id, m]));
                const msgs = c.messages
                  .map(m => (byId.has(m.id) ? { ...byId.get(m.id)! } : m))
                  .filter(m => !(m as ChatMessage).deleted);
                const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
                return {
                  ...c,
                  messages: msgs,
                  lastMessage: lastMsg
                    ? {
                        content: lastMsg.recalled
                          ? (lastMsg.senderId === user.id ? '你撤回了一条消息' : '对方撤回了一条消息')
                          : lastMsg.content,
                        timestamp: lastMsg.timestamp,
                      }
                    : undefined,
                };
              }));
            }

            if (res.messages.length > 0) {
              const newMsgs: ChatMessage[] = res.messages.map(mapMsg);

            const maxId = Math.max(...res.messages.map((m: any) => m.id));
            setLastMsgId(prev => ({ ...prev, [peerId]: maxId }));

            // 用 ref 获取最新的会话列表（避免闭包过期）
            setConversations(prev => {
              const existingConv = prev.find(c => c.peerId === peerId);
              const latestMsg = newMsgs[newMsgs.length - 1];

              if (existingConv) {
                // 去重：只添加不存在的消息
                const existingIds = new Set(existingConv.messages.map(m => m.id));
                const uniqueNew = newMsgs.filter(m => !existingIds.has(m.id));
                if (uniqueNew.length === 0) return prev;
                const isOtherActive = activeId === existingConv.id;
                return prev.map(c => {
                  if (c.id !== existingConv.id) return c;
                  return {
                    ...c,
                    messages: [...c.messages, ...uniqueNew],
                    lastMessage: { content: latestMsg.content, timestamp: latestMsg.timestamp },
                    unread: isOtherActive ? c.unread : c.unread + uniqueNew.filter(m => m.senderId !== user.id && !m.read).length,
                  };
                });
              } else {
                // 没有会话就创建一个
                const friendUser = allFriends.find(f => f.id === peerId);
                if (friendUser) {
                  const newConv: Conversation = {
                    id: `conv-${Date.now()}-${peerId}`,
                    peerId,
                    peerName: friendUser.username,
                    peerColor: pickColor(peerId),
                    messages: newMsgs,
                    unread: newMsgs.filter(m => m.senderId !== user.id && !m.read).length,
                    lastMessage: { content: latestMsg.content, timestamp: latestMsg.timestamp },
                  };
                  return [newConv, ...prev];
                }
                return prev;
              }
            });
            }
          }
        } catch {}
      }

      // 拉取群聊消息（新消息 + 变更同步）
      const allGroups = groupsRef.current;
      for (const group of allGroups) {
        const afterId = lastGroupMsgIdRef.current[group.id] || 0;
        try {
          const res = await apiGet(`/groups/${group.id}/messages?after=${afterId}&changedAfter=${changedSince}`, user.id);
          if (res.ok) {
            if (res.serverTime && res.serverTime > lastServerTimeRef.current) {
              lastServerTimeRef.current = res.serverTime;
            }
            const mapGMsg = (m: any): GroupMessage => ({
              id: m.id,
              groupId: m.groupId,
              senderId: m.senderId,
              senderName: m.senderName,
              senderNickname: m.senderNickname,
              content: m.content,
              type: m.type || 'text',
              redpacketId: m.redpacketId || undefined,
              redpacketStatus: m.type === 'redpacket' ? (m.redpacketStatus || 'active') : undefined,
              replyToId: m.replyToId || undefined,
              replyTo: m.replyTo || undefined,
              recalled: m.recalled,
              mentionedMe: m.mentionedMe,
              deleted: m.deleted,
              fileUrl: m.fileUrl,
              fileName: m.fileName,
              fileSize: m.fileSize,
              timestamp: m.timestamp,
            });

            // 变更同步：撤回 / 删除的旧群消息
            const changedGMsgs: GroupMessage[] = (res.changed || []).map(mapGMsg);
            if (changedGMsgs.length > 0) {
              setGroupMessages(prev => {
                const list = prev[group.id] || [];
                const byId = new Map(changedGMsgs.map(m => [m.id, m]));
                const merged = list
                  .map(m => (byId.has(m.id) ? { ...byId.get(m.id)! } : m))
                  .filter(m => !(m as GroupMessage).deleted);
                return { ...prev, [group.id]: merged };
              });
            }

            if (res.messages.length > 0) {
              const newGroupMsgs: GroupMessage[] = res.messages.map(mapGMsg);

            const maxId = Math.max(...res.messages.map((m: any) => m.id));
            setLastGroupMsgId(prev => ({ ...prev, [group.id]: maxId }));

            setGroupMessages(prev => {
              const existingMsgs = prev[group.id] || [];
              const existingIds = new Set(existingMsgs.map(m => m.id));
              const uniqueNew = newGroupMsgs.filter(m => !existingIds.has(m.id));
              if (uniqueNew.length === 0) return prev;
              return {
                ...prev,
                [group.id]: [...existingMsgs, ...uniqueNew]
              };
            });
            // 有新消息提及我且不在该群 → 群列表显示"@我"徽标
            if (newGroupMsgs.some(m => m.mentionedMe) && activeGroupIdRef.current !== group.id) {
              setMentionedGroupIds(prev => new Set(prev).add(group.id));
            }
            }
          }
        } catch {}
      }
      } finally { pollingRef.current = false; }
    }, 2000);
    return () => clearInterval(timer);
  }, [currentUser, page]);

  // ─── Conversation helpers ───
  const getOrCreateConv = (peerId: number, peerName: string) => {
    const existing = conversations.find(c => c.peerId === peerId);
    setActiveGroupId(null);
    if (existing) {
      setActiveConvId(existing.id);
      // 从好友列表/搜索结果进入也要清未读
      setConversations(prev => prev.map(c => (c.id === existing.id ? { ...c, unread: 0 } : c)));
      setActiveView('chats');
      return;
    }
    const newConv: Conversation = {
      id: `conv-${Date.now()}`,
      peerId, peerName,
      peerColor: pickColor(peerId),
      messages: [], unread: 0,
    };
    setConversations(prev => [newConv, ...prev]);
    setActiveConvId(newConv.id);
    setActiveView('chats');
  };

  const handleSendMsg = async (convId: string, content: string, replyToId?: number) => {
    if (!content.trim() || !currentUser) return;
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;

    // 检查是否被对方拉黑
    if (blockedBy.has(conv.peerId)) { adminToastFn('你已被对方拉黑，无法发送消息'); return; }

    // 先立即显示在界面上（乐观更新）
    const msg: Message = {
      id: `msg-${Date.now()}`,
      senderId: currentUser.id,
      content: content.trim(),
      timestamp: new Date(),
    };
    setConversations(prev => prev.map(c => {
      if (c.id !== convId) return c;
      return { ...c, messages: [...c.messages, msg], lastMessage: { content: content.trim(), timestamp: msg.timestamp } };
    }));

    // 再发到后端存储
    try {
      const res = await apiPost('/messages/send', { receiverId: conv.peerId, content: content.trim(), replyToId }, currentUser.id);
      if (res.ok) {
        // 用后端返回的真实 id 替换临时 id
        const serverMsg = res.message;
        // 替换乐观消息为服务端 id，并按 id 去重（轮询可能已先拉到同一条）
        setConversations(prev => prev.map(c => {
          if (c.id !== convId) return c;
          const replaced = c.messages.map(m => (m.id === msg.id ? { ...m, id: `server-${serverMsg.id}` } : m));
          const seen = new Set<string>();
          const unique = replaced.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)));
          return { ...c, messages: unique };
        }));
        // 不覆盖 lastMsgId：由轮询自然推进，避免跳过对方更早发出、尚未拉到的消息
        // 刷新好友列表以更新 confirmed 状态
        apiGet('/friends').then((res: { ok: boolean; friends: ChatUser[] }) => {
          if (res.ok) setFriends(res.friends);
        });
      } else {
        // 发送失败（如被对方拉黑），移除乐观更新的消息
        setConversations(prev => prev.map(c => {
          if (c.id !== convId) return c;
          const filtered = c.messages.filter(m => m.id !== msg.id);
          const lastMsg = filtered.length > 0 ? filtered[filtered.length - 1] : null;
          return {
            ...c,
            messages: filtered,
            lastMessage: lastMsg ? { content: lastMsg.content, timestamp: lastMsg.timestamp } : undefined,
          };
        }));
        // 如果是被拉黑，记录下来
        if (res.msg && res.msg.includes('拉黑')) {
          setBlockedBy(prev => new Set(prev).add(conv.peerId));
        }
      }
    } catch {}
  };

  // 标记与某好友的消息为已读（进入会话 / 收到新消息时调用）
  const handleReadMessages = async (peerId: number) => {
    if (!currentUser) return;
    try {
      const res = await apiPost('/messages/read', { peerId }, currentUser.id);
      if (res.ok && res.marked > 0) {
        setConversations(prev => prev.map(c =>
          c.peerId === peerId
            ? { ...c, messages: c.messages.map(m => (m.senderId === peerId ? { ...m, read: true } : m)) }
            : c
        ));
      }
    } catch {}
  };

  // 删除单条消息
  const handleDeleteMessage = async (peerId: number, messageId: number) => {
    if (!currentUser) return;
    const res = await apiDelete(`/messages/${messageId}`, currentUser.id);
    if (res.ok) {
      setConversations(prev => prev.map(c => {
        if (c.peerId !== peerId) return c;
        const msgs = c.messages.filter(m => m.id !== `server-${messageId}`);
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
        return {
          ...c,
          messages: msgs,
          lastMessage: lastMsg ? { content: lastMsg.content, timestamp: lastMsg.timestamp } : undefined,
        };
      }));
    } else {
      adminToastFn(res.msg || '删除失败');
    }
  };

  // 撤回消息（5 分钟内）
  const handleRecallMessage = async (peerId: number, messageId: number) => {
    if (!currentUser) return;
    const res = await apiPost(`/messages/${messageId}/recall`, {}, currentUser.id);
    if (res.ok) {
      setConversations(prev => prev.map(c => {
        if (c.peerId !== peerId) return c;
        const msgs = c.messages.map(m => (m.id === `server-${messageId}` ? { ...m, recalled: true } : m));
        // 若撤回的是最后一条消息，会话列表预览同步更新
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
        return {
          ...c,
          messages: msgs,
          lastMessage: lastMsg
            ? { content: lastMsg.recalled ? '你撤回了一条消息' : lastMsg.content, timestamp: lastMsg.timestamp }
            : undefined,
        };
      }));
      adminToastFn('已撤回');
    } else {
      adminToastFn(res.msg || '撤回失败');
    }
  };

  // 消息搜索（输入即时查询，展示匹配会话 + 匹配消息）
  const handleChatSearch = (q: string) => {
    setSearchQuery(q);
    const seq = ++searchSeqRef.current;
    if (searchTimerRef.current) { clearTimeout(searchTimerRef.current); searchTimerRef.current = null; }
    if (!q.trim() || !currentUser) { setMsgSearchResults([]); return; }
    // 防抖 200ms：避免每次按键都发请求
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await apiGet(`/messages/search?q=${encodeURIComponent(q.trim())}`, currentUser.id);
        // 只接受最新一次请求的结果
        if (seq === searchSeqRef.current && res.ok) setMsgSearchResults(res.results || []);
      } catch {}
    }, 200);
  };

  // 加载会话设置（置顶 / 免打扰）
  const loadConvSettings = async () => {
    if (!currentUser) return;
    try {
      const res = await apiGet('/conv-settings', currentUser.id);
      if (res.ok) {
        const m: Record<number, { pinned: boolean; muted: boolean }> = {};
        res.settings.forEach((s: any) => { m[s.peerId] = { pinned: !!s.pinned, muted: !!s.muted }; });
        setConvSettings(m);
      }
    } catch {}
  };

  const toggleConvPin = async (peerId: number) => {
    const cur = convSettings[peerId] || { pinned: false, muted: false };
    const next = { ...cur, pinned: !cur.pinned };
    setConvSettings(prev => ({ ...prev, [peerId]: next }));
    try {
      const res = await apiPost('/conv-settings', { peerId, pinned: next.pinned }, currentUser?.id);
      if (!res.ok) {
        // 失败回滚，避免界面与服务端不一致
        setConvSettings(prev => ({ ...prev, [peerId]: cur }));
        adminToastFn(res.msg || '置顶设置失败');
      }
    } catch {
      setConvSettings(prev => ({ ...prev, [peerId]: cur }));
    }
  };

  const toggleConvMute = async (peerId: number) => {
    const cur = convSettings[peerId] || { pinned: false, muted: false };
    const next = { ...cur, muted: !cur.muted };
    setConvSettings(prev => ({ ...prev, [peerId]: next }));
    try {
      const res = await apiPost('/conv-settings', { peerId, muted: next.muted }, currentUser?.id);
      if (!res.ok) {
        setConvSettings(prev => ({ ...prev, [peerId]: cur }));
        adminToastFn(res.msg || '免打扰设置失败');
      }
    } catch {
      setConvSettings(prev => ({ ...prev, [peerId]: cur }));
    }
  };

  const sortedConvs = [...conversations].sort((a, b) => {
    const pa = convSettings[a.peerId]?.pinned ? 1 : 0;
    const pb = convSettings[b.peerId]?.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (b.lastMessage?.timestamp.getTime() ?? 0) - (a.lastMessage?.timestamp.getTime() ?? 0);
  });
  const filteredConvs = searchQuery
    ? sortedConvs.filter(c => c.peerName.toLowerCase().includes(searchQuery.toLowerCase()))
    : sortedConvs;

  // ─── Friend search ───
  const handleSearchFriend = async () => {
    if (!friendSearchQuery.trim()) return;
    try {
      const res = await apiGet(`/users/search?q=${encodeURIComponent(friendSearchQuery.trim())}`);
      if (res.ok) {
        setFriendSearchResults(res.users);
        setFriendSearchHint('');
        setAddedFriendIds(new Set());
      } else {
        setFriendSearchResults([]);
        setFriendSearchHint(res.msg || '搜索失败');
      }
    } catch { setFriendSearchHint('网络错误'); }
  };

  const handleAddFriend = async (userId: number) => {
    setAddFriendError('');
    try {
      const res = await apiPost('/friends/add', { friendId: userId });
      if (res.ok) {
        setAddedFriendIds(prev => new Set(prev).add(userId));
        // Refresh friend list
        const friendsRes = await apiGet('/friends');
        if (friendsRes.ok) setFriends(friendsRes.friends);
      } else {
        setAddFriendError(res.msg || '添加失败');
      }
    } catch {
      setAddFriendError('网络错误，请检查后端服务器是否运行');
    }
  };

  const handleRemoveFriend = async (friendId: number) => {
    try {
      const res = await apiDelete(`/friends/${friendId}`);
      if (res.ok) {
        setFriends(prev => prev.filter(f => f.id !== friendId));
        setConversations(prev => prev.filter(c => c.peerId !== friendId));
        if (activeConversation?.peerId === friendId) setActiveConvId(null);
      }
    } catch {}
  };

  const handleBlockUser = async (friendId: number) => {
    try {
      const res = await apiPost('/block', { targetId: friendId });
      if (res.ok) {
        setBlockedIds(prev => new Set(prev).add(friendId));
      }
    } catch {}
  };

  const handleUnblockUser = async (friendId: number) => {
    try {
      const res = await apiPost('/unblock', { targetId: friendId });
      if (res.ok) {
        setBlockedIds(prev => {
          const next = new Set(prev);
          next.delete(friendId);
          return next;
        });
      }
    } catch {}
  };

  // ─── Render ───
  if (page === 'login') return <LoginPage onLogin={handleLogin} onGoRegister={() => setPage('register')} />;
  if (page === 'register') return <RegisterPage onLogin={handleLogin} onGoLogin={() => setPage('login')} />;

  return (
    <div className="app">
      {/* 全局提示：任何视图都能看到（上传失败/被拉黑/撤回失败等） */}
      {adminToast && <div className="admin-toast">{adminToast}</div>}
      {/* 全站公告 */}
      {announcement && !announcementDismissed && (
        <div className="announcement-bar">
          <Megaphone size={15} />
          <span className="announcement-text">{announcement}</span>
          <button className="announcement-close" title="关闭公告" onClick={dismissAnnouncement}><X size={14} /></button>
        </div>
      )}
      {/* Sidebar */}
      <nav className="sidebar">
        <button className={`sidebar-icon ${activeView === 'chats' ? 'active' : ''}`} onClick={() => { setActiveGroupId(null); setActiveView('chats'); }}>
          <MessageCircle size={22} />
          {totalUnread > 0 && <span className="sidebar-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
        </button>
        <button className={`sidebar-icon ${activeView === 'groups' ? 'active' : ''}`} onClick={() => { setActiveConvId(null); setActiveView('groups'); }}>
          <Users size={22} />
        </button>
        <button className={`sidebar-icon ${activeView === 'friends' ? 'active' : ''}`} onClick={() => { setActiveGroupId(null); setActiveView('friends'); setAddedFriendIds(new Set()); setFriendSearchResults([]); }}>
          <User size={22} />
        </button>
        <button className={`sidebar-icon ${activeView === 'addfriend' ? 'active' : ''}`} onClick={() => { setActiveGroupId(null); setActiveView('addfriend'); setAddedFriendIds(new Set()); setFriendSearchResults([]); }}>
          <UserPlus size={22} />
        </button>
        <button className={`sidebar-icon ${activeView === 'market' ? 'active' : ''}`} onClick={() => { setActiveGroupId(null); setActiveConvId(null); setActiveView('market'); }}>
          <ShoppingBag size={22} />
        </button>
        <button className={`sidebar-icon ${activeView === 'settings' ? 'active' : ''}`} onClick={() => { setActiveGroupId(null); setActiveConvId(null); setActiveView('settings'); }}>
          <Settings size={22} />
        </button>
        {isAdminUser && (
          <button className={`sidebar-icon admin-icon ${activeView === 'admin' ? 'active' : ''}`} onClick={() => setActiveView('admin')} title="管理后台">
            <Shield size={22} />
          </button>
        )}
        <div className="sidebar-avatar" title={currentUser?.username} onClick={() => setActiveView('settings')}>
          <AvatarContent avatar={currentUser?.avatar} fallback={currentUser?.username?.[0]?.toUpperCase() || '?'} />
        </div>
      </nav>

      {/* Panel */}
      <div className="panel">
        {/* ── Chats ── */}
        {activeView === 'chats' && (
          <>
            <div className="panel-header">消息</div>
            <input className="search-box" placeholder="搜索会话或消息" value={searchQuery} onChange={e => handleChatSearch(e.target.value)} />
            <div className="conv-list">
              {searchQuery.trim() === '' ? (
                <>
                  {filteredConvs.length === 0 && (
                    <div style={{ padding: '40px 16px', textAlign: 'center', color: '#bbb', fontSize: 13 }}>
                      暂无消息
                    </div>
                  )}
                  {filteredConvs.map(conv => (
                    <div key={conv.id} className={`conv-item ${activeConvId === conv.id ? 'active' : ''}`} onClick={() => { setActiveGroupId(null); setActiveConvId(conv.id); setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unread: 0 } : c)); }}>
                      <div className="conv-avatar" style={{ background: conv.peerColor }}>
                        {conv.peerName[0].toUpperCase()}
                      </div>
                      <div className="conv-info">
                        <div className="conv-name">{conv.peerName}</div>
                        {conv.lastMessage && <div className="conv-last">{conv.lastMessage.content}</div>}
                      </div>
                      <div className="conv-meta">
                        {convSettings[conv.peerId]?.pinned && <Pin size={12} className="conv-pinned" />}
                        {convSettings[conv.peerId]?.muted && <BellOff size={13} className="conv-muted" />}
                        {conv.lastMessage && <span className="conv-time">{formatTime(conv.lastMessage.timestamp)}</span>}
                        {conv.unread > 0 && !convSettings[conv.peerId]?.muted && <span className="conv-unread">{conv.unread}</span>}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {filteredConvs.length > 0 && (
                    <div className="conv-section">匹配会话</div>
                  )}
                  {filteredConvs.map(conv => (
                    <div key={conv.id} className={`conv-item ${activeConvId === conv.id ? 'active' : ''}`} onClick={() => { setActiveGroupId(null); setActiveConvId(conv.id); setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unread: 0 } : c)); }}>
                      <div className="conv-avatar" style={{ background: conv.peerColor }}>
                        {conv.peerName[0].toUpperCase()}
                      </div>
                      <div className="conv-info">
                        <div className="conv-name">{conv.peerName}</div>
                        {conv.lastMessage && <div className="conv-last">{conv.lastMessage.content}</div>}
                      </div>
                      <div className="conv-meta">
                        {convSettings[conv.peerId]?.pinned && <Pin size={12} className="conv-pinned" />}
                        {convSettings[conv.peerId]?.muted && <BellOff size={13} className="conv-muted" />}
                        {conv.lastMessage && <span className="conv-time">{formatTime(conv.lastMessage.timestamp)}</span>}
                        {conv.unread > 0 && !convSettings[conv.peerId]?.muted && <span className="conv-unread">{conv.unread}</span>}
                      </div>
                    </div>
                  ))}
                  {msgSearchResults.length > 0 && (
                    <div className="conv-section">匹配消息（{msgSearchResults.length}）</div>
                  )}
                  {msgSearchResults.map(r => (
                    <div key={`sr-${r.message.id}`} className="conv-item" onClick={() => getOrCreateConv(r.peerId, r.peerName)}>
                      <div className="conv-avatar" style={{ background: pickColor(r.peerId) }}>
                        {r.peerName[0].toUpperCase()}
                      </div>
                      <div className="conv-info">
                        <div className="conv-name">{r.peerName}</div>
                        <div className="conv-last">{r.message.content}</div>
                      </div>
                      <div className="conv-meta">
                        <span className="conv-time">{formatTime(new Date(r.message.timestamp))}</span>
                      </div>
                    </div>
                  ))}
                  {filteredConvs.length === 0 && msgSearchResults.length === 0 && (
                    <div style={{ padding: '40px 16px', textAlign: 'center', color: '#bbb', fontSize: 13 }}>
                      未找到相关会话或消息
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* ── Groups ── */}
        {activeView === 'groups' && (
          <>
            <div className="panel-header">
              群聊
              <button className="create-group-btn" onClick={() => {
                setSelectedFriends(new Set());
                setShowCreateGroupModal(true);
              }}>
                <Plus size={16} />
              </button>
            </div>
            <div className="conv-list">
              {groups.length === 0 && (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: '#bbb', fontSize: 13 }}>
                  暂无群聊，点击右上角创建群聊
                </div>
              )}
              {groups.map(group => (
                <div key={group.id} className={`conv-item ${activeGroupId === group.id ? 'active' : ''}`} onClick={() => {
                  setActiveConvId(null);
                  setActiveGroupId(group.id);
                  setMentionedGroupIds(prev => { const n = new Set(prev); n.delete(group.id); return n; });
                  loadGroupDetails(group.id);
                  loadGroupMessages(group.id);
                }}>
                  <div className="conv-avatar" style={{ background: pickColor(group.id) }}>
                    <Users size={16} />
                  </div>
                  <div className="conv-info">
                    <div className="conv-name">{group.name}</div>
                    <div className="conv-last">{group.memberCount} 个成员</div>
                  </div>
                  <div className="conv-meta">
                    {mentionedGroupIds.has(group.id) && (
                      <span className="conv-mention">@我</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Friends list ── */}
        {activeView === 'friends' && (
          <>
            <div className="panel-header">好友 ({friends.length})</div>
            <div className="conv-list">
              {friends.length === 0 && (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: '#bbb', fontSize: 13 }}>
                  还没有好友，去添加一个吧
                </div>
              )}
              {friends.map(f => {
                const isBlocked = blockedIds.has(f.id);
                const isNewFriend = !f.confirmed && f.addedBy !== null && f.addedBy !== currentUser?.id;
                return (
                  <div key={f.id} className="conv-item" onClick={() => !isBlocked && getOrCreateConv(f.id, f.username)}>
                    <div className="conv-avatar" style={{ background: pickColor(f.id) }}>
                      {f.username[0].toUpperCase()}
                      <div className={`online-dot ${f.online ? 'on' : 'off'}`} />
                    </div>
                    <div className="conv-info">
                      <div className="conv-name">{f.username}</div>
                      {isNewFriend && <div className="conv-last new-friend-hint">对方添加了你，开始聊天吧</div>}
                      {isBlocked && !isNewFriend && <div className="conv-last blocked-hint">已拉黑</div>}
                    </div>
                    <div className="friend-actions">
                      {isBlocked ? (
                        <button
                          className="add-friend-btn can unblock-btn"
                          onClick={(e) => { e.stopPropagation(); handleUnblockUser(f.id); }}
                          title="取消拉黑"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                        >取消拉黑</button>
                      ) : (
                        <button
                          className="add-friend-btn cannot block-btn"
                          onClick={(e) => { e.stopPropagation(); handleBlockUser(f.id); }}
                          title="拉黑"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                        >拉黑</button>
                      )}
                      <button
                        className="add-friend-btn cannot"
                        onClick={(e) => { e.stopPropagation(); handleRemoveFriend(f.id); }}
                        title="删除好友"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                      >删除</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Add friend ── */}
        {activeView === 'addfriend' && (
          <>
            <div className="panel-header">添加好友</div>
            <div className="search-row">
              <input
                className="search-box"
                placeholder="输入用户名搜索"
                value={friendSearchQuery}
                onChange={e => setFriendSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSearchFriend(); }}
              />
              <button className="search-go" onClick={handleSearchFriend}>搜索</button>
            </div>
            {addFriendError && (
              <div style={{ padding: '10px 16px', textAlign: 'center', color: '#f5222d', fontSize: 13, background: '#fff1f0' }}>
                {addFriendError}
              </div>
            )}
            <div className="conv-list">
              {friendSearchHint && (
                <div style={{ padding: '20px 16px', textAlign: 'center', color: '#bbb', fontSize: 13 }}>
                  {friendSearchHint}
                </div>
              )}
              {friendSearchResults.map(u => {
                const isSelf = currentUser && u.id === currentUser.id;
                const isFriend = friends.some(f => f.id === u.id);
                const justAdded = addedFriendIds.has(u.id);
                const canAdd = !isSelf && !isFriend && !justAdded;
                let btnText = '添加';
                let btnClass = 'can';
                if (isSelf) { btnText = '自己'; btnClass = 'cannot'; }
                else if (isFriend) { btnText = '已添加'; btnClass = 'cannot'; }
                else if (justAdded) { btnText = '已添加'; btnClass = 'done'; }

                return (
                  <div key={u.id} className="add-friend-result">
                    <div className="conv-avatar" style={{ background: pickColor(u.id) }}>
                      {u.username[0].toUpperCase()}
                    </div>
                    <div className="add-friend-result-info">
                      <div className="add-friend-result-name">{u.username}</div>
                      <div className="add-friend-result-hint">{isFriend ? '已经是好友' : ''}</div>
                    </div>
                    <button
                      className={`add-friend-btn ${btnClass}`}
                      disabled={!canAdd}
                      onClick={() => canAdd && handleAddFriend(u.id)}
                    >{btnText}</button>
                  </div>
                );
              })}
              {friendSearchResults.length === 0 && !friendSearchHint && (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: '#bbb', fontSize: 13 }}>
                  输入用户名搜索添加好友
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Settings ── */}
        {activeView === 'settings' && (
          <>
            <div className="panel-header">设置</div>
            <div className="conv-list">
              <div className="settings-item">
                <span className="settings-label">头像</span>
                <span className="settings-value" style={{fontSize:'24px',display:'inline-flex',alignItems:'center'}}>
                  <span style={{width:30,height:30,display:'inline-flex',alignItems:'center',justifyContent:'center',overflow:'hidden',borderRadius:8}}>
                    <AvatarContent avatar={currentUser?.avatar} fallback={currentUser?.username?.[0]?.toUpperCase() || '?'} />
                  </span>
                </span>
              </div>
              <div className="settings-item">
                <span className="settings-label">用户名</span>
                <span className="settings-value">{currentUser?.username}</span>
              </div>
              <div className="settings-item">
                <span className="settings-label">昵称</span>
                <span className="settings-value">{currentUser?.nickname}</span>
              </div>
              <div className="settings-item">
                <span className="settings-label">身份</span>
                <span className="settings-value">
                  {currentUser?.role === 'superadmin'
                    ? <span className="admin-badge super-badge"><Crown size={12} /> 超级管理员</span>
                    : currentUser?.role === 'admin'
                      ? <span className="admin-badge"><Shield size={12} /> 管理员</span>
                      : <span style={{fontSize:'13px',color:'#8c8c8c'}}>普通用户</span>}
                </span>
              </div>
              {currentUser?.bio && (
                <div className="settings-item">
                  <span className="settings-label">简介</span>
                  <span className="settings-value" style={{fontSize:'12px',color:'#666'}}>{currentUser.bio}</span>
                </div>
              )}
              <div className="settings-item">
                <span className="settings-label">好友数</span>
                <span className="settings-value">{friends.length}</span>
              </div>
              <div className="settings-item">
                <span className="settings-label">我的积分</span>
                <span className="settings-value" style={{color:'#faad14',display:'flex',alignItems:'center',gap:'4px'}}>
                  <Coins size={14} /> {credits}
                </span>
              </div>
              <div className="settings-item">
                <span className="settings-label">主题配色</span>
                <div className="theme-picker">
                  {THEMES.map(t => (
                    <button
                      key={t.id}
                      className={`theme-swatch ${theme === t.id ? 'active' : ''}`}
                      title={t.name}
                      onClick={() => setTheme(t.id)}
                      style={{ background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})` }}
                    >
                      {theme === t.id && <Check size={13} strokeWidth={3} />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-item">
                <span className="settings-label">版本</span>
                <span className="settings-value" style={{fontSize:'12px',color:'#8c8c8c'}}>{__BUILD_TIME__}</span>
              </div>
              <button className="logout-btn" onClick={() => { setProfileForm({ nickname: currentUser?.nickname || '', avatar: currentUser?.avatar || '', bio: currentUser?.bio || '' }); setShowProfileModal(true); }} style={{marginTop:'8px'}}>
                <Edit3 size={14} /> 编辑资料
              </button>
              <button className="logout-btn" onClick={() => { setPwdError(''); setPwdForm({ oldPassword: '', newPassword: '', confirmPassword: '' }); setShowPwdModal(true); }} style={{marginTop:'8px'}}>
                修改密码
              </button>
              <button className="logout-btn" onClick={handleLogout} style={{marginTop:'16px',background:'#ff4d4f'}}>
                退出登录
              </button>
            </div>
          </>
        )}

        {/* ── Admin Panel ── */}
        {activeView === 'admin' && (
          <div className="admin-panel">
            <div className="panel-header" style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <Shield size={20} /> 管理后台
              {isSuperAdminUser
                ? <span className="admin-badge super-badge"><Crown size={12} /> 超级管理员</span>
                : <span className="admin-badge"><Shield size={12} /> 管理员</span>}
            </div>

            {/* Stats */}
            {adminStats && (
              <div className="admin-stats">
                <div className="stat-card">
                  <div className="stat-value">{adminStats.totalUsers}</div>
                  <div className="stat-label">总用户</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{adminStats.activeUsers}</div>
                  <div className="stat-label">活跃</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{adminStats.disabledUsers}</div>
                  <div className="stat-label">已禁</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{adminStats.totalMessages}</div>
                  <div className="stat-label">消息</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{adminStats.totalGroups || 0}</div>
                  <div className="stat-label">群聊</div>
                </div>
              </div>
            )}

            {/* Actions bar */}
            <div className="admin-actions">
              <button className="admin-action-btn" onClick={handleClearMessages}>
                <Trash2 size={16} /> 清空所有消息
              </button>
              <button className="admin-action-btn" onClick={loadAdminData}>
                <RotateCcw size={16} /> 刷新
              </button>
            </div>

            {/* User list */}
            <div className="admin-user-list">
              {adminLoading && <div className="admin-loading">加载中...</div>}
              {!adminLoading && adminUsers.map(u => {
                const isSuper = u.role === 'superadmin';
                const isOrdAdmin = u.role === 'admin';
                const isSelf = u.id === currentUser?.id;
                // 规则：管理员都可以管理他人；唯一例外——普通管理员不能罢免/禁用超级管理员
                const canDisable = !isSelf && !(isSuper && !isSuperAdminUser);
                const canResetPwd = !isSelf;
                const canSetAdmin = !isSelf && !isSuper;
                // 超级管理员身份（设为/取消）只有超级管理员能操作
                const canSuperToggle = isSuperAdminUser && !isSelf;
                return (
                <div key={u.id} className={`admin-user-card ${u.disabled ? 'disabled' : ''}`}>
                  <div className="admin-user-info">
                    <div className="admin-user-avatar" style={{background: pickColor(u.id)}}>
                      {u.username[0].toUpperCase()}
                    </div>
                    <div className="admin-user-detail">
                      <div className="admin-user-name">
                        {u.username}
                        {isSuper && <span className="admin-badge super-badge"><Crown size={12} /> 超级管理员</span>}
                        {isOrdAdmin && <span className="admin-badge"><Shield size={12} /> 管理员</span>}
                        {u.disabled && <span className="disabled-badge"><Ban size={12} /> 已禁</span>}
                      </div>
                      <div className="admin-user-meta">ID: {u.id} <span style={{color:'#faad14',marginLeft:'6px',display:'inline-flex',alignItems:'center',gap:'2px'}}><Coins size={11} />{u.credits || 0}</span></div>
                    </div>
                  </div>
                  <div className="admin-user-actions">
                    {canDisable && u.disabled && (
                      <button className="admin-btn enable" onClick={() => handleEnableUser(u.id)} title="启用">
                        <UserCheck size={16} />
                      </button>
                    )}
                    {canDisable && !u.disabled && (
                      <button className="admin-btn disable" onClick={() => handleDisableUser(u.id)} title="注销">
                        <UserX size={16} />
                      </button>
                    )}
                    {canSetAdmin && (
                      <button
                        className={`admin-btn ${isOrdAdmin ? 'remove-admin' : 'make-admin'}`}
                        onClick={() => handleToggleAdmin(u.id)}
                        title={isOrdAdmin ? '取消管理员' : '设为管理员'}
                      >
                        <Shield size={16} />
                      </button>
                    )}
                    {canSuperToggle && (
                      <button
                        className={`admin-btn ${isSuper ? 'remove-super' : 'make-super'}`}
                        onClick={() => handleToggleSuperAdmin(u.id, u.username, isSuper)}
                        title={isSuper ? '取消超级管理员（罢免）' : '设为超级管理员'}
                      >
                        <Crown size={16} />
                      </button>
                    )}
                    {canResetPwd && (
                      <button className="admin-btn reset-pwd" onClick={() => { setResetPwdTarget(resetPwdTarget === u.id ? null : u.id); setResetPwdValue(''); setCreditTarget(null); }} title="重置密码">
                        <RotateCcw size={16} />
                      </button>
                    )}
                    {!isSelf && (
                      <button className="admin-btn credit-btn" onClick={() => { setCreditTarget(creditTarget === u.id ? null : u.id); setCreditValue(''); setResetPwdTarget(null); }} title="调整积分">
                        <Coins size={16} />
                      </button>
                    )}
                    {isSuperAdminUser && !isSelf && !isSuper && (
                      <button className="admin-btn purge-btn" title="彻底删除用户（不可恢复）" onClick={() => handlePurgeUser(u)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  {resetPwdTarget === u.id && (
                    <div className="admin-reset-pwd">
                      <input
                        type="text"
                        placeholder="新密码（至少6位）"
                        value={resetPwdValue}
                        onChange={e => setResetPwdValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleResetPassword(u.id); }}
                      />
                      <button onClick={() => handleResetPassword(u.id)}>确认</button>
                      <button onClick={() => setResetPwdTarget(null)}>取消</button>
                    </div>
                  )}
                  {creditTarget === u.id && (
                    <div className="admin-reset-pwd admin-credit-adjust">
                      <Coins size={14} style={{color:'#faad14',flexShrink:0}} />
                      <input
                        type="number"
                        placeholder="积分变动（+增加，-扣减）"
                        value={creditValue}
                        onChange={e => setCreditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAdjustCredits(u.id); }}
                      />
                      <button className="credit-confirm-btn" onClick={() => handleAdjustCredits(u.id)}>确认</button>
                      <button onClick={() => setCreditTarget(null)}>取消</button>
                    </div>
                  )}
                </div>
                );
              })}
            </div>

            {/* ── 群聊管理（仅超级管理员） ── */}
            {isSuperAdminUser && (
            <div className="admin-section">
              <div className="admin-section-title">
                <Users size={16} /> 群聊管理
                <span className="admin-section-sub">共 {adminGroups.length} 个群</span>
                <button className="admin-link-btn" onClick={loadAdminGroups}>刷新</button>
              </div>
              {adminGroups.length === 0 && <div className="admin-empty">暂无群聊</div>}
              {adminGroups.map(g => (
                <div key={g.id} className="admin-group-row">
                  <div className="admin-group-main">
                    <div className="admin-group-name">{g.name}</div>
                    <div className="admin-group-meta">
                      群主：{g.ownerName} · 成员 {g.memberCount} · 消息 {g.messageCount}
                    </div>
                  </div>
                  <button
                    className="admin-btn disable"
                    title="解散群聊"
                    onClick={() => handleDissolveGroup(g)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            )}

            {/* ── 系统设置（仅超级管理员） ── */}
            {isSuperAdminUser && (
              <div className="admin-section">
                <div className="admin-section-title">
                  <Settings size={16} /> 系统设置
                  <span className="admin-section-sub">仅超级管理员可见</span>
                </div>
                <label className="market-label">全站公告（显示在所有用户页面顶部，留空关闭）</label>
                <textarea
                  className="market-textarea"
                  rows={2}
                  placeholder="例如：今晚 22:00 系统维护，请提前保存消息"
                  value={systemForm.announcement}
                  onChange={e => setSystemForm(f => ({ ...f, announcement: e.target.value }))}
                />
                <label className="admin-switch-row">
                  <input
                    type="checkbox"
                    checked={systemForm.registrationOpen}
                    onChange={e => setSystemForm(f => ({ ...f, registrationOpen: e.target.checked }))}
                  />
                  <span>允许新用户注册（关闭后只有管理员能开通账号）</span>
                </label>
                <div className="admin-system-actions">
                  <button className="modal-btn confirm" onClick={handleSaveSystem} disabled={systemSaving}>
                    {systemSaving ? '保存中...' : '保存设置'}
                  </button>
                  <button className="modal-btn cancel" onClick={handleDownloadBackup}>下载数据备份</button>
                </div>
                <div className="admin-danger-zone">
                  <div className="admin-danger-title">危险操作（不可恢复）</div>
                  <div className="admin-danger-actions">
                    <button className="admin-action-btn danger" onClick={handleResetMarket}>
                      <Trash2 size={16} /> 清空市场数据
                    </button>
                    <label className="admin-action-btn danger" style={{cursor:'pointer'}}>
                      <Download size={16} /> 导入备份恢复
                      <input
                        type="file"
                        accept=".json,application/json"
                        style={{display:'none'}}
                        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleRestoreBackup(f); }}
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* ── 消息审查（仅超级管理员） ── */}
            {isSuperAdminUser && (
              <div className="admin-section">
                <div className="admin-section-title">
                  <Eye size={16} /> 消息审查
                  <span className="admin-section-sub">可查看任意用户的私聊</span>
                  <button className="admin-link-btn" onClick={loadAuditConversations}>
                    {auditLoading ? '加载中…' : '加载会话'}
                  </button>
                </div>
                {auditConvs.length === 0 && <div className="admin-empty">点击右上角"加载会话"查看所有私聊</div>}
                {auditConvs.map(c => (
                  <div key={`${c.userA}-${c.userB}`} className="admin-group-row admin-audit-row" onClick={() => openAuditMessages(c)}>
                    <div className="admin-group-main">
                      <div className="admin-group-name">{c.nameA} ↔ {c.nameB}</div>
                      <div className="admin-group-meta">
                        {c.count} 条消息 · {new Date(c.lastAt).toLocaleString('zh-CN')} · {c.lastText}
                      </div>
                    </div>
                    <Eye size={16} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Market Panel ── */}
        {activeView === 'market' && (
          <div className="admin-panel">
            <div className="panel-header" style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <ShoppingBag size={20} /> 市场
              <span className="market-credits" style={{marginLeft:'auto',fontSize:'13px',color:'#faad14',display:'flex',alignItems:'center',gap:'4px'}}>
                <Coins size={14} /> {credits}
              </span>
            </div>

            {/* Market Tabs */}
            <div className="market-tabs">
              <button className={`market-tab ${marketTab === 'browse' ? 'active' : ''}`} onClick={() => { setMarketTab('browse'); loadMarketItems(); }}>
                <ShoppingBag size={14} /> 市场
              </button>
              <button className={`market-tab ${marketTab === 'my' ? 'active' : ''}`} onClick={() => { setMarketTab('my'); loadMyItems(); }}>
                <Package size={14} /> 我的商品
              </button>
              <button className={`market-tab ${marketTab === 'cart' ? 'active' : ''}`} onClick={() => { setMarketTab('cart'); loadCartItems(); }}>
                <ShoppingCart size={14} /> 购物车{cartItems.length > 0 && <span className="cart-badge">{cartItems.length}</span>}
              </button>
              <button className={`market-tab ${marketTab === 'orders' ? 'active' : ''}`} onClick={() => { setMarketTab('orders'); loadMyOrders(); }}>
                <Package size={14} /> 我的订单
              </button>
            </div>

            {/* Browse Tab */}
            {marketTab === 'browse' && (
              <div className="market-content">
                <div className="market-search">
                  <Search size={16} />
                  <input
                    placeholder="搜索商品..."
                    value={marketSearch}
                    onChange={e => { setMarketSearch(e.target.value); }}
                    onKeyDown={e => { if (e.key === 'Enter') loadMarketItems(); }}
                  />
                  <button onClick={() => loadMarketItems()}>搜索</button>
                </div>
                <div className="category-filter">
                  <button
                    className={`category-btn ${selectedCategory === null ? 'active' : ''}`}
                    onClick={() => { setSelectedCategory(null); loadMarketItems(null); }}
                  >
                    全部
                  </button>
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      className={`category-btn ${selectedCategory === cat.id ? 'active' : ''}`}
                      onClick={() => { setSelectedCategory(cat.id); loadMarketItems(cat.id); }}
                      style={selectedCategory === cat.id ? { background: cat.color } : {}}
                    >
                      {cat.icon} {cat.name}
                    </button>
                  ))}
                </div>
                <button className="market-publish-btn" onClick={() => setShowPublishModal(true)}>
                  <Plus size={16} /> 上架商品
                </button>
                <div className="market-items-grid">
                  {marketItems.length === 0 && (
                    <div className="empty-state" style={{padding:'40px 0'}}>
                      <div className="empty-icon"><ShoppingBag size={32} /></div>
                      <div className="empty-title">暂无商品</div>
                      <div className="empty-sub">点击上方按钮上架商品吧</div>
                    </div>
                  )}
                  {marketItems.map(item => (
                    <div key={item.id} className={`market-item-card ${item.bought ? 'bought' : ''}`}>
                      {item.categoryName && (
                        <div className="market-item-category">{item.categoryName}</div>
                      )}
                      <div className="market-item-title">{item.title}</div>
                      <div className="market-item-desc">{item.description}{item.description?.length >= 100 ? '...' : ''}</div>
                      <div className="market-item-meta">
                        <span className="market-item-seller">{item.sellerName}</span>
                        <span className="market-item-rating">
                          <Star size={12} style={{color:'#faad14',fill:'#faad14'}} /> {item.avgRating || 0} ({item.ratingCount || 0})
                        </span>
                        <span className="market-item-price"><Coins size={12} /> {item.price}</span>
                      </div>
                      <div className="market-item-stock">
                        {item.stock === 0
                          ? <span className="stock-badge stock-out">已售罄</span>
                          : item.stock != null
                            ? <span className="stock-badge">库存 {item.stock} 件 · 已售 {item.soldCount || 0}</span>
                            : <span className="stock-badge stock-unlimited">无限量</span>}
                      </div>
                      {item.sellerId !== currentUser?.id && item.bought && (
                        <div className="market-item-status bought-tag">
                          <Heart size={12} /> 已购买
                          <button
                            className="rate-btn"
                            onClick={() => { setRatingItem(item); loadItemRatings(item.id); setShowRatingsListModal(true); }}
                            style={{marginLeft:'8px'}}
                          >
                            <Star size={12} /> 评价
                          </button>
                        </div>
                      )}
                      {item.sellerId !== currentUser?.id && !item.bought && (
                        <div className="market-item-actions">
                          <button
                            className="market-buy-btn direct-buy-btn"
                            onClick={() => handleDirectBuy(item)}
                            disabled={item.stock === 0}
                          >
                            {item.stock === 0 ? '已售罄' : '直接购买'}
                          </button>
                          <button
                            className="market-buy-btn cart-btn"
                            onClick={() => handleAddToCart(item)}
                            disabled={item.stock === 0}
                          >
                            <ShoppingCart size={14} /> 加入购物车
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* My Items Tab */}
            {marketTab === 'my' && (
              <div className="market-content">
                <button className="market-publish-btn" onClick={() => setShowPublishModal(true)}>
                  <Plus size={16} /> 上架新商品
                </button>
                {myItems.length === 0 && (
                  <div className="empty-state" style={{padding:'40px 0'}}>
                    <div className="empty-icon"><Package size={32} /></div>
                    <div className="empty-title">暂无上架商品</div>
                    <div className="empty-sub">点击上方按钮上架商品吧</div>
                  </div>
                )}
                {myItems.map(item => (
                  <div key={item.id} className="market-order-card">
                    <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'4px'}}>
                      <span className="market-order-title">{item.title}</span>
                      <span className={`order-type-tag ${item.status === 'active' ? 'tag-buy' : 'tag-sell'}`}>
                        {item.status === 'active' ? '在售' : '已下架'}
                      </span>
                    </div>
                    <div className="market-order-desc">{item.description}</div>
                    <div className="market-item-meta">
                      <span className="market-item-seller">
                        销量：{item.sales || 0} · {new Date(item.createdAt).toLocaleString('zh-CN')}
                      </span>
                      <span className="market-item-price"><Coins size={12} /> {item.price}</span>
                    </div>
                    <div className="market-item-stock">
                      {item.stock === 0
                        ? <span className="stock-badge stock-out">已售罄</span>
                        : item.stock != null
                          ? <span className="stock-badge">剩余库存 {item.stock} 件</span>
                          : <span className="stock-badge stock-unlimited">无限量</span>}
                    </div>
                    {item.status === 'active' && (
                      <div className="market-item-actions" style={{marginTop:'8px'}}>
                        <button
                          className="market-buy-btn cart-btn"
                          onClick={() => handleRemoveItem(item.id)}
                          style={{background:'#ff4d4f'}}
                        >
                          下架
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Cart Tab */}
            {marketTab === 'cart' && (
              <div className="market-content">
                <div className="cart-summary">
                  <span>共 {cartItems.length} 件商品</span>
                  <span className="cart-total">合计：<Coins size={14} style={{color:'#faad14',verticalAlign:'middle'}} /> {cartItems.reduce((s, i) => s + i.price, 0)} 积分</span>
                </div>
                {cartItems.length > 0 && (
                  <button className="market-publish-btn checkout-btn" onClick={handleCheckout}>
                    <ShoppingCart size={16} /> 结算购物车
                  </button>
                )}
                {cartItems.length === 0 && (
                  <div className="empty-state" style={{padding:'40px 0'}}>
                    <div className="empty-icon"><ShoppingCart size={32} /></div>
                    <div className="empty-title">购物车是空的</div>
                    <div className="empty-sub">去市场逛逛，把喜欢的商品加入购物车吧</div>
                  </div>
                )}
                {cartItems.map(item => (
                  <div key={item.id} className="market-order-card cart-item-card">
                    <div className="cart-item-info">
                      <div>
                        <div className="market-order-title">{item.title}</div>
                        <div className="market-order-desc">{item.description.substring(0, 80)}</div>
                        <div className="market-item-meta" style={{marginTop:'4px'}}>
                          <span className="market-item-seller">{item.sellerName}</span>
                          <span className="market-item-price"><Coins size={12} /> {item.price}</span>
                        </div>
                      </div>
                    </div>
                    <button className="cart-remove-btn" onClick={() => handleRemoveFromCart(item.id)} title="移除">
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Orders Tab */}
            {marketTab === 'orders' && (
              <div className="market-content">
                {myOrders.length === 0 && (
                  <div className="empty-state" style={{padding:'40px 0'}}>
                    <div className="empty-icon"><Package size={32} /></div>
                    <div className="empty-title">暂无订单</div>
                    <div className="empty-sub">去市场逛逛吧</div>
                  </div>
                )}
                {myOrders.map(order => (
                  <div key={order.id} className={`market-order-card ${order.type === 'sell' ? 'order-sell' : 'order-buy'}`}>
                    <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'4px'}}>
                      <span className={`order-type-tag ${order.type === 'sell' ? 'tag-sell' : 'tag-buy'}`}>
                        {order.type === 'sell' ? '售出' : '购买'}
                      </span>
                      <span className="market-order-title" style={{margin:0}}>{order.title}</span>
                    </div>
                    <div className="market-order-desc">{order.description}</div>
                    <div className="market-item-meta">
                      <span className="market-item-seller">
                        {order.type === 'sell'
                          ? `买家：${order.buyerId}`
                          : `卖家：${order.sellerId}`}
                        {' · '}{new Date(order.createdAt).toLocaleString('zh-CN')}
                      </span>
                      <span className="market-item-price"><Coins size={12} /> {order.price}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Publish Modal */}
            {showPublishModal && (
              <div className="modal-overlay" onClick={() => setShowPublishModal(false)}>
                <div className="modal-content market-modal modal-wide" onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <span>上架商品</span>
                    <button className="modal-close" onClick={() => setShowPublishModal(false)}><X size={18} /></button>
                  </div>
                  <div className="modal-body">
                    <div className="market-form-grid">
                      <div className="market-form-col">
                        <label className="market-label">标题</label>
                        <input
                          className="market-input"
                          placeholder="商品标题"
                          value={publishForm.title}
                          onChange={e => setPublishForm(f => ({...f, title: e.target.value}))}
                        />
                      </div>
                      <div className="market-form-col">
                        <label className="market-label">价格（积分）</label>
                        <input
                          className="market-input"
                          type="number"
                          min="1"
                          placeholder="输入价格"
                          value={publishForm.price}
                          onChange={e => setPublishForm(f => ({...f, price: e.target.value}))}
                        />
                      </div>
                      <div className="market-form-col">
                        <label className="market-label">
                          数量（库存）<span style={{color:'#8c8c8c',fontWeight:400,fontSize:'12px'}}> · 不填 = 无限量</span>
                        </label>
                        <input
                          className="market-input"
                          type="number"
                          min="1"
                          placeholder="留空 = 无限量"
                          value={publishForm.stock}
                          onChange={e => setPublishForm(f => ({...f, stock: e.target.value}))}
                        />
                        <div style={{fontSize:'11px',color:'#8c8c8c',marginTop:'3px'}}>填数字＝最多卖这么多份；留空＝不限次数</div>
                      </div>
                      <div className="market-form-col">
                        <label className="market-label">分类</label>
                        <select
                          className="market-input"
                          value={publishForm.categoryId || ''}
                          onChange={e => setPublishForm(f => ({...f, categoryId: e.target.value ? Number(e.target.value) : null}))}
                        >
                          <option value="">请选择分类</option>
                          {categories.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <label className="market-label">描述</label>
                    <textarea
                      className="market-textarea"
                      placeholder="商品详细描述"
                      rows={3}
                      value={publishForm.description}
                      onChange={e => setPublishForm(f => ({...f, description: e.target.value}))}
                    />
                    <div className="publish-tax-hint">
                      <Coins size={14} style={{color:'#faad14',flexShrink:0}} />
                      <span>上架须知：买家付款后，您将获得售价的 <strong>80%</strong>（平台收取 20% 税费）。例如标价 100 积分，您实际获得 80 积分。数量留空则不限购买次数。</span>
                    </div>
                    <label className="market-label" style={{marginTop:'8px',fontSize:'12px',color:'#8c8c8c'}}>购买后提示（可选，买家付款后弹窗显示）</label>
                    <textarea
                      className="market-textarea"
                      placeholder="例如：感谢购买！使用方法：..."
                      rows={2}
                      value={publishForm.postBuyMessage}
                      onChange={e => setPublishForm(f => ({...f, postBuyMessage: e.target.value}))}
                    />
                  </div>
                  <div className="modal-footer">
                    <button className="modal-btn cancel" onClick={() => setShowPublishModal(false)}>取消</button>
                    <button className="modal-btn confirm" onClick={handlePublish}>上架</button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

      </div>

      {/* Chat area */}
      <div className="chat-area">
        {activeGroupId && currentUser ? (
          <GroupChatView
            key={activeGroupId}
            groupId={activeGroupId}
            currentUser={currentUser}
            groupMessages={groupMessages[activeGroupId] || []}
            onSend={handleSendGroupMessage}
            onAddMember={() => {
              setSelectedFriends(new Set());
              setCurrentGroup(groups.find(g => g.id === activeGroupId) || null);
              setShowAddMemberModal(true);
            }}
            onLeaveGroup={handleLeaveGroup}
            onRedpacketClick={loadRedpacketInfo}
            groupName={groups.find(g => g.id === activeGroupId)?.name}
            onSendRedpacket={(groupId, groupName) => {
              setRedpacketTarget({ id: groupId, name: groupName, isGroup: true });
              setShowRedpacketModal(true);
            }}
            onDeleteMessage={handleDeleteGroupMessage}
            onRecallMessage={handleRecallGroupMessage}
            onUpload={uploadFile}
            onSendMedia={handleSendMediaGroup}
            onShowMembers={() => {
              // 先加载群详情以获取成员列表
              loadGroupDetails(activeGroupId);
              setShowGroupMembersModal(true);
            }}
            onShowSettings={() => {
              // 先加载群详情
              loadGroupDetails(activeGroupId);
              // 设置表单初始值
              const group = groups.find(g => g.id === activeGroupId);
              if (group) {
                setGroupSettingsForm({ name: group.name });
              }
              setShowGroupSettingsModal(true);
            }}
          />
        ) : activeConversation && currentUser ? (
          <ChatView
            key={activeConversation.id}
            conversation={activeConversation}
            currentUser={currentUser}
            onSend={handleSendMsg}
            onTransfer={handleChatTransfer}
            onRedpacket={handleChatRedpacket}
            onRedpacketClick={loadRedpacketInfo}
            onDeleteChat={handleDeleteChat}
            onRead={handleReadMessages}
            onDeleteMessage={handleDeleteMessage}
            onRecallMessage={handleRecallMessage}
            onUpload={uploadFile}
            onSendMedia={handleSendMedia}
            settings={convSettings[activeConversation.peerId] || { pinned: false, muted: false }}
            onTogglePin={toggleConvPin}
            onToggleMute={toggleConvMute}
            isBlockedByPeer={blockedBy.has(activeConversation.peerId)}
            isPeerBlocked={blockedIds.has(activeConversation.peerId)}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-icon"><MessageCircle size={32} /></div>
            <div className="empty-title">Tang people chat</div>
            <div className="empty-sub">选择一个聊天开始吧</div>
          </div>
        )}
      </div>

      {/* ── All Modals (Moved to outside of conditional views) ── */}

      {/* Create Group Modal */}
      {showCreateGroupModal && (
        <div className="modal-overlay" onClick={() => setShowCreateGroupModal(false)}>
          <div className="modal-content create-group-modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span><Users size={18} /> 创建群聊</span>
              <button className="modal-close" onClick={() => setShowCreateGroupModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="create-group-form">
                <div className="profile-form-item">
                  <label>群聊名称</label>
                  <input
                    type="text"
                    placeholder="请输入群聊名称，例如：开心团队"
                    value={createGroupForm.name}
                    onChange={e => setCreateGroupForm({ ...createGroupForm, name: e.target.value })}
                  />
                </div>
                <div className="profile-form-item">
                  <div className="friend-select-header">
                    <label>选择成员</label>
                    {selectedFriends.size > 0 && (
                      <div className="selected-count">
                        已选择 {selectedFriends.size} 人
                      </div>
                    )}
                  </div>
                  <div className="friend-select-list">
                    {friends.length === 0 ? (
                      <div className="empty-friends">
                        <div className="empty-friends-icon">👥</div>
                        <div className="empty-friends-text">暂无好友，先去添加好友吧</div>
                      </div>
                    ) : (
                      friends.map(f => (
                        <div key={f.id} className={`friend-select-item ${selectedFriends.has(f.id) ? 'selected' : ''}`} onClick={() => {
                          setSelectedFriends(prev => {
                            const newSet = new Set(prev);
                            if (newSet.has(f.id)) {
                              newSet.delete(f.id);
                            } else {
                              newSet.add(f.id);
                            }
                            return newSet;
                          });
                        }}>
                          <div className="friend-select-avatar" style={{ background: pickColor(f.id) }}>
                            {(f.nickname || f.username)[0].toUpperCase()}
                          </div>
                          <div className="friend-select-name">
                            <div>{f.nickname || f.username}</div>
                            {f.nickname && f.nickname !== f.username && (
                              <span>@{f.username}</span>
                            )}
                          </div>
                          <div className="friend-select-check">
                            {selectedFriends.has(f.id) && <UserCheck size={14} />}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-btn cancel" onClick={() => setShowCreateGroupModal(false)}>取消</button>
              <button 
                className="modal-btn confirm" 
                onClick={handleCreateGroup} 
                disabled={!createGroupForm.name.trim() || selectedFriends.size === 0}
              >
                创建群聊
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMemberModal && currentGroup && (
        <div className="modal-overlay" onClick={() => setShowAddMemberModal(false)}>
          <div className="modal-content create-group-modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span><UserPlus size={18} /> 添加成员</span>
              <button className="modal-close" onClick={() => setShowAddMemberModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="create-group-form">
                <div className="profile-form-item">
                  <div className="friend-select-header">
                    <label>选择成员</label>
                    {selectedFriends.size > 0 && (
                      <div className="selected-count">
                        已选择 {selectedFriends.size} 人
                      </div>
                    )}
                  </div>
                  <div className="friend-select-list">
                    {friends.length === 0 ? (
                      <div className="empty-friends">
                        <div className="empty-friends-icon">👥</div>
                        <div className="empty-friends-text">暂无好友可添加</div>
                      </div>
                    ) : (
                      friends.map(f => {
                        const isInGroup = currentGroup.members?.some(m => m.id === f.id) || false;
                        return (
                          <div key={f.id} className={`friend-select-item ${selectedFriends.has(f.id) ? 'selected' : ''} ${isInGroup ? 'disabled' : ''}`} onClick={() => {
                            if (!isInGroup) {
                              setSelectedFriends(prev => {
                                const newSet = new Set(prev);
                                if (newSet.has(f.id)) {
                                  newSet.delete(f.id);
                                } else {
                                  newSet.add(f.id);
                                }
                                return newSet;
                              });
                            }
                          }}>
                            <div className="friend-select-avatar" style={{ background: pickColor(f.id) }}>
                              {(f.nickname || f.username)[0].toUpperCase()}
                            </div>
                            <div className="friend-select-name">
                              <div>{f.nickname || f.username}</div>
                              {isInGroup ? (
                                <span>已在群里</span>
                              ) : (
                                f.nickname && f.nickname !== f.username && (
                                  <span>@{f.username}</span>
                                )
                              )}
                            </div>
                            <div className="friend-select-check">
                              {selectedFriends.has(f.id) && <UserCheck size={14} />}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-btn cancel" onClick={() => setShowAddMemberModal(false)}>取消</button>
              <button 
                className="modal-btn confirm" 
                onClick={() => handleAddGroupMember(currentGroup.id)} 
                disabled={selectedFriends.size === 0}
              >
                添加成员
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group Members Modal */}
      {showGroupMembersModal && currentGroup && (
        <div className="modal-overlay" onClick={() => setShowGroupMembersModal(false)}>
          <div className="modal-content create-group-modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span><Users size={18} /> 群成员 ({currentGroup.members?.length || 0})</span>
              <button className="modal-close" onClick={() => setShowGroupMembersModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="friend-select-list">
                {currentGroup.members?.map(member => (
                  <div key={member.id} className="friend-select-item" style={{ cursor: 'default' }}>
                    <div className="friend-select-avatar" style={{ background: pickColor(member.id) }}>
                      {(member.nickname || member.username)[0].toUpperCase()}
                    </div>
                    <div className="friend-select-name">
                      <div>{member.nickname || member.username}</div>
                      {member.role === 'owner' && <span style={{ color: '#faad14' }}>群主</span>}
                      {member.role === 'member' && member.nickname && member.nickname !== member.username && (
                        <span>@{member.username}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-btn confirm" onClick={() => setShowGroupMembersModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* Group Settings Modal */}
      {showGroupSettingsModal && currentGroup && (
        <div className="modal-overlay" onClick={() => setShowGroupSettingsModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span><Settings size={18} /> 群设置</span>
              <button className="modal-close" onClick={() => setShowGroupSettingsModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="create-group-form">
                <div className="profile-form-item">
                  <label>群聊名称</label>
                  <input
                    type="text"
                    value={groupSettingsForm.name}
                    onChange={e => setGroupSettingsForm({ ...groupSettingsForm, name: e.target.value })}
                  />
                </div>
                <div className="profile-form-item">
                  <label>群聊信息</label>
                  <div style={{ marginTop: '8px', fontSize: '13px', color: '#666' }}>
                    <p>创建者: {currentGroup.creatorId}</p>
                    <p>创建时间: {new Date(currentGroup.createdAt).toLocaleString('zh-CN')}</p>
                    <p>成员数: {currentGroup.members?.length || 0}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-btn cancel" onClick={() => setShowGroupSettingsModal(false)}>取消</button>
              <button 
                className="modal-btn confirm" 
                onClick={() => handleUpdateGroupName(currentGroup.id, groupSettingsForm.name)}
                disabled={!groupSettingsForm.name.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout Confirm Modal */}
      {showCheckoutModal && (
        <div className="modal-overlay" onClick={() => setShowCheckoutModal(false)}>
          <div className="modal-content market-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>确认结算</span>
              <button className="modal-close" onClick={() => setShowCheckoutModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p>即将购买 <strong>{cartItems.length}</strong> 件商品：</p>
              <div className="checkout-item-list">
                {cartItems.map(item => (
                  <div key={item.id} className="checkout-item-row">
                    <span className="checkout-item-name">{item.title}</span>
                    <span className="checkout-item-price"><Coins size={12} style={{color:'#faad14',verticalAlign:'middle'}} /> {item.price}</span>
                  </div>
                ))}
              </div>
              <div className="checkout-total-row">
                <span>合计</span>
                <span className="checkout-total-price"><Coins size={14} style={{color:'#faad14',verticalAlign:'middle'}} /> {cartItems.reduce((s, i) => s + i.price, 0)} 积分</span>
              </div>
              <p style={{fontSize:'12px',color:'#ff4d4f',marginTop:'8px'}}>提示：卖家将获得售价的 80%，平台收取 20% 税费</p>
            </div>
            <div className="modal-footer">
              <button className="modal-btn cancel" onClick={() => setShowCheckoutModal(false)}>取消</button>
              <button className="modal-btn confirm" onClick={confirmCheckout} disabled={checkoutLoading}>{checkoutLoading ? '结算中...' : '确认结算'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Direct Buy Confirm Modal */}
      {showBuyModal && buyItem && (
        <div className="modal-overlay" onClick={() => { setShowBuyModal(false); setBuyItem(null); }}>
          <div className="modal-content market-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>确认购买</span>
              <button className="modal-close" onClick={() => { setShowBuyModal(false); setBuyItem(null); }}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p>即将购买以下商品：</p>
              <div className="checkout-item-list">
                <div className="checkout-item-row">
                  <span className="checkout-item-name">{buyItem.title}</span>
                  <span className="checkout-item-price"><Coins size={12} style={{color:'#faad14',verticalAlign:'middle'}} /> {buyItem.price}</span>
                </div>
              </div>
              <div className="checkout-total-row">
                <span>需支付</span>
                <span className="checkout-total-price"><Coins size={14} style={{color:'#faad14',verticalAlign:'middle'}} /> {buyItem.price} 积分</span>
              </div>
              <p style={{fontSize:'12px',color:'#ff4d4f',marginTop:'8px'}}>提示：卖家将获得售价的 80%，平台收取 20% 税费</p>
            </div>
            <div className="modal-footer">
              <button className="modal-btn cancel" onClick={() => { setShowBuyModal(false); setBuyItem(null); }}>取消</button>
              <button className="modal-btn confirm" onClick={confirmDirectBuy}>确认购买</button>
            </div>
          </div>
        </div>
      )}
      {showPostBuyModal && (
        <div className="modal-overlay" onClick={() => setShowPostBuyModal(false)}>
          <div className="modal-content post-buy-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{display:'flex',alignItems:'center',gap:'6px'}}><Coins size={18} style={{color:'#52c41a'}}/> 购买成功</span>
              <button className="modal-close" onClick={() => setShowPostBuyModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {allPostBuyMessages.length > 1 && (
                <div className="post-buy-msg-counter">{postBuyMsgIndex + 1} / {allPostBuyMessages.length}</div>
              )}
              {allPostBuyMessages.length > 0 && (
                <div className="post-buy-item-title">{allPostBuyMessages[postBuyMsgIndex]?.title}</div>
              )}
              <div className="post-buy-msg-content">{postBuyModalMsg}</div>
            </div>
            <div className="modal-footer">
              {postBuyMsgIndex < allPostBuyMessages.length - 1 ? (
                <button className="modal-btn confirm" onClick={handlePostBuyNext}>下一个</button>
              ) : (
                <button className="modal-btn confirm" onClick={() => { setShowPostBuyModal(false); setAllPostBuyMessages([]); }}>我知道了</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Profile Edit Modal */}
      {showProfileModal && (
        <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span><Edit3 size={18} /> 编辑资料</span>
              <button className="modal-close" onClick={() => setShowProfileModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="profile-form-item">
                <label>昵称</label>
                <input
                  type="text"
                  placeholder="输入昵称"
                  value={profileForm.nickname}
                  onChange={e => setProfileForm({ ...profileForm, nickname: e.target.value })}
                />
              </div>
              <div className="profile-form-item">
                <label>头像（emoji/文字，或上传图片）</label>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input
                    type="text"
                    placeholder="输入 emoji 或文字"
                    value={profileForm.avatar}
                    onChange={e => setProfileForm({ ...profileForm, avatar: e.target.value })}
                    style={{flex:1}}
                  />
                  <label className="modal-btn cancel" style={{cursor:'pointer', margin:0, display:'inline-flex', alignItems:'center', minHeight:40, padding:'0 14px', flexShrink:0}}>
                    上传图片
                    <input
                      type="file"
                      accept="image/*"
                      style={{display:'none'}}
                      onChange={async e => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        const info = await uploadFile(f);
                        if (info) setProfileForm(prev => ({ ...prev, avatar: info.url }));
                      }}
                    />
                  </label>
                  {profileForm.avatar && (
                    <span style={{width:40,height:40,display:'inline-flex',alignItems:'center',justifyContent:'center',overflow:'hidden',borderRadius:10,flexShrink:0,fontSize:22}}>
                      <AvatarContent avatar={profileForm.avatar} fallback="?" />
                    </span>
                  )}
                </div>
              </div>
              <div className="profile-form-item">
                <label>个人简介</label>
                <textarea
                  placeholder="输入个人简介"
                  value={profileForm.bio}
                  onChange={e => setProfileForm({ ...profileForm, bio: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-btn cancel" onClick={() => setShowProfileModal(false)}>取消</button>
              <button className="modal-btn confirm" onClick={handleUpdateProfile}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 消息审查 Modal（仅超级管理员） */}
      {auditTarget && (
        <div className="modal-overlay" onClick={() => setAuditTarget(null)}>
          <div className="modal-content modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>消息审查：{auditTarget.nameA} ↔ {auditTarget.nameB}</span>
              <button className="modal-close" onClick={() => setAuditTarget(null)}><X size={18} /></button>
            </div>
            <div className="modal-body admin-audit-body">
              {auditMessages.length === 0 && <div className="admin-empty">暂无消息</div>}
              {auditMessages.map(m => (
                <div key={m.id} className="admin-audit-msg">
                  <span className="admin-audit-sender">{m.senderName}</span>
                  <span className="admin-audit-text">{m.content}</span>
                  <span className="admin-audit-time">{new Date(m.timestamp).toLocaleString('zh-CN')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 修改密码 Modal */}
      {showPwdModal && (
        <div className="modal-overlay" onClick={() => setShowPwdModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>修改密码</span>
              <button className="modal-close" onClick={() => setShowPwdModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="profile-form-item">
                <label>原密码</label>
                <input
                  type="password"
                  placeholder="请输入当前密码"
                  value={pwdForm.oldPassword}
                  onChange={e => setPwdForm({ ...pwdForm, oldPassword: e.target.value })}
                />
              </div>
              <div className="profile-form-item">
                <label>新密码</label>
                <input
                  type="password"
                  placeholder="至少6个字符"
                  value={pwdForm.newPassword}
                  onChange={e => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
                />
              </div>
              <div className="profile-form-item">
                <label>确认新密码</label>
                <input
                  type="password"
                  placeholder="再输入一次新密码"
                  value={pwdForm.confirmPassword}
                  onChange={e => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
                />
              </div>
              {pwdError && <div style={{color:'#e5484d',fontSize:13,marginTop:4}}>{pwdError}</div>}
            </div>
            <div className="modal-footer">
              <button className="modal-btn cancel" onClick={() => setShowPwdModal(false)}>取消</button>
              <button className="modal-btn confirm" onClick={handleChangePassword} disabled={pwdLoading}>
                {pwdLoading ? '提交中...' : '确认修改'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Redpacket Modal */}
      {showRedpacketModal && redpacketTarget && (
        <div className="modal-overlay" onClick={() => setShowRedpacketModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span><Gift size={18} /> 发红包</span>
              <button className="modal-close" onClick={() => setShowRedpacketModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="transfer-balance">
                当前积分: <Coins size={14} style={{color:'#faad14'}} /> {credits}
              </div>
              <RedpacketForm
                targetName={redpacketTarget.name}
                onSend={handleSendRedpacket}
                onCancel={() => setShowRedpacketModal(false)}
                disabled={false}
              />
            </div>
          </div>
        </div>
      )}

      {/* Redpacket Claim Modal */}
      {showRedpacketClaimModal && claimingRedpacket && (
        <div className="modal-overlay" onClick={() => { setShowRedpacketClaimModal(false); setClaimingRedpacket(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span><Gift size={18} /> 红包</span>
              <button className="modal-close" onClick={() => { setShowRedpacketClaimModal(false); setClaimingRedpacket(null); }}><X size={18} /></button>
            </div>
            <div className="modal-body" style={{textAlign:'center'}}>
              <div style={{fontSize:'48px',marginBottom:'12px'}}>🧧</div>
              <div style={{fontSize:'16px',fontWeight:'bold',marginBottom:'8px'}}>
                {claimingRedpacket.senderNickname} 的红包
              </div>
              {claimingRedpacket.note && (
                <div style={{fontSize:'14px',color:'#666',marginBottom:'12px'}}>
                  "{claimingRedpacket.note}"
                </div>
              )}
              {claimingRedpacket.status === 'active' ? (
                <>
                  <div style={{fontSize:'24px',color:'#faad14',marginBottom:'16px'}}>
                    每个 {claimingRedpacket.perAmount} 积分
                  </div>
                  <button
                    className="modal-btn confirm"
                    style={{width:'100%'}}
                    onClick={() => handleClaimRedpacket(claimingRedpacket.id)}
                  >
                    领取红包
                  </button>
                </>
              ) : (
                <div style={{fontSize:'14px',color:'#999',marginTop:'12px'}}>
                  红包已被领取
                </div>
              )}
              <div style={{fontSize:'12px',color:'#aaa',marginTop:'16px'}}>
                剩余 {claimingRedpacket.remaining}/{claimingRedpacket.count}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rating Modal */}
      {showTransferModal && (
        <div className="modal-overlay" onClick={() => setShowTransferModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span><ArrowRightLeft size={18} /> 积分转账</span>
              <button className="modal-close" onClick={() => setShowTransferModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="transfer-balance">
                当前积分: <Coins size={14} style={{color:'#faad14'}} /> {credits}
              </div>
              <TransferForm
                onTransfer={handleTransfer}
                adminToastFn={adminToastFn}
              />
              {transfers.length > 0 && (
                <div className="transfer-history">
                  <div className="transfer-history-title">转账记录</div>
                  {transfers.slice(0, 10).map(t => (
                    <div key={t.id} className={`transfer-item ${t.type}`}>
                      <div className="transfer-info">
                        <span className="transfer-direction">{t.type === 'out' ? '转出' : '转入'}</span>
                        <span className="transfer-user">{t.type === 'out' ? t.receiverName : t.senderName}</span>
                      </div>
                      <div className="transfer-amount">
                        {t.type === 'out' ? '-' : '+'}{t.amount}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rating Modal */}
      {showRatingModal && ratingItem && (
        <div className="modal-overlay" onClick={() => setShowRatingModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span><Star size={18} style={{color:'#faad14'}} /> 评价商品</span>
              <button className="modal-close" onClick={() => setShowRatingModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="rating-item-info">
                <div className="rating-item-title">{ratingItem.title}</div>
                <div className="rating-item-price"><Coins size={12} style={{color:'#faad14',verticalAlign:'middle'}} /> {ratingItem.price}</div>
              </div>
              <RatingForm
                onSubmit={(rating, comment) => {
                  handleSubmitRating(rating, comment);
                  setShowRatingModal(false);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Ratings List Modal */}
      {showRatingsListModal && ratingItem && (
        <div className="modal-overlay" onClick={() => setShowRatingsListModal(false)}>
          <div className="modal-content modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span><Star size={18} style={{color:'#faad14'}} /> 商品评价</span>
              <button className="modal-close" onClick={() => setShowRatingsListModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="rating-item-title">{ratingItem.title}</div>
              {itemRatings.length === 0 ? (
                <div className="empty-state" style={{padding:'20px'}}>
                  <div className="empty-sub">暂无评价</div>
                </div>
              ) : (
                <div className="ratings-list">
                  {itemRatings.map(r => (
                    <div key={r.id} className="rating-card">
                      <div className="rating-header">
                        <span className="rating-user">{r.nickname || r.username}</span>
                        <div className="rating-stars">
                          {[1,2,3,4,5].map(s => (
                            <Star key={s} size={12} style={{color:'#faad14', fill: s <= r.rating ? '#faad14' : 'transparent'}} />
                          ))}
                        </div>
                      </div>
                      {r.comment && <div className="rating-comment">{r.comment}</div>}
                      <div className="rating-date">{new Date(r.createdAt).toLocaleString('zh-CN')}</div>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="modal-btn confirm"
                onClick={() => { setShowRatingsListModal(false); setShowRatingModal(true); }}
                style={{marginTop:'12px'}}
              >
                <Star size={14} /> 我要评价
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

/* ═══════════════════════════════════════
   Helpers
   ═══════════════════════════════════════ */
function TransferForm({ onTransfer, adminToastFn }: {
  onTransfer: (targetId: number, amount: number, note: string) => void;
  adminToastFn: (msg: string) => void;
}) {
  const [targetId, setTargetId] = React.useState<number | null>(null);
  const [targetName, setTargetName] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [note, setNote] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    try {
      const transferData = sessionStorage.getItem('transferTarget');
      if (transferData) {
        const data = JSON.parse(transferData);
        setTargetId(data.targetId);
        setTargetName(data.targetName);
      } else {
        // 从设置页面直接打开时，显示提示
        setTargetName('请从聊天界面选择');
      }
    } catch {}
  }, []);

  const handleSubmit = async () => {
    if (!targetId) { adminToastFn('请选择转账对象'); return; }
    if (!amount || Number(amount) <= 0) { adminToastFn('请输入有效金额'); return; }
    setLoading(true);
    try {
      await onTransfer(targetId, Number(amount), note.trim());
    } catch (error) {
      adminToastFn('网络错误，请稍后重试');
    } finally {
      setLoading(false);
      setAmount('');
      setNote('');
      sessionStorage.removeItem('transferTarget');
    }
  };

  return (
    <div className="transfer-form">
      <div className="market-input" style={{background:'#f5f5f5',cursor:'not-allowed'}}>
        收款方: {targetName || '请从聊天界面选择'}
      </div>
      <input
        className="market-input"
        type="number"
        placeholder="转账金额"
        value={amount}
        onChange={e => setAmount(e.target.value)}
      />
      <input
        className="market-input"
        placeholder="备注（可选）"
        value={note}
        onChange={e => setNote(e.target.value)}
      />
      <button className="modal-btn confirm" onClick={handleSubmit} disabled={loading}>
        {loading ? '转账中...' : '确认转账'}
      </button>
    </div>
  );
}

function RedpacketForm({ targetName, onSend, onCancel, disabled }: {
  targetName: string;
  onSend: (amount: number, count: number, note: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [amount, setAmount] = React.useState('');
  const [count, setCount] = React.useState('1');
  const [note, setNote] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async () => {
    const amountNum = Number(amount);
    const countNum = Number(count);
    if (!amountNum || amountNum <= 0) { alert('请输入有效金额'); return; }
    if (!countNum || countNum <= 0 || countNum > 100) { alert('红包数量必须在1-100之间'); return; }
    if (amountNum < countNum) { alert('金额必须大于等于红包数量'); return; }
    setLoading(true);
    try {
      await onSend(amountNum, countNum, note.trim());
    } catch (error) {
      alert('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="transfer-form">
      <div className="market-input" style={{background:'#f5f5f5',cursor:'not-allowed'}}>
        发送给: {targetName}
      </div>
      <input
        className="market-input"
        type="number"
        placeholder="总金额"
        value={amount}
        onChange={e => setAmount(e.target.value)}
      />
      <input
        className="market-input"
        type="number"
        placeholder="红包数量（1-100）"
        value={count}
        min="1"
        max="100"
        onChange={e => setCount(e.target.value)}
      />
      <input
        className="market-input"
        placeholder="祝福语（可选）"
        value={note}
        onChange={e => setNote(e.target.value)}
      />
      <div style={{fontSize:'12px',color:'#888',marginBottom:'8px'}}>
        每个红包金额: {amount && count ? (Math.floor(Number(amount) / Number(count))) : 0} 积分
      </div>
      <div style={{display:'flex',gap:'8px'}}>
        <button className="modal-btn cancel" onClick={onCancel} style={{flex:1}}>
          取消
        </button>
        <button className="modal-btn confirm" onClick={handleSubmit} disabled={loading || disabled} style={{flex:1}}>
          {loading ? '发送中...' : '塞钱进红包'}
        </button>
      </div>
    </div>
  );
}

function RatingForm({ onSubmit }: {
  onSubmit: (rating: number, comment: string) => void;
}) {
  const [rating, setRating] = React.useState(5);
  const [comment, setComment] = React.useState('');

  return (
    <div className="rating-form">
      <div className="rating-stars-input">
        {[1,2,3,4,5].map(s => (
          <button
            key={s}
            onClick={() => setRating(s)}
            className="star-btn"
          >
            <Star size={28} style={{ color: '#faad14', fill: s <= rating ? '#faad14' : 'transparent' }} />
          </button>
        ))}
      </div>
      <textarea
        className="market-textarea"
        placeholder="写下你的评价（可选）"
        rows={3}
        value={comment}
        onChange={e => setComment(e.target.value)}
      />
      <div className="modal-footer" style={{marginTop:'12px'}}>
        <button className="modal-btn confirm" onClick={() => onSubmit(rating, comment)}>提交评价</button>
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
