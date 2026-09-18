FROM node:20-slim
WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install ALL dependencies (including dev) so TypeScript can compile
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript to JS
RUN npm run build

# Remove dev dependencies to keep image lean
RUN npm prune --omit=dev

# Railway sets PORT dynamically via env var
EXPOSE ${PORT:-4000}

CMD ["node", "dist/index.js"]
