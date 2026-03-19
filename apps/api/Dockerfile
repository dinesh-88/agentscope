# syntax=docker/dockerfile:1.7

FROM rust:1.85-bookworm AS builder
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY apps ./apps
COPY examples ./examples

RUN cargo build --release -p agentscope-api

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/agentscope-api /usr/local/bin/agentscope-api
COPY --from=builder /app/examples /app/examples

ENV SERVER_PORT=8080
EXPOSE 8080

CMD ["agentscope-api"]
