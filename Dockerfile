FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY apps/api apps/api
COPY packages/shared packages/shared
WORKDIR /app/apps/api
ENV PORT=4000 HOST=0.0.0.0 DATABASE_PATH=/data/novelreader.db
EXPOSE 4000
VOLUME ["/data"]
CMD ["npm", "start"]
