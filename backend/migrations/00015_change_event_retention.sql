-- +goose Up
create table change_event_retention (
    singleton      boolean primary key default true,
    pruned_through bigint not null default 0,
    constraint change_event_retention_singleton check (singleton),
    constraint change_event_retention_nonnegative check (pruned_through >= 0)
);

alter table change_event_retention enable row level security;

-- anon / authenticated は Supabase 固有のロール。素の PostgreSQL には存在しない。
-- +goose StatementBegin
do $$
declare
    target text;
begin
    foreach target in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = target) then
            execute format('revoke all on table change_event_retention from %I', target);
        end if;
    end loop;
end $$;
-- +goose StatementEnd

-- +goose Down
drop table if exists change_event_retention;
