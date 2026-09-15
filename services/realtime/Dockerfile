FROM node:22-alpine AS production

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY src ./src

ENV NODE_ENV=production
EXPOSE 2567 2568
CMD ["npm", "start"]
