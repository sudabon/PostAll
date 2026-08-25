-- +goose Up
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

-- +goose Down
drop table if exists channels;
