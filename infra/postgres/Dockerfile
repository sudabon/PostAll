FROM postgres:16-alpine

# pg_bigm は upstream のタグ付きリリースをビルド時に取得する。
# リポジトリに他プロジェクトのソースを抱えず、CI・ローカル・本番で同じ手順になる。
ARG PG_BIGM_VERSION=1.2-20250903

# 公式イメージの Postgres は /usr/local。apk の postgresql16-dev は別物なので使わない。
# JIT 用 bitcode は不要なので with_llvm=no（clang 版の不一致を避ける）。
RUN apk add --no-cache --virtual .build-deps \
      build-base \
      curl \
      icu-dev \
 && mkdir -p /tmp/pg_bigm \
 && curl -fsSL "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz" \
    | tar -xz -C /tmp/pg_bigm --strip-components=1 \
 && make -C /tmp/pg_bigm USE_PGXS=1 with_llvm=no \
 && make -C /tmp/pg_bigm USE_PGXS=1 with_llvm=no install \
 && rm -rf /tmp/pg_bigm \
 && apk del .build-deps
