FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git openjdk-17-jre-headless \
  && curl -fsSL https://raw.githubusercontent.com/paulp/sbt-extras/master/sbt -o /usr/local/bin/sbt \
  && chmod 0755 /usr/local/bin/sbt \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV TRITON_RUNTIME_HOST=0.0.0.0
ENV TRITON_RUNTIME_PORT=4317

EXPOSE 4317

CMD ["node", "./src/cli.js"]
