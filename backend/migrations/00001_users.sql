-- +goose Up
create extension if not exists pgcrypto;

create table users (
    id          uuid primary key default gen_random_uuid(),
    cognito_sub text not null unique,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- +goose Down
drop table if exists users;
