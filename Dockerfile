FROM node:20-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY engine/ ./engine/
COPY server/ ./server/
COPY assets/ ./assets/
COPY index.html ./index.html

EXPOSE 8000
CMD ["node", "server/index.js"]
