-- +goose Up
create table emojis (
    id          uuid primary key default gen_random_uuid(),
    shortcode   text not null unique,
    storage_key text not null,
    checksum    text not null,
    created_at  timestamptz not null default now(),
    constraint emojis_shortcode_not_blank check (shortcode <> '')
);

create table reactions (
    post_id    uuid not null references posts(id) on delete cascade,
    emoji_id   uuid not null references emojis(id) on delete cascade,
    user_id    uuid not null references users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (post_id, emoji_id, user_id)
);

-- +goose Down
drop table if exists reactions;
drop table if exists emojis;
