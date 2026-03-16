FROM node:18-alpine

# better-sqlite3 needs these to compile
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install root dependencies (server deps)
COPY package.json ./
RUN npm install --production=false

# Install client dependencies
COPY client/package.json client/
RUN cd client && npm install

# Copy all source code
COPY . .

# Build the React frontend
RUN cd client && npm run build

# Remove dev dependencies to slim down
RUN npm prune --production

EXPOSE 3001

ENV NODE_ENV=production
ENV DB_DIR=/data

CMD ["node", "server/index.js"]
