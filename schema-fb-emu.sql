-- ============================================================
-- fb_emu — tabela de emulação do Firebase Realtime Database
-- Usada pelo supabase-bif-shim.js para que as páginas do BIF
-- funcionem sem reescrever a lógica interna de cada módulo.
-- ============================================================
create extension if not exists "pgcrypto";

create table if not exists fb_emu (
  path text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

create index if not exists idx_fb_emu_path_prefix on fb_emu (path text_pattern_ops);

alter table fb_emu enable row level security;

-- Demo: liberado para leitura/escrita com a chave anon.
-- Ajustar depois conforme o modelo de autenticação real do BIF.
create policy "demo_select_fb_emu" on fb_emu for select using (true);
create policy "demo_insert_fb_emu" on fb_emu for insert with check (true);
create policy "demo_update_fb_emu" on fb_emu for update using (true);
create policy "demo_delete_fb_emu" on fb_emu for delete using (true);

alter publication supabase_realtime add table fb_emu;
