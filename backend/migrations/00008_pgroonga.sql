-- +goose Up
drop index if exists posts_body_bigm;
drop extension if exists pg_bigm;

create extension if not exists pgroonga;

create index posts_body_pgroonga
    on posts using pgroonga (body pgroonga_text_regexp_ops_v2);

-- +goose Down
drop index if exists posts_body_pgroonga;
drop extension if exists pgroonga;
