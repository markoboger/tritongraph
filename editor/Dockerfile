FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY editor/package.json editor/package-lock.json ./editor/
RUN cd editor && npm ci

COPY editor ./editor
COPY packages ./packages
# Vite resolves `../scala-examples`, `../sbt-examples`, `../ts-examples` from `editor/` (see vite.config.ts).
# Without these, bundled example cards (e.g. animal–fruit Scala/TS) are empty in the built SPA.
COPY sbt-examples ./sbt-examples
COPY scala-examples ./scala-examples
COPY ts-examples ./ts-examples
COPY docker-examples ./docker-examples
ARG VITE_TRITON_RUNTIME_URL=http://127.0.0.1:4317
ENV VITE_TRITON_RUNTIME_URL=$VITE_TRITON_RUNTIME_URL
RUN cd editor && npm run build

FROM nginx:1.27-alpine

COPY editor/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/editor/dist /usr/share/nginx/html

EXPOSE 8080
