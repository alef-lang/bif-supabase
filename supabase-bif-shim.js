/**
 * ============================================================
 * BIF · Supabase Shim (emula a API do Firebase RTDB + Auth)
 * ============================================================
 * Objetivo: permitir que as ~9000 linhas de lógica de cada página
 * do BIF continuem chamando ref()/get()/set()/update()/remove()/
 * push()/onValue()/getAuth()/onAuthStateChanged() exatamente como
 * antes, mas com o Supabase Postgres como banco real por trás.
 *
 * Isso evita reescrever a lógica de negócio de cada módulo agora;
 * é uma camada de compatibilidade para viabilizar o teste completo
 * da cópia migrada. A migração para tabelas relacionais "de verdade"
 * (schema empresas/empresa_impostos/etc, já desenhado) é o próximo
 * passo, depois que este teste validar o comportamento das páginas.
 *
 * Requer a tabela fb_emu (ver schema-fb-emu.sql) e Realtime habilitado
 * nela.
 * ============================================================
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export function initFirebaseShim(config) {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const TABLE = 'fb_emu';

  // ---------- utilidades internas ----------
  function normalizePath(p) {
    return String(p).replace(/^\/+|\/+$/g, '');
  }

  function genPushId() {
    // Formato similar a uma chave push do Firebase (ordenável por tempo)
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    return `-${ts}${rand}`;
  }

  async function readNode(path) {
    path = normalizePath(path);
    // 1) Tenta como "container": filhos diretos (path/filho, sem sub-filhos)
    const { data: filhos, error: errFilhos } = await supabase
      .from(TABLE)
      .select('path,value')
      .like('path', `${path}/%`);

    if (errFilhos) throw errFilhos;

    if (filhos && filhos.length) {
      const diretos = filhos.filter(r => {
        const resto = r.path.slice(path.length + 1);
        return resto.length > 0 && !resto.includes('/');
      });
      if (diretos.length) {
        const obj = {};
        diretos.forEach(r => { obj[r.path.slice(path.length + 1)] = r.value; });
        return obj;
      }
    }

    // 2) Senão, tenta como nó folha (valor único gravado no próprio path)
    const { data: folha, error: errFolha } = await supabase
      .from(TABLE)
      .select('value')
      .eq('path', path)
      .maybeSingle();

    if (errFolha) throw errFolha;
    return folha ? folha.value : null;
  }

  function makeSnapshot(value) {
    return {
      val: () => value,
      exists: () => value !== null && value !== undefined,
      forEach: (cb) => {
        if (value && typeof value === 'object') {
          Object.entries(value).forEach(([k, v]) => cb(makeSnapshot(v), k));
        }
      },
      key: null
    };
  }

  // ---------- API estilo Firebase RTDB ----------
  function ref(_db, path) {
    return { path: normalizePath(path || '') };
  }

  async function get(refObj) {
    const value = await readNode(refObj.path);
    return makeSnapshot(value);
  }

  async function set(refObj, data) {
    const path = refObj.path;
    // Remove qualquer coisa que exista sob este path (nó + filhos)
    await supabase.from(TABLE).delete().eq('path', path);
    await supabase.from(TABLE).delete().like('path', `${path}/%`);
    if (data === null || data === undefined) return;
    await supabase.from(TABLE).upsert({ path, value: data, updated_at: new Date().toISOString() });
  }

  async function update(refObj, data) {
    const path = refObj.path;
    if (!data || typeof data !== 'object') return set(refObj, data);
    // Merge raso: cada chave de "data" é tratada como filho direto do path
    const existente = await readNode(path);
    const base = (existente && typeof existente === 'object' && !Array.isArray(existente)) ? existente : {};
    const merged = { ...base, ...data };
    await supabase.from(TABLE).delete().eq('path', path);
    await supabase.from(TABLE).delete().like('path', `${path}/%`);
    await supabase.from(TABLE).upsert({ path, value: merged, updated_at: new Date().toISOString() });
  }

  async function remove(refObj) {
    const path = refObj.path;
    await supabase.from(TABLE).delete().eq('path', path);
    await supabase.from(TABLE).delete().like('path', `${path}/%`);
  }

  async function push(refObj, data) {
    const id = genPushId();
    const childPath = `${refObj.path}/${id}`;
    await supabase.from(TABLE).upsert({ path: childPath, value: data, updated_at: new Date().toISOString() });
    return { key: id, path: childPath };
  }

  const listeners = new Map(); // path -> Set(callback)
  let canalRealtime = null;

  function garantirCanalRealtime() {
    if (canalRealtime) return;
    canalRealtime = supabase
      .channel('fb_emu_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, (payload) => {
        const changedPath = (payload.new && payload.new.path) || (payload.old && payload.old.path) || '';
        listeners.forEach((callbacks, path) => {
          if (changedPath === path || changedPath.startsWith(path + '/')) {
            callbacks.forEach(({ cb }) => {
              readNode(path).then(v => cb(makeSnapshot(v))).catch(err => console.error('[fb-shim] onValue error', err));
            });
          }
        });
      })
      .subscribe();
  }

  function onValue(refObj, callback, errCallback) {
    const path = refObj.path;
    garantirCanalRealtime();
    if (!listeners.has(path)) listeners.set(path, new Set());
    const entry = { cb: callback, errCb: errCallback };
    listeners.get(path).add(entry);

    // Disparo inicial, igual ao Firebase
    readNode(path)
      .then(v => callback(makeSnapshot(v)))
      .catch(err => { console.error('[fb-shim] erro ao carregar', path, err); if (errCallback) errCallback(err); });

    // Retorna função de unsubscribe (equivalente ao off())
    return () => { listeners.get(path)?.delete(entry); };
  }

  function off(refObj) {
    if (refObj && refObj.path) listeners.delete(refObj.path);
  }

  // ---------- API estilo Firebase Auth (sobre Supabase Auth) ----------
  function getAuth() { return supabase.auth; }

  function onAuthStateChanged(_auth, callback) {
    supabase.auth.getSession().then(({ data }) => callback(data.session ? data.session.user : null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session ? session.user : null);
    });
    return () => sub.subscription.unsubscribe();
  }

  async function signInWithEmailAndPassword(_auth, email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { user: data.user };
  }

  async function signOut(_auth) {
    await supabase.auth.signOut();
  }

  async function signInAnonymously(_auth) {
    // Supabase não tem "anônimo" nativo igual ao Firebase; usamos uma sessão
    // anônima local baseada em signInAnonymously do Supabase (se habilitado no projeto)
    // ou cai para um usuário fixo de demonstração.
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      return { user: data.user };
    } catch (e) {
      console.warn('[fb-shim] signInAnonymously indisponível, usando usuário demo local.', e);
      return { user: { uid: 'demo-anon', id: 'demo-anon' } };
    }
  }

  return {
    supabase,
    db: {}, // placeholder passado como "db" para manter assinatura ref(db, path)
    auth: {},
    ref, get, set, update, remove, push, onValue, off,
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, signInAnonymously
  };
}
