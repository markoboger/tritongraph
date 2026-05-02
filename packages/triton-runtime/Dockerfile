FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV TRITON_RUNTIME_HOST=0.0.0.0
ENV TRITON_RUNTIME_PORT=4317

EXPOSE 4317

CMD ["node", "./src/cli.js"]
