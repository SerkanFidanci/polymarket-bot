FROM node:20-alpine

WORKDIR /app

# better-sqlite3 needs build tools on Alpine
RUN apk add --no-cache python3 make g++

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source
COPY . .

# Build frontend
RUN npm run build

# Expose ports
EXPOSE 3001

# Serve built frontend from Express + run trading engine
CMD ["node", "--import", "tsx", "server/index.ts"]
