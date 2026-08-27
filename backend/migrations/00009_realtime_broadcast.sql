-- +goose Up
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

-- +goose Down
-- +goose StatementBegin
create or replace function postall_notify_change_event() returns trigger
language plpgsql
as $$
begin
    perform pg_notify('postall_events', new.id::text);
    return new;
end;
$$;
-- +goose StatementEnd
