# Tang People Chat 部署指南

## 项目概述

基于 React + Node.js 的聊天应用，功能：注册登录、好友系统、即时消息、红包、积分转账、商品市场、购物车、群聊、管理后台。

## 部署环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0

## 部署步骤

```bash
cd app
npm install        # 安装依赖
npm run build      # 构建前端（生成 dist/）
npm start          # 启动服务器（托管前端 + API）
```

访问 http://localhost:3001

> 注意：`npm start` 运行的是 `server.prod.js`（薄启动器），它会复用 `server/index.js` 的全部 API 并托管 `dist/` 前端产物。API 代码只有一份，修改 `server/index.js` 即可同时作用于开发与生产。

## 生产环境部署

### 使用 PM2

```bash
npm install -g pm2
pm2 start server.prod.js --name tang-chat
pm2 status        # 查看状态
pm2 stop tang-chat
```

### 使用 Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
```

```bash
docker build -t tang-chat .
docker run -p 3001:3001 -d tang-chat
```

### 部署到 Vercel

`vercel.json` 已将 `/api/*` 路由到 `server.prod.js`（serverless 函数，`export default app`），其余请求由 `dist/` 静态托管。

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| PORT | 服务端口 | 3001 |
| DATA_DIR | 数据文件目录（JSON 文件存放处） | app/server |

## 目录结构

```
app/
├── dist/              # 前端构建产物（npm run build 生成）
├── server/
│   ├── index.js       # 唯一 API 代码源（开发 / 生产共用）
│   └── *.json         # 数据文件（users/friends/messages/items 等 14 个）
├── src/               # 前端源代码
├── server.prod.js     # 生产薄启动器：复用 server/index.js + 托管 dist/
├── index.html         # HTML入口
├── vite.config.ts     # Vite配置（dev 下 /api 代理到 3001）
└── package.json       # 项目配置
```

## 安全说明（已内置）

1. 密码以 scrypt 加盐哈希存储，旧明文账号首次登录自动迁移
2. 登录发放 HMAC 签名 Bearer token（`tpc.<userId>.<签名>`），密钥持久化于 `server/.secret`
3. 全局鉴权中间件：除公开端点（注册/登录/健康检查/商品浏览/分类/评价/红包详情）外，所有 API 必须携带有效 token；伪造、冒充、被禁用账号一律 401/403
4. 金额/价格类输入已做严格整数与范围校验，杜绝 NaN 注入

## 初始账号

应用启动后使用 `server/users.json` 中的既有数据；若数据目录为空，首个注册用户自动成为管理员。

## 健康检查

GET /api/health 返回 `{ ok: true, ... }`，可用于存活探测。

## 注意事项

1. 数据存储：当前使用 JSON 文件（同步读写）。handler 均为同步执行，单进程内无并发写竞争；若需多实例部署（PM2 cluster / 多副本），请先迁移到数据库
2. 令牌无法远程吊销：被禁用用户会立即被中间件拦截（403），无需吊销 token
3. 性能：当前为单进程轮询架构，高并发场景建议引入 WebSocket 并上数据库
4. 备份：定期备份 server 目录下的 JSON 文件
