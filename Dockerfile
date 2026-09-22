FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
COPY data ./data
ENV NODE_ENV=production
CMD ["node", "server.js"]
