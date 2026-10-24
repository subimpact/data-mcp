# Build stage: compile TypeScript and copy the tools.json snapshot into dist/.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: only production dependencies and the compiled server.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# The server starts without APIFY_TOKEN so directories can introspect it;
# tool calls explain how to set the token.
ENTRYPOINT ["node", "dist/index.js"]
