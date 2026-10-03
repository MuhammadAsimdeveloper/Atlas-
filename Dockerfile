FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY infra ./infra
COPY README.md RELEASE-MANIFEST.txt ./
USER node
EXPOSE 8080
CMD ["node", "apps/api/server.mjs"]