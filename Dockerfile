FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --workspace=@novelreader/api --workspace=@novelreader/shared --omit=dev
COPY apps/api apps/api
COPY packages/shared packages/shared
WORKDIR /app/apps/api
ENV PORT=4000 HOST=0.0.0.0 DATABASE_PATH=/data/novelreader.db
EXPOSE 4000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
