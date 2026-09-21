FROM node:24-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY web web
RUN npm run build -w web

# Node runs the server's TypeScript directly; there is no server build step.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server
COPY server/src server/src
COPY migrations migrations
COPY --from=web /app/web/dist web/dist
USER node
EXPOSE 3000
CMD ["node", "server/src/index.ts"]
