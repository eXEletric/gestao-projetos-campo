/* ============================================================================
   eX_Envio.js — ENVIO DA PROPOSTA POR E-MAIL + REVISÕES CONGELADAS (passo 1)
   Plugado no eX_Orcamento.html por <script src="eX_Envio.js"> (depois do script principal).
   Decisões ratificadas pelo dono em 11/09/2026 (fluxo eX_Fluxo_Envio_Proposta.html):
   - UM botão "Enviar proposta": checagem → tela de envio → congela a revisão Rn → PDF → e-mail → confirma.
   - Enviou = imutável (tabela orcamento_versoes + trigger). Mexer depois = criar R(n+1).
   - TAG [código Rn] no assunto; responsável em cópia. Canal agora = e-mail do próprio usuário.
   - Lote (mestra/unidades): envio em conjunto é o próximo passo — aqui não aparece.
   Usa os globais da folha: S, OPP, ORC_ID, SB, CLOUD, EMPRESA_ID, USER_NOME, EMP, BLKS, blocoAtivo,
   recalc, pushOrc, renderBanner, setMode, save, esc, fmt, num, hoje, proximoNumero, updateCodigoFull…
   ============================================================================ */
(function(){
'use strict';
if(typeof renderBanner!=='function' || typeof setMode!=='function') return;   // folha não é a do orçamento

const ENV={ versoes:[], carregado:false, carregando:false, prep:null, checks:[] };
window.EXENV=ENV;
const H2P_SRC='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
const CANAIS={
  gmail:{nome:'Gmail',ic:'mail'},
  outlook:{nome:'Outlook / Hotmail',ic:'alternate_email'},
  app:{nome:'App de e-mail do computador',ic:'desktop_windows'}
};

/* ---------- utilidades ---------- */
const $=id=>document.getElementById(id);
const br=iso=>iso?String(iso).slice(0,10).split('-').reverse().join('/'):'';
const brDH=ts=>{ if(!ts)return''; const d=new Date(ts); const p=n=>String(n).padStart(2,'0'); return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes()); };
const emailOk=s=>/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(s||'').trim());
const listaEmails=s=>String(s||'').split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean);
const ms=(i,st)=>`<span class="material-symbols-rounded"${st?` style="${st}"`:''}>${i}</span>`;
const safeKey=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9_.-]+/g,'-');
function codigoFull(){ let c=S.numero||''; if(S.ofertaSigla){ c+='-'+S.ofertaSigla; if(S.ofertaSeq) c+='-'+String(S.ofertaSeq).padStart(2,'0'); } return c; }
function ehLote(){ try{ return (typeof isLoteUnit==='function'&&isLoteUnit())||(typeof isLoteBase==='function'&&isLoteBase()); }catch(e){ return false; } }
function aprovada(){ return !!(S&&(S.comprovantes||[]).length); }
function toast(t){ let el=$('envToast'); if(!el){ el=document.createElement('div'); el.id='envToast'; document.body.appendChild(el); } el.innerHTML=t; el.classList.add('on'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('on'),5200); }

/* ---------- revisões ---------- */
async function carregarVersoes(){
  if(!(CLOUD&&ORC_ID&&SB)){ ENV.versoes=[]; ENV.carregado=true; return; }
  ENV.carregando=true;
  try{ const {data,error}=await SB.from('orcamento_versoes').select('id,revisao,status,total,codigo,para,cc,assunto,corpo,pdf_path,preparado_em,preparado_por_nome,enviado_em').eq('orcamento_id',ORC_ID).is('deleted_at',null).order('revisao',{ascending:true}).order('preparado_em',{ascending:true});
    if(error) throw error; ENV.versoes=data||[];
  }catch(e){ console.error('versoes',e); }
  ENV.carregando=false; ENV.carregado=true;
}
const vivas=()=>ENV.versoes.filter(v=>v.status!=='descartada');
function maxRev(){ return vivas().reduce((m,v)=>Math.max(m,v.revisao),0); }
function revTrab(){ const mr=maxRev(); let r=parseInt(S&&S.envioRev)||0; if(r<mr) r=mr; return r||1; }   // revisão em trabalho (a que vai/foi enviada)
function vAtual(){ const r=revTrab(); return vivas().find(v=>v.revisao===r)||null; }
function ultimaEnviada(){ return vivas().filter(v=>['enviada','aprovada','substituida'].includes(v.status)).sort((a,b)=>b.revisao-a.revisao)[0]||null; }
function travada(){ if(!S)return false; if(aprovada())return true; const v=vAtual(); return !!v && v.status!=='descartada'; }   // preparada/enviada/aprovada → não edita

/* ---------- ganchos na folha (sem editar o arquivo principal) ---------- */
const _renderBanner=window.renderBanner, _setMode=window.setMode, _save=window.save;
window.renderBanner=function(){ _renderBanner.apply(this,arguments); try{ decorar(); }catch(e){ console.error('envio banner',e); } };
window.setMode=function(m){
  if(m==='edit' && travada()){ _setMode('view'); avisoTravada(); return; }
  _setMode(m);
};
let _avisoSave=0;
window.save=function(){
  if(travada()){ if(Date.now()-_avisoSave>4000){ _avisoSave=Date.now(); toast('Esta revisão já foi <b>enviada</b> e está travada. Para alterar, crie a próxima revisão.'); } return; }
  return _save.apply(this,arguments);
};

/* ---------- banner: status + botão único ---------- */
function decorar(){
  const box=document.querySelector('#oppBanner .ob-st'); if(!box||!S) return;
  if(CLOUD && ORC_ID && !ENV.carregado && !ENV.carregando){
    carregarVersoes().then(()=>{ if(S && S.envioRev==null && maxRev()) S.envioRev=maxRev(); window.renderBanner(); if(travada()) _setMode('view'); });
  }
  const n=revTrab(), v=vAtual(), ult=ultimaEnviada(), hist=ENV.versoes.length;
  let h='';
  if(aprovada()){
    h+=`<span class="obst-aprov">${ms('verified')}Aprovada${ult?' · R'+ult.revisao:''}</span>`;
  } else if(v && v.status==='preparada'){
    h+=`<span class="envchip warn">${ms('pending')}R${n} preparada · falta confirmar o envio</span>`;
    h+=`<button class="envbtn pri" onclick="EXENV.retomar()">${ms('forward_to_inbox')}Concluir envio</button>`;
  } else if(v && ['enviada','aprovada','substituida'].includes(v.status)){
    h+=`<span class="envchip sent">${ms('mark_email_read')}Enviada · R${n} · ${br(v.enviado_em)}${v.para?' · p/ '+esc(listaEmails(v.para)[0]):''}</span>`;
    h+=`<button class="envbtn" onclick="EXENV.criarRevisao()">${ms('edit_document')}Criar R${n+1}</button>`;
  } else {
    if(ult) h+=`<span class="envchip">${ms('edit_note')}R${n} em edição · R${ult.revisao} enviada ${br(ult.enviado_em)}</span>`;
    else if(S.status==='enviado') h+=`<span class="envchip" title="Foi marcada como enviada antes do registro de versões — nada foi congelado.">${ms('info')}marcada como enviada (sem registro)</span>`;
    if(ehLote()) h+=`<span class="envchip">${ms('inventory_2')}Lote: envio em conjunto (próximo passo)</span>`;
    else h+=`<button class="envbtn pri" ${CLOUD?'':'disabled title="Entre no app (login) para enviar"'} onclick="EXENV.abrirEnvio()">${ms('send')}Enviar ${n>1?'R'+n:'proposta'}</button>`;
  }
  if(hist) h+=`<button class="envbtn ghost" onclick="EXENV.historico()" title="Revisões enviadas">${ms('history')}${hist}</button>`;
  box.innerHTML=h;
}

/* ---------- modal ---------- */
function modal(html,wide){ let ov=$('envOv'); if(!ov){ ov=document.createElement('div'); ov.id='envOv'; document.body.appendChild(ov); }
  ov.innerHTML=`<div class="envbox${wide?' wide':''}">${html}</div>`; ov.classList.add('on'); }
function fechar(){ const ov=$('envOv'); if(ov){ ov.classList.remove('on'); ov.innerHTML=''; } }

function avisoTravada(){
  if(aprovada()){ modal(`<div class="envh">${ms('verified')}Proposta aprovada</div><p class="envp">A proposta foi <b>aprovada</b> e está congelada: é o que a execução vai herdar. Não aceita mais revisão.</p><div class="envact"><button class="envbtn pri" onclick="EXENV.fechar()">Entendi</button></div>`); return; }
  const v=vAtual(), n=revTrab();
  if(v && v.status==='preparada'){ retomar(); return; }
  modal(`<div class="envh">${ms('lock')}R${n} já foi enviada</div>
    <p class="envp">O que o cliente recebeu fica guardado exatamente como foi enviado${v&&v.enviado_em?' em <b>'+br(v.enviado_em)+'</b>':''}. Para alterar, crie a <b>R${n+1}</b>: ela nasce como cópia da R${n}, e a R${n} continua intacta no histórico.</p>
    <div class="envact"><button class="envbtn" onclick="EXENV.fechar()">Só ver</button><button class="envbtn pri" onclick="EXENV.criarRevisao(true)">${ms('edit_document')}Criar R${n+1}</button></div>`);
}

/* ---------- 1) checagem pré-envio ---------- */
async function checar(){
  const L=[]; try{ recalc(); }catch(e){}
  if(!(CLOUD&&ORC_ID)) L.push({ok:false,t:'Proposta salva na nuvem',d:'Entre no app (login) e salve a proposta antes de enviar.'});
  let numOk=!!S.numero, numMsg=codigoFull();
  if(numOk && CLOUD){ try{ const {data}=await SB.from('orcamentos').select('id').eq('numero',S.numero).neq('id',ORC_ID||'00000000-0000-0000-0000-000000000000').is('deleted_at',null).limit(1); if(data&&data.length){ numOk=false; numMsg=S.numero+' já é usado por outra proposta'; } }catch(e){} }
  if(!S.numero) numMsg='proposta sem número';
  L.push({ok:numOk,t:'Número único',d:numMsg,fix:numOk?null:['Gerar número novo','renumerar']});
  const vOk=!!S.validadeISO && S.validadeISO>=hoje();
  L.push({ok:vOk,t:'Validade no futuro',d:S.validadeISO?('até '+br(S.validadeISO)+(vOk?'':' (vencida)')):'sem validade',data:!vOk});
  const tot=num(S._total)||0;
  L.push({ok:tot>0,t:'Total maior que zero',d:fmt(tot)});
  const vaz=(typeof BLKS!=='undefined'?BLKS:[]).filter(b=>blocoAtivo(b.key) && !(S[b.key]||[]).some(r=>r&&String(r.desc||'').trim()) && !(b.key==='despesas' && typeof diariasCusto==='function' && diariasCusto()>0));
  L.push({ok:!vaz.length,t:'Nenhum bloco ligado vazio',d:vaz.length?(vaz.map(b=>b.titulo).join(', ')+' sem itens'):'tudo certo',fix:vaz.length?['Desligar os vazios','desligarVazios']:null});
  L.push({ok:!!String(S.finNome||'').trim(),t:'Cliente final / loja',d:String(S.finNome||'').trim()||'não preenchido: escolha a loja na proposta'});
  L.push({ok:!!String(S.respNome||'').trim(),t:'Responsável comercial',d:S.respNome?(S.respNome+(emailOk(S.respEmail)?' · vai em cópia':' · sem e-mail, não vai em cópia')):'não definido'});
  if(aprovada()) L.push({ok:false,t:'Proposta ainda não aprovada',d:'Aprovada não aceita novo envio.'});
  ENV.checks=L; return L;
}
function assuntoPadrao(n){ return `[${codigoFull()} R${n}] Proposta · ${S.cliNome||''}${S.finNome?' — '+S.finNome:''}`; }
function corpoPadrao(n){
  const nome=(String(S.cliContato||'').trim().split(/\s+/)[0])||'';
  const sol=[S.solTitulo,S.finNome].filter(x=>String(x||'').trim()).join(' — ');
  const L=[nome?`Olá, ${nome},`:'Olá,',''];
  L.push(n>1?`Segue a revisão R${n} da nossa proposta ${codigoFull()}${sol?' — '+sol:''}, conforme conversamos.`:`Segue em anexo a nossa proposta ${codigoFull()}${sol?' — '+sol:''}.`);
  L.push('',`Valor total: ${fmt(num(S._total)||0)}`);
  if(S.validadeISO) L.push(`Validade da proposta: ${br(S.validadeISO)}`);
  L.push('','Fico à disposição para qualquer ajuste ou dúvida.','','Atenciosamente,',S.respNome||USER_NOME||'');
  const c=[S.respFone,S.respEmail].filter(Boolean).join(' · '); if(c) L.push(c);
  L.push((typeof EMP!=='undefined'&&EMP&&EMP.nome)?EMP.nome:'eX Eletric');
  return L.join('\n');
}
function canalSalvo(){ try{ return localStorage.getItem('ex_envio_canal')||'gmail'; }catch(e){ return 'gmail'; } }

async function abrirEnvio(){
  if(!ENV.carregado){ await carregarVersoes(); if(S.envioRev==null && maxRev()) S.envioRev=maxRev(); window.renderBanner(); }
  if(travada()){ avisoTravada(); return; }
  if(ehLote()){ toast('Proposta de <b>lote</b>: o envio em conjunto é o próximo passo.'); return; }
  modal(`<div class="envh">${ms('hourglass_top')}Conferindo a proposta…</div>`);
  const L=await checar(); const n=revTrab();
  const form=ENV._form||{ para:S.cliEmail||'', cc:emailOk(S.respEmail)?S.respEmail:'', assunto:assuntoPadrao(n), corpo:corpoPadrao(n), canal:canalSalvo() };
  ENV._form=form; renderEnvio(L,n);
}
function renderEnvio(L,n){
  const f=ENV._form, rows=L.map((c,i)=>`<div class="envck ${c.ok?'ok':'no'}">${ms(c.ok?'check_circle':'error')}<div class="envck-b"><b>${esc(c.t)}</b><span>${esc(c.d)}</span>
      ${c.data?`<input type="date" class="envin sm" value="${esc(S.validadeISO||'')}" onchange="EXENV.fixValidade(this.value)">`:''}
      ${c.fix?`<button class="envbtn sm" onclick="EXENV.fix('${c.fix[1]}')">${esc(c.fix[0])}</button>`:''}</div></div>`).join('');
  const paraOk=listaEmails(f.para).length>0 && listaEmails(f.para).every(emailOk);
  const ccOk=listaEmails(f.cc).every(emailOk);
  const tudo=L.every(c=>c.ok) && paraOk && ccOk;
  modal(`<div class="envh">${ms('send')}Enviar ${n>1?'a revisão R'+n:'a proposta'} · <span class="envcod">${esc(codigoFull())} R${n}</span><button class="envx" onclick="EXENV.fechar()" title="Fechar">${ms('close')}</button></div>
    <div class="envgrid">
      <div>
        <div class="envsec">${ms('fact_check')}Checagem antes de enviar</div>
        ${rows}
        <div id="envCkMail">${ckMailHtml()}</div>
        ${(typeof DIRTY!=='undefined'&&DIRTY)?`<div class="envinfo">${ms('info')}Há alterações não salvas: elas serão salvas junto com o envio.</div>`:''}
      </div>
      <div>
        <div class="envsec">${ms('mail')}E-mail</div>
        <label class="envlb">Para</label><input id="envPara" class="envin ${paraOk?'':'bad'}" value="${esc(f.para)}" oninput="EXENV.setF('para',this.value)" placeholder="email@cliente.com">
        <label class="envlb">Cópia (CC)</label><input id="envCc" class="envin ${ccOk?'':'bad'}" value="${esc(f.cc)}" oninput="EXENV.setF('cc',this.value)" placeholder="responsável e outros, separados por vírgula">
        <label class="envlb">Assunto <span class="envhint">o código entre colchetes amarra as respostas a esta proposta</span></label><input class="envin" value="${esc(f.assunto)}" oninput="EXENV.setF('assunto',this.value)">
        <label class="envlb">Mensagem</label><textarea class="envin ta" oninput="EXENV.setF('corpo',this.value)">${esc(f.corpo)}</textarea>
        <div class="envatt">${ms('picture_as_pdf')}Anexo: <b>${esc(codigoFull())}_R${n}.pdf</b> <span class="envhint">gerado da versão congelada</span></div>
      </div>
    </div>
    <div class="envact"><span class="envhint" id="envPrepHint" style="margin-right:auto">${tudo?'Ao preparar: congela a R'+n+', gera e guarda o PDF. O envio só conta depois que você confirmar.':'Resolva os itens em vermelho para liberar o envio.'}</span>
      <button class="envbtn" onclick="EXENV.fechar()">Cancelar</button>
      <button class="envbtn pri" id="envPrepBtn" ${tudo?'':'disabled'} onclick="EXENV.preparar()">${ms('lock')}Congelar R${n} e gerar PDF</button></div>`,true);
}
function formOk(){ const f=ENV._form||{}; const p=listaEmails(f.para); return { para:p.length>0&&p.every(emailOk), cc:listaEmails(f.cc).every(emailOk) }; }
function ckMailHtml(){ const f=ENV._form||{}, ok=formOk().para;
  return `<div class="envck ${ok?'ok':'no'}">${ms(ok?'check_circle':'error')}<div class="envck-b"><b>E-mail do cliente</b><span>${ok?esc(f.para):(f.para?'e-mail inválido no campo Para':'sem e-mail: digite ao lado (e cadastre no CRM para as próximas)')}</span></div></div>`; }
function setF(k,v){ ENV._form[k]=v;   // atualiza só o estado (sem redesenhar os campos enquanto digita)
  const ok=formOk(), tudo=(ENV.checks||[]).every(c=>c.ok)&&ok.para&&ok.cc, n=revTrab();
  const pa=$('envPara'), cc=$('envCc'), ck=$('envCkMail'), bt=$('envPrepBtn'), hi=$('envPrepHint');
  if(pa) pa.classList.toggle('bad',!ok.para); if(cc) cc.classList.toggle('bad',!ok.cc); if(ck) ck.innerHTML=ckMailHtml();
  if(bt) bt.disabled=!tudo;
  if(hi) hi.textContent=tudo?('Ao preparar: congela a R'+n+', gera e guarda o PDF. O envio só conta depois que você confirmar.'):'Resolva os itens em vermelho para liberar o envio.'; }
async function fix(k){
  if(k==='renumerar'){ const nn=await proximoNumero(); if(typeof setM==='function') setM('numero',nn); else S.numero=nn; try{ updateCodigoFull(); }catch(e){} pushOrc(); ENV._form.assunto=assuntoPadrao(revTrab()); ENV._form.corpo=corpoPadrao(revTrab()); toast('Novo número: <b>'+esc(codigoFull())+'</b>'); }
  if(k==='desligarVazios'){ BLKS.forEach(b=>{ if(blocoAtivo(b.key) && !(S[b.key]||[]).some(r=>r&&String(r.desc||'').trim()) && !(b.key==='despesas'&&typeof diariasCusto==='function'&&diariasCusto()>0)){ S.blocoOn[b.key]=false; try{ renderBlk(b); }catch(e){} } }); try{ applyBlocoVis(); renderBlocosBar(); }catch(e){} }
  try{ recalc(); }catch(e){}
  renderEnvio(await checar(),revTrab());
}
async function fixValidade(v){ if(!v)return; if(typeof setM==='function') setM('validadeISO',v); else S.validadeISO=v; try{ checkValidade(); }catch(e){} ENV._form.corpo=corpoPadrao(revTrab()); renderEnvio(await checar(),revTrab()); }

/* ---------- 2) congela + PDF ---------- */
function loadH2P(){ if(window.html2pdf) return Promise.resolve(); return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=H2P_SRC; s.onload=()=>res(); s.onerror=()=>rej(new Error('não carregou o gerador de PDF (sem internet?)')); document.head.appendChild(s); }); }
// PDF = o MESMO papel do "Imprimir": aplica as regras @media print da folha como tela, numa largura fixa de A4
// (não depende do tamanho da janela de quem envia; esconde o mecanismo interno igual à impressão)
const PDF_W=748;   // A4 (210mm) − margens 12mm, a 96dpi
function cssDeImpressao(){ let out='';
  for(const ss of document.styleSheets){ let rs; try{ rs=ss.cssRules; }catch(e){ continue; }
    for(const r of rs){ if(r.type===CSSRule.MEDIA_RULE && /\bprint\b/.test(r.media.mediaText) && !/\bscreen\b/.test(r.media.mediaText)) for(const x of r.cssRules) out+=x.cssText+'\n'; } }
  return out; }
async function gerarPDF(nome){
  await loadH2P();
  const wasView=document.body.classList.contains('viewing'), sy=window.scrollY;
  _setMode('view'); document.body.classList.add('env-pdf');
  const emu=document.createElement('style'); emu.id='envPrintEmu';
  const base=cssDeImpressao()+`\nbody.env-pdf{background:#fff!important}\nbody.env-pdf .grid{grid-template-columns:1fr!important}\nbody.env-pdf .app{padding:0!important;margin:0!important;box-shadow:none!important;border-radius:0!important;background:#fff!important;`;
  emu.textContent=base+`width:${PDF_W}px!important;max-width:${PDF_W}px!important}`;
  document.head.appendChild(emu); window.scrollTo(0,0);
  await new Promise(r=>setTimeout(r,250));
  try{
    const el=document.querySelector('.app');
    // igual ao "Imprimir": se o conteúdo tem largura mínima maior que a folha, a página inteira encolhe pra caber (nada é cortado)
    const L=el.getBoundingClientRect().left; let w=PDF_W;
    el.querySelectorAll('*').forEach(e=>{ const r=e.getBoundingClientRect(); if(r.width>0 && r.right-L>w) w=Math.ceil(r.right-L); });
    w=Math.min(w+2,930);   // < 940px: mantém o layout de coluna única da impressão
    emu.textContent=base+`width:${w}px!important;max-width:${w}px!important}`;
    await new Promise(r=>setTimeout(r,150));
    // folha na proporção A4 com a largura do conteúdo (o gerador corta o que passa da folha; assim nada passa)
    const m=22, pageW=w+2*m, pageH=Math.round(pageW*297/210);
    return await window.html2pdf().set({
      margin:m, filename:nome, image:{type:'jpeg',quality:0.92},
      html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff',scrollX:0,scrollY:0},   // layout de papel vem do CSS (grade em coluna única + regras de impressão), não da janela
      jsPDF:{unit:'px',format:[pageW,pageH],orientation:'portrait',hotfixes:['px_scaling']},
      pagebreak:{mode:['css','legacy'],avoid:['tr','.prophead','.eqprint','.grouped-print','.summ']}
    }).from(el).outputPdf('blob');
  } finally {
    emu.remove(); document.body.classList.remove('env-pdf');
    if(!wasView) _setMode('edit');
    window.scrollTo(0,sy);
  }
}
function progresso(t){ const b=$('envPrepBtn'); if(b){ b.disabled=true; b.innerHTML=ms('hourglass_top')+esc(t); } }
async function preparar(){
  const f=ENV._form, n=revTrab(), cod=codigoFull();
  if(!(CLOUD&&ORC_ID)) return;
  const L=await checar(); if(!L.every(c=>c.ok)){ renderEnvio(L,n); return; }
  const abrNova=(typeof abrCongelada==='function' && !abrCongelada());
  let vid=null;
  try{
    if(abrNova && typeof congelarAbr==='function') congelarAbr();   // mesma regra de hoje: enviar congela a abrangência
    try{ recalc(); }catch(e){}
    S.envioRev=n;
    progresso('Gerando o PDF…');
    const pdfNome=`${cod}_R${n}.pdf`;
    const blob=await gerarPDF(pdfNome);
    progresso('Congelando a R'+n+'…');
    await SB.from('orcamento_versoes').update({status:'descartada'}).eq('orcamento_id',ORC_ID).eq('status','preparada');   // tentativa anterior abandonada
    const snap=JSON.parse(JSON.stringify(S));
    const ins=await SB.from('orcamento_versoes').insert({ empresa_id:EMPRESA_ID, orcamento_id:ORC_ID, oportunidade_id:OPP, numero:S.numero, codigo:cod, revisao:n,
      dados:snap, total:num(S._total)||0, para:listaEmails(f.para).join(', '), cc:listaEmails(f.cc).join(', '), assunto:f.assunto, corpo:f.corpo,
      preparado_por_nome:USER_NOME||S.respNome||'' }).select('id').single();
    if(ins.error) throw ins.error; vid=ins.data.id;
    progresso('Guardando o PDF…');
    const path=`propostas/${ORC_ID}/${safeKey(cod)}_R${n}.pdf`;
    const up=await SB.storage.from('anexos').upload(path,blob,{upsert:true,contentType:'application/pdf'});
    if(up.error) throw up.error;
    const u2=await SB.from('orcamento_versoes').update({pdf_path:'anexos:'+path}).eq('id',vid); if(u2.error) throw u2.error;
    // a proposta salva = a revisão congelada
    clearTimeout(typeof _saveT!=='undefined'?_saveT:0); pushOrc(); try{ DIRTY=false; _lastSaved=_hhmm(); renderSaveState(); }catch(e){}
    ENV.prep={id:vid,n,cod,f:{...f},pdfNome,blob,abrNova};
    baixarPDF();
    await carregarVersoes(); window.renderBanner(); _setMode('view');
    renderPasso2();
  }catch(e){
    console.error('preparar envio',e);
    if(vid){ try{ await SB.from('orcamento_versoes').update({status:'descartada'}).eq('id',vid); }catch(_){} }
    if(abrNova && typeof descongelarAbr==='function'){ try{ descongelarAbr(); }catch(_){} }
    await carregarVersoes(); window.renderBanner();
    modal(`<div class="envh">${ms('error')}Não foi possível preparar o envio</div><p class="envp">${esc(e.message||String(e))}</p><p class="envp"><b>Nada foi enviado.</b> Pode tentar de novo.</p><div class="envact"><button class="envbtn" onclick="EXENV.fechar()">Fechar</button><button class="envbtn pri" onclick="EXENV.abrirEnvio()">Tentar de novo</button></div>`);
  }
}

/* ---------- 3) abrir o e-mail + confirmar ---------- */
function baixarPDF(){ const p=ENV.prep; if(!p)return;
  if(p.blob){ const a=document.createElement('a'); a.href=URL.createObjectURL(p.blob); a.download=p.pdfNome; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },3000); }
  else if(p.url){ window.open(p.url,'_blank'); } }
function urlEmail(canal){ const f=ENV.prep.f, e=encodeURIComponent;
  if(canal==='gmail') return `https://mail.google.com/mail/?view=cm&fs=1&to=${e(f.para)}&cc=${e(f.cc||'')}&su=${e(f.assunto)}&body=${e(f.corpo)}`;
  if(canal==='outlook') return `https://outlook.live.com/mail/0/deeplink/compose?to=${e(f.para)}&cc=${e(f.cc||'')}&subject=${e(f.assunto)}&body=${e(f.corpo)}`;
  return `mailto:${f.para}?${f.cc?'cc='+e(f.cc)+'&':''}subject=${e(f.assunto)}&body=${e(f.corpo)}`; }
function abrirEmail(canal){ try{ localStorage.setItem('ex_envio_canal',canal); }catch(e){}
  const u=urlEmail(canal); if(canal==='app'){ const a=document.createElement('a'); a.href=u; document.body.appendChild(a); a.click(); a.remove(); } else window.open(u,'_blank');
  ENV.prep.abriu=canal; renderPasso2(); }
function copiarTexto(){ const f=ENV.prep.f; const t='Para: '+f.para+(f.cc?'\nCC: '+f.cc:'')+'\nAssunto: '+f.assunto+'\n\n'+f.corpo;
  (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(()=>toast('Texto do e-mail copiado.')).catch(()=>{ prompt('Copie o texto:',t); }); }
function renderPasso2(){ const p=ENV.prep; if(!p)return; const c=canalSalvo();
  const ok1=!!p.ck1, ok2=!!p.ck2;
  modal(`<div class="envh">${ms('forward_to_inbox')}R${p.n} congelada · agora envie <span class="envcod">${esc(p.cod)} R${p.n}</span><button class="envx" onclick="EXENV.fechar()" title="Fechar (dá pra concluir depois pelo banner)">${ms('close')}</button></div>
    <div class="envdone">${ms('check_circle')}R${p.n} gravada como está · ${ms('check_circle')}PDF gerado e guardado</div>
    <div class="envstep"><span class="envn">1</span><div><b>PDF baixado</b> · ${esc(p.pdfNome)}<div><button class="envbtn sm" onclick="EXENV.baixarPDF()">${ms('download')}Baixar de novo</button></div></div></div>
    <div class="envstep"><span class="envn">2</span><div><b>Abra o e-mail já preenchido</b>${p.abriu?` <span class="envok">aberto no ${esc(CANAIS[p.abriu].nome)}</span>`:''}
      <div class="envcanais">${Object.keys(CANAIS).map(k=>`<button class="envbtn ${k===c?'pri':''}" onclick="EXENV.abrirEmail('${k}')">${ms(CANAIS[k].ic)}${CANAIS[k].nome}</button>`).join('')}<button class="envbtn ghost" onclick="EXENV.copiarTexto()">${ms('content_copy')}Copiar texto</button></div>
      <div class="envhint">Para: ${esc(p.f.para)}${p.f.cc?' · CC: '+esc(p.f.cc):''}<br>Assunto: ${esc(p.f.assunto)}</div></div></div>
    <div class="envstep"><span class="envn">3</span><div><b>Anexe o PDF e clique em Enviar no seu e-mail.</b></div></div>
    <div class="envstep"><span class="envn">4</span><div><b>Confirme aqui</b>
      <label class="envchk"><input type="checkbox" ${ok1?'checked':''} onchange="EXENV.ck(1,this.checked)">Enviei o e-mail</label>
      <label class="envchk"><input type="checkbox" ${ok2?'checked':''} onchange="EXENV.ck(2,this.checked)">Anexei o PDF ${esc(p.pdfNome)}</label></div></div>
    <div class="envact"><button class="envbtn danger" onclick="EXENV.descartar()">${ms('undo')}Não enviei: descartar R${p.n}</button><span style="flex:1"></span>
      <button class="envbtn pri" ${ok1&&ok2?'':'disabled'} onclick="EXENV.confirmar()">${ms('mark_email_read')}Confirmar envio da R${p.n}</button></div>`,true);
}
function ck(i,v){ ENV.prep['ck'+i]=v; renderPasso2(); }
async function retomar(){   // voltou depois (recarregou a página): reconstrói o passo 2 a partir da revisão preparada
  if(!ENV.prep){ const v=vAtual(); if(!v||v.status!=='preparada') return;
    let url=null; if(v.pdf_path&&v.pdf_path.indexOf('anexos:')===0){ try{ const {data}=await SB.storage.from('anexos').createSignedUrl(v.pdf_path.slice(7),3600); url=data&&data.signedUrl; }catch(e){} }
    ENV.prep={id:v.id,n:v.revisao,cod:v.codigo||codigoFull(),f:{para:v.para||'',cc:v.cc||'',assunto:v.assunto||'',corpo:v.corpo||''},pdfNome:`${v.codigo||codigoFull()}_R${v.revisao}.pdf`,blob:null,url,abrNova:false}; }
  renderPasso2();
}
async function confirmar(){ const p=ENV.prep; if(!p||!(p.ck1&&p.ck2)) return;
  try{
    const u=await SB.from('orcamento_versoes').update({status:'enviada'}).eq('id',p.id).eq('status','preparada').select('id,enviado_em').single();
    if(u.error) throw u.error;
    await SB.from('orcamento_versoes').update({status:'substituida'}).eq('orcamento_id',ORC_ID).eq('status','enviada').lt('revisao',p.n);
    S.status='enviado'; S.envioRev=p.n; S.envioUlt={rev:p.n,em:u.data.enviado_em,para:p.f.para};
    try{ recalc(); }catch(e){} pushOrc(); try{ writeback(S._total||0); DIRTY=false; renderSaveState(); }catch(e){}
    ENV.prep=null; ENV._form=null;
    await carregarVersoes(); fechar(); window.renderBanner(); _setMode('view');
    toast(`${ms('mark_email_read','font-size:16px')} <b>R${p.n} enviada e congelada.</b> Para alterar a proposta daqui pra frente, crie a R${p.n+1}.`);
  }catch(e){ console.error('confirmar envio',e); toast('Não consegui confirmar: '+esc(e.message||String(e))); }
}
async function descartar(){ const p=ENV.prep; if(!p)return;
  if(!confirm(`Descartar a R${p.n} preparada? Use isto se o e-mail NÃO foi enviado. A proposta volta a ficar editável.`)) return;
  try{ await SB.from('orcamento_versoes').update({status:'descartada'}).eq('id',p.id).eq('status','preparada');
    if(p.abrNova && typeof descongelarAbr==='function'){ try{ descongelarAbr(); pushOrc(); }catch(_){} }
    ENV.prep=null; await carregarVersoes(); fechar(); window.renderBanner(); _setMode('edit');
    toast(`R${p.n} descartada. Nada foi registrado como enviado.`);
  }catch(e){ toast('Não consegui descartar: '+esc(e.message||String(e))); }
}

/* ---------- R(n+1) ---------- */
function criarRevisao(direto){
  if(aprovada()){ avisoTravada(); return; }
  const v=vAtual(); if(!v||!['enviada','substituida'].includes(v.status)){ fechar(); return; }
  const n=maxRev()+1;
  if(!direto){
    modal(`<div class="envh">${ms('edit_document')}Criar a R${n}?</div><p class="envp">A R${n} nasce como cópia da R${n-1} para você alterar. A R${n-1} continua no histórico exatamente como o cliente recebeu.</p>
      <div class="envact"><button class="envbtn" onclick="EXENV.fechar()">Cancelar</button><button class="envbtn pri" onclick="EXENV.criarRevisao(true)">${ms('edit_document')}Criar R${n}</button></div>`);
    return;
  }
  S.envioRev=n; pushOrc(); try{ DIRTY=false; renderSaveState(); }catch(e){}
  ENV._form=null; fechar(); window.renderBanner(); _setMode('edit');
  toast(`<b>R${n} criada.</b> Edite à vontade; a R${n-1} continua guardada como foi enviada.`);
}

/* ---------- histórico ---------- */
async function historico(){
  modal(`<div class="envh">${ms('history')}Carregando revisões…</div>`);
  await carregarVersoes();
  const urls={}; await Promise.all(ENV.versoes.filter(v=>v.pdf_path&&v.pdf_path.indexOf('anexos:')===0).map(async v=>{ try{ const {data}=await SB.storage.from('anexos').createSignedUrl(v.pdf_path.slice(7),3600); if(data)urls[v.id]=data.signedUrl; }catch(e){} }));
  const ST={preparada:['pending','preparada','warn'],enviada:['mark_email_read','enviada','sent'],substituida:['history','substituída',''],aprovada:['verified','aprovada','okc'],descartada:['block','descartada','off']};
  const rows=[...ENV.versoes].reverse().map(v=>{ const s=ST[v.status]||['help',v.status,''];
    return `<div class="envhist ${v.status==='descartada'?'off':''}"><span class="envrv">R${v.revisao}</span><div class="envhb"><div><span class="envchip ${s[2]}">${ms(s[0])}${s[1]}</span> ${v.enviado_em?'enviada '+brDH(v.enviado_em):'preparada '+brDH(v.preparado_em)}${v.preparado_por_nome?' · por '+esc(v.preparado_por_nome):''}</div>
      <div class="envhint">${v.para?'Para: '+esc(v.para)+' · ':''}${fmt(num(v.total)||0)}${v.assunto?' · '+esc(v.assunto):''}</div></div>
      ${urls[v.id]?`<a class="envbtn sm" href="${esc(urls[v.id])}" target="_blank" rel="noopener">${ms('picture_as_pdf')}PDF</a>`:''}</div>`; }).join('');
  modal(`<div class="envh">${ms('history')}Revisões desta proposta · <span class="envcod">${esc(codigoFull())}</span><button class="envx" onclick="EXENV.fechar()">${ms('close')}</button></div>
    <p class="envp">Cada revisão é o que o cliente recebeu naquele envio: gravada e imutável.</p>${rows||'<p class="envp">Nenhuma revisão ainda.</p>'}
    <div class="envact"><button class="envbtn pri" onclick="EXENV.fechar()">Fechar</button></div>`,true);
}

/* ---------- API p/ os onclick ---------- */
Object.assign(ENV,{abrirEnvio,preparar,confirmar,descartar,retomar,criarRevisao,
  historico,fechar,setF,fix,fixValidade,abrirEmail,baixarPDF,copiarTexto,ck,travada,revTrab,carregarVersoes});

/* ---------- estilos ---------- */
const css=document.createElement('style'); css.textContent=`
.envbtn{display:inline-flex;align-items:center;gap:5px;font:600 12px/1.2 inherit;padding:6px 11px;border-radius:8px;border:1px solid var(--line2,#ccc);background:var(--surf,#fff);color:var(--tx2,#555);cursor:pointer;text-decoration:none;white-space:nowrap}
.envbtn .material-symbols-rounded{font-size:16px}
.envbtn:hover{background:var(--surf2,#f1efe8)}
.envbtn.pri{background:var(--pri,#533ab7);border-color:var(--pri,#533ab7);color:#fff}.envbtn.pri:hover{background:#472f9e}
.envbtn.ghost{border-style:dashed}
.envbtn.danger{color:var(--red,#a32d2d);border-color:#e7b9b9}
.envbtn.sm{padding:4px 9px;font-size:11.5px;margin-top:5px}
.envbtn:disabled{opacity:.45;cursor:not-allowed}
.envchip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:8px;background:var(--surf2,#f1efe8);color:var(--tx2,#555);white-space:nowrap}
.envchip .material-symbols-rounded{font-size:15px}
.envchip.sent{background:#e7f0fa;color:var(--blue,#185fa5)}.envchip.warn{background:#faeeda;color:var(--amber,#ba7517)}.envchip.okc{background:#e9f2dd;color:var(--green,#3b6d11)}.envchip.off{opacity:.7}
#oppBanner .ob-st{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
#envOv{position:fixed;inset:0;z-index:900;background:rgba(20,14,40,.55);display:none;overflow:auto;padding:24px 14px}
#envOv.on{display:block}
.envbox{background:var(--surf,#fff);width:min(560px,96vw);margin:4vh auto;border-radius:14px;box-shadow:0 30px 90px rgba(20,10,50,.42);padding:18px 20px}
.envbox.wide{width:min(980px,96vw)}
.envh{font-size:16px;font-weight:800;display:flex;align-items:center;gap:8px;margin-bottom:10px;color:var(--tx,#1a1a18)}
.envh>.material-symbols-rounded{color:var(--pri,#533ab7)}
.envcod{font-size:12px;font-weight:800;background:var(--pri-bg,#eeedfe);color:var(--pri,#533ab7);border-radius:7px;padding:3px 8px}
.envx{margin-left:auto;border:none;background:none;cursor:pointer;color:var(--tx3,#888)}
.envp{font-size:13px;color:var(--tx2,#555);margin:6px 0}
.envgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:18px}
@media(max-width:760px){.envgrid{grid-template-columns:1fr}}
.envsec{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--tx3,#888);display:flex;align-items:center;gap:6px;margin:4px 0 8px}
.envsec .material-symbols-rounded{font-size:16px;color:var(--pri,#533ab7)}
.envck{display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-top:1px dashed var(--line,#ddd)}
.envck:first-of-type{border-top:none}
.envck>.material-symbols-rounded{font-size:18px;flex-shrink:0}
.envck.ok>.material-symbols-rounded{color:var(--green,#3b6d11)}.envck.no>.material-symbols-rounded{color:var(--red,#a32d2d)}
.envck-b{display:flex;flex-direction:column;font-size:12.5px;min-width:0}
.envck-b span{font-size:11.5px;color:var(--tx2,#555)}
.envck.no .envck-b b{color:var(--red,#a32d2d)}
.envinfo{display:flex;gap:6px;align-items:center;font-size:11.5px;color:var(--blue,#185fa5);background:#e7f0fa;border-radius:8px;padding:7px 9px;margin-top:8px}
.envinfo .material-symbols-rounded{font-size:16px}
.envlb{display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--tx3,#888);margin:9px 0 4px}
.envhint{font-size:11px;color:var(--tx3,#888);font-weight:500;text-transform:none;letter-spacing:0}
.envin{width:100%;box-sizing:border-box;border:1px solid var(--line2,#ccc);border-radius:8px;padding:7px 9px;font:13px inherit;color:var(--tx,#1a1a18);background:var(--surf,#fff);outline:none}
.envin:focus{border-color:var(--pri,#533ab7)}
.envin.bad{border-color:var(--red,#a32d2d);background:#fff7f7}
.envin.sm{width:auto;padding:4px 7px;font-size:12px;margin-top:5px}
.envin.ta{height:190px;resize:vertical;font-size:12.5px;line-height:1.45}
.envatt{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx2,#555);margin-top:8px;background:var(--pri-bg,#eeedfe);border-radius:8px;padding:7px 9px;flex-wrap:wrap}
.envatt .material-symbols-rounded{font-size:17px;color:var(--pri,#533ab7)}
.envact{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:14px;padding-top:12px;border-top:1px solid var(--line,#ddd);flex-wrap:wrap}
.envdone{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px;font-weight:700;color:var(--green,#3b6d11);background:#eef6e6;border-radius:9px;padding:8px 11px;margin-bottom:6px}
.envdone .material-symbols-rounded{font-size:17px}
.envstep{display:flex;gap:10px;padding:10px 0;border-top:1px dashed var(--line,#ddd);font-size:13px}
.envn{flex:0 0 24px;height:24px;border-radius:50%;background:var(--pri,#533ab7);color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
.envcanais{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
.envok{font-size:11px;font-weight:700;color:var(--green,#3b6d11);background:#e9f2dd;border-radius:6px;padding:1px 7px;margin-left:4px}
.envchk{display:flex;align-items:center;gap:7px;font-size:13px;margin-top:7px;cursor:pointer}
.envchk input{width:17px;height:17px;accent-color:var(--pri,#533ab7)}
.envhist{display:flex;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--line,#ddd);font-size:12.5px}
.envhist.off{opacity:.55}
.envrv{flex:0 0 auto;font-size:11px;font-weight:800;background:var(--tx,#1a1a18);color:#fff;border-radius:6px;padding:3px 7px}
.envhb{flex:1;min-width:0}
#envToast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(20px);background:#241c40;color:#f0edfb;font-size:12.5px;line-height:1.45;padding:11px 16px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:560px;opacity:0;pointer-events:none;transition:.25s;z-index:1000}
#envToast.on{opacity:1;transform:translateX(-50%) translateY(0)}
body.env-pdf .app{box-shadow:none!important;border-radius:0!important;margin:0 auto!important}
@media print{#envOv,#envToast{display:none!important}}
`; document.head.appendChild(css);

// se a folha já renderizou antes deste script carregar, decora agora
try{ if(document.querySelector('#oppBanner .ob-st')) decorar(); }catch(e){}
})();
