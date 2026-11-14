-- name: GetEncryptionKeyring :one
select key_id, singleton, auth_hash, passphrase_wrap, recovery_wrap, created_at, updated_at
from encryption_keyring
where singleton;

-- name: InsertEncryptionKeyring :one
-- 同時の初期設定は 1 件だけを成立させる。既にあれば行を返さない。
insert into encryption_keyring (key_id, auth_hash, passphrase_wrap, recovery_wrap)
-- jsonb は文字列で渡す。QueryExecModeExec では []byte が bytea として送られるため。
values (
    sqlc.arg('key_id'),
    sqlc.arg('auth_hash'),
    sqlc.arg('passphrase_wrap')::text::jsonb,
    sqlc.arg('recovery_wrap')::text::jsonb
)
on conflict do nothing
returning key_id, singleton, auth_hash, passphrase_wrap, recovery_wrap, created_at, updated_at;

-- name: UpdatePassphraseWrap :one
update encryption_keyring
set passphrase_wrap = sqlc.arg('wrap')::text::jsonb,
    updated_at = now()
where key_id = sqlc.arg('key_id')
returning key_id, singleton, auth_hash, passphrase_wrap, recovery_wrap, created_at, updated_at;

-- name: UpdateRecoveryWrap :one
update encryption_keyring
set recovery_wrap = sqlc.arg('wrap')::text::jsonb,
    updated_at = now()
where key_id = sqlc.arg('key_id')
returning key_id, singleton, auth_hash, passphrase_wrap, recovery_wrap, created_at, updated_at;
