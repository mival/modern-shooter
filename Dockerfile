# Stage 1: build the web client.
# This stage runs on the platform of the build machine. Its output is the same for all platforms.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY client ./client
COPY shared ./shared
RUN npm run build

# Stage 2: the dedicated server with the built client.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY shared ./shared
COPY server ./server
COPY --from=build /app/dist ./dist
# The server keeps its changed settings in /data. Mount a volume there to keep them after an update.
RUN mkdir -p /data && chown node:node /data
ENV CONFIG_FILE=/data/server.json
VOLUME /data
USER node
EXPOSE 27960
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||27960)+'/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.js"]
