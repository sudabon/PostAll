-- +goose Up
-- 暗号化チャネル。暗号化の有無はチャネルの作成時に決まり、以後は変わらない。
-- ポストは属するチャネルの値を posts.encrypted に複製し、複合外部キーで一致を保証する。
-- 暗号文は body ではなく body_ciphertext に置く。body の PGroonga 索引に暗号文を入れないため。
alter table channels add column encrypted boolean not null default false;
alter table channels add constraint channels_id_encrypted_key unique (id, encrypted);

-- 作成後の変更を DB でも拒否する（API にも変更の経路は無い）。
-- +goose StatementBegin
create function postall_channels_encrypted_immutable() returns trigger
language plpgsql
as $$
begin
    if old.encrypted is distinct from new.encrypted then
        raise exception 'channels.encrypted cannot be changed after creation'
            using errcode = 'check_violation';
    end if;
    return new;
end;
$$;
-- +goose StatementEnd

create trigger channels_encrypted_immutable
before update of encrypted on channels
for each row execute function postall_channels_encrypted_immutable();

alter table posts
    add column encrypted boolean not null default false,
    add column body_ciphertext text,
    add constraint posts_channel_encryption_fkey
        foreign key (channel_id, encrypted) references channels (id, encrypted) on delete cascade,
    add constraint posts_encrypted_has_no_plain_body check (not encrypted or body = ''),
    add constraint posts_plain_has_no_ciphertext check (encrypted or body_ciphertext is null),
    add constraint posts_live_encrypted_has_ciphertext
        check (not encrypted or deleted_at is not null or body_ciphertext is not null);

-- 包んだマスター鍵。ワークスペースに 1 行だけ置く。サーバーは鍵の平文を持たない。
create table encryption_keyring (
    key_id          uuid primary key,
    singleton       boolean not null default true unique check (singleton),
    auth_hash       bytea not null,
    passphrase_wrap jsonb not null,
    recovery_wrap   jsonb not null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

alter table encryption_keyring enable row level security;

-- anon / authenticated は Supabase 固有のロール。素の PostgreSQL には存在しない。
-- 00013 の後に作ったテーブルと関数なので、同じ方針で権限を剥がす。
-- +goose StatementBegin
do $$
declare
    target text;
begin
    foreach target in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = target) then
            execute format('revoke all on table encryption_keyring from %I', target);
            execute format('revoke all on function postall_channels_encrypted_immutable() from %I', target);
        end if;
    end loop;
end $$;
-- +goose StatementEnd

-- +goose Down
-- 暗号化チャネルがあると、戻すと暗号文を失う。そのときは失敗させる。
-- +goose StatementBegin
do $$
begin
    if exists (select 1 from channels where encrypted) then
        raise exception '00017 を戻せません: 暗号化チャネルがあり、戻すと暗号文を失います';
    end if;
end $$;
-- +goose StatementEnd

drop table if exists encryption_keyring;

alter table posts
    drop constraint if exists posts_live_encrypted_has_ciphertext,
    drop constraint if exists posts_plain_has_no_ciphertext,
    drop constraint if exists posts_encrypted_has_no_plain_body,
    drop constraint if exists posts_channel_encryption_fkey,
    drop column if exists body_ciphertext,
    drop column if exists encrypted;

drop trigger if exists channels_encrypted_immutable on channels;
drop function if exists postall_channels_encrypted_immutable();

alter table channels
    drop constraint if exists channels_id_encrypted_key,
    drop column if exists encrypted;
