-- +goose Up
create table attachments (
    id            uuid primary key default gen_random_uuid(),
    post_id       uuid references posts(id),
    uploader_id   uuid not null references users(id),
    file_name     text not null,
    content_type  text not null,
    size_bytes    bigint not null,
    storage_key   text not null unique,
    checksum      text not null,
    created_at    timestamptz not null default now(),
    completed_at  timestamptz
);

create index attachments_post_id on attachments (post_id);
create index attachments_incomplete on attachments (created_at) where post_id is null;

-- +goose Down
drop table if exists attachments;
