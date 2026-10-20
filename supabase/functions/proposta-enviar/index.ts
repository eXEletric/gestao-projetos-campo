// eX Controller · proposta-enviar
// Envia pelo Resend a revisão PREPARADA da proposta (PDF congelado anexado) e registra tudo.
// Decisões do dono (14/09/2026): remetente ex@exeletric.com.br · ex@ sempre em cópia oculta ·
// respostas vão para ex@ (Outlook) E para o endereço de registro (grava na linha do tempo).
// Segredo necessário: RESEND_API_KEY (Supabase → Edge Functions → Secrets). Nunca no código do app.
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const FROM = "eX Eletric <ex@exeletric.com.br>";
const BCC = ["ex@exeletric.com.br"];
const REPLY_TO = ["ex@exeletric.com.br", "respostas@r.exeletric.com.br"];
const MAX_PDF = 15 * 1024 * 1024;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const emailOk = (s: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s);
const lista = (s: string | null) => String(s || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);

  const key = Deno.env.get("RESEND_API_KEY");
  const body = await req.json().catch(() => ({}));
  if (body?.ping) {
    // diag: confere se as chaves do Resend ainda valem (NUNCA devolve o valor da chave)
    let chaves: Record<string, unknown> | undefined;
    if (body?.diag) {
      const prova = async (k?: string) => {
        if (!k) return { configurada: false };
        const t = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${k}` } });
        const j: any = await t.json().catch(() => ({}));
        return { configurada: true, tamanho: k.length, prefixo_ok: k.startsWith("re_"), valida: t.ok, status: t.status, motivo: t.ok ? null : (j?.message || t.statusText) };
      };
      // que TIPO de valor foi colado em cada segredo (sem mostrar o valor)
      const tipo = (k?: string) => !k ? "vazio"
        : k.startsWith("re_") ? "chave do Resend (re_)"
        : k.startsWith("whsec_") ? "segredo de webhook (whsec_)"
        : k.startsWith("eyJ") ? "token JWT (eyJ)"
        : k.startsWith("sb_") ? "chave do Supabase (sb_)"
        : "outro";
      const wh = Deno.env.get("RESEND_WEBHOOK_SECRET");
      chaves = {
        envio: { ...await prova(key), tipo: tipo(key) },
        leitura: { ...await prova(Deno.env.get("RESEND_READ_KEY")), tipo: tipo(Deno.env.get("RESEND_READ_KEY")) },
        webhook: { configurada: !!wh, tamanho: wh?.length || 0, tipo: tipo(wh) },
      };
    }
    return json({ ready: !!key, from: FROM, bcc: BCC, reply_to: REPLY_TO, chaves });
  }
  if (!key) return json({ error: "O envio pelo sistema ainda não foi configurado (falta a chave do Resend)." }, 503);

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") || "";
  const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await userDb.auth.getUser();
  if (!u?.user) return json({ error: "Sessão expirada: entre de novo no app." }, 401);

  const versaoId = String(body?.versao_id || "");
  if (!versaoId) return json({ error: "versao_id obrigatório" }, 400);
  // lida com o token do usuário: a RLS garante que ele só envia proposta da própria empresa
  const { data: v, error: ve } = await userDb.from("orcamento_versoes").select("*").eq("id", versaoId).maybeSingle();
  if (ve || !v) return json({ error: "Revisão não encontrada ou sem acesso." }, 404);
  if (v.status !== "preparada") return json({ error: `A R${v.revisao} não está pronta para envio (status: ${v.status}).` }, 409);

  const para = lista(v.para), cc = lista(v.cc);
  if (!para.length || !para.every(emailOk) || !cc.every(emailOk)) return json({ error: "E-mail de destino inválido." }, 400);
  if (!v.pdf_path || !String(v.pdf_path).startsWith("anexos:")) return json({ error: "PDF da revisão não encontrado." }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const pdfPath = String(v.pdf_path).slice(7);
  const { data: pdf, error: pe } = await admin.storage.from("anexos").download(pdfPath);
  if (pe || !pdf) return json({ error: "Não consegui ler o PDF congelado." }, 500);
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  if (bytes.length > MAX_PDF) return json({ error: "PDF grande demais para e-mail." }, 400);
  const pdfNome = `${v.codigo || v.numero}_R${v.revisao}.pdf`;

  const corpo = String(v.corpo || "");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a18">${escHtml(corpo).replace(/\n/g, "<br>")}</div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `versao-${v.id}` },
    body: JSON.stringify({
      from: FROM, to: para, cc: cc.length ? cc : undefined, bcc: BCC, reply_to: REPLY_TO,
      subject: v.assunto, text: corpo, html,
      attachments: [{ filename: pdfNome, content: encodeBase64(bytes) }],
      headers: { "X-eX-Proposta": `${v.codigo || v.numero} R${v.revisao}` },
      tags: [{ name: "tipo", value: "proposta" }, { name: "versao", value: v.id }],
    }),
  });
  const rj = await r.json().catch(() => ({}));
  if (!r.ok || !rj?.id) {
    const invalida = r.status === 401 || r.status === 403 || /api key/i.test(String(rj?.message || ""));
    const msg = invalida
      ? "A chave do Resend nao vale mais (apagada, trocada ou sem permissao de envio). Gere uma chave nova em resend.com/api-keys (acesso de envio) e salve em Supabase -> Edge Functions -> Secrets, no RESEND_API_KEY."
      : `O Resend recusou o envio: ${rj?.message || r.statusText}`;
    return json({ error: msg, detalhe: rj }, 502);
  }

  // a partir daqui o e-mail SAIU: registra (se algo falhar, devolve ok com aviso para não reenviar)
  const avisos: string[] = [];
  const nome = String(body?.usuario_nome || u.user.email || "");
  const up = await admin.from("orcamento_versoes").update({ status: "enviada" }).eq("id", v.id).eq("status", "preparada").select("enviado_em").maybeSingle();
  if (up.error) avisos.push("status da revisão: " + up.error.message);
  const sub = await admin.from("orcamento_versoes").update({ status: "substituida" }).eq("orcamento_id", v.orcamento_id).eq("status", "enviada").lt("revisao", v.revisao);
  if (sub.error) avisos.push("revisões anteriores: " + sub.error.message);

  const anexos = [{ nome: pdfNome, path: "anexos:" + pdfPath, tipo: "application/pdf", tamanho: bytes.length }];
  const msg2 = await admin.from("email_mensagens").insert({
    empresa_id: v.empresa_id, direcao: "saida", provedor_id: rj.id, de: FROM, para, cc, bcc: BCC, reply_to: REPLY_TO,
    assunto: v.assunto, texto: corpo, anexos, orcamento_id: v.orcamento_id, oportunidade_id: v.oportunidade_id,
    versao_id: v.id, revisao: v.revisao, vinculo: "envio", entrega: "enviado",
  }).select("id").single();
  if (msg2.error) avisos.push("registro do e-mail: " + msg2.error.message);

  const ev = await admin.from("orcamento_eventos").insert({
    empresa_id: v.empresa_id, orcamento_id: v.orcamento_id, oportunidade_id: v.oportunidade_id, versao_id: v.id, revisao: v.revisao,
    tipo: "envio", canal: "sistema", titulo: `R${v.revisao} enviada pelo sistema para ${para.join(", ")}`,
    texto: v.assunto, mensagem_id: msg2.data?.id || null, anexos, criado_por: u.user.id, criado_por_nome: nome,
  });
  if (ev.error) avisos.push("linha do tempo: " + ev.error.message);

  return json({ ok: true, email_id: rj.id, enviado_em: up.data?.enviado_em || new Date().toISOString(), avisos });
});
