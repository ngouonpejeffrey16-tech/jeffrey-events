FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV DB_FILE=/app/data/jeffrey-events.db
EXPOSE 3000
CMD ["node", "--no-warnings", "src/server.js"]
