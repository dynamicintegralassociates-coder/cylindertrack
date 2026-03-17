FROM node:18-alpine
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
