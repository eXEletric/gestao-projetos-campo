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

const ENV={ versoes:[], carregado:false, carregando:false, prep:null, checks:[], sistema:null, eventos:[], evCarregado:false, manual:false };
window.EXENV=ENV;
// envio direto pelo sistema (Resend, via Edge Function proposta-enviar) — decisão do dono 14/09/2026
const REMETENTE='ex@exeletric.com.br', CAPTURA='respostas@r.exeletric.com.br';
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
// lote (15/09): a BASE do lote é a proposta que vai ao cliente (documento do lote, valor = soma das lojas); a LOJA não é enviada sozinha
function ehLote(){ try{ return typeof isLoteUnit==='function'&&isLoteUnit(); }catch(e){ return false; } }
function ehBaseLote(){ try{ return typeof isLoteBase==='function'&&isLoteBase(); }catch(e){ return false; } }
// total que o cliente vê no documento do lote (mesma conta do verComoClienteLote)
function totalLoteCliente(){ try{
  const modo=(S.macro&&S.macro.modo)||'detalhado', qtd=num(S.macro&&S.macro.qtd), baseT=num(S._total)||0, U=(typeof LOTE_UNITS!=='undefined'&&LOTE_UNITS)||[];
  const subUn=modo==='estimativa'?baseT*qtd:U.reduce((a,o)=>a+num(o.total),0);
  const comboOn=typeof comboActive==='function'&&comboActive(), macroT=typeof macroTotal==='function'?num(macroTotal()):0;
  return subUn+(modo==='estimativa'?(comboOn?0:macroT*(1+num(S.impostoPct)/100)):(typeof macroPendente==='function'?num(macroPendente()):0));
}catch(e){ console.error('total do lote',e); return 0; } }
const totalEnvio=()=>ehBaseLote()?totalLoteCliente():(num(S._total)||0);
const nLojasLote=()=>((typeof LOTE_UNITS!=='undefined'&&LOTE_UNITS)||[]).length;
function aprovada(){ return !!(S&&(S.comprovantes||[]).length); }
function toast(t){ let el=$('envToast'); if(!el){ el=document.createElement('div'); el.id='envToast'; document.body.appendChild(el); } el.innerHTML=t; el.classList.add('on'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('on'),5200); }

/* ---------- linha do tempo: gravar evento (só adiciona) ---------- */
async function evento(o){
  if(!(CLOUD&&ORC_ID&&SB)) return null;
  try{ const {data,error}=await SB.from('orcamento_eventos').insert(Object.assign({ empresa_id:EMPRESA_ID, orcamento_id:ORC_ID, oportunidade_id:OPP||null, criado_por_nome:USER_NOME||S.respNome||'' },o)).select('id').single();
    if(error) throw error; return data.id;
  }catch(e){ console.error('evento',e); return null; }
}
// o envio pelo sistema está configurado? (a função responde sem precisar da chave; nunca expõe a chave)
async function checarSistema(){
  if(ENV.sistema!==null || !(CLOUD&&SB&&SB.functions)) return ENV.sistema;
  try{ const {data,error}=await SB.functions.invoke('proposta-enviar',{body:{ping:true}}); ENV.sistema=!error && !!(data&&data.ready); }
  catch(e){ ENV.sistema=false; }
  return ENV.sistema;
}

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
    const apr=vivas().find(x=>x.status==='aprovada')||ult;   // a revisão que o cliente aprovou (pode não ser a última enviada)
    h+=`<span class="obst-aprov">${ms('verified')}Aprovada${apr?' · R'+apr.revisao:''}</span>`;
  } else if(v && v.status==='preparada'){
    h+=`<span class="envchip warn">${ms('pending')}R${n} preparada · falta confirmar o envio</span>`;
    h+=`<button class="envbtn pri" onclick="EXENV.retomar()">${ms('forward_to_inbox')}Concluir envio</button>`;
  } else if(v && ['enviada','aprovada','substituida'].includes(v.status)){
    h+=`<span class="envchip sent">${ms('mark_email_read')}Enviada · R${n} · ${br(v.enviado_em)}${v.para?' · p/ '+esc(listaEmails(v.para)[0]):''}</span>`;
    h+=`<button class="envbtn" onclick="EXENV.criarRevisao()">${ms('edit_document')}Criar R${n+1}</button>`;
  } else {
    if(ult) h+=`<span class="envchip">${ms('edit_note')}R${n} em edição · R${ult.revisao} enviada ${br(ult.enviado_em)}</span>`;
    else if(S.status==='enviado') h+=`<span class="envchip" title="Foi marcada como enviada antes do registro de versões — nada foi congelado.">${ms('info')}marcada como enviada (sem registro)</span>`;
    if(ehLote()) h+=`<span class="envchip" title="O cliente recebe o documento do lote, enviado pela base">${ms('inventory_2')}Loja do lote: o envio é pela base do lote</span>`;
    else h+=`<button class="envbtn pri" ${CLOUD?'':'disabled title="Entre no app (login) para enviar"'} onclick="EXENV.abrirEnvio()">${ms('send')}Enviar ${n>1?'R'+n:'proposta'}</button>`;
  }
  if(hist) h+=`<button class="envbtn ghost" onclick="EXENV.historico()" title="Revisões enviadas">${ms('history')}${hist}</button>`;
  if(OPP && CLOUD) h+=`<button class="envbtn" onclick="EXENV.irFunil()" title="Abrir esta oportunidade no funil">${ms('view_kanban')}Ir para o funil</button>`;
  const pend=pendentes().length;
  if(pend) h=`<button class="envchip newr" onclick="EXENV.irTrat()" title="Classificar nas tratativas">${ms('mark_email_unread')}${pend} resposta${pend>1?'s':''} do cliente</button>`+h;
  box.innerHTML=h;
  // proposta já enviada pelo sistema mas oportunidade parada antes de "negociação" (ex.: enviada antes desta regra): avança uma vez
  if(CLOUD && ORC_ID && ENV.carregado && !ENV._faseOk && !ehLote()){ const u=ultimaEnviada();
    if(u){ ENV._faseOk=true; moverParaNegociacao(u.revisao).then(mv=>{ if(mv){ toast(`Esta proposta já foi enviada (R${u.revisao}): a oportunidade foi movida para <b>${esc(mv.para)}</b>.`); try{ window.renderBanner(); }catch(_){} } }); } }
  // proposta travada abre em visualização: mostra os painéis internos na TELA (nunca no PDF/impressão)
  const trv=travada(); document.body.classList.toggle('env-travada',trv);
  const lbl=document.querySelector('#previewBar .pv-lbl');
  if(lbl){ if(!lbl.dataset.orig) lbl.dataset.orig=lbl.innerHTML;
    lbl.innerHTML=trv?`${ms('lock')}${aprovada()?'Proposta aprovada':'Proposta enviada'} · travada · é assim que o cliente recebeu`:lbl.dataset.orig; }
  if(CLOUD && ORC_ID && !ENV.evCarregado && !ENV.evCarregando){ ENV.evCarregando=true; carregarEventos().finally(()=>{ ENV.evCarregando=false; ENV.evCarregado=true; renderTrat(); const b=document.querySelector('#oppBanner .ob-st'); if(b&&pendentes().length) decorar(); }); }
  renderTrat();
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
  const tot=totalEnvio();
  L.push({ok:tot>0,t:ehBaseLote()?'Total do lote maior que zero':'Total maior que zero',d:fmt(tot)+(ehBaseLote()?' · soma das lojas (documento do lote)':'')});
  if(ehBaseLote()){
    const nl=nLojasLote(); L.push({ok:nl>0,t:'Lojas no lote',d:nl?nl+' loja(s)':'nenhuma loja gerada no lote'});
    // checagem do próprio lote (sessão do orçamento): bloqueios travam, avisos só informam
    try{ if(typeof preEnvioLista==='function') preEnvioLista().forEach(x=>L.push({ok:x.nivel!=='bloqueio',t:x.nivel==='bloqueio'?'Lote: bloqueio':'Lote: aviso',d:x.d})); }catch(e){ console.error('pré-envio do lote',e); }
  } else {
    const vaz=(typeof BLKS!=='undefined'?BLKS:[]).filter(b=>blocoAtivo(b.key) && !(S[b.key]||[]).some(r=>r&&String(r.desc||'').trim()) && !(b.key==='despesas' && typeof diariasCusto==='function' && diariasCusto()>0));
    L.push({ok:!vaz.length,t:'Nenhum bloco ligado vazio',d:vaz.length?(vaz.map(b=>b.titulo).join(', ')+' sem itens'):'tudo certo',fix:vaz.length?['Desligar os vazios','desligarVazios']:null});
    L.push({ok:!!String(S.finNome||'').trim(),t:'Cliente final / loja',d:String(S.finNome||'').trim()||'não preenchido: escolha a loja na proposta'});
  }
  L.push({ok:!!String(S.respNome||'').trim(),t:'Responsável comercial',d:S.respNome?(S.respNome+(emailOk(S.respEmail)?' · vai em cópia':' · sem e-mail, não vai em cópia')):'não definido'});
  if(aprovada()) L.push({ok:false,t:'Proposta ainda não aprovada',d:'Aprovada não aceita novo envio.'});
  ENV.checks=L; return L;
}
function assuntoPadrao(n){ return ehBaseLote()
  ? `[${codigoFull()} R${n}] Proposta · ${S.cliNome||''} — lote com ${nLojasLote()} lojas`
  : `[${codigoFull()} R${n}] Proposta · ${S.cliNome||''}${S.finNome?' — '+S.finNome:''}`; }
function corpoPadrao(n){
  const nome=(String(S.cliContato||'').trim().split(/\s+/)[0])||'';
  const sol=(ehBaseLote()?[S.solTitulo,nLojasLote()+' lojas']:[S.solTitulo,S.finNome]).filter(x=>String(x||'').trim()).join(' — ');
  const L=[nome?`Olá, ${nome},`:'Olá,',''];
  L.push(n>1?`Segue a revisão R${n} da nossa proposta ${codigoFull()}${sol?' — '+sol:''}, conforme conversamos.`:`Segue em anexo a nossa proposta ${codigoFull()}${sol?' — '+sol:''}.`);
  L.push('',`Valor total${ehBaseLote()?' do lote':''}: ${fmt(totalEnvio())}`);
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
  if(ehLote()){ toast('Esta é uma <b>loja do lote</b>: o cliente recebe o documento do lote inteiro. Envie pela <b>base do lote</b>.'); return; }
  modal(`<div class="envh">${ms('hourglass_top')}Conferindo a proposta…</div>`);
  const [L]=await Promise.all([checar(),checarSistema()]); const n=revTrab();
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
        <div class="envatt">${ms('picture_as_pdf')}Anexo: <b>${esc(codigoFull())}_R${n}.pdf</b> <span class="envhint">gerado da versão congelada</span><button class="envbtn sm" id="envVerPdf" style="margin:0 0 0 auto" onclick="EXENV.verPDF()">${ms('picture_as_pdf')}Ver o PDF antes</button></div>
        ${ENV.sistema?`<div class="envinfo">${ms('verified_user')}Sai de <b>${REMETENTE}</b> · cópia oculta para ${REMETENTE} · respostas chegam no Outlook e ficam registradas aqui.</div>`:''}
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
/* ===== gerador de PDF "papel" (15/09, corrige PDF desconfigurado) =====
   1) aplica as regras de impressão como tela; 2) CLONA o documento num palco fora da tela com a largura da folha;
   3) "estatiza" o clone: campos viram texto (sem caixas, sem textos de exemplo, datas dd/mm/aaaa, quebra de linha),
      SVG vira imagem, somem mensagens de editor; 4) marca blocos pequenos para não quebrar entre páginas;
   5) gera o PDF do clone e tira a última página se ficou em branco. */
const fmtDataBR=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.split('-').reverse().join('/'):(v||'');
function estatizar(src,dst){
  const S1=[...src.querySelectorAll('input,textarea,select')], D1=[...dst.querySelectorAll('input,textarea,select')];
  S1.forEach((s,i)=>{ const d=D1[i]; if(!d||!d.parentNode) return; const cs=getComputedStyle(s);
    if(cs.display==='none'||cs.visibility==='hidden'||s.type==='hidden'||s.type==='file'){ d.remove(); return; }
    if(s.type==='checkbox'||s.type==='radio'){ const sp=document.createElement('span'); sp.textContent=s.checked?'☑':'☐'; d.replaceWith(sp); return; }
    let t=s.tagName==='SELECT'?((s.options[s.selectedIndex]||{}).text||''):(s.value||'');
    if(s.type==='date') t=fmtDataBR(t);
    const el=document.createElement(s.tagName==='TEXTAREA'?'div':'span');
    el.className=s.className; el.textContent=t;
    el.style.cssText=`display:${s.tagName==='TEXTAREA'?'block':'inline-block'};white-space:pre-wrap;word-break:break-word;border:0;background:transparent;box-shadow:none;padding:0;min-height:0;height:auto;max-width:100%;vertical-align:baseline;`+
      `font:${cs.font};color:${cs.color==='rgba(0, 0, 0, 0)'?'inherit':cs.color};text-align:${cs.textAlign};letter-spacing:${cs.letterSpacing};text-transform:${cs.textTransform}`;
    if(s.tagName!=='TEXTAREA' && t.length<40 && s.style.width) el.style.minWidth='0';
    d.replaceWith(el); });
  // SVG (mapa etc.) → imagem do tamanho que aparece na tela
  const S2=[...src.querySelectorAll('svg')], D2=[...dst.querySelectorAll('svg')];
  S2.forEach((s,i)=>{ const d=D2[i]; if(!d||!d.parentNode) return; const r=s.getBoundingClientRect(); if(r.width<40||r.height<40) return;
    try{ const c=s.cloneNode(true); c.setAttribute('xmlns','http://www.w3.org/2000/svg'); c.setAttribute('width',Math.round(r.width)); c.setAttribute('height',Math.round(r.height));
      const img=document.createElement('img'); img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(c.outerHTML);
      img.style.cssText=`display:block;width:${Math.round(r.width)}px;max-width:100%;height:auto`; d.replaceWith(img); }catch(_){} });
  // mensagens de editor que não são do cliente
  dst.querySelectorAll('td[colspan],.empty,.cmp-empty').forEach(e=>{ if(/Nenhum item|Clique em|Adicionar /i.test(e.textContent||'')){ const tr=e.closest('tr'); (tr||e).remove(); } });
  dst.querySelectorAll('[contenteditable]').forEach(e=>e.removeAttribute('contenteditable'));
}
async function gerarPDFDe(src,nome,prep){
  await loadH2P();
  const stage=document.createElement('div'); stage.id='envPdfStage';
  stage.style.cssText=`position:absolute;left:-12000px;top:0;width:${PDF_W}px;background:#fff`;
  document.body.appendChild(stage);
  try{
    const clone=src.cloneNode(true); estatizar(src,clone);
    clone.style.width=PDF_W+'px'; clone.style.maxWidth='none'; clone.style.margin='0'; clone.style.boxShadow='none'; clone.style.borderRadius='0';
    if(prep) prep(clone);
    stage.appendChild(clone);
    await new Promise(r=>setTimeout(r,350));
    // largura real (nada pode passar da folha): mede o que transborda e alarga a folha no mesmo tanto
    const L=clone.getBoundingClientRect().left; let w=Math.max(PDF_W,clone.scrollWidth);
    clone.querySelectorAll('*').forEach(e=>{ const r=e.getBoundingClientRect(); if(r.width>0 && r.right-L>w) w=Math.ceil(r.right-L); });
    w=Math.min(w+8,980); stage.style.width=w+'px'; clone.style.width=w+'px';
    await new Promise(r=>setTimeout(r,120));
    // não quebrar no meio: linhas de tabela e blocos pequenos (até 1/3 da folha)
    const m=24, pageW=w+2*m, pageH=Math.round(pageW*297/210), limite=(pageH-2*m)/3;
    clone.querySelectorAll('tr,thead,p,h1,h2,h3,h4,li,img,div,section').forEach(e=>{ const h=e.getBoundingClientRect().height; if(h>0 && h<=limite) e.classList.add('env-nobreak'); });
    const wk=window.html2pdf().set({
      margin:m, filename:nome, image:{type:'jpeg',quality:0.92},
      html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff',scrollX:0,scrollY:0,windowWidth:w+40},
      jsPDF:{unit:'px',format:[pageW,pageH],orientation:'portrait',hotfixes:['px_scaling']},
      pagebreak:{mode:['css'],avoid:['.env-nobreak']}
    }).from(clone);
    const pdf=await wk.toPdf().get('pdf');
    // última página em branco (sobra do espaçamento): tira
    try{ const cv=wk.prop&&wk.prop.canvas, n=pdf.internal.getNumberOfPages(); if(cv&&n>1){ const precisa=Math.ceil(cv.height/((pageH-2*m)*2)-0.02); if(n>precisa) for(let i=n;i>Math.max(precisa,1);i--) pdf.deletePage(i); } }catch(_){}
    return pdf.output('blob');
  } finally { stage.remove(); }
}
// PDF do LOTE = o "Documento do lote" (verComoClienteLote), respeitando as chaves de seção (S.docOpt)
async function gerarPDFLote(nome){
  if(typeof verComoClienteLote!=='function') throw new Error('documento do lote indisponível nesta página');
  const jaAberto=!!document.getElementById('vcOverlay');
  verComoClienteLote();
  const emu=document.createElement('style'); emu.id='envPrintEmuLote';
  emu.textContent=cssDeImpressao().replace(/body\s*>\s*\*:not\(#vcOverlay\)\s*\{[^}]*\}/g,'')+`\n#envPdfStage #vcBar,#envPdfStage #vcWarn,#envPdfStage #vcMenu,#envPdfStage .vctog,#envPdfStage .docoff,#envPdfStage .noprint{display:none!important}
    #envPdfStage #vcSheet.off-lojas-modelo .col-modelo,#envPdfStage #vcSheet.off-lojas-dias .col-dias,#envPdfStage #vcSheet.off-lojas-adic .col-adic{display:none!important}`;
  document.head.appendChild(emu);
  await new Promise(r=>setTimeout(r,500));   // mapa e fontes
  try{
    const el=document.getElementById('vcSheet'); if(!el) throw new Error('não achei o documento do lote');
    return await gerarPDFDe(el,nome,c=>{ c.querySelectorAll('.vctog,.docoff,#vcBar,#vcWarn,#vcMenu').forEach(x=>x.remove()); });
  } finally {
    emu.remove();
    if(!jaAberto && typeof closeVerCliente==='function'){ try{ closeVerCliente(); }catch(_){} }
  }
}
async function gerarPDF(nome){
  if(ehBaseLote()) return gerarPDFLote(nome);
  const wasView=document.body.classList.contains('viewing'), sy=window.scrollY;
  _setMode('view'); document.body.classList.add('env-pdf');
  const emu=document.createElement('style'); emu.id='envPrintEmu';
  emu.textContent=cssDeImpressao()+`\nbody.env-pdf{background:#fff!important}\nbody.env-pdf .grid{grid-template-columns:1fr!important}\n#envPdfStage .app{padding:0!important;margin:0!important;box-shadow:none!important;border-radius:0!important;background:#fff!important;max-width:none!important}
    #envPdfStage .noprint,#envPdfStage .intbox,#envPdfStage #envTrat,#envPdfStage #comprovantesPanel,#envPdfStage #oppBanner,#envPdfStage .oppbar,#envPdfStage #previewBar{display:none!important}`;
  document.head.appendChild(emu);
  await new Promise(r=>setTimeout(r,250));
  try{ return await gerarPDFDe(document.querySelector('.app'),nome); }
  finally {
    emu.remove(); document.body.classList.remove('env-pdf');
    if(!wasView) _setMode('edit');
    window.scrollTo(0,sy);
  }
}
// pré-visualizar o PDF sem congelar nada (botão na tela de envio)
async function verPDF(){ const b=$('envVerPdf'); if(b){ b.disabled=true; b.innerHTML=ms('hourglass_top')+'Gerando…'; }
  try{ try{ recalc(); }catch(_){} const blob=await gerarPDF(codigoFull()+'_previa.pdf'); const u=URL.createObjectURL(blob); window.open(u,'_blank'); setTimeout(()=>URL.revokeObjectURL(u),120000); }
  catch(e){ console.error('prévia PDF',e); toast('Não consegui gerar a prévia: '+esc(e.message||e)); }
  finally{ const b2=$('envVerPdf'); if(b2){ b2.disabled=false; b2.innerHTML=ms('picture_as_pdf')+'Ver o PDF antes'; } } }
function abrirPDFPrep(){ const p=ENV.prep; if(!p) return; if(p.blob){ const u=URL.createObjectURL(p.blob); window.open(u,'_blank'); setTimeout(()=>URL.revokeObjectURL(u),120000); } else if(p.url) window.open(p.url,'_blank'); }
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
      dados:snap, total:totalEnvio(), para:listaEmails(f.para).join(', '), cc:listaEmails(f.cc).join(', '), assunto:f.assunto, corpo:f.corpo,
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
    ENV.manual=!ENV.sistema;
    if(!ENV.sistema) baixarPDF();   // pelo sistema o PDF vai anexado sozinho
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
function urlEmail(canal){ const f0=ENV.prep.f, e=encodeURIComponent;
  const f=Object.assign({},f0,{cc:ENV.sistema?[...listaEmails(f0.cc),CAPTURA].join(', '):f0.cc});   // registro em cópia quando a captura está ativa
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
  if(ENV.sistema && !ENV.manual){
    modal(`<div class="envh">${ms('forward_to_inbox')}R${p.n} congelada · pronta para enviar <span class="envcod">${esc(p.cod)} R${p.n}</span><button class="envx" onclick="EXENV.fechar()" title="Fechar (dá pra concluir depois pelo banner)">${ms('close')}</button></div>
      <div class="envdone">${ms('check_circle')}R${p.n} gravada como está · ${ms('check_circle')}PDF gerado e guardado</div>
      <div class="envsis">
        <div class="envsis-r"><span>De</span><b>eX Eletric &lt;${REMETENTE}&gt;</b></div>
        <div class="envsis-r"><span>Para</span><b>${esc(p.f.para)}</b></div>
        ${p.f.cc?`<div class="envsis-r"><span>Cópia</span><b>${esc(p.f.cc)}</b></div>`:''}
        <div class="envsis-r"><span>Cópia oculta</span><b>${REMETENTE}</b></div>
        <div class="envsis-r"><span>Respostas para</span><b>${REMETENTE} · ${CAPTURA}</b><em>chegam no Outlook e ficam registradas nas tratativas</em></div>
        <div class="envsis-r"><span>Assunto</span><b>${esc(p.f.assunto)}</b></div>
        <div class="envsis-r"><span>Anexo</span><b>${ms('picture_as_pdf','font-size:15px')} ${esc(p.pdfNome)} <button class="envbtn sm" style="margin:0 0 0 6px" onclick="EXENV.abrirPDFPrep()">${ms('open_in_new')}Abrir e conferir</button></b></div>
      </div>
      ${p.erro?`<div class="enverr">${ms('error')}<span>${esc(p.erro)}<br><b>Nada foi enviado.</b> Pode tentar de novo ou enviar pelo seu e-mail.</span></div>`:''}
      <div class="envact"><button class="envbtn danger" onclick="EXENV.descartar()">${ms('undo')}Desistir: descartar R${p.n}</button>
        <button class="envbtn ghost" onclick="EXENV.modoManual(true)">${ms('alternate_email')}Enviar pelo meu e-mail</button><span style="flex:1"></span>
        <button class="envbtn pri" id="envSisBtn" onclick="EXENV.enviarSistema()">${ms('send')}Enviar agora</button></div>`,true);
    return;
  }
  modal(`<div class="envh">${ms('forward_to_inbox')}R${p.n} congelada · agora envie <span class="envcod">${esc(p.cod)} R${p.n}</span><button class="envx" onclick="EXENV.fechar()" title="Fechar (dá pra concluir depois pelo banner)">${ms('close')}</button></div>
    <div class="envdone">${ms('check_circle')}R${p.n} gravada como está · ${ms('check_circle')}PDF gerado e guardado</div>
    ${ENV.sistema?`<div class="envinfo">${ms('info')}<span>Pelo seu e-mail, o endereço de registro <b>${CAPTURA}</b> já vai em cópia: se o cliente usar "Responder a todos", a resposta entra nas tratativas.</span> <button class="envbtn sm" style="margin:0 0 0 auto" onclick="EXENV.modoManual(false)">Voltar: enviar pelo sistema</button></div>`:''}
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
function modoManual(on){ ENV.manual=!!on; if(on && ENV.prep && ENV.prep.blob && !ENV.prep.baixou){ ENV.prep.baixou=true; baixarPDF(); } renderPasso2(); }
// depois que o e-mail saiu (pelo sistema ou confirmado à mão): estado da folha + banner
// enviou → a oportunidade vai para a fase de papel "negociação" (dono 14/09). Só avança: se já está em negociação ou
// além (execução/ganho/perdido), não mexe. Lote fica de fora (envio em conjunto é outro passo).
const FASES_ANTES_NEG=['captacao','visita','proposta','pausa'];
async function moverParaNegociacao(n){
  if(!(OPP&&CLOUD&&SB) || ehLote()) return null;
  try{
    const [{data:op},{data:fases}]=await Promise.all([
      SB.from('oportunidades').select('fase_id').eq('id',OPP).maybeSingle(),
      SB.from('crm_fases').select('id,nome,papel,ordem').is('deleted_at',null).order('ordem') ]);
    if(!op) return null;
    const neg=(fases||[]).find(f=>f.papel==='negociacao'); if(!neg) return null;
    const atual=(fases||[]).find(f=>f.id===op.fase_id);
    if(atual && !FASES_ANTES_NEG.includes(atual.papel)) return null;
    const {error}=await SB.from('oportunidades').update({fase_id:neg.id}).eq('id',OPP); if(error) throw error;
    evento({ revisao:n||null, tipo:'nota', canal:'sistema', titulo:`Oportunidade movida de "${atual?atual.nome:'sem fase'}" para "${neg.nome}" (R${n} enviada)` });
    // funil (outro quadro) recarrega; banner desta proposta lê a fase da ponte local do CRM
    try{ localStorage.setItem('ex_opp_sync',JSON.stringify({opp:OPP,t:Date.now()})); localStorage.setItem('ex_orc_sync',JSON.stringify({opp:OPP,t:Date.now()})); }catch(_){}
    try{ const crm=JSON.parse(localStorage.getItem('ex_crm_v1')||'null'); const o=crm&&(crm.oportunidades||[]).find(x=>x.id===OPP); if(o){ o.colId=neg.id; localStorage.setItem('ex_crm_v1',JSON.stringify(crm)); } }catch(_){}
    return {de:atual?atual.nome:null, para:neg.nome};
  }catch(e){ console.error('mover para negociação',e); return null; }
}
const avisoFase=mv=>mv?` A oportunidade foi movida para <b>${esc(mv.para)}</b>.`:'';
async function posEnvio(n,enviadoEm,para){
  S.status='enviado'; S.envioRev=n; S.envioUlt={rev:n,em:enviadoEm,para};
  try{ recalc(); }catch(e){} pushOrc(); try{ writeback(S._total||0); DIRTY=false; renderSaveState(); }catch(e){}
  ENV.prep=null; ENV._form=null; ENV.manual=false;
  ENV._faseOk=true;
  const mv=await moverParaNegociacao(n);
  await carregarVersoes(); fechar(); window.renderBanner(); _setMode('view');
  carregarEventos();
  return mv;
}
async function enviarSistema(){ const p=ENV.prep; if(!p) return;
  const b=$('envSisBtn'); if(b){ b.disabled=true; b.innerHTML=ms('hourglass_top')+'Enviando…'; }
  p.erro=null;
  try{
    const {data,error}=await SB.functions.invoke('proposta-enviar',{body:{versao_id:p.id,usuario_nome:USER_NOME||S.respNome||''}});
    let msg=null;
    if(error){ msg=error.message||String(error); try{ const j=await error.context.json(); if(j&&j.error) msg=j.error; }catch(_){} }
    else if(!data||!data.ok) msg=(data&&data.error)||'resposta inesperada do servidor';
    if(msg) throw new Error(msg);
    if(data.avisos&&data.avisos.length) console.warn('envio: registrado com avisos',data.avisos);
    const mv=await posEnvio(p.n,data.enviado_em,p.f.para);
    toast(`${ms('mark_email_read','font-size:16px')} <b>R${p.n} enviada pelo sistema</b> para ${esc(listaEmails(p.f.para)[0]||'')}. As respostas vão aparecer nas tratativas.`+avisoFase(mv));
  }catch(e){
    console.error('enviar pelo sistema',e);
    // a resposta pode ter se perdido depois do envio: se a revisão já consta como enviada, não houve falha
    try{ await carregarVersoes(); const v=ENV.versoes.find(x=>x.id===p.id);
      if(v&&v.status==='enviada'){ const mv=await posEnvio(p.n,v.enviado_em,p.f.para); toast(`<b>R${p.n} enviada.</b> (a confirmação demorou, mas o e-mail saiu)`+avisoFase(mv)); return; } }catch(_){}
    p.erro=e.message||String(e); renderPasso2();
  }
}
async function retomar(){   // voltou depois (recarregou a página): reconstrói o passo 2 a partir da revisão preparada
  await checarSistema();
  if(!ENV.prep){ ENV.manual=!ENV.sistema; const v=vAtual(); if(!v||v.status!=='preparada') return;
    let url=null; if(v.pdf_path&&v.pdf_path.indexOf('anexos:')===0){ try{ const {data}=await SB.storage.from('anexos').createSignedUrl(v.pdf_path.slice(7),3600); url=data&&data.signedUrl; }catch(e){} }
    ENV.prep={id:v.id,n:v.revisao,cod:v.codigo||codigoFull(),f:{para:v.para||'',cc:v.cc||'',assunto:v.assunto||'',corpo:v.corpo||''},pdfNome:`${v.codigo||codigoFull()}_R${v.revisao}.pdf`,blob:null,url,abrNova:false}; }
  renderPasso2();
}
async function confirmar(){ const p=ENV.prep; if(!p||!(p.ck1&&p.ck2)) return;
  try{
    const u=await SB.from('orcamento_versoes').update({status:'enviada'}).eq('id',p.id).eq('status','preparada').select('id,enviado_em').single();
    if(u.error) throw u.error;
    await SB.from('orcamento_versoes').update({status:'substituida'}).eq('orcamento_id',ORC_ID).eq('status','enviada').lt('revisao',p.n);
    await evento({ versao_id:p.id, revisao:p.n, tipo:'envio', canal:'e-mail próprio'+(p.abriu?' ('+CANAIS[p.abriu].nome+')':''),
      titulo:`R${p.n} enviada pelo e-mail do usuário para ${listaEmails(p.f.para).join(', ')}`, texto:p.f.assunto,
      anexos:[{nome:p.pdfNome,path:'anexos:propostas/'+ORC_ID+'/'+safeKey(p.cod)+'_R'+p.n+'.pdf',tipo:'application/pdf'}] });
    const mv=await posEnvio(p.n,u.data.enviado_em,p.f.para);
    toast(`${ms('mark_email_read','font-size:16px')} <b>R${p.n} enviada e congelada.</b> Para alterar a proposta daqui pra frente, crie a R${p.n+1}.`+avisoFase(mv));
  }catch(e){ console.error('confirmar envio',e); toast('Não consegui confirmar: '+esc(e.message||String(e))); }
}
async function descartar(){ const p=ENV.prep; if(!p)return;
  if(!confirm(`Descartar a R${p.n} preparada? Use isto se o e-mail NÃO foi enviado. A proposta volta a ficar editável.`)) return;
  try{ await SB.from('orcamento_versoes').update({status:'descartada'}).eq('id',p.id).eq('status','preparada');
    evento({ versao_id:p.id, revisao:p.n, tipo:'descarte', canal:'sistema', titulo:`R${p.n} preparada e descartada (não foi enviada)` });
    ENV.manual=false;
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
  evento({ revisao:n, tipo:'revisao', canal:'sistema', titulo:`R${n} criada a partir da R${n-1}`+(ENV._motivoRev?' · motivo: '+ENV._motivoRev:'') }).then(()=>carregarEventos());
  ENV._motivoRev=null;
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

/* ============================================================================
   TRATATIVAS (passo 2) — linha do tempo da proposta
   Respostas chegam sozinhas pelo endereço de registro (Edge Function email-entrada).
   O sistema SUGERE; uma pessoa CONFIRMA com 1 clique (decisão do dono 14/09/2026).
   ============================================================================ */
const CLS={aprovacao:['verified','Aprovou','gold'],ajuste:['reply','Pediu ajuste','pri'],recusa:['do_not_disturb_on','Recusou','red'],duvida:['help','Dúvida','blue'],outro:['chat','Outro','gray']};
const CANAL_IC={'telefone':'call','WhatsApp':'chat','reunião':'groups','e-mail':'mail','outro':'more_horiz'};
const MOTIVOS=['preço','prazo','escopo','concorrente','cliente sem verba','outro'];
function ehMestra(){ try{ return typeof isLoteBase==='function'&&isLoteBase(); }catch(e){ return false; } }
const pendentes=()=>ENV.eventos.filter(e=>e.tipo==='email_cliente'&&!e.classificacao&&!e.anulado_em);
async function carregarEventos(){
  if(!(CLOUD&&ORC_ID&&SB)) return;
  try{ const {data,error}=await SB.from('orcamento_eventos').select('*').eq('orcamento_id',ORC_ID).is('deleted_at',null).order('ocorrido_em',{ascending:false});
    if(error) throw error;
    const antes=JSON.stringify(ENV.eventos.map(e=>[e.id,e.classificacao,e.anulado_em]));
    ENV.eventos=data||[]; ENV.evCarregado=true;
    // proposta já aprovada: respostas abertas da revisão aprovada que dizem "aprovado" = confirmação, sozinhas
    // (antigas ou chegando depois). Ajuste/recusa/dúvida continuam abertas para a pessoa conferir.
    if(aprovada()){ const ra=revAprovada(); ENV._autoConf=ENV._autoConf||{};
      const alvo=pendentes().filter(x=>x.sugestao==='aprovacao' && (!x.revisao||!ra||x.revisao===ra) && !ENV._autoConf[x.id]);
      if(alvo.length){ for(const x of alvo){ ENV._autoConf[x.id]=1; try{ await SB.from('orcamento_eventos').update({classificacao:'outro',classificacao_motivo:`confirmação da aprovação da R${ra||x.revisao||''}`,classificado_por_nome:`automático (R${ra||x.revisao||''} já aprovada)`}).eq('id',x.id).is('classificacao',null); }catch(_){} }
        const r2=await SB.from('orcamento_eventos').select('*').eq('orcamento_id',ORC_ID).is('deleted_at',null).order('ocorrido_em',{ascending:false});
        if(!r2.error) ENV.eventos=r2.data||[];
        toast(`${alvo.length===1?'1 resposta que dizia "aprovado" foi registrada':alvo.length+' respostas que diziam "aprovado" foram registradas'} como <b>confirmação</b> da R${ra} (já aprovada).`); } }
    if(antes!==JSON.stringify(ENV.eventos.map(e=>[e.id,e.classificacao,e.anulado_em]))){ try{ decorar(); }catch(_){ renderTrat(); } }
    // veio do funil pelo botão "Abrir tratativas" (?trat=1): rola até o painel uma vez
    if(!ENV._trIr && /[?&]trat=1\b/.test(location.search)){ ENV._trIr=true; setTimeout(irTrat,400); }
    // veio da esteira do funil ("Anexar contrato ou OS do cliente", ?comp=1): abre o formulário de comprovante já no tipo contrato
    if(!ENV._compIr && /[?&]comp=1\b/.test(location.search)){ ENV._compIr=true; setTimeout(()=>{ const p=$('comprovantesPanel'); if(p) p.scrollIntoView({behavior:'smooth',block:'start'});
      try{ if(typeof window.addComprovanteUI==='function'){ window.addComprovanteUI(); const t=$('cmpTipo'); if(t) t.value='contrato'; } }catch(_){} },500); }
  }catch(e){ console.error('tratativas',e); }
}
function trEl(){ let el=$('envTrat');
  if(!el){ const ref=$('comprovantesPanel'); const anchor=ref||$('levUnidadePanel')||$('oppBanner'); if(!anchor||!anchor.parentElement) return null;
    el=document.createElement('div'); el.id='envTrat'; el.className='noprint';
    if(ref) ref.parentElement.insertBefore(el,ref); else anchor.parentElement.insertBefore(el,anchor.nextSibling); }
  return el; }
function evIcone(e){
  if(e.anulado_em) return ['block','gray'];
  if(e.classificacao&&CLS[e.classificacao]) return [CLS[e.classificacao][0],CLS[e.classificacao][2]];
  return ({envio:['send','blue'],descarte:['block','gray'],revisao:['edit_document','pri'],email_cliente:['mark_email_unread','pri'],email_ex:['forward_to_inbox','gray'],
    entrega:['report','red'],contato:[CANAL_IC[e.canal]||'call','gray'],cobranca:['notifications_active','amber'],nota:['sticky_note_2','gray'],legado:['history','gray']})[e.tipo]||['circle','gray']; }
const anexosHtml=e=>(e.anexos||[]).map(a=>`<button class="tratt" onclick="EXENV.abrirAnexo('${esc(a.path)}')">${ms(/pdf/i.test(a.tipo||a.nome)?'picture_as_pdf':'attach_file')}${esc(a.nome)}</button>`).join('');
function revChip(e){ if(!e.revisao) return ''; const ult=ultimaEnviada(); const velha=ult&&e.revisao<ult.revisao; return `<span class="trrv ${velha?'old':''}" title="${velha?'revisão já substituída':''}">R${e.revisao}</span>`; }
function renderTrat(){
  const el=trEl(); if(!el) return;
  const enviada=!!ultimaEnviada();
  if(!(CLOUD&&ORC_ID) || ehLote() || (!ENV.eventos.length && !enviada && S.status!=='enviado')){ el.innerHTML=''; return; }
  const pend=pendentes(), outros=ENV.eventos.filter(e=>!pend.includes(e));
  const v=vAtual();
  // próxima ação depois de um pedido de ajuste: criar a revisão seguinte
  const ultAj=ENV.eventos.find(e=>e.classificacao==='ajuste'&&!e.anulado_em);
  const mostraR=ultAj && !aprovada() && v && ['enviada','substituida'].includes(v.status) && ultAj.revisao===v.revisao;
  const jaAprov=aprovada();
  const card=e=>{ const sg=e.sugestao&&CLS[e.sugestao]; const txt=String(e.texto||''); const longo=txt.length>700;
    const ressalva=e.sugestao==='ajuste'&&/aprovado/.test(e.sugestao_motivo||'');
    return `<div class="trnew">
      <div class="trnew-h">${ms('mark_email_unread','font-size:17px')}Nova resposta do cliente <span class="trm">${brDH(e.ocorrido_em)} · ${esc(e.canal||'e-mail')}</span> ${revChip(e)}</div>
      <div class="trnew-t">${esc(e.titulo||'')}</div>
      ${txt?`<div class="trq">${esc(longo?txt.slice(0,700)+'…':txt)}</div>`:''}
      <div class="trlinks">${e.mensagem_id?`<button class="tratt" onclick="EXENV.verEmail('${e.id}')">${ms('mail')}ver e-mail completo</button>`:''}${anexosHtml(e)}</div>
      ${jaAprov
        ? (e.sugestao==='aprovacao'||!e.sugestao
            ? `<div class="trsug good">${ms('task_alt','font-size:17px')}<div><b>A R${revAprovada()} já está aprovada</b><span>Esta resposta parece só uma confirmação. Registre com um clique.</span></div></div>`
            : `<div class="trsug care">${ms('warning','font-size:17px')}<div><b>Atenção: a proposta já está aprovada, mas esta resposta parece ${({ajuste:'um pedido de ajuste',recusa:'uma recusa',duvida:'uma dúvida'})[e.sugestao]||'outra coisa'}</b><span>Confira com o cliente antes de seguir.</span></div></div>`)
        : (sg?`<div class="trsug ${e.sugestao==='aprovacao'?'good':(ressalva||e.sugestao==='recusa')?'care':'info'}">${ms(ressalva?'help':sg[0],'font-size:17px')}<div><b>Sugestão do sistema: ${ressalva?'aprovação COM ressalva: confira':esc(sg[1].toLowerCase())}</b><span>${esc(e.sugestao_motivo||'')}</span></div></div>`:'')}
      <div class="tracts">
        ${jaAprov
          ? `<button class="envbtn ${e.sugestao==='aprovacao'||!e.sugestao?'okb':''}" onclick="EXENV.classificar('${e.id}','confirmacao')">${ms('task_alt')}Registrar como confirmação</button>`
          : `<button class="envbtn ${e.sugestao==='aprovacao'?'okb':''}" onclick="EXENV.classificar('${e.id}','aprovacao')">${ms('verified')}Aprovou${e.revisao?' a R'+e.revisao:''}</button>`}
        <button class="envbtn ${e.sugestao==='ajuste'?'pri':''}" onclick="EXENV.classificar('${e.id}','ajuste')">${ms('reply')}Pediu ajuste</button>
        <button class="envbtn ${e.sugestao==='recusa'?'danger':''}" onclick="EXENV.classificar('${e.id}','recusa')">${ms('do_not_disturb_on')}Recusou</button>
        <button class="envbtn" onclick="EXENV.classificar('${e.id}','duvida')">${ms('help')}Dúvida / outro</button>
        <button class="envbtn ghost sm2" onclick="EXENV.anular('${e.id}')" title="Não é desta proposta / registrado por engano">${ms('link_off')}Não é desta proposta</button>
      </div></div>`; };
  const linha=e=>{ const [ic,c]=ehConfirmacao(e)&&!e.anulado_em?['task_alt','green']:evIcone(e); const cl=ehConfirmacao(e)?['task_alt','Confirmação','green']:(e.classificacao&&CLS[e.classificacao]);
    const manual=(['contato','nota','cobranca'].includes(e.tipo)&&e.canal!=='sistema')||(e.tipo==='email_cliente'&&e.classificacao);   // nota automática do sistema não se anula
    return `<div class="trev ${e.anulado_em?'off':''}"><span class="tric ${c}">${ms(ic)}</span><div class="trevb">
      <div class="trevt">${esc(e.titulo||'')} ${revChip(e)} ${cl?`<span class="trcl ${cl[2]}">${cl[1]}${ehConfirmacao(e)?(' da R'+(String(e.classificacao_motivo).match(/R(\d+)/)||['',''])[1]):(e.classificacao_motivo?' · '+esc(e.classificacao_motivo):'')}</span>`:''}</div>
      <div class="trm">${brDH(e.ocorrido_em)}${e.canal?' · '+esc(e.canal):''}${e.criado_por_nome?' · '+esc(e.criado_por_nome):''}${e.classificado_por_nome?' · classificado por '+esc(e.classificado_por_nome):''}</div>
      ${e.texto&&e.tipo!=='envio'?`<div class="trtx">${esc(String(e.texto).slice(0,300))}${String(e.texto).length>300?'…':''}</div>`:''}
      ${e.anulado_em?`<div class="trtx red">Anulado ${brDH(e.anulado_em)}${e.anulado_por_nome?' por '+esc(e.anulado_por_nome):''}: ${esc(e.anulado_motivo||'')}</div>`:''}
      <div class="trlinks">${e.mensagem_id&&e.tipo!=='envio'?`<button class="tratt" onclick="EXENV.verEmail('${e.id}')">${ms('mail')}ver e-mail</button>`:''}${anexosHtml(e)}
        ${manual&&!e.anulado_em?`<button class="tratt ghost" onclick="EXENV.anular('${e.id}')">${ms('undo')}anular</button>`:''}</div>
    </div></div>`; };
  const legado=(!ENV.eventos.length && !enviada && S.status==='enviado')?`<div class="trev"><span class="tric gray">${ms('history')}</span><div class="trevb"><div class="trevt">Marcada como enviada antes do sistema</div><div class="trm">sem cópia guardada do que foi enviado</div></div></div>`:'';
  const LIM=6, todos=ENV._trTodos;
  el.innerHTML=`<div class="trw">
    <div class="trh">${ms('forum')}<b>Tratativas</b>${pend.length?`<span class="trbadge">${pend.length} nova${pend.length>1?'s':''}</span>`:''}
      <span style="flex:1"></span>
      <button class="envbtn sm2" onclick="EXENV.contatoUI()">${ms('add_call')}Registrar contato</button>
      <button class="envbtn ghost sm2" onclick="EXENV.carregarEventos()" title="Atualizar">${ms('refresh')}</button></div>
    ${mostraR?`<div class="trnext">${ms('edit_document')}<span>Pedido de ajuste registrado. Próximo passo: <b>criar a R${v.revisao+1}</b> com as alterações.</span><button class="envbtn pri" onclick="EXENV.revDoAjuste('${ultAj.id}')">${ms('edit_document')}Criar R${v.revisao+1}</button></div>`:''}
    ${pend.map(card).join('')}
    <div class="trlist">${(todos?outros:outros.slice(0,LIM)).map(linha).join('')}${legado}
      ${!outros.length&&!legado&&!pend.length?`<div class="trm" style="padding:8px 2px">Nenhuma tratativa ainda. As respostas do cliente aparecem aqui sozinhas.</div>`:''}</div>
    ${outros.length>LIM?`<button class="tratt" style="margin-top:6px" onclick="EXENV._trTodos=!EXENV._trTodos;EXENV.renderTrat()">${todos?'mostrar menos':'ver todas ('+outros.length+')'}</button>`:''}
  </div>`;
}
function irTrat(){ const el=$('envTrat'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }

const ehConfirmacao=e=>e&&e.classificacao==='outro'&&/^confirma/i.test(e.classificacao_motivo||'');
function revAprovada(){ const a=vivas().find(x=>x.status==='aprovada'); return a?a.revisao:((ultimaEnviada()||{}).revisao||null); }
async function classificar(id,cls,motivo){
  const e=ENV.eventos.find(x=>x.id===id); if(!e) return;
  if(cls==='recusa' && !motivo){ motivoRecusaUI(id); return; }
  const ult=ultimaEnviada();
  // proposta já aprovada: outra resposta dizendo "aprovado" = CONFIRMAÇÃO (sem 2º comprovante, sem pergunta)
  if(cls==='confirmacao' || (cls==='aprovacao' && aprovada())){ cls='outro'; motivo=`confirmação da aprovação da R${revAprovada()||e.revisao||''}`; }
  const aprovouAgora=(cls==='aprovacao' && !aprovada());
  if(cls==='aprovacao'){
    {
      if(e.revisao && ult && e.revisao<ult.revisao && !confirm(`Atenção: esta resposta é sobre a R${e.revisao}, mas a R${ult.revisao} foi enviada depois.\n\nAprovar a R${e.revisao} faz a execução herdar os preços DELA.\n\nConfirmar a aprovação da R${e.revisao}?`)) return;
      const vt=vAtual(); if(vt && !['enviada','substituida','aprovada'].includes(vt.status) && revTrab()>(ult?ult.revisao:0) && !confirm(`Existe uma R${revTrab()} em edição que ainda não foi enviada. A aprovação vale para a R${e.revisao||(ult&&ult.revisao)} enviada, não para a edição. Continuar?`)) return;
    }
  }
  try{
    const u=await SB.from('orcamento_eventos').update({classificacao:cls,classificacao_motivo:motivo||null,classificado_por_nome:USER_NOME||S.respNome||''}).eq('id',id).is('classificacao',null).select('id').maybeSingle();
    if(u.error) throw u.error; if(!u.data){ toast('Esta resposta já tinha sido classificada por outra pessoa.'); await carregarEventos(); return; }
    if(cls==='aprovacao' && !aprovada()){
      const a0=(e.anexos||[])[0]||{}; const quem=String(e.titulo||'').replace(/^Resposta de\s*/,'')||'cliente';
      if(!Array.isArray(S.comprovantes)) S.comprovantes=[];
      S.comprovantes.push({ id:uid(), tipo:(e.tipo==='contato'?'outro':'email'), origem:quem, data:String(e.ocorrido_em||'').slice(0,10),
        obs:`Aprovação da R${e.revisao||(ult&&ult.revisao)||''} registrada pelas tratativas${e.tipo==='contato'?' ('+(e.canal||'contato')+')':''}`,
        url:a0.path||'', nome:a0.nome||'', evento_id:id, versao_id:e.versao_id||(ult&&ult.id)||null, revisao:e.revisao||(ult&&ult.revisao)||null });
      const vid=e.versao_id||(ult&&ult.id);
      if(vid) await SB.from('orcamento_versoes').update({status:'aprovada'}).eq('id',vid).in('status',['enviada','substituida']);
      onComprovantesChange();   // status "aprovado" + grava na nuvem + banner (mesmo caminho do painel de comprovantes)
      await carregarVersoes(); window.renderBanner(); _setMode('view');
      // outras respostas ainda abertas da mesma revisão: as que também dizem "aprovado" viram CONFIRMAÇÃO sozinhas;
      // as que parecem ajuste/recusa/dúvida ficam abertas e destacadas (podem contradizer a aprovação)
      const rev=e.revisao||(ult&&ult.revisao);
      const outras=pendentes().filter(x=>x.id!==id && (!x.revisao||x.revisao===rev));
      const confirma=outras.filter(x=>x.sugestao==='aprovacao'), conflito=outras.filter(x=>x.sugestao!=='aprovacao');
      for(const x of confirma){ try{ await SB.from('orcamento_eventos').update({classificacao:'outro',classificacao_motivo:`confirmação da aprovação da R${rev}`,classificado_por_nome:`automático (aprovação da R${rev})`}).eq('id',x.id).is('classificacao',null); }catch(_){} }
      toast(`${ms('verified','font-size:16px')} <b>Aprovada a R${rev}.</b> O comprovante foi criado com esta resposta.`
        +(confirma.length?` ${confirma.length===1?'A outra resposta que também dizia "aprovado" foi registrada':confirma.length+' outras respostas que também diziam "aprovado" foram registradas'} como <b>confirmação</b>.`:'')
        +(conflito.length?` <b>Atenção:</b> ${conflito.length} resposta${conflito.length>1?'s':''} ainda aberta${conflito.length>1?'s':''} pode${conflito.length>1?'m':''} contradizer a aprovação: confira.`:''));
    }
    if(cls==='outro' && /^confirma/i.test(motivo||'')) toast('Registrada como <b>confirmação</b> da aprovação.');
    if(cls==='recusa'){ S.status='recusado'; try{ recalc(); }catch(_){} pushOrc(); try{ writeback(S._total||0); }catch(_){} window.renderBanner(); toast('Registrado como <b>recusa</b> ('+esc(motivo)+').'); }
    if(cls==='ajuste') toast('Registrado como <b>pedido de ajuste</b>. Crie a próxima revisão quando for alterar.');
    fechar(); await carregarEventos(); try{ decorar(); }catch(_){ renderTrat(); }
  }catch(err){ console.error('classificar',err); toast('Não consegui registrar: '+esc(err.message||String(err))); }
}
function motivoRecusaUI(id){
  modal(`<div class="envh">${ms('do_not_disturb_on')}Motivo da recusa<button class="envx" onclick="EXENV.fechar()">${ms('close')}</button></div>
    <p class="envp">Obrigatório: é o que mostra, com o tempo, por que perdemos propostas.</p>
    <div class="trchips">${MOTIVOS.map(m=>`<button class="envbtn" onclick="EXENV.classificar('${id}','recusa','${m}')">${esc(m)}</button>`).join('')}</div>`); }
function revDoAjuste(id){ const e=ENV.eventos.find(x=>x.id===id); ENV._motivoRev=e?String(e.texto||'').replace(/\s+/g,' ').slice(0,90):null; criarRevisao(true); }

function contatoUI(){ const f=ENV._ct||(ENV._ct={canal:'telefone',cls:'',texto:'',rev:(ultimaEnviada()||{}).revisao||revTrab()});
  const revs=[...new Set(vivas().filter(v=>v.status!=='preparada').map(v=>v.revisao))];
  modal(`<div class="envh">${ms('add_call')}Registrar contato com o cliente<button class="envx" onclick="EXENV.fechar()">${ms('close')}</button></div>
    <label class="envlb">Por onde</label><div class="trchips">${Object.keys(CANAL_IC).map(c=>`<button class="envbtn ${f.canal===c?'pri':''}" onclick="EXENV._ct.canal='${c}';EXENV.contatoUI()">${ms(CANAL_IC[c])}${c}</button>`).join('')}</div>
    <label class="envlb">O que o cliente disse</label><div class="trchips"><button class="envbtn ${!f.cls?'pri':''}" onclick="EXENV._ct.cls='';EXENV.contatoUI()">Só registrar</button>${Object.keys(CLS).filter(k=>k!=='outro').map(k=>`<button class="envbtn ${f.cls===k?'pri':''}" onclick="EXENV._ct.cls='${k}';EXENV.contatoUI()">${ms(CLS[k][0])}${CLS[k][1]}</button>`).join('')}</div>
    ${revs.length?`<label class="envlb">Sobre qual revisão</label><select class="envin" style="width:auto" onchange="EXENV._ct.rev=+this.value">${revs.map(r=>`<option value="${r}" ${r===f.rev?'selected':''}>R${r}</option>`).join('')}</select>`:''}
    <label class="envlb">Resumo</label><textarea class="envin ta" style="height:110px" oninput="EXENV._ct.texto=this.value" placeholder="Ex.: ligou o Denis, pediu para retirar o item 4">${esc(f.texto)}</textarea>
    <div class="envact"><button class="envbtn" onclick="EXENV.fechar()">Cancelar</button><button class="envbtn pri" onclick="EXENV.salvarContato()">${ms('check')}Registrar</button></div>`); }
async function salvarContato(){ const f=ENV._ct; if(!f) return;
  if(!String(f.texto||'').trim()){ toast('Escreva um resumo do contato.'); return; }
  const v=vivas().find(x=>x.revisao===f.rev&&x.status!=='preparada');
  const id=await evento({ tipo:'contato', canal:f.canal, revisao:f.rev||null, versao_id:v?v.id:null, titulo:`Contato por ${f.canal}`, texto:f.texto.trim() });
  if(!id){ toast('Não consegui registrar o contato.'); return; }
  const cls=f.cls; ENV._ct=null; await carregarEventos();
  if(cls) await classificar(id,cls); else { fechar(); try{ decorar(); }catch(_){ renderTrat(); } toast('Contato registrado.'); }
}
async function anular(id){ const e=ENV.eventos.find(x=>x.id===id); if(!e) return;
  const motivo=prompt(e.tipo==='email_cliente'&&!e.classificacao?'Por que esta resposta não é desta proposta? (fica registrado)':'Motivo para anular este registro (fica registrado, nada é apagado):');
  if(motivo===null) return; if(!motivo.trim()){ toast('Anular exige um motivo.'); return; }
  const u=await SB.from('orcamento_eventos').update({anulado_em:new Date().toISOString(),anulado_por_nome:USER_NOME||'',anulado_motivo:motivo.trim()}).eq('id',id).is('anulado_em',null);
  if(u.error){ toast('Não consegui anular: '+esc(u.error.message)); return; }
  await carregarEventos(); try{ decorar(); }catch(_){ renderTrat(); } toast('Registro anulado (continua visível no histórico).'); }
async function abrirAnexo(path){ if(!path) return;
  if(String(path).indexOf('anexos:')!==0){ window.open(path,'_blank'); return; }
  try{ const {data,error}=await SB.storage.from('anexos').createSignedUrl(path.slice(7),3600); if(error) throw error; window.open(data.signedUrl,'_blank'); }
  catch(e){ toast('Não consegui abrir o anexo: '+esc(e.message||String(e))); } }
async function verEmail(id){ const e=ENV.eventos.find(x=>x.id===id); if(!e||!e.mensagem_id) return;
  modal(`<div class="envh">${ms('hourglass_top')}Abrindo e-mail…</div>`);
  const {data:m,error}=await SB.from('email_mensagens').select('direcao,de,para,cc,assunto,texto,anexos,ocorrido_em,entrega').eq('id',e.mensagem_id).maybeSingle();
  if(error||!m){ modal(`<div class="envh">${ms('error')}E-mail não encontrado</div><div class="envact"><button class="envbtn" onclick="EXENV.fechar()">Fechar</button></div>`); return; }
  const L=a=>(a||[]).join(', ');
  modal(`<div class="envh">${ms('mail')}${esc(m.assunto||'(sem assunto)')}<button class="envx" onclick="EXENV.fechar()">${ms('close')}</button></div>
    <div class="envsis"><div class="envsis-r"><span>De</span><b>${esc(m.de||'')}</b></div><div class="envsis-r"><span>Para</span><b>${esc(L(m.para))}</b></div>${(m.cc||[]).length?`<div class="envsis-r"><span>Cópia</span><b>${esc(L(m.cc))}</b></div>`:''}
      <div class="envsis-r"><span>Data</span><b>${brDH(m.ocorrido_em)}</b>${m.entrega?`<em>entrega: ${esc(m.entrega)}</em>`:''}</div></div>
    <div class="trfull">${esc(m.texto||'')}</div>
    <div class="trlinks">${anexosHtml(m)}</div>
    <div class="envact"><button class="envbtn pri" onclick="EXENV.fechar()">Fechar</button></div>`,true); }
// atualiza sozinho: a cada 60 s com a aba visível e ao voltar para a aba
setInterval(()=>{ if(document.visibilityState==='visible' && CLOUD && ORC_ID && ENV.evCarregado) carregarEventos(); },60000);
window.addEventListener('focus',()=>{ if(CLOUD && ORC_ID && ENV.evCarregado) carregarEventos(); });

/* ============================================================================
   SINCRONIA PROPOSTA ↔ FUNIL (dono aprovou 14/09/2026)
   (a) fonte única do cliente: trocar cliente/loja na proposta atualiza a OPORTUNIDADE (o card do funil segue)
   (b) sinaliza o funil ('ex_orc_sync') a cada gravação → o funil recarrega sozinho (eX_CRM.html escuta)
   (c) alteração NÃO salva: aviso ao voltar ao funil + sinal 'ex_orc_dirty' que o funil mostra em destaque
   ============================================================================ */
let OPP_VINC=null;   // {c: contratante_id, l: contemplado_id} como está gravado na oportunidade
function sinalFunil(){ try{ localStorage.setItem('ex_orc_sync',JSON.stringify({opp:OPP,t:Date.now()})); }catch(e){} }
async function sincronizarOportunidade(){
  if(!(OPP&&CLOUD&&SB) || (typeof MODELO_V2!=='undefined'&&MODELO_V2)) return;
  try{
    if(!OPP_VINC){ const {data}=await SB.from('oportunidades').select('contratante_id,contemplado_id').eq('id',OPP).maybeSingle(); if(!data) return; OPP_VINC={c:data.contratante_id||null,l:data.contemplado_id||null}; }
    const upd={};
    if(S.contratanteId && S.contratanteId!==OPP_VINC.c) upd.contratante_id=S.contratanteId;
    // loja: só em proposta avulsa. Mestra não tem loja; unidade de lote tem a loja definida pelo próprio lote
    // (14/09: há unidades Copeland com loja divergente entre oportunidade e proposta — não propagar até conferir)
    const emLote=(typeof S_LOTE_ID!=='undefined'&&S_LOTE_ID);
    if(S.lojaId && S.lojaId!==OPP_VINC.l && !S._base && !emLote) upd.contemplado_id=S.lojaId;
    if(!Object.keys(upd).length) return;
    const {error}=await SB.from('oportunidades').update(upd).eq('id',OPP);
    if(error) throw error;
    if(upd.contratante_id) OPP_VINC.c=upd.contratante_id; if(upd.contemplado_id) OPP_VINC.l=upd.contemplado_id;
    sinalFunil();
  }catch(e){ console.error('sincronizar oportunidade',e); }
}
// (14/09, regra do dono "a OPORTUNIDADE manda"): a proposta NÃO escreve mais cliente/loja na oportunidade — só avisa o funil que gravou.
// sincronizarOportunidade() fica sem uso (caminho único: oportunidade → proposta, abaixo).
if(typeof window.pushOrc==='function'){ const _pushOrc=window.pushOrc;
  window.pushOrc=function(){ const r=_pushOrc.apply(this,arguments); try{ if(OPP&&CLOUD) sinalFunil(); }catch(e){} return r; }; }

/* ---------- A OPORTUNIDADE MANDA: cliente, loja e contato da proposta vêm dela ----------
   Avulsa: contratante + loja + contato. Lote (mestra/unidade): só contratante + contato — a loja de cada unidade
   é CONTEMPLADA e vem do próprio lote (regra do dono 14/09). Trocar = janela "Editar oportunidade" do CRM. */
let OPP_ROW=null;
const emLoteAtual=()=>!!(typeof S_LOTE_ID!=='undefined'&&S_LOTE_ID);
async function lerOportunidade(){
  if(!(OPP&&SB)) return null;
  try{ const {data,error}=await SB.from('oportunidades').select('contratante_id,contemplado_id,contato_nome,contato_fone,contato_email,objeto').eq('id',OPP).maybeSingle();
    if(error) throw error; return data||null; }catch(e){ console.error('ler oportunidade',e); return null; }
}
function aplicarOportunidade(row){
  if(!row||!S) return false; let mudou=false;
  if(row.contratante_id && S.contratanteId!==row.contratante_id){ S.contratanteId=row.contratante_id; mudou=true; }
  if(!emLoteAtual() && row.contemplado_id && S.lojaId!==row.contemplado_id){ S.lojaId=row.contemplado_id; mudou=true; }
  return mudou;
}
function aplicarContatoOportunidade(){
  if(!OPP_ROW||!S) return;
  if(OPP_ROW.contato_nome) S.cliContato=OPP_ROW.contato_nome;
  if(OPP_ROW.contato_fone) S.cliFone=OPP_ROW.contato_fone;
  if(OPP_ROW.contato_email) S.cliEmail=OPP_ROW.contato_email;
}
if(typeof window.carregarOrc==='function'){ const _carregarOrc=window.carregarOrc;
  window.carregarOrc=async function(){ const r=await _carregarOrc.apply(this,arguments);
    try{ if(OPP&&SB){ const {data:{session}}=await SB.auth.getSession(); if(session){ OPP_ROW=await lerOportunidade(); aplicarOportunidade(OPP_ROW); } } }catch(e){ console.error('oportunidade manda',e); }
    return r; }; }
if(typeof window.refreshClienteLive==='function'){ const _rcl=window.refreshClienteLive;
  window.refreshClienteLive=function(){ const r=_rcl.apply(this,arguments); try{ aplicarContatoOportunidade(); }catch(e){} return r; }; }
// cabeçalho: dados que vêm da oportunidade ficam travados; o botão "CRM" vira "Editar oportunidade"
function travarCabecalho(){
  if(!OPP||!S) return;
  const lote=emLoteAtual();
  const campos=['cliNome','cliContato','cliFone','cliEmail'].concat(lote?[]:['finNome','finRede','finNum','finEnd']);
  campos.forEach(k=>{ const el=document.querySelector('[data-m="'+k+'"]'); if(!el) return;
    el.readOnly=true; el.classList.add('env-opp-lock'); el.title='Vem da oportunidade. Para trocar, use "Editar oportunidade".'; });
  document.querySelectorAll('.fpick').forEach(b=>{ const oc=b.getAttribute('onclick')||'';
    const alvo=/openHP\('contratante'\)/.test(oc)||(!lote&&/openHP\('final'\)/.test(oc));
    if(!alvo||b.dataset.envOpp) return;
    b.dataset.envOpp='1'; b.setAttribute('onclick','EXENV.editarOportunidade()'); b.title='Cliente, loja e contato vêm da oportunidade';
    b.innerHTML='<span class="material-symbols-rounded">edit_note</span>Editar oportunidade'; });
}
if(typeof window.bindFields==='function'){ const _bind=window.bindFields;
  window.bindFields=function(){ const r=_bind.apply(this,arguments); try{ travarCabecalho(); }catch(e){ console.error('travar cabeçalho',e); } return r; }; }
ENV.editarOportunidade=function(){
  if(!OPP) return;
  try{ localStorage.setItem('ex_abrir_opp',JSON.stringify({opp:OPP,t:Date.now()})); }catch(_){}
  try{ if(window.top!==window.self){ parent.postMessage({type:'exNav',view:'funil'},'*'); return; } }catch(_){}
  location.href='eX_CRM.html?m=funil&editar='+encodeURIComponent(OPP);
};
// a oportunidade foi editada (em outro quadro do app) com esta proposta aberta → acompanha na hora
window.addEventListener('storage',async function(e){
  if(e.key!=='ex_opp_sync'||!e.newValue||!OPP||!S) return;
  let d=null; try{ d=JSON.parse(e.newValue); }catch(_){} if(!d||d.opp!==OPP) return;
  const lojaAntes=S.lojaId, foto=()=>[S.contratanteId,S.lojaId,S.cliNome,S.cliContato,S.cliFone,S.cliEmail,S.finNome,S.finEnd].join('|'), antes=foto();
  OPP_ROW=await lerOportunidade(); if(!OPP_ROW) return;
  aplicarOportunidade(OPP_ROW);
  try{ refreshClienteLive(); }catch(_){}
  if(foto()===antes) return;   // a edição não mexeu em nada que a proposta usa (ex.: só temperatura)
  try{ bindFields(); }catch(_){}
  if(S.lojaId!==lojaAntes && typeof carregarRaio==='function'){ try{ await carregarRaio(); }catch(_){} }
  try{ recalc(); }catch(_){} try{ window.renderBanner(); }catch(_){}
  toast(travada()
    ? `Os dados do cliente mudaram na oportunidade. A <b>R${revTrab()}</b> já enviada continua como foi; para enviar com os dados novos, crie a <b>R${revTrab()+1}</b>.`
    : 'Cliente/contato atualizados a partir da <b>oportunidade</b>.');
});
function tituloProposta(){ return [S&&S.cliNome,S&&S.finNome].filter(x=>String(x||'').trim()).join(' — ')||(S&&S.numero)||''; }
if(typeof window.renderSaveState==='function'){ const _rss=window.renderSaveState;
  window.renderSaveState=function(){ const r=_rss.apply(this,arguments);
    try{ if(!OPP) return r; let cur=null; try{ cur=JSON.parse(localStorage.getItem('ex_orc_dirty')||'null'); }catch(_){}
      const sujo=(typeof MANUAL!=='undefined'&&MANUAL)&&(typeof DIRTY!=='undefined'&&DIRTY);
      if(sujo){ if(!cur||cur.opp!==OPP) localStorage.setItem('ex_orc_dirty',JSON.stringify({opp:OPP,titulo:tituloProposta(),t:Date.now()})); }
      else if(cur&&cur.opp===OPP){ localStorage.removeItem('ex_orc_dirty'); }
    }catch(e){}
    return r; }; }
if(typeof window.voltarFunil==='function'){ const _voltar=window.voltarFunil;
  window.voltarFunil=function(){
    const sujo=(typeof MANUAL!=='undefined'&&MANUAL)&&(typeof DIRTY!=='undefined'&&DIRTY);
    ENV._destino=ENV._destinoPend||null; ENV._destinoPend=null;   // só o "Ir para o funil" troca o destino
    if(!sujo) return _voltar.apply(this,arguments);
    modal(`<div class="envh">${ms('warning','color:var(--amber,#ba7517)')}Alterações não salvas</div>
      <p class="envp">Você mudou esta proposta e <b>não salvou</b>. Sem salvar, o funil e as outras telas continuam com os dados antigos.</p>
      <div class="envact"><button class="envbtn" onclick="EXENV.fechar()">Continuar editando</button>
        <button class="envbtn danger" onclick="EXENV.sairSemSalvar()">${ms('undo')}Descartar alterações</button>
        <button class="envbtn pri" onclick="EXENV.salvarEVoltar()">${ms('save')}Salvar e voltar</button></div>`);
  };
  const destino=()=>{ const f=ENV._destino||_voltar; ENV._destino=null; f(); };
  ENV.salvarEVoltar=function(){ fechar(); try{ salvarManual(); }catch(e){ console.error(e); }
    if(typeof DIRTY!=='undefined'&&DIRTY) return;   // o próprio Salvar pode ter sido cancelado (ex.: material pendente)
    destino(); };
  ENV.sairSemSalvar=async function(){ fechar();
    try{ await carregarOrc(); boot(); DIRTY=false; renderSaveState(); }catch(e){ console.error('descartar',e); }
    try{ const cur=JSON.parse(localStorage.getItem('ex_orc_dirty')||'null'); if(cur&&cur.opp===OPP) localStorage.removeItem('ex_orc_dirty'); }catch(_){}
    destino(); };
}
// "Ir para o funil": abre o CARD desta oportunidade no funil (de qualquer origem: menu Orçamentos ou funil)
function abrirCardFunil(){
  try{ localStorage.setItem('ex_abrir_opp',JSON.stringify({opp:OPP,t:Date.now(),modo:'ver'})); }catch(_){}
  try{ if(window.top!==window.self){ parent.postMessage({type:'exNav',view:'funil'},'*'); return; } }catch(_){}
  location.href='eX_CRM.html?m=funil&ver='+encodeURIComponent(OPP);
}
ENV.irFunil=function(){
  if(!OPP) return;
  const sujo=(typeof MANUAL!=='undefined'&&MANUAL)&&(typeof DIRTY!=='undefined'&&DIRTY);
  if(!sujo || typeof window.voltarFunil!=='function') return abrirCardFunil();
  ENV._destinoPend=abrirCardFunil; window.voltarFunil();   // mesmo aviso de "alterações não salvas", indo pro card
};

/* ---------- API p/ os onclick ---------- */
Object.assign(ENV,{abrirEnvio,preparar,confirmar,descartar,retomar,criarRevisao,
  historico,fechar,setF,fix,fixValidade,abrirEmail,baixarPDF,copiarTexto,ck,travada,revTrab,carregarVersoes,
  modoManual,enviarSistema,checarSistema,carregarEventos,renderTrat,irTrat,classificar,revDoAjuste,contatoUI,salvarContato,anular,abrirAnexo,verEmail,verPDF,abrirPDFPrep,gerarPDF});

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
/* envio pelo sistema */
.envsis{border:1px solid var(--line,#ddd);border-radius:10px;overflow:hidden;margin:8px 0}
.envsis-r{display:grid;grid-template-columns:120px 1fr;gap:4px 10px;padding:7px 12px;border-top:1px solid var(--line,#ddd);font-size:12.5px;align-items:baseline}
.envsis-r:first-child{border-top:none}
.envsis-r span{color:var(--tx3,#888);font-weight:600}.envsis-r b{font-weight:600;color:var(--tx,#1a1a18);word-break:break-word;display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
.envsis-r em{grid-column:2;font-style:normal;font-size:11px;color:var(--pri,#533ab7)}
.enverr{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--red,#a32d2d);background:#fcebeb;border-radius:9px;padding:9px 11px;margin-top:8px}
.envinfo span{flex:1}
.envbtn.okb{background:var(--green,#3b6d11);border-color:var(--green,#3b6d11);color:#fff}
.envbtn.sm2{padding:5px 9px;font-size:11.5px}
.envchip.newr{background:var(--pri,#533ab7);color:#fff;border:none;cursor:pointer;animation:envpulse 2s ease-in-out 3}
@keyframes envpulse{50%{box-shadow:0 0 0 5px rgba(83,58,183,.25)}}
/* tratativas */
.trw{background:var(--surf,#fff);border:1px solid var(--line,#ddd);border-radius:12px;padding:12px 14px;margin:0 0 14px}
.trh{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:8px;flex-wrap:wrap}
.trh>.material-symbols-rounded{color:var(--pri,#533ab7);font-size:20px}
.trbadge{font-size:11px;font-weight:800;background:var(--pri,#533ab7);color:#fff;border-radius:10px;padding:2px 8px}
.trnext{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--pri-bg,#eeedfe);color:var(--pri,#533ab7);border-radius:10px;padding:9px 12px;font-size:12.5px;margin-bottom:10px}
.trnext span{flex:1;min-width:200px;color:var(--tx2,#555)}
.trnew{border:2px solid var(--pri,#533ab7);background:#fbfaff;border-radius:12px;padding:11px 12px;margin-bottom:10px}
.trnew-h{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;color:var(--pri,#533ab7)}
.trnew-t{font-size:13.5px;font-weight:700;margin:4px 0 6px;color:var(--tx,#1a1a18)}
.trq{background:var(--surf,#fff);border:1px solid var(--line,#ddd);border-left:3px solid var(--blue,#185fa5);border-radius:0 9px 9px 0;padding:8px 11px;font-size:13px;white-space:pre-wrap;color:var(--tx,#1a1a18)}
.trm{font-size:11.5px;color:var(--tx3,#888);font-weight:500;text-transform:none;letter-spacing:0}
.trrv{font-size:10px;font-weight:800;background:var(--tx,#1a1a18);color:#fff;border-radius:5px;padding:1px 6px;text-transform:none}
.trrv.old{background:var(--tx3,#888)}
.trsug{display:flex;gap:8px;align-items:flex-start;border-radius:9px;padding:8px 11px;margin:8px 0;font-size:12.5px}
.trsug div{display:flex;flex-direction:column}.trsug span{font-size:11.5px;color:var(--tx2,#555)}
.trsug.good{background:#e9f2dd;color:var(--green,#3b6d11)}.trsug.care{background:#faeeda;color:#8a560f}.trsug.info{background:var(--pri-bg,#eeedfe);color:var(--pri,#533ab7)}
.tracts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.trlinks{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
.tratt{display:inline-flex;align-items:center;gap:4px;font:600 11px inherit;color:var(--pri,#533ab7);background:var(--pri-bg,#eeedfe);border:none;border-radius:7px;padding:3px 8px;cursor:pointer}
.tratt .material-symbols-rounded{font-size:14px}
.tratt.ghost{background:none;color:var(--tx3,#888)}
.trlist{border-top:1px solid var(--line,#ddd);margin-top:4px}
.trev{display:flex;gap:9px;padding:8px 0;border-bottom:1px dashed var(--line,#ddd)}
.trev:last-child{border-bottom:none}
.trev.off{opacity:.55}.trev.off .trevt{text-decoration:line-through}
.tric{flex:0 0 28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--surf2,#f1efe8);color:var(--tx3,#888)}
.tric .material-symbols-rounded{font-size:15px}
.tric.blue{background:#e7f0fa;color:var(--blue,#185fa5)}.tric.pri{background:var(--pri-bg,#eeedfe);color:var(--pri,#533ab7)}.tric.green{background:#e9f2dd;color:var(--green,#3b6d11)}.tric.red{background:#fcebeb;color:var(--red,#a32d2d)}.tric.amber{background:#faeeda;color:var(--amber,#ba7517)}
.trevb{flex:1;min-width:0}
.trevt{font-size:12.5px;font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.trcl{font-size:10.5px;font-weight:800;border-radius:6px;padding:1px 7px}
.trcl.green{background:#e9f2dd;color:var(--green,#3b6d11)}.trcl.pri{background:var(--pri-bg,#eeedfe);color:var(--pri,#533ab7)}.trcl.red{background:#fcebeb;color:var(--red,#a32d2d)}.trcl.blue{background:#e7f0fa;color:var(--blue,#185fa5)}.trcl.gray{background:var(--surf2,#f1efe8);color:var(--tx2,#555)}
.trtx{font-size:12px;color:var(--tx2,#555);white-space:pre-wrap;margin-top:3px}.trtx.red{color:var(--red,#a32d2d)}
.trchips{display:flex;gap:6px;flex-wrap:wrap}
.trfull{white-space:pre-wrap;font-size:13px;line-height:1.5;background:var(--surf2,#f1efe8);border-radius:9px;padding:12px;max-height:50vh;overflow:auto;margin:8px 0}
/* tratativas em fundo preto (pedido do dono 14/09) + aprovação em dourado */
.trw{--surf:#1f1f1d;--surf2:#2a2a27;--line:#34342f;--line2:#4a4a44;--tx:#f3f1ea;--tx2:#c9c6bc;--tx3:#8f8c83;--pri:#a996f2;--pri-bg:#2b2544;--blue:#8cb8ea;--green:#9fd16b;--red:#f08a8a;--amber:#e8b25e;
  background:#111110;border-color:#111110;color:#f3f1ea}
.trw .envbtn.pri{color:#111110}.trw .envbtn.pri:hover{background:#bcaef5}
.trw .envbtn.okb{color:#111110}.trw .envbtn.danger{border-color:#6b3a3a}
.trnew{background:#181720}
.trsug.good{background:#1f2c14}.trsug.care{background:#33260f}.trsug.info{background:#2b2544}
.tric.blue{background:#16283c}.tric.pri{background:#2b2544}.tric.green{background:#1f2c14}.tric.red{background:#3a1b1b}.tric.amber{background:#33260f}
.trcl.green{background:#1f2c14}.trcl.pri{background:#2b2544}.trcl.red{background:#3a1b1b}.trcl.blue{background:#16283c}.trcl.gray{background:#2a2a27}
.trrv{background:#f3f1ea;color:#111110}.trrv.old{background:#5b5a55;color:#e6e3da}
.trbadge{color:#111110}
.tric.gold{background:#d4af37;color:#2b2000}
.trcl.gold{background:#d4af37;color:#2b2000}
.obst-aprov{background:#d4af37;color:#2b2000;border:none;box-shadow:none}
.obst-aprov .material-symbols-rounded{color:#2b2000}
@media print{#envTrat{display:none!important}}
@media screen{ .env-opp-lock{cursor:default;color:var(--tx,#1a1a18)} .env-opp-lock:focus{outline:none;box-shadow:none} }
@media screen{
  body.viewing.env-travada:not(.env-pdf) .oppbar{display:flex!important}
  body.viewing.env-travada:not(.env-pdf) #envTrat,body.viewing.env-travada:not(.env-pdf) #comprovantesPanel .cmp-wrap{display:block!important}
}
@media print{#envOv,#envToast{display:none!important}}
`; document.head.appendChild(css);

// se a folha já renderizou antes deste script carregar, decora agora
try{ if(document.querySelector('#oppBanner .ob-st')) decorar(); }catch(e){}
})();
