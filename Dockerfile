FROM node:23-alpine AS builder

WORKDIR /app
# Copy manifest files for pnpm
COPY package.json pnpm-lock.yaml ./
# Install pnpm globally and install dependencies using the lockfile
RUN npm i -g pnpm && pnpm install --frozen-lockfile
# Copy the rest of the source code
COPY . .
# Build the project
RUN pnpm run build

# Runtime image – clean Alpine node image
FROM node:23-alpine
WORKDIR /app
# Copy manifest and lockfile for production install
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/dist ./dist
# Install only production dependencies using the lockfile
RUN npm i -g pnpm && pnpm install --prod --frozen-lockfile

ENTRYPOINT ["node", "dist/index.js"]