FROM node:23-alpine AS builder

WORKDIR /app
# Copy only the manifest files needed for pnpm
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
# Copy only the built artifacts and manifest for production install
COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./dist
# Install only production dependencies
RUN npm i -g pnpm && pnpm install --prod --frozen-lockfile

ENTRYPOINT ["node", "dist/index.js"]