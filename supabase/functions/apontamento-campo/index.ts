// eX · Apontamento de campo — link com chave (sem login)
// Link: eX_Apontamento.html?p=<projeto_id>&k=<projetos.campo_token>
// A chave é por obra: apagar projetos.campo_token desliga o link.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const sb = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const STATUS = ['a_fazer', 'em_andamento', 'concluida', 'congelada'];
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // America/Sao_Paulo
const isData = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const txt = (s: any, n = 2000) => (s == null ? null : String(s).slice(0, n));

async function projeto(db: any, p: string, k: string) {
  if (!p || !k) return null;
  const { data } = await db.from('projetos').select('id,nome,contemplado,contratante,cidade,uf,campo_token').eq('id', p).is('deleted_at', null).maybeSingle();
  if (!data || !data.campo_token || data.campo_token !== k) return null;
  return data;
}

async function diaId(db: any, projetoId: string, data: string) {
  const { data: d } = await db.from('diario_dias').select('id').eq('projeto_id', projetoId).eq('data', data).maybeSingle();
  if (d) return d.id;
  const { data: ins, error } = await db.from('diario_dias').insert({ projeto_id: projetoId, data, mood: '' }).select('id').single();
  if (error) {
    const { data: d2 } = await db.from('diario_dias').select('id').eq('projeto_id', projetoId).eq('data', data).maybeSingle();
    if (d2) return d2.id;
    throw error;
  }
  return ins.id;
}

async function marcar(db: any, projetoId: string, data: string, tarefaId: string) {
  const did = await diaId(db, projetoId, data);
  await db.from('diario_lancamentos').upsert({ diario_id: did, tarefa_id: tarefaId, marcada: true }, { onConflict: 'diario_id,tarefa_id' });
}

async function assinar(db: any, fotos: any[]) {
  const out = [];
  for (const f of fotos || []) {
    if (!f || !f.path) continue;
    const sg = await db.storage.from('anexos').createSignedUrl(f.path, 60 * 60 * 6);
    out.push({ ...f, url: sg.data && sg.data.signedUrl });
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = sb();
  try {
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json() : {};
    const p = String(body.p || url.searchParams.get('p') || '');
    const k = String(body.k || url.searchParams.get('k') || '');
    const pj = await projeto(db, p, k);
    if (!pj) return json({ error: 'link invalido ou desligado' }, 401);

    if (req.method === 'GET') {
      const data = isData(url.searchParams.get('d')) ? url.searchParams.get('d')! : hoje();
      const { data: grupos } = await db.from('grupos').select('id,nome,ordem').eq('projeto_id', pj.id).is('deleted_at', null).order('ordem');
      const { data: tarefas } = await db.from('tarefas')
        .select('id,grupo_id,nome,quantidade,unidade,tempo_atual,tempo_previsto,progresso,status,variacoes,notas,fotos,ordem,is_header,nivel,data_inicio_real,data_fim_real,updated_at')
        .eq('projeto_id', pj.id).is('deleted_at', null).order('ordem');
      const ts = [];
      for (const t of (tarefas || []).filter((t: any) => !t.is_header)) ts.push({ ...t, fotos: await assinar(db, t.fotos) });
      const { data: dia } = await db.from('diario_dias').select('id,data,campo,observacoes,mood').eq('projeto_id', pj.id).eq('data', data).maybeSingle();
      let hojeIds: string[] = [];
      if (dia) { const { data: ls } = await db.from('diario_lancamentos').select('tarefa_id').eq('diario_id', dia.id).eq('marcada', true); hojeIds = (ls || []).map((l: any) => l.tarefa_id); }
      return json({ projeto: { id: pj.id, nome: pj.nome, contemplado: pj.contemplado, contratante: pj.contratante, cidade: pj.cidade, uf: pj.uf }, grupos: grupos || [], tarefas: ts, dia: dia || null, hoje: hojeIds, data });
    }

    if (req.method !== 'POST') return json({ error: 'metodo invalido' }, 405);
    const action = body.action;
    const data = isData(body.data) ? body.data : hoje();

    if (action === 'tarefa') {
      const { data: t } = await db.from('tarefas').select('id,projeto_id,status,progresso,quantidade,variacoes,tempo_atual,data_inicio_real,data_fim_real').eq('id', body.id).is('deleted_at', null).maybeSingle();
      if (!t || t.projeto_id !== pj.id) return json({ error: 'tarefa nao encontrada' }, 404);
      const inp = body.patch || {};
      const patch: any = {};
      if (inp.status != null) { if (!STATUS.includes(inp.status)) return json({ error: 'status invalido' }, 400); patch.status = inp.status; }
      if (inp.progresso != null) patch.progresso = Math.max(0, Math.min(100, Math.round(Number(inp.progresso) || 0)));
      if (inp.quantidade != null) { const q = Number(inp.quantidade); if (!(q >= 0) || q > 100000) return json({ error: 'quantidade invalida' }, 400); patch.quantidade = q; }
      if (inp.variacao != null) {
        const v = Array.isArray(t.variacoes) ? t.variacoes[Number(inp.variacao)] : null;
        if (!v) return json({ error: 'condicao invalida' }, 400);
        patch.tempo_atual = Number(v[1]) || 0;
      }
      if (inp.notas !== undefined) patch.notas = txt(inp.notas);
      const st = patch.status || t.status;
      if (patch.status === 'concluida' && patch.progresso == null) patch.progresso = 100;
      if ((st === 'em_andamento' || st === 'concluida') && !t.data_inicio_real) patch.data_inicio_real = data;
      if (st === 'concluida' && !t.data_fim_real) patch.data_fim_real = data;
      if (patch.status && patch.status !== 'concluida' && t.data_fim_real) patch.data_fim_real = null;
      if (!Object.keys(patch).length) return json({ ok: true });
      const { data: up, error } = await db.from('tarefas').update(patch).eq('id', t.id).select('id,quantidade,tempo_atual,progresso,status,notas,data_inicio_real,data_fim_real').single();
      if (error) throw error;
      await marcar(db, pj.id, data, t.id);
      return json({ ok: true, tarefa: up });
    }

    if (action === 'foto') {
      const { data: t } = await db.from('tarefas').select('id,projeto_id,fotos').eq('id', body.id).is('deleted_at', null).maybeSingle();
      if (!t || t.projeto_id !== pj.id) return json({ error: 'tarefa nao encontrada' }, 404);
      const b64 = String(body.base64 || '').replace(/^data:[^,]+,/, '');
      if (!b64) return json({ error: 'sem imagem' }, 400);
      if (b64.length > 8_000_000) return json({ error: 'imagem grande demais' }, 413);
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const path = `campo/apontamento/${pj.id}/${t.id}/${Date.now()}.jpg`;
      const up = await db.storage.from('anexos').upload(path, bin, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw up.error;
      const fotos = (Array.isArray(t.fotos) ? t.fotos : []).concat([{ path, nome: 'campo ' + data, data, origem: 'apontamento' }]);
      const { error } = await db.from('tarefas').update({ fotos }).eq('id', t.id);
      if (error) throw error;
      await marcar(db, pj.id, data, t.id);
      return json({ ok: true, fotos: await assinar(db, fotos) });
    }

    if (action === 'dia') {
      const c = body.campo || {};
      const campo = {
        lider: txt(c.lider, 120), equipe: txt(c.equipe, 400), entrada: txt(c.entrada, 5), saida: txt(c.saida, 5),
        termostatos_em_caixa: txt(c.termostatos_em_caixa, 3), impedimentos: txt(c.impedimentos), resumo: txt(c.resumo),
      };
      const linhas = [
        campo.lider ? 'Líder: ' + campo.lider : '', campo.equipe ? 'Equipe: ' + campo.equipe : '',
        (campo.entrada || campo.saida) ? 'Horário: ' + (campo.entrada || '?') + '–' + (campo.saida || '?') : '',
        campo.termostatos_em_caixa ? 'Termostatos em caixa: ' + campo.termostatos_em_caixa : '',
        campo.impedimentos ? 'Impedimentos: ' + campo.impedimentos : '', campo.resumo ? 'Resumo: ' + campo.resumo : '',
      ].filter(Boolean);
      const did = await diaId(db, pj.id, data);
      const mood = campo.impedimentos ? 'warn' : '';
      const { error } = await db.from('diario_dias').update({ campo, observacoes: linhas.join('\n') || null, mood }).eq('id', did);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'acao invalida' }, 400);
  } catch (e: any) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
});
