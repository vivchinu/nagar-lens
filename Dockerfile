# Nagar Lens — single container for Google Cloud Run (also works on any Docker host).
# Stage 1 builds the Vite client; stage 2 runs Express, which serves the app + API on $PORT.
FROM node:22-slim AS build
WORKDIR /app
COPY client/package*.json client/
RUN npm --prefix client ci
COPY client/ client/
RUN npm --prefix client run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server/package*.json server/
RUN npm --prefix server ci --omit=dev
COPY server/ server/
COPY --from=build /app/client/dist client/dist
# Cloud Run sets PORT (default 8080). GEMINI_API_KEY is set as an env var on the service.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
