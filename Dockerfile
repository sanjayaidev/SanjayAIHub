# Use Node.js LTS
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Expose the port Railway will use
EXPOSE 3000

# Start command - Railway will use PORT env var automatically
CMD ["node", "server.js"]
