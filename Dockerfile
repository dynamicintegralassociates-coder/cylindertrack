FROM node:18-alpine
# Build tools needed by better-sqlite3 native module
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY client/package*.json client/
RUN cd client && npm install
COPY . .
RUN cd client && npm run build
ENV PORT=3001
EXPOSE 3001
CMD ["node", "server/index.js"]
