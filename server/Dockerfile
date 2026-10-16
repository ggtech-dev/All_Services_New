# All Services API (Node + Express). Only the API runs here; the four apps are served by their own containers.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY db ./db
# uploaded photos / documents are kept on volumes (see deploy/docker-compose.yml)
RUN mkdir -p uploads private_uploads && chown -R node:node /app
USER node
EXPOSE 5000
CMD ["node", "src/index.js"]
