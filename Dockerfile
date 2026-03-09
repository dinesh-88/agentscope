# syntax=docker/dockerfile:1.7

FROM rust:1.85-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY engine ./engine

RUN cargo build --release -p agentscope-api

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/agentscope-api /usr/local/bin/agentscope-api

ENV SERVER_PORT=3000
EXPOSE 3000

CMD ["agentscope-api"]
