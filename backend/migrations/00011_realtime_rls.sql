-- +goose Up
-- realtime.messages は Supabase 固有。testcontainers の素の PostgreSQL では存在しない。
-- ホストでは所有者は supabase_admin で、postgres からの CREATE POLICY は 42501 になる。
-- その場合はマイグレーションを止めず、SQL Editor で同じポリシーを適用する。
-- +goose StatementBegin
do $$
begin
    if to_regclass('realtime.messages') is null then
        return;
    end if;

    begin
        alter table realtime.messages enable row level security;

        drop policy if exists postall_events_select on realtime.messages;
        create policy postall_events_select
            on realtime.messages
            for select
            to authenticated
            using (true);
    exception
        when insufficient_privilege then
            raise notice 'skip realtime RLS: current user cannot own realtime.messages';
    end;
end
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
do $$
begin
    if to_regclass('realtime.messages') is null then
        return;
    end if;

    begin
        drop policy if exists postall_events_select on realtime.messages;
    exception
        when insufficient_privilege then
            null;
    end;
end
$$;
-- +goose StatementEnd
