FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache ffmpeg font-dejavu
COPY package.json ./
COPY server.js instagram-intelligence.js ./
COPY public ./public
COPY data ./data
ENV NODE_ENV=production
CMD ["node", "server.js"]
