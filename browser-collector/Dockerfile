FROM mcr.microsoft.com/playwright:v1.61.1-noble

ENV NODE_ENV=production HOME=/tmp/collector
WORKDIR /opt/collector
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
USER pwuser
CMD ["node", "src/main.mjs"]
