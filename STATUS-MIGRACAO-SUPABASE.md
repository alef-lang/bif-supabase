# Status da Migração BIF: Firebase → Supabase (teste)

## ✅ Migração completa: 34 de 34 arquivos

Todos os arquivos que referenciavam o Firebase foram migrados para o
`supabase-bif-shim.js` e validados com `node --check` (sintaxe JS íntegra).

**Confirmado por auditoria automatizada:** zero referências, em todo o
repositório, a:
- SDKs do Firebase (`gstatic.com/firebasejs`, SDK compat)
- A chave de API original
- O nome do projeto Firebase de produção (`portal-treinamentos-lang`)

Ou seja: esta cópia não tem **nenhum** vínculo com o Firebase de produção.
Pode subir para um repositório novo no GitHub com segurança.

## O que foi feito em cada arquivo

O bloco de import/inicialização do Firebase (SDK + `firebaseConfig` +
`initializeApp`/`getDatabase`/`getAuth`) foi trocado pelo
`supabase-bif-shim.js`, mantendo os mesmos nomes de variável que o resto de
cada arquivo já usava (`db`, `auth`, `ref`, `get`, `set`, `update`, `remove`,
`push`, `onValue` etc.). **A lógica interna de cada página não foi
reescrita** — só a camada de conexão com o banco.

### Casos padrão (23 arquivos)
Import/config Firebase → shim Supabase, 1 para 1.

### Casos especiais (11 arquivos), tratados manualmente:
| Arquivo | Particularidade |
|---|---|
| `certificados.html`, `controle_ciap.html`, `portal_pedido_emissao_nota.html` | Padrão `getApps().length ? getApp() : initializeApp(...)` |
| `indicadores-principal-com-sped.html`, `recebimento.html` | Import dinâmico de módulos Firebase (`await import(...)`) |
| `arquivo.html`, `saneamento_ncm.html` | Guardavam a instância do banco em `state.db` em vez de variável simples |
| `antena-fiscal.html`, `central-relacionamento-bif.html` | Usavam o SDK **compat** antigo (namespace global `firebase.*`) — receberam um mini-adaptador local que recria a API encadeada (`db.ref(path).set()/.once()`) por cima do shim |
| `kanban.html` | Tinha wrapper próprio (`const firebase = {ready, db, ref, get, update, user}`) — só o bloco `initFirebase()` interno foi trocado |
| `colaboradores.html` | Usava um **segundo app Firebase** (`secondaryApp`) para criar usuários sem deslogar o admin — recriado com um **segundo cliente Supabase** isolado (`persistSession:false`), mesmo princípio |

## Arquitetura usada

- **`supabase-bif-shim.js`** — camada de compatibilidade na raiz do projeto.
  Emula a API do Firebase RTDB (`ref/get/set/update/remove/push/onValue/off`)
  e do Firebase Auth (`getAuth/onAuthStateChanged/signInWithEmailAndPassword/
  signOut/signInAnonymously`) usando Supabase por baixo.
- **`schema-fb-emu.sql`** — tabela `fb_emu` no Postgres, que armazena os
  dados no mesmo formato de "árvore de caminhos" do Firebase, para que
  push/set/update continuem funcionando exatamente como antes.

**Importante:** isso é uma camada de compatibilidade para viabilizar o teste
completo desta cópia sem reescrever toda a lógica de cada módulo agora. A
migração para tabelas relacionais de verdade (schema `empresas` já
desenhado em conversas anteriores) continua sendo o passo seguinte, depois
que este teste validar o comportamento das páginas no Supabase.

## Como usar (quando for testar)

1. Criar um projeto no [supabase.com](https://supabase.com)
2. Rodar `schema-fb-emu.sql` no SQL Editor do projeto
3. Em **cada** arquivo migrado, substituir:
   - `COLE_AQUI_SUA_URL_DO_PROJETO` pela Project URL
   - `COLE_AQUI_SUA_ANON_KEY` pela anon public key
   (Settings → API no painel do Supabase)
4. Subir os arquivos no novo repositório GitHub

Enquanto os placeholders `COLE_AQUI_...` não forem preenchidos, todas as
páginas ficam inertes — não tentam conectar em lugar nenhum.
