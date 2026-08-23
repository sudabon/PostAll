FROM postgres:16-alpine

COPY pg_bigm /tmp/pg_bigm

# 公式イメージの Postgres は /usr/local。apk の postgresql16-dev は別物なので使わない。
# JIT 用 bitcode は不要なので with_llvm=no（clang 版の不一致を避ける）。
RUN apk add --no-cache --virtual .build-deps \
      build-base \
      icu-dev \
 && make -C /tmp/pg_bigm USE_PGXS=1 with_llvm=no \
 && make -C /tmp/pg_bigm USE_PGXS=1 with_llvm=no install \
 && rm -rf /tmp/pg_bigm \
 && apk del .build-deps
