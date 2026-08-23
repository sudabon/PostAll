-- +goose Up
create extension if not exists pg_bigm;

create index posts_body_bigm
    on posts using gin (lower(body) gin_bigm_ops);

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

-- +goose StatementBegin
create function postall_notify_change_event() returns trigger
language plpgsql
as $$
begin
    perform pg_notify('postall_events', new.id::text);
    return new;
end;
$$;
-- +goose StatementEnd

create trigger change_events_notify
after insert on change_events
for each row execute function postall_notify_change_event();

-- +goose StatementBegin
create function postall_record_channel_change() returns trigger
language plpgsql
as $$
begin
    if tg_op = 'INSERT' then
        insert into change_events (event_type, channel_id)
        values ('channel.created', new.id);
        return new;
    elsif tg_op = 'UPDATE' then
        insert into change_events (event_type, channel_id)
        values ('channel.updated', new.id);
        return new;
    end if;

    insert into change_events (event_type, channel_id)
    values ('channel.deleted', old.id);
    return old;
end;
$$;
-- +goose StatementEnd

create trigger channels_record_change
after insert or update or delete on channels
for each row execute function postall_record_channel_change();

-- +goose StatementBegin
create function postall_record_post_change() returns trigger
language plpgsql
as $$
declare
    kind text;
begin
    if new.thread_root_id is null then
        if tg_op = 'INSERT' then
            kind := 'post.created';
        elsif old.deleted_at is null and new.deleted_at is not null then
            kind := 'post.deleted';
        else
            kind := 'post.updated';
        end if;
    else
        if tg_op = 'INSERT' then
            kind := 'reply.created';
        elsif old.deleted_at is null and new.deleted_at is not null then
            kind := 'reply.deleted';
        else
            kind := 'reply.updated';
        end if;
    end if;

    insert into change_events (event_type, channel_id, post_id, thread_root_id)
    values (kind, new.channel_id, new.id, new.thread_root_id);
    return new;
end;
$$;
-- +goose StatementEnd

create trigger posts_record_change
after insert or update on posts
for each row execute function postall_record_post_change();

-- +goose StatementBegin
create function postall_record_reaction_change() returns trigger
language plpgsql
as $$
declare
    target_post_id uuid;
    target_channel_id uuid;
    target_thread_root_id uuid;
begin
    if tg_op = 'DELETE' then
        target_post_id := old.post_id;
    else
        target_post_id := new.post_id;
    end if;

    select p.channel_id, p.thread_root_id
      into target_channel_id, target_thread_root_id
      from posts p
     where p.id = target_post_id;

    insert into change_events (event_type, channel_id, post_id, thread_root_id)
    values ('reaction.updated', target_channel_id, target_post_id, target_thread_root_id);

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;
-- +goose StatementEnd

create trigger reactions_record_change
after insert or delete on reactions
for each row execute function postall_record_reaction_change();

-- +goose Down
drop trigger if exists reactions_record_change on reactions;
drop function if exists postall_record_reaction_change();
drop trigger if exists posts_record_change on posts;
drop function if exists postall_record_post_change();
drop trigger if exists channels_record_change on channels;
drop function if exists postall_record_channel_change();
drop trigger if exists change_events_notify on change_events;
drop function if exists postall_notify_change_event();
drop table if exists change_events;
drop index if exists posts_body_bigm;
drop extension if exists pg_bigm;
