// eX Controller · email-entrada (webhook do Resend)
// 1) email.received: resposta que chegou em respostas@r.exeletric.com.br → liga à proposta certa
//    (cabeçalhos da conversa → código [ORÇ-… Rn] no assunto → remetente) → grava e-mail + anexos +
//    evento na linha do tempo com SUGESTÃO de classificação. Nunca aprova sozinho (decisão do dono).
// 2) email.delivered / bounced / complained / delivery_delayed: atualiza a entrega do e-mail que saiu.
// Segredos: RESEND_API_KEY (ler o e-mail recebido) e RESEND_WEBHOOK_SECRET (assinatura do webhook).
// verify_jwt = false: quem chama é o Resend; a autenticação é a assinatura (svix) conferida abaixo.
import { createClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";

const DOMINIO_EX = "exeletric.com.br";
const MAX_ANEXO = 15 * 1024 * 1024;
const ok = (b: unknown = { ok: true }) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
const fail = (msg: string, s: number) => new Response(JSON.stringify({ error: msg }), { status: s, headers: { "Content-Type": "application/json" } });

async function assinaturaValida(raw: string, h: Headers, segredo: string): Promise<boolean> {
  const id = h.get("svix-id"), ts = h.get("svix-timestamp"), sig = h.get("svix-signature");
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;          // 5 min de tolerância
  const chave = decodeBase64(segredo.replace(/^whsec_/, ""));
  const k = await crypto.subtle.importKey("raw", chave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = encodeBase64(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${id}.${ts}.${raw}`))));
  return sig.split(" ").some((p) => {
    const [ver, val] = p.split(",");
    if (ver !== "v1" || !val || val.length !== mac.length) return false;
    let d = 0; for (let i = 0; i < mac.length; i++) d |= mac.charCodeAt(i) ^ val.charCodeAt(i);
    return d === 0;
  });
}

const emailDe = (s: string) => (String(s || "").match(/<([^>]+)>/)?.[1] || String(s || "")).trim().toLowerCase();
const nomeDe = (s: string) => (String(s || "").match(/^\s*"?([^"<]+?)"?\s*</)?.[1] || emailDe(s)).trim();
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function htmlParaTexto(html: string): string {
  let h = String(html || "");
  if (h.startsWith("data:")) { const b = h.split(",")[1] || ""; try { h = new TextDecoder().decode(decodeBase64(b)); } catch { h = ""; } }
  return h.replace(/<(br|\/p|\/div|\/tr|\/li)[^>]*>/gi, "\n").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();
}
// só a parte nova da mensagem (tira o histórico citado)
function parteNova(t: string): string {
  const linhas = String(t || "").split(/\r?\n/), out: string[] = [];
  for (const l of linhas) {
    const s = l.trim();
    if (/(escreveu|wrote):$/i.test(s) || /^(em .+ escreveu:|on .+ wrote:|-{2,}\s*(mensagem original|original message|forwarded message|mensagem encaminhada)|de:\s|from:\s|enviado:\s|sent:\s|_{5,})/i.test(s)) break;
    if (s.startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n").trim();
}
// regras testadas em 15 casos reais de redação (14/09): "proposta revisada" ≠ pedido de ajuste; "sem alterações" não conta
const RE_RECUSA = /(nao (vamos|iremos|podemos|conseguiremos) (seguir|fechar|contratar|prosseguir|aprovar)|recusad|declinad|optamos por outr|fechamos com outr|nao (foi )?aprovad|sem verba|cancelad)/;
const RE_APROV = /(aprovad|aprovamos|pode seguir|podem seguir|pode prosseguir|de acordo|autorizad|autorizamos|pode (dar )?inicio|podem iniciar|pedido de compra|ordem de compra|\bpo\b|segue (o )?pedido|esta fechado|pode fechar)/;
const RE_AJUSTE = /(retir(ar|e|em|ada)\b|remov(er|a|am)\b|exclu(ir|a|am)\b|inclu(ir|a|am)\b|alter(ar|e|em)\b|alteracao (no|na|do|da|de)|ajust(ar|e|em)\b|favor revisar|podem revisar|revisem|rever o|nova versao|desconto|reduz(ir|a|am)\b|mud(ar|e|em)\b|troc(ar|a)\b|troque|substitu(ir|a|am)\b|mais barat|valor (esta |ficou )?alto|diminu(ir|a|am)\b|conseguem|melhorar o (valor|preco|prazo))/;
function sugerir(texto: string, inteiro = false): { s: string | null; m: string | null } {
  const t = semAcento(inteiro ? texto : parteNova(texto)).replace(/sem (nenhuma )?(alteracao|alteracoes|ajuste|ajustes|mudanca|mudancas)/g, "");
  const recusa = RE_RECUSA.test(t), aprov = RE_APROV.test(t), ajuste = RE_AJUSTE.test(t);
  if (recusa) return { s: "recusa", m: "fala em não seguir / recusa" };
  if (aprov && ajuste) return { s: "ajuste", m: 'tem "aprovado", mas também pede alteração: confira' };
  if (aprov) return { s: "aprovacao", m: 'palavras de aprovação ("aprovado", "pode seguir"…)' };
  if (ajuste) return { s: "ajuste", m: "pede alteração na proposta" };
  if (t.includes("?")) return { s: "duvida", m: "tem pergunta" };
  return { s: null, m: null };
}
const cabecalho = (hs: Record<string, unknown> | null, nome: string) => {
  if (!hs) return "";
  const k = Object.keys(hs).find((x) => x.toLowerCase() === nome);
  const v = k ? hs[k] : ""; return Array.isArray(v) ? v.join(" ") : String(v || "");
};
const safe = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 120) || "anexo";

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("método não permitido", 405);
  const segredo = Deno.env.get("RESEND_WEBHOOK_SECRET"), key = Deno.env.get("RESEND_API_KEY");
  if (!segredo || !key) return fail("webhook ainda não configurado", 503);
  const raw = await req.text();
  if (!(await assinaturaValida(raw, req.headers, segredo))) return fail("assinatura inválida", 401);
  const ev = JSON.parse(raw); const d = ev?.data || {};
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  /* ---------- entrega do que saiu ---------- */
  const ENTREGA: Record<string, string> = { "email.delivered": "entregue", "email.bounced": "devolvido", "email.complained": "reclamacao", "email.delivery_delayed": "atrasado" };
  if (ENTREGA[ev.type]) {
    const { data: m } = await db.from("email_mensagens").update({ entrega: ENTREGA[ev.type], entrega_em: new Date().toISOString() })
      .eq("provedor_id", d.email_id).eq("direcao", "saida").select("id,empresa_id,orcamento_id,oportunidade_id,versao_id,revisao,para").maybeSingle();
    if (m && m.orcamento_id && (ev.type === "email.bounced" || ev.type === "email.complained")) {
      await db.from("orcamento_eventos").insert({ empresa_id: m.empresa_id, orcamento_id: m.orcamento_id, oportunidade_id: m.oportunidade_id,
        versao_id: m.versao_id, revisao: m.revisao, tipo: "entrega", canal: "sistema", mensagem_id: m.id,
        titulo: ev.type === "email.bounced" ? `E-mail da R${m.revisao} DEVOLVIDO: não chegou em ${(m.para || []).join(", ")}` : `Destinatário marcou o e-mail da R${m.revisao} como spam`,
        criado_por_nome: "sistema" });
    }
    return ok();
  }
  if (ev.type !== "email.received") return ok({ ignorado: ev.type });

  /* ---------- e-mail recebido ---------- */
  const { data: ja } = await db.from("email_mensagens").select("id").eq("provedor_id", d.email_id).eq("direcao", "entrada").maybeSingle();
  if (ja) return ok({ repetido: true });                                   // webhook reenviado: não duplica

  const H = { Authorization: `Bearer ${key}` };
  const fr = await fetch(`https://api.resend.com/emails/receiving/${d.email_id}`, { headers: H });
  if (!fr.ok) return fail("não consegui ler o e-mail recebido", 502);      // Resend tenta de novo
  const e = await fr.json();
  const hs = (e.headers || null) as Record<string, unknown> | null;
  const inReplyTo = cabecalho(hs, "in-reply-to"), refs = cabecalho(hs, "references");
  const assunto = String(e.subject || d.subject || "");
  const texto = String(e.text || "") || htmlParaTexto(e.html || "");
  const de = String(e.from || d.from || ""), deEmail = emailDe(de);
  const daEx = deEmail.endsWith("@" + DOMINIO_EX);
  const encaminhado = daEx && /^\s*(enc|fwd?|fw|encaminhad[ao])\s*:/i.test(assunto);

  // ---- vínculo com a proposta ----
  type Alvo = { orcamento_id: string; oportunidade_id: string | null; empresa_id: string | null; versao_id: string | null; revisao: number | null; vinculo: string };
  let alvo: Alvo | null = null;
  const ids = `${inReplyTo} ${refs}`.match(/<[^>]+>/g) || [];
  if (ids.length) {
    const { data } = await db.from("email_mensagens").select("orcamento_id,oportunidade_id,empresa_id,versao_id,revisao").in("message_id", ids).not("orcamento_id", "is", null).order("ocorrido_em", { ascending: false }).limit(1);
    if (data?.length) alvo = { ...data[0], vinculo: "cabecalho" };
  }
  if (!alvo) {
    const tag = assunto.match(/\[\s*(OR[CÇ]-[0-9]{4}-[0-9]{3,6}(?:-[A-Z0-9]+)*)\s+R([0-9]+)\s*\]/i);
    if (tag) {
      const cod = tag[1].toUpperCase(), variantes = [cod, cod.replace(/^ORC/, "ORÇ"), cod.replace(/^ORÇ/, "ORC")];
      const { data } = await db.from("orcamento_versoes").select("id,orcamento_id,oportunidade_id,empresa_id,revisao,status")
        .in("codigo", variantes).eq("revisao", Number(tag[2])).neq("status", "descartada").is("deleted_at", null).limit(1);
      if (data?.length) alvo = { orcamento_id: data[0].orcamento_id, oportunidade_id: data[0].oportunidade_id, empresa_id: data[0].empresa_id, versao_id: data[0].id, revisao: data[0].revisao, vinculo: "tag" };
    }
  }
  if (!alvo && !daEx && deEmail) {
    const { data } = await db.from("orcamento_versoes").select("id,orcamento_id,oportunidade_id,empresa_id,revisao")
      .in("status", ["enviada", "aprovada"]).ilike("para", `%${deEmail}%`).is("deleted_at", null).order("enviado_em", { ascending: false }).limit(1);
    if (data?.length) alvo = { orcamento_id: data[0].orcamento_id, oportunidade_id: data[0].oportunidade_id, empresa_id: data[0].empresa_id, versao_id: data[0].id, revisao: data[0].revisao, vinculo: "remetente" };
  }

  // ---- grava o e-mail ----
  const { data: msg, error: me } = await db.from("email_mensagens").insert({
    empresa_id: alvo?.empresa_id || null, direcao: "entrada", provedor_id: d.email_id, message_id: e.message_id || d.message_id || null,
    in_reply_to: inReplyTo || null, referencias: refs || null, de, para: e.to || d.to || [], cc: e.cc || d.cc || [], reply_to: e.reply_to || [],
    assunto, texto, html: e.html && !String(e.html).startsWith("data:") ? e.html : null,
    orcamento_id: alvo?.orcamento_id || null, oportunidade_id: alvo?.oportunidade_id || null, versao_id: alvo?.versao_id || null,
    revisao: alvo?.revisao || null, vinculo: alvo?.vinculo || "nenhum", ocorrido_em: e.created_at || d.created_at || new Date().toISOString(), bruto: ev,
  }).select("id").single();
  if (me) return me.code === "23505" ? ok({ repetido: true }) : fail("erro ao gravar: " + me.message, 500);

  // ---- anexos (para o bucket privado) ----
  const anexos: { nome: string; path: string; tipo: string; tamanho: number }[] = [];
  try {
    const la = await fetch(`https://api.resend.com/emails/receiving/${d.email_id}/attachments`, { headers: H });
    const lj = la.ok ? await la.json() : { data: [] };
    for (const a of (lj.data || [])) {
      if (!a.download_url || (a.size && a.size > MAX_ANEXO)) continue;
      const bin = await fetch(a.download_url); if (!bin.ok) continue;
      const blob = await bin.blob(); if (blob.size > MAX_ANEXO) continue;
      const path = `emails/${alvo?.orcamento_id || "sem-vinculo"}/${msg.id}/${safe(a.filename || "anexo")}`;
      const up = await db.storage.from("anexos").upload(path, blob, { upsert: true, contentType: a.content_type || "application/octet-stream" });
      if (!up.error) anexos.push({ nome: a.filename || "anexo", path: "anexos:" + path, tipo: a.content_type || "", tamanho: blob.size });
    }
    if (anexos.length) await db.from("email_mensagens").update({ anexos }).eq("id", msg.id);
  } catch (_) { /* anexo é complemento: o e-mail já está gravado */ }

  // ---- linha do tempo ----
  if (alvo) {
    const cliente = !daEx || encaminhado;
    const sg = cliente ? sugerir(texto, encaminhado) : { s: null, m: null };
    await db.from("orcamento_eventos").insert({
      empresa_id: alvo.empresa_id, orcamento_id: alvo.orcamento_id, oportunidade_id: alvo.oportunidade_id, versao_id: alvo.versao_id, revisao: alvo.revisao,
      tipo: cliente ? "email_cliente" : "email_ex", canal: encaminhado ? "e-mail (encaminhado)" : "e-mail",
      titulo: cliente ? `Resposta de ${encaminhado ? "cliente (encaminhada por " + nomeDe(de) + ")" : nomeDe(de)}` : `${nomeDe(de)} respondeu ao cliente`,
      texto: (encaminhado ? texto : (parteNova(texto) || texto)).slice(0, 4000), sugestao: sg.s, sugestao_motivo: sg.m,
      mensagem_id: msg.id, anexos, criado_por_nome: "sistema (e-mail)", ocorrido_em: e.created_at || new Date().toISOString(),
    });
  }
  return ok({ gravado: msg.id, vinculo: alvo?.vinculo || "nenhum" });
});
