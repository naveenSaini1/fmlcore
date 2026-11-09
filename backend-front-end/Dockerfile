FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
ARG API_ORIGIN=http://api:8000
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_ORIGIN=$API_ORIGIN
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 API_ORIGIN=http://api:8000
COPY --from=build /app ./
EXPOSE 3001
CMD ["npm", "run", "start"]
