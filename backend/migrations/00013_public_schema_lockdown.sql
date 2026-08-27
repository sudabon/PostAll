-- +goose Up
-- PostgREST (Supabase Data API) は public スキーマを公開する。クライアントは
-- publishable key と authenticated ロールの JWT を持つため、RLS と GRANT を
-- 締めないと Go API の認可をバイパスして直接読み書きできる。
-- anon / authenticated は Supabase 固有のロール。testcontainers の素の
-- PostgreSQL には存在しないため、存在するロールにだけ revoke する。
alter table users enable row level security;
alter table channels enable row level security;
alter table posts enable row level security;
alter table attachments enable row level security;
alter table emojis enable row level security;
alter table reactions enable row level security;
alter table change_events enable row level security;

-- +goose StatementBegin
do $$
declare
    target text;
begin
    foreach target in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = target) then
            execute format('revoke all on all tables in schema public from %I', target);
            execute format('revoke all on all sequences in schema public from %I', target);
            execute format('revoke all on all functions in schema public from %I', target);
            execute format('revoke usage on schema public from %I', target);
        end if;
    end loop;
end $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
do $$
declare
    target text;
begin
    foreach target in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = target) then
            execute format('grant usage on schema public to %I', target);
            execute format('grant all on all tables in schema public to %I', target);
            execute format('grant all on all sequences in schema public to %I', target);
            execute format('grant all on all functions in schema public to %I', target);
        end if;
    end loop;
end $$;
-- +goose StatementEnd

alter table users disable row level security;
alter table channels disable row level security;
alter table posts disable row level security;
alter table attachments disable row level security;
alter table emojis disable row level security;
alter table reactions disable row level security;
alter table change_events disable row level security;
