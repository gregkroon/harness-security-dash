# Multi-stage build for Harness Security Dashboard
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

# Copy frontend package files
COPY package*.json ./
COPY vite.config.ts tsconfig.json tsconfig.node.json ./
COPY tailwind.config.js postcss.config.js ./
COPY index.html ./
COPY src ./src

# Install dependencies and build
RUN npm ci
RUN npm run build

# Backend stage
FROM node:20-alpine AS backend-build

WORKDIR /app/backend

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ ca-certificates wget && \
    update-ca-certificates

# Pre-download Node headers to avoid SSL issues during node-gyp build
RUN NODE_VERSION=$(node -v | cut -d 'v' -f 2) && \
    wget --no-check-certificate -O /tmp/node-headers.tar.gz \
    "https://nodejs.org/download/release/v${NODE_VERSION}/node-v${NODE_VERSION}-headers.tar.gz"

# Copy backend package files
COPY backend/package*.json ./

# Install with local node headers tarball
RUN npm_config_tarball=/tmp/node-headers.tar.gz npm ci --omit=dev

# Copy backend source
COPY backend/src ./src

# Final production image
FROM node:20-alpine

WORKDIR /app

# Install nginx for serving frontend
RUN apk add --no-cache nginx

# Copy backend
COPY --from=backend-build /app/backend /app/backend

# Copy frontend build
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Create nginx config
RUN mkdir -p /run/nginx && \
    mkdir -p /app/data

COPY <<EOF /etc/nginx/http.d/default.conf
server {
    listen 80;
    server_name _;

    # Frontend
    location / {
        root /app/frontend/dist;
        try_files \$uri \$uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Copy startup script
COPY <<'EOF' /app/start.sh
#!/bin/sh
set -e

echo "Starting Harness Security Dashboard..."

# Start nginx
nginx

# Start backend
cd /app/backend
node src/server.js
EOF

RUN chmod +x /app/start.sh

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/api/health || exit 1

# Volume for persistent data
VOLUME ["/app/data"]

# Start services
CMD ["/app/start.sh"]
