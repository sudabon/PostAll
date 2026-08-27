-- +goose Up
-- ホスト・testcontainers のいずれでも、通知失敗で本書き込みを巻き戻さない。
-- realtime.send が無い環境では 3F000/42883 以外（42P01 など）も出る。
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
        when undefined_function then
            null;
        when invalid_schema_name then
            null;
    end;
    return new;
end;
$$;
-- +goose StatementEnd
