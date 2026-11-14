import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 构建时间戳：显示在设置页，用于确认用户看到的是不是最新构建
const buildTime = new Date().toLocaleString('zh-CN', { hour12: false })

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
