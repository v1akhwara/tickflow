FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN mkdir -p data
ENV PORT=3000
ENV JWT_SECRET=change-me-to-a-real-secret
EXPOSE 3000
VOLUME /app/data
CMD ["node", "server.js"]
