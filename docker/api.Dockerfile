# syntax=docker/dockerfile:1.7

FROM rust:1.85-bookworm AS builder
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm python3 \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY apps ./apps
COPY packages ./packages
COPY examples ./examples

RUN npm --prefix packages/ts-sdk install
RUN npm --prefix packages/ts-sdk run build
RUN packages/ts-sdk/node_modules/.bin/tsc \
    --module commonjs \
    --target es2020 \
    --moduleResolution node \
    --esModuleInterop \
    --typeRoots packages/ts-sdk/node_modules/@types \
    --outDir examples/sandbox/ts-agent/dist \
    examples/sandbox/ts-agent/main.ts \
    examples/sandbox/ts-agent/tools.ts
RUN cargo build --release -p agentscope-api

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates nodejs python3 python3-pip \
    && pip3 install --no-cache-dir --break-system-packages openai \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/agentscope-api /usr/local/bin/agentscope-api
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/examples /app/examples

ENV SERVER_PORT=8080
EXPOSE 8080

CMD ["agentscope-api"]
