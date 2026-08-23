import express from 'express';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import apiApp from './server/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 生产服务器：复用 server/index.js 的全部 API（单一代码源），并托管前端构建产物 dist/
const app = express();
app.use(apiApp);

const DIST_DIR = join(__dirname, 'dist');
app.use(express.static(DIST_DIR));

// SPA 回退：非 /api 的 GET 请求返回 index.html（前端路由由状态驱动，直接回退即可）
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  const indexFile = join(DIST_DIR, 'index.html');
  if (existsSync(indexFile)) return res.sendFile(indexFile);
  res.status(404).send('前端资源不存在，请先运行 npm run build');
});

export default app;

// 仅当直接运行本文件时才监听端口（Vercel 等平台会以函数形式调用 export default）
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const PORT = parseInt(process.env.PORT, 10) || 3001;
  app.listen(PORT, () => {
    console.log(`Tang People Chat running at http://localhost:${PORT}`);
  });
}
