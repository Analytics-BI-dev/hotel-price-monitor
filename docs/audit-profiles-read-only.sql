-- Auditoria manual, SOMENTE LEITURA. Executar no SQL Editor do Supabase.
-- Não retorna registros pessoais, usuários, senhas, tokens ou secrets.
-- Nenhuma tabela, role, policy, trigger ou configuração é modificada.

-- 1. profiles e hotels precisam de RLS habilitado.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('profiles', 'hotels');

-- 2. Revisar policies: usuários só devem ler seu próprio profile; clientes não
-- podem alterar role/active nem ler perfis alheios. Admin usa cliente servidor.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('profiles', 'hotels')
order by tablename, policyname;

-- 3. Grants por tabela e coluna: RLS precisa proteger qualquer permissão de
-- escrita concedida a anon/authenticated, especialmente profiles.role/active.
select table_name, grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'public' and table_name in ('profiles', 'hotels')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and grantee in ('anon', 'authenticated')
order by column_name, grantee, privilege_type;

-- 4. Metadados dos triggers/funções (não executa nem retorna seus corpos).
-- Revisar no Dashboard se o trigger de criação de profile existe, fixa a role
-- inicial em client e não confia em user_metadata para role/active.
select n.nspname as schema_name, c.relname as table_name, t.tgname as trigger_name,
       pn.nspname as function_schema, p.proname as function_name,
       p.prosecdef as security_definer, p.proconfig as function_settings
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
join pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal
  and ((n.nspname = 'auth' and c.relname = 'users')
    or (n.nspname = 'public' and c.relname = 'profiles'));

-- 5. Revisar constraints sem consultar dados de usuários.
select conname as constraint_name, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = to_regclass('public.profiles');
