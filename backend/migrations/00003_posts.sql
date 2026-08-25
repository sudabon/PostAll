-- +goose Up
create table posts (
    id             uuid primary key default gen_random_uuid(),
    channel_id     uuid not null references channels(id) on delete cascade,
    thread_root_id uuid references posts(id),
    author_id      uuid not null references users(id),
    body           text not null default '',
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    edited_at      timestamptz,
    deleted_at     timestamptz
);

create index posts_timeline
    on posts (channel_id, created_at, id)
    where thread_root_id is null and deleted_at is null;

create index posts_thread
    on posts (thread_root_id, created_at, id)
    where deleted_at is null;

-- +goose Down
drop table if exists posts;
