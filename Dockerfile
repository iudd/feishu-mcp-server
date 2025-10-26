FROM node:23-alpine AS builder

WORKDIR /app
COPY package*.json package-lock.json* ./
# 使用 npm ci 而不是 npm install
RUN npm ci
COPY . .
RUN npm run build

FROM node:23-alpine
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
RUN npm ci --only=production

ENTRYPOINT ["node", "dist/index.js"]