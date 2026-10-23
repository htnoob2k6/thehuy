FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && addgroup -S app \
    && adduser -S -G app app
COPY --chown=app:app src ./src
COPY --chown=app:app public ./public
RUN mkdir -p /app/uploads && chown app:app /app/uploads
USER app
EXPOSE 3000
CMD ["node", "src/server.js"]
