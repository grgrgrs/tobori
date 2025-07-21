# Step 1: Build the site
FROM node:18 AS builder
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

# Step 2: Serve with static server
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
