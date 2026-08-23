# Tang People Chat

一款基于 React 19 + Vite + Express 5 的聊天应用：好友、私聊/群聊、红包、积分转账、商品市场、购物车、评价、管理后台、多主题。

## ✨ 功能

- 注册登录（scrypt 密码哈希 + Bearer token 鉴权，首个注册用户自动成为管理员）
- 好友 / 私聊（引用回复、撤回、已读回执、单条删除、消息搜索、图片/文件发送、置顶/免打扰）
- 群聊（@提及、引用、撤回、成员管理）
- 红包 / 转账 / 市场 / 评价 / 管理后台
- 8 套主题（设置页一键切换）

## 🚀 一键部署

[![Deploy to Glitch](https://cdn.glitch.global/0ff8e3c5-2b7e-4b8e-9b6a-7f0f1f2f3f4f/glitch-button.svg)](https://glitch.com/edit/#!/import/github/yourusername/tang-chat)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yourusername/tang-chat)

> 替换 `yourusername` 为你的 GitHub 用户名。部署后访问平台分配的网址即可。

## 🖥️ 本地运行

```bash
npm install
npm run build
npm start        # http://localhost:3001
```

开发模式：`npm run dev`（Vite 5173）+ `npm run dev:server`（API 3001）。

## 🗄️ 数据存储

默认存 `server/*.json`（14 个文件 + uploads/），可用环境变量 `DATA_DIR` 指定目录。**这些文件已被 .gitignore 排除，不会进入仓库**——首次部署时数据目录为空，第一个注册的用户自动成为管理员。

## ⚙️ 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| PORT | 服务端口 | 3001 |
| DATA_DIR | 数据文件目录 | app/server |

## 🔒 安全

- 密码 scrypt 加盐哈希，旧明文账号首次登录自动迁移
- HMAC 签名 token（密钥持久化于 `server/.secret`，不入库）
- 全局鉴权中间件：伪造 / 冒充 / 禁用账号一律拒绝
- 文件上传有大小与扩展名白名单、文件名净化

## 📄 文档

- `docs/login-plan.md` — 原始设计
- `DEPLOYMENT.md` — 部署指南
- `scripts/` — API 冒烟测试（`node scripts/smoke-*.mjs`）
