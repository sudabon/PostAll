create extension if not exists pgcrypto;

create table users (
    id          uuid primary key default gen_random_uuid(),
    auth_subject text not null unique,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table channels (
    id         uuid primary key default gen_random_uuid(),
    parent_id  uuid references channels(id) on delete cascade,
    name       text not null,
    sort_key   text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint channels_name_not_blank check (btrim(name) <> '')
);

create unique index channels_name_in_parent
    on channels (parent_id, name) where parent_id is not null;

create unique index channels_name_at_root
    on channels (name) where parent_id is null;

create index channels_parent_sort on channels (parent_id, sort_key);

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

create table attachments (
    id                  uuid primary key default gen_random_uuid(),
    post_id             uuid references posts(id) on delete set null,
    uploader_id         uuid not null references users(id),
    file_name           text not null,
    content_type        text not null,
    size_bytes          bigint not null,
    storage_key         text not null unique,
    checksum            text not null,
    created_at          timestamptz not null default now(),
    completed_at        timestamptz,
    deletion_pending_at timestamptz,
    deletion_attempts   integer not null default 0,
    deletion_error      text
);

create index attachments_post_id on attachments (post_id);
create index attachments_incomplete on attachments (created_at) where post_id is null;
create index attachments_deletion_pending
    on attachments (deletion_pending_at, id)
    where deletion_pending_at is not null;

create function mark_post_attachments_for_deletion()
returns trigger
language plpgsql
as $$
begin
    update attachments
    set post_id = null,
        deletion_pending_at = coalesce(deletion_pending_at, now()),
        deletion_error = null
    where post_id = old.id;
    return old;
end;
$$;

create trigger posts_mark_attachments_for_deletion
before delete on posts
for each row execute function mark_post_attachments_for_deletion();

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

create extension if not exists pgroonga;

create index posts_body_pgroonga
    on posts using pgroonga (body pgroonga_text_regexp_ops_v2);

create table change_events (
    id             bigint generated always as identity primary key,
    event_type     text not null,
    channel_id     uuid,
    post_id        uuid,
    thread_root_id uuid,
    created_at     timestamptz not null default now(),
    constraint change_events_type check (event_type in (
        'channel.created',
        'channel.updated',
        'channel.deleted',
        'post.created',
        'post.updated',
        'post.deleted',
        'reply.created',
        'reply.updated',
        'reply.deleted',
        'reaction.updated'
    ))
);

create index change_events_created_at on change_events (created_at);

create table change_event_retention (
    singleton      boolean primary key default true,
    pruned_through bigint not null default 0,
    constraint change_event_retention_singleton check (singleton),
    constraint change_event_retention_nonnegative check (pruned_through >= 0)
);
