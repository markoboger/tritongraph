FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV TRITON_RUNTIME_HOST=0.0.0.0
ENV TRITON_RUNTIME_PORT=4317

EXPOSE 4317

CMD ["node", "./src/cli.js"]
