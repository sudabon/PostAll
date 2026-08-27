-- +goose Up
create table if not exists postall_notify_failures (
    day   date primary key,
    count bigint not null default 0
);

alter table postall_notify_failures enable row level security;

-- anon / authenticated は Supabase 固有のロール。素の PostgreSQL には存在しない。
-- +goose StatementBegin
do $$
declare
    target text;
begin
    foreach target in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = target) then
            execute format('revoke all on table postall_notify_failures from %I', target);
        end if;
    end loop;
end $$;
-- +goose StatementEnd

-- +goose StatementBegin
create or replace function postall_notify_change_event() returns trigger
language plpgsql
as $$
begin
    begin
        perform realtime.send(
            jsonb_build_object('id', new.id),
            'change',
            'postall:events',
            true
        );
    exception
        when others then
            raise warning 'postall realtime notification failed (SQLSTATE %): %', sqlstate, sqlerrm;
            -- 計数自体の失敗で本書き込みを巻き戻さない。例外ハンドラ内の
            -- エラーは捕捉されないため、独立したサブトランザクションで包む。
            begin
                insert into postall_notify_failures(day, count)
                values (current_date, 1)
                on conflict (day) do update set count = postall_notify_failures.count + 1;
            exception
                when others then
                    null;
            end;
    end;
    return new;
end;
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
create or replace function postall_notify_change_event() returns trigger
language plpgsql
as $$
begin
    begin
        perform realtime.send(
            jsonb_build_object('id', new.id),
            'change',
            'postall:events',
            true
        );
    exception
        when others then
            raise warning 'postall realtime notification failed (SQLSTATE %): %', sqlstate, sqlerrm;
    end;
    return new;
end;
$$;
-- +goose StatementEnd

drop table if exists postall_notify_failures;
