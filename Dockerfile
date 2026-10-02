# --- STAGE 1: Build ---
FROM node:18-alpine AS builder

WORKDIR /app

# 复制依赖定义
COPY package*.json ./

# 安装所有依赖 (包括开发依赖，用于 build)
RUN npm install

# 复制源码
COPY . .

# 执行构建 (生成 dist 和 dist/public)
RUN npm run build

# 【关键优化】：清理掉开发依赖 (devDependencies)
# 只保留运行代码所必需的依赖
RUN npm prune --omit=dev

# --- STAGE 2: Run ---
FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV USE_HTTPS=false
ENV PORT=3000

# 仅复制构建产物
COPY --from=builder /app/dist ./dist
# 【关键优化】：此时复制的是已经经过清理、只包含生产依赖的 node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
# 强制拷贝 public 文件夹到 /app/public
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "dist/main.js"]
