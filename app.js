/* Painéis da equipe Inabaláveis — atualizados em tempo real via Server-Sent Events. */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const brl0 = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const pct = (v) => `${Math.round((v || 0) * 100)}%`;
  const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } },
  };
  const PAGAMENTOS = ['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito'];

  let S = null;
  const ABAS = ['painel', 'colportor', 'gestao', 'ranking', 'lideres', 'mapa', 'meta', 'cadastro'];
  const TITULOS = { painel: 'Painel', colportor: 'Colportor', gestao: 'Gestão', ranking: 'Ranking', lideres: 'Líderes', mapa: 'Mapa', meta: 'Meta', cadastro: 'Cadastro' };
  let aba = ABAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : store.get('aba', 'painel');
  let colportorId = store.get('colportor', '');
  let modoRanking = 'hoje';
  let filtroSeg = '';
  let vistos = null;                 // ids de vendas já exibidas (para destacar as novas)
  let novas = new Set();
  let ultimoEnvio = null;            // { texto, messageId } para o teste de duplicidade
  let botoesChat = ['minhas vendas', 'produtos', 'ajuda'];
  let mapa = null;
  let marcadores = {};
  let chatCount = -1;

  // ---------- Toasts ----------
  function toast(texto, { acao, onAcao, festa = false, ms = 6000 } = {}) {
    const el = document.createElement('div');
    el.className = `toast${festa ? ' festa' : ''}`;
    el.innerHTML = `<span>${esc(texto)}</span>${acao ? `<button>${esc(acao)}</button>` : ''}`;
    if (acao) el.querySelector('button').onclick = () => { el.remove(); onAcao(); };
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---------- API: no Mac fala com o servidor local; na nuvem, com a função do Supabase ----------
  const SB = window.INAB_SUPABASE || null;
  let sb = null;
  async function chamar(url, { method = 'GET', body } = {}) {
    const corpo = method === 'GET' ? undefined : JSON.stringify(body || {});
    if (!SB) return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: corpo });
    const { data } = await sb.auth.getSession();
    const tk = data.session?.access_token;
    return fetch(`${SB.url}/functions/v1${url}`, {
      method, body: corpo,
      headers: { 'Content-Type': 'application/json', apikey: SB.key, Authorization: `Bearer ${tk || SB.key}` },
    });
  }
  async function post(url, body) {
    const res = await chamar(url, { method: 'POST', body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.erro || json.erros?.geral || Object.values(json.erros || {})[0] || `Erro ${res.status}`);
    return json;
  }

  async function desfazer(id) {
    try {
      const r = await post(`/api/vendas/${id}/desfazer`);
      toast(r.jaDesfeita ? 'Essa venda já estava desfeita.' : `↩️ Venda desfeita: ${r.resumo}`);
    } catch (e) { toast(e.message); }
  }

  // ---------- Tempo real ----------
  function receberEstado(novo) {
    S = novo;
    marcarNovas();
    $('#aoVivo').classList.remove('off');
    $('#aoVivo').classList.add('flash');
    setTimeout(() => $('#aoVivo').classList.remove('flash'), 800);
    $('#aoVivoTxt').textContent = `ao vivo · ${new Date().toLocaleTimeString('pt-BR')}`;
    render();
    document.dispatchEvent(new CustomEvent('inab:estado', { detail: S }));
  }
  function receberAviso(a) {
    document.dispatchEvent(new CustomEvent('inab:aviso', { detail: a }));
    toast(a.painel, { festa: true, ms: 9000 });
  }
  function conectar() {
    if (SB) return; // na nuvem, quem conecta é conectarNuvem() depois do login
    const es = new EventSource('/eventos');
    es.addEventListener('estado', (ev) => receberEstado(JSON.parse(ev.data)));
    es.addEventListener('aviso', (ev) => receberAviso(JSON.parse(ev.data)));
    es.onerror = () => {
      $('#aoVivo').classList.add('off');
      $('#aoVivoTxt').textContent = 'reconectando…';
    };
  }

  function marcarNovas() {
    const ids = new Set(S.vendasHoje.map((v) => v.id));
    novas = vistos ? new Set([...ids].filter((id) => !vistos.has(id))) : new Set();
    vistos = ids;
  }

  // ---------- Render ----------
  function render() {
    if (!S) return;
    const c = S.campanha;
    $('#campanha').textContent = new Date(S.hoje + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    if (!S.colportores.some((x) => x.id === colportorId)) colportorId = S.colportores[0]?.id;
    renderColportor();
    renderGestao();
    renderRanking();
    renderMapa();
    renderMeta();
    renderEscala();
    renderLocais();
    renderLideresHoje();
    renderLideres();
    renderAvaliacoes();
    renderEquipe();
    const b = $('#badgeCad');
    b.hidden = !S.cadastrosPendentes;
    b.textContent = S.cadastrosPendentes || '';
    $('#badgeMenu').hidden = !S.cadastrosPendentes;
    $('#badgeMenu').textContent = S.cadastrosPendentes || '';
    $('#chipDemo').hidden = !S.demo;
    $('#btnApresentacao').hidden = !(S.demo && eu?.diretor);
    $('#menuCampanha').textContent = `${S.campanha.nome} · ${S.equipe}`;
    if (eu?.diretor) carregarCadastros();
  }

  function kpis(el, itens) {
    const antes = Object.fromEntries([...el.querySelectorAll('.kpi')].map((k) => [k.dataset.k, k.querySelector('.valor').textContent]));
    el.innerHTML = itens.map(([rot, val, extra]) => `
      <div class="kpi${antes[rot] !== undefined && antes[rot] !== String(val) ? ' pisca' : ''}" data-k="${esc(rot)}">
        <div class="rotulo">${esc(rot)}</div><div class="valor">${esc(val)}</div>${extra ? `<div class="extra">${esc(extra)}</div>` : ''}
      </div>`).join('');
  }

  // Não existe fechamento: o que importa é se o colportor já relatou vendas hoje (lembrete às 20h).
  const lembreteDe = (c) => c.lembreteEm ?? c.fechamento?.lembreteEm ?? null;
  function relatos() {
    const total = S.colportores.length;
    const relataram = S.colportores.filter((c) => c.hoje.vendas > 0).length;
    return { total, relataram, semRelato: total - relataram };
  }
  function chipRelato(c) {
    if (c.hoje.vendas > 0) return `<span class="chip ok">Relatou ${c.hoje.vendas} venda(s) hoje</span>`;
    if (lembreteDe(c)) return `<span class="chip bad">Sem relato · lembrete ${hora(lembreteDe(c))}</span>`;
    return '<span class="chip">Ainda sem vendas hoje · lembrete às 20h</span>';
  }

  function renderColportor() {
    const sel = $('#selColportor');
    if (sel.options.length !== S.colportores.length) {
      sel.innerHTML = S.colportores.map((c) => `<option value="${c.id}">${esc(c.nome)} — ${esc(c.regiao)}</option>`).join('');
    }
    if (eu?.colportor) colportorId = eu.colportor.id;
    sel.closest('label').hidden = Boolean(eu?.colportor);
    sel.value = colportorId;
    const c = S.colportores.find((x) => x.id === colportorId);
    $('#btnNovaVenda').disabled = !c;
    $('#cardMeta').hidden = !c;
    $('#chatForm').querySelector('button').disabled = !c;
    if (!c) {
      $('#kpisColportor').innerHTML = '';
      $('#fechColportor').innerHTML = '';
      $('#listaVendasColportor').innerHTML = `<li class="vazio-bloco">Nenhum colportor cadastrado ainda.<br><button class="btn primario" data-ir="cadastro">Ir para o cadastro</button></li>`;
      $('#chatMsgs').innerHTML = '<p class="dica" style="text-align:center">O simulador fica disponível quando houver colportores aprovados.</p>';
      chatCount = '';
      return;
    }
    const pos = S.rankingHoje.find((r) => r.colportorId === c.id);
    kpis($('#kpisColportor'), [
      ['Vendido hoje (colportor)', brl(c.hoje.valor), `público ${brl(c.hoje.valorPublico)} · ${c.hoje.vendas} vendas`],
      ['Pódio hoje', pos?.valorPublico ? `${pos.pos}º` : '—', pos?.valorPublico && pos.pos <= 3 ? 'no pódio 🏆 (venda ao público)' : `de ${S.colportores.length} · venda ao público`],
      ['Campanha (colportor)', brl(c.campanha.valor), `público ${brl(c.campanha.valorPublico)} · ${c.campanha.vendas} vendas`],
      ['Média da equipe hoje', brl0(S.kpis.valorHoje / Math.max(1, S.colportores.length)), ''],
    ]);
    renderMetaPessoal(c);
    $('#fechColportor').outerHTML = `<span id="fechColportor">${chipRelato(c)}</span>`;

    const vendas = S.vendasHoje.filter((v) => v.colportorId === c.id);
    $('#listaVendasColportor').innerHTML = vendas.length ? vendas.map((v) => `
      <li class="${v.desfeita ? 'desfeita' : ''} ${novas.has(v.id) ? 'nova' : ''}">
        <span class="hora">${hora(v.criadaEm)}</span>
        <span class="desc">${v.qtd}x ${esc(v.produto)} <span class="dica">· ${esc(v.pagamento)}</span><span class="origem">${v.origem === 'whatsapp' ? 'WhatsApp' : 'app'}</span>${v.correcoes ? '<span class="origem">corrigida</span>' : ''}</span>
        <span class="val">${brl(v.valor)}<small class="pub">público ${brl(v.valorPublico ?? v.valor)}</small></span>
        ${v.desfeita ? '<span class="dica">desfeita</span>' : `<button class="btn pequeno" data-desfazer="${v.id}">Desfazer</button>`}
      </li>`).join('') : '<li class="vazio">Nenhuma venda hoje. Toque em <b>＋ Nova venda</b> ou envie pelo WhatsApp.</li>';

    // Chat
    const msgs = (S.conversas[c.id] || []).slice(-60);
    const box = $('#chatMsgs');
    const chave = `${c.id}:${msgs.length}:${msgs.at(-1)?.em}`;
    if (chave !== chatCount) {
      chatCount = chave;
      box.innerHTML = msgs.length ? msgs.map((m) => `
        <div class="bolha ${m.de}">${formatarWa(m.texto)}<span class="h">${hora(m.em)}</span></div>`).join('')
        : '<p class="dica" style="text-align:center">Envie uma venda, por exemplo: <b>vendi 2x Mente Positiva pix</b></p>';
      box.scrollTop = box.scrollHeight;
    }
    $('#chatBotoes').innerHTML = botoesChat.map((b) => `<button class="btn pequeno" data-chat="${esc(b)}">${esc(b)}</button>`).join('');
  }

  let editandoMeta = false;
  function renderMetaPessoal(c) {
    const m = c.meta;                         // null | {definida:false, opcaoBolsa} | {definida:true, ...}
    const bolsa = m?.opcaoBolsa;
    const form = $('#formMeta');
    const editar = editandoMeta || !m?.definida;
    form.hidden = !editar;
    $('#btnEditarMeta').hidden = !m?.definida || editandoMeta;
    $('#opBolsa').hidden = !bolsa;
    $('#opBolsaTxt').textContent = bolsa ? `${bolsa.curso}${bolsa.faculdade ? ` (${bolsa.faculdade})` : ''}: ${brl0(bolsa.valor)}` : '';
    $('#semBolsa').hidden = Boolean(bolsa);
    $('#semBolsa').textContent = c.curso
      ? `O curso "${c.curso}"${c.faculdade ? ` (${c.faculdade})` : ''} ainda não tem meta de bolsa cadastrada pelo Diretor. Você pode definir a sua própria meta.`
      : 'Defina a sua própria meta.';
    if (editar && form.dataset.para !== c.id) {   // preenche só ao abrir, para não apagar o que está sendo digitado
      form.dataset.para = c.id;
      const tipo = m?.definida ? m.tipo : (bolsa ? 'bolsa' : 'propria');
      form.tipo.value = bolsa ? tipo : 'propria';
      form.metaValor.value = m?.definida && m.tipo === 'propria' ? String(m.valor).replace('.', ',') : '';
      form.diasTrabalho.value = m?.definida ? m.dias : '';
      atualizarCampoValor();
    }
    if (!m?.definida) {
      $('#metaResumo').innerHTML = `<p class="dica">${bolsa ? 'Quer bater a bolsa do seu curso? Escolha abaixo e informe quantos dias vai trabalhar.' : 'Defina sua meta da campanha e quantos dias vai trabalhar.'} O app calcula quanto precisa vender por dia.</p>`;
      return;
    }
    $('#metaResumo').innerHTML = `
      <p class="dica">${m.tipo === 'bolsa' ? `🎓 Meta da bolsa de ${esc(bolsa?.curso || c.curso)}${bolsa?.faculdade ? ` (${esc(bolsa.faculdade)})` : ''}` : '🎯 Meta própria'} · realizado pelo valor de compra (preço colportor)</p>
      <div class="barra-mini"><div style="width:${Math.min(100, m.pct * 100)}%"></div></div>
      <div class="meta-pessoal">
        <div>Meta<b>${brl(m.valor)}</b></div>
        <div>Realizado (colportor)<b>${brl(m.realizado)} · ${pct(m.pct)}</b><small>público ${brl(m.realizadoPublico)}</small></div>
        <div>Falta<b>${brl(m.falta)}</b></div>
        <div>Dias trabalhados<b>${m.diasTrabalhados} de ${m.dias}</b></div>
        <div>Preciso vender por dia<b>${m.falta ? brl(m.necessarioPorDia) : 'Meta batida 🎉'}</b></div>
      </div>`;
  }
  function atualizarCampoValor() {
    const propria = $('#formMeta').tipo.value !== 'bolsa';
    $('#campoValorMeta').hidden = !propria;
    $('#formMeta').metaValor.required = propria;
  }
  $$('#formMeta input[name=tipo]').forEach((r) => (r.onchange = () => {
    atualizarCampoValor();
    if (r.value === 'propria') setTimeout(() => $('#formMeta').metaValor.focus(), 30);
  }));
  $('#btnEditarMeta').onclick = () => { editandoMeta = true; $('#formMeta').dataset.para = ''; renderColportor(); };
  $('#formMeta').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await post(`/api/colportores/${colportorId}/meta`, {
        tipo: f.get('tipo') || 'propria', metaValor: f.get('metaValor'), diasTrabalho: f.get('diasTrabalho'),
      });
      editandoMeta = false;
      e.target.dataset.para = '';
      toast('🎯 Meta salva.');
    } catch (err) { toast(err.message); }
  };

  // *negrito* do WhatsApp
  const formatarWa = (t) => esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');

  function renderGestao() {
    renderMensagem();
    const f = relatos();
    kpis($('#kpisGestao'), [
      ['Vendido hoje (colportor)', brl(S.kpis.valorHoje), `público ${brl(S.kpis.valorHojePublico)} · ${S.kpis.vendasHoje} vendas`],
      ['Relataram hoje', `${f.relataram}/${f.total}`, `${f.semRelato} ainda sem vendas`],
      ['Meta da campanha', pct(S.meta.pct), `projeção ${pct(S.meta.projecaoPct)}`],
    ]);
    $('#resumoFech').textContent = `${f.relataram} relataram · ${f.semRelato} sem relato`;

    const ultimaVenda = (id) => S.vendasHoje.filter((v) => v.colportorId === id && !v.desfeita).map((v) => v.criadaEm).sort().at(-1);
    const linhas = [...S.colportores].sort((a, b) => (a.hoje.vendas > 0) - (b.hoje.vendas > 0) || a.nome.localeCompare(b.nome));
    $('#tabFech').innerHTML = `
      <thead><tr><th>Colportor</th><th>Situação</th><th>Vendas do dia</th><th>Última venda</th><th>Lembrete 20h</th></tr></thead>
      <tbody>${linhas.length ? '' : '<tr><td colspan="5" class="vazio">Nenhum colportor cadastrado ainda.</td></tr>'}${linhas.map((c) => {
        const ult = ultimaVenda(c.id);
        const st = c.hoje.vendas > 0 ? '<span class="chip ok">Relatou</span>' : '<span class="chip bad">Sem relato</span>';
        return `<tr>
          <td><b>${esc(c.nome)}</b><br><span class="dica">${esc(c.regiao)}</span></td>
          <td>${st}</td>
          <td class="num">${brl(c.hoje.valor)}<br><span class="dica">público ${brl(c.hoje.valorPublico)} · ${c.hoje.vendas} vendas</span></td>
          <td class="num">${ult ? hora(ult) : '—'}</td>
          <td class="num">${lembreteDe(c) ? hora(lembreteDe(c)) : '—'}</td>
        </tr>`;
      }).join('')}</tbody>`;

    $('#qtdVendasHoje').textContent = `${S.kpis.vendasHoje} ativas`;
    $('#tabVendas').innerHTML = S.vendasHoje.length ? `
      <thead><tr><th>Hora</th><th>Colportor</th><th>Produto</th><th>Qtd</th><th>Pagamento</th><th>Colportor</th><th>Público</th><th>Origem</th><th></th></tr></thead>
      <tbody>${S.vendasHoje.map((v) => `
        <tr class="${v.desfeita ? 'desfeita' : ''} ${novas.has(v.id) ? 'nova' : ''}">
          <td class="num">${hora(v.criadaEm)}</td><td>${esc(v.colportor)}</td><td>${esc(v.produto)}</td>
          <td class="num">${v.qtd}</td><td>${esc(v.pagamento)}</td><td class="num">${brl(v.valor)}</td><td class="num">${brl(v.valorPublico ?? v.valor)}</td>
          <td>${v.origem === 'whatsapp' ? 'WhatsApp' : 'App'}${v.correcoes ? ' · corrigida' : ''}</td>
          <td>${v.desfeita ? '<span class="dica">desfeita</span>' : ''}</td>
        </tr>`).join('')}</tbody>` : '<tbody><tr><td class="vazio">Nenhuma venda hoje ainda.</td></tr></tbody>';
  }

  function renderRanking() {
    const bolsa = modoRanking === 'bolsa';
    const fs = $('#filtroSegmento');
    if (fs.options.length !== S.segmentos.length + 1) {
      fs.innerHTML = '<option value="">Todos os segmentos</option>' + S.segmentos.map((s) => `<option>${esc(s)}</option>`).join('');
      fs.value = filtroSeg;
    }
    const base = bolsa ? S.rankingBolsa : modoRanking === 'hoje' ? S.rankingHoje : S.rankingCampanha;
    const rk = (filtroSeg ? base.filter((r) => r.segmento === filtroSeg) : base).map((r, i) => ({ ...r, pos: i + 1 }));
    $('#criterioRanking').textContent = bolsa
      ? '🎓 Ranking da bolsa: quanto cada colportor já fez da própria meta, pelo preço colportor (valor de compra).'
      : '🏆 Pódio e premiação: pelo valor de venda ao público.';
    // valor principal de cada linha conforme o critério
    const principal = (r) => (bolsa ? (r.pct ?? 0) : r.valorPublico);
    const temValor = (r) => (bolsa ? r.pct != null && r.realizado > 0 : r.valorPublico > 0);
    const pct1 = (v) => `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    const rotulo = (r) => (bolsa ? (r.pct != null ? pct1(r.pct) : 'sem meta') : brl(r.valorPublico));

    const top = rk.slice(0, 3);
    const medalha = ['🥇', '🥈', '🥉'];
    const ordem = [1, 0, 2].map((i) => top[i]).filter(Boolean);
    $('#podio').innerHTML = rk.length ? ordem.map((r) => `
      <div class="degrau p${r.pos}">
        <div class="medalha">${temValor(r) ? medalha[r.pos - 1] : ''}</div>
        <div class="nome">${temValor(r) ? esc(r.nome.split(' ')[0]) : '—'}</div>
        <div class="v">${temValor(r) ? rotulo(r) : 'lugar vago'}</div>
        <div class="bloco">${r.pos}</div>
      </div>`).join('') : '<p class="vazio" style="grid-column:1/-1">O pódio aparece quando houver colportores cadastrados.</p>';

    const max = Math.max(bolsa ? 1 : 0.01, ...rk.map(principal));
    $('#listaRanking').innerHTML = rk.map((r) => {
      const detalhe = bolsa
        ? (r.pct != null
          ? `${brl(r.realizado)} de ${brl(r.meta)} (colportor)${r.tipo === 'bolsa' ? ` · bolsa ${esc(r.curso)}${r.faculdade ? ` (${esc(r.faculdade)})` : ''}` : ' · meta própria'}`
          : `${brl(r.realizado)} (colportor) · ainda não definiu a meta`)
        : `${esc(r.regiao)}${r.segmento ? ` · ${esc(r.segmento)}` : ''} · ${r.vendas} vendas · colportor ${brl(r.valor)}`;
      return `
      <li>
        <span class="pos">${r.pos}º</span>
        <div><b>${esc(r.nome)}</b> <span class="dica">· ${detalhe}</span>
          <div class="barra-r" style="width:${Math.min(100, (principal(r) / max) * 100)}%"></div></div>
        <span class="v">${rotulo(r)}</span>
      </li>`;
    }).join('');
  }

  const metaDe = (id) => S.colportores.find((c) => c.id === id)?.meta;

  function renderMapa() {
    const ordem = [...S.colportores].sort((a, b) => b.hoje.valorPublico - a.hoje.valorPublico);
    if ($('#listaMapa')) $('#listaMapa').innerHTML = ordem.map((c) => `
      <li><div><b>${esc(c.regiao)}</b><small>${esc(c.nome)}</small></div>
      <div style="text-align:right"><b>${brl0(c.hoje.valorPublico)}</b><small>${c.hoje.vendas} vendas hoje · ao público</small></div></li>`).join('');
    if (aba !== 'mapa') return;
    if (typeof L === 'undefined') {
      $('#mapa').innerHTML = '<p class="mapa-fallback">Mapa indisponível sem internet. A lista ao lado continua atualizando em tempo real.</p>';
      return;
    }
    if (!mapa) {
      mapa = L.map('mapa', { scrollWheelZoom: false });
      camadaMapa = camadaDoTema().addTo(mapa);
      // nomes só com o mapa mais perto (no mapa afastado ficam só os bonecos)
      const ajustarNomes = () => {
        $('#mapa').classList.toggle('mapa-longe', mapa.getZoom() < 10);
        $('#mapa').classList.toggle('mapa-medio', mapa.getZoom() < 13); // nomes dos bairros só bem de perto
      };
      mapa.on('zoomend', ajustarNomes);
      setTimeout(ajustarNomes, 0);
      // abre enquadrado na sede e no que fica até ~60 km dela (Fortaleza e arredores); afastando, aparecem as demais cidades
      const sedeIni = S.locais.find((l) => l.tipo === 'sede');
      const perto = (p) => !sedeIni || km(sedeIni, p) <= 60;
      const pontos = [...S.colportores, ...S.locais].filter(perto).map((c) => [c.lat, c.lng]);
      if (pontos.length) mapa.fitBounds(pontos, { padding: [50, 50], maxZoom: 10 });
      else mapa.setView([-6.36, -39.3], 8);
    }
    atualizarMarcadores();
  }

  function renderMeta() {
    const m = S.meta;
    if (!m.metaValor) {
      $('#metaTitulo').textContent = 'Meta da campanha';
      $('#legendaMeta').innerHTML = '<span>A meta da equipe é a soma das metas individuais. Ainda nenhum colportor definiu a sua meta (painel do colportor → <b>Minha meta</b>).</span>';
      $('#barraReal').style.width = '0'; $('#barraProj').style.width = '0';
      $('#kpisMeta').innerHTML = ''; $('#graficoMeta').innerHTML = '';
      return;
    }
    $('#metaTitulo').textContent = `Meta da campanha — ${brl0(m.metaValor)}${m.origemMeta === 'soma' ? ` (soma das metas de ${m.comMeta} colportor${m.comMeta === 1 ? '' : 'es'})` : ''}`;
    $('#barraReal').style.width = `${Math.min(100, m.pct * 100)}%`;
    $('#barraProj').style.width = `${Math.min(100, m.projecaoPct * 100)}%`;
    $('#legendaMeta').innerHTML = `
      <span>Realizado <b>${brl(m.realizado)}</b> colportor (${pct(m.pct)}) · ${brl(m.realizadoPublico)} público</span>
      <span>Projeção no ritmo atual <b>${brl0(m.projecao)}</b> (${pct(m.projecaoPct)})</span>
      <span>Dia <b>${m.diasDecorridos}</b> de ${m.diasTotais}</span>`;
    const atinge = m.projecao >= m.metaValor;
    kpis($('#kpisMeta'), [
      ['Ritmo atual', `${brl0(m.ritmoDiario)}/dia`, 'média da equipe'],
      ['Necessário', `${brl0(m.necessarioPorDia)}/dia`, `nos ${m.diasRestantes} dias restantes`],
      ['Projeção', atinge ? 'Bate a meta ✅' : 'Abaixo da meta', `${brl0(m.projecao - m.metaValor)} vs. meta`],
      ['Falta', brl0(Math.max(0, m.metaValor - m.realizado)), ''],
    ]);
    $('#graficoMeta').innerHTML = grafico(m);
  }

  function grafico(m) {
    const W = 800; const H = 260; const pl = 84; const pr = 16; const pt = 16; const pb = 28;
    const bruto = Math.max(m.metaValor, m.projecao, m.realizado) * 1.05;
    const mag = 10 ** Math.floor(Math.log10(bruto / 4));
    const passo = Math.ceil(bruto / 4 / mag) * mag;   // divisões "redondas"
    const ymax = passo * 4;
    const x = (i) => pl + (i / (m.diasTotais - 1)) * (W - pl - pr);
    const y = (v) => pt + (1 - v / ymax) * (H - pt - pb);
    const ticks = [0, 1, 2, 3, 4].map((k) => k * passo);
    const real = m.porDia.map((d, i) => `${x(i)},${y(d.acumulado)}`).join(' ');
    const ult = m.porDia.length - 1;
    const ultV = m.porDia[ult]?.acumulado || 0;
    const cor = getComputedStyle(document.documentElement).getPropertyValue('--serie').trim() || '#38a9e0';
    const linha = getComputedStyle(document.documentElement).getPropertyValue('--line').trim();
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Vendas acumuladas comparadas à meta">
      ${ticks.map((t) => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="${linha}"/><text x="${pl - 8}" y="${y(t) + 4}" text-anchor="end">${brl0(t)}</text>`).join('')}
      <line x1="${x(0)}" y1="${y(0)}" x2="${x(m.diasTotais - 1)}" y2="${y(m.metaValor)}" stroke="${muted}" stroke-dasharray="2 4" stroke-width="1.5"/>
      <text x="${x(m.diasTotais - 1)}" y="${y(m.metaValor) - 6}" text-anchor="end">meta</text>
      <line x1="${x(ult)}" y1="${y(ultV)}" x2="${x(m.diasTotais - 1)}" y2="${y(m.projecao)}" stroke="${cor}" stroke-dasharray="6 5" stroke-width="2" opacity=".6"/>
      <text x="${x(m.diasTotais - 1)}" y="${y(m.projecao) + 16}" text-anchor="end">projeção</text>
      <polyline points="${real}" fill="none" stroke="${cor}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="${x(ult)}" cy="${y(ultV)}" r="5" fill="${cor}"/>
      <text x="${pl}" y="${H - 8}">${new Date(S.campanha.inicio + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</text>
      <text x="${x(ult)}" y="${H - 8}" text-anchor="middle">hoje</text>
      <text x="${W - pr}" y="${H - 8}" text-anchor="end">${new Date(S.campanha.fim + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</text>
    </svg>`;
  }

  // ---------- Abas ----------
  function mostrarAba(nome) {
    aba = nome;
    store.set('aba', nome);
    history.replaceState(null, '', `#${nome}`);
    $$('.menu-itens [data-aba]').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === nome));
    $('#tituloPagina').textContent = TITULOS[nome] || 'Inabaláveis';
    fecharMenu();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    document.dispatchEvent(new CustomEvent('inab:aba', { detail: nome }));
    $$('.aba').forEach((s) => s.classList.toggle('ativa', s.id === `aba-${nome}`));
    if (S) render();
    if (mapa) setTimeout(() => mapa.invalidateSize(), 50);
  }
  $$('.menu-itens [data-aba]').forEach((b) => (b.onclick = () => mostrarAba(b.dataset.aba)));

  // ---------- Tema claro / escuro ----------
  let camadaMapa = null;
  const temaAtual = () => (document.documentElement.dataset.tema === 'claro' ? 'claro' : 'escuro');
  function camadaDoTema() {
    // OpenStreetMap (gratuito, sem chave). No tema escuro, o CSS escurece os blocos do mapa.
    return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
  }
  function aplicarTema(tema) {
    if (tema === 'claro') document.documentElement.dataset.tema = 'claro';
    else delete document.documentElement.dataset.tema;
    store.set('tema', tema);
    $('#btnTema').textContent = tema === 'claro' ? '🌙' : '☀️';
    $('#btnTema').setAttribute('aria-label', tema === 'claro' ? 'Usar tema escuro' : 'Usar tema claro');
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', tema === 'claro' ? '#f4f8fc' : '#06101f');
    if (mapa && camadaMapa) { mapa.removeLayer(camadaMapa); camadaMapa = camadaDoTema().addTo(mapa); }
    if (S) { render(); document.dispatchEvent(new CustomEvent('inab:estado', { detail: S })); }
  }
  $('#btnTema').onclick = () => aplicarTema(temaAtual() === 'claro' ? 'escuro' : 'claro');
  aplicarTema(temaAtual());

  // ---------- Menu sanduíche ----------
  function abrirMenu() {
    $('#menu').classList.add('aberto');
    $('#menu').setAttribute('aria-hidden', 'false');
    $('#menuFundo').hidden = false;
    requestAnimationFrame(() => $('#menuFundo').classList.add('visivel'));
    $('#btnMenu').setAttribute('aria-expanded', 'true');
    document.body.classList.add('sem-rolagem');
    setTimeout(() => $('.menu-itens .ativa')?.focus(), 200);
  }
  function fecharMenu() {
    if (!$('#menu').classList.contains('aberto')) return;
    $('#menu').classList.remove('aberto');
    $('#menu').setAttribute('aria-hidden', 'true');
    $('#menuFundo').classList.remove('visivel');
    setTimeout(() => { $('#menuFundo').hidden = true; }, 250);
    $('#btnMenu').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sem-rolagem');
  }
  $('#btnMenu').onclick = abrirMenu;
  $('#btnFecharMenu').onclick = fecharMenu;
  $('#menuFundo').onclick = fecharMenu;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharMenu(); });
  // deslizar para a esquerda fecha o menu no celular
  let toqueX = null;
  $('#menu').addEventListener('touchstart', (e) => { toqueX = e.touches[0].clientX; }, { passive: true });
  $('#menu').addEventListener('touchend', (e) => { if (toqueX !== null && toqueX - e.changedTouches[0].clientX > 60) fecharMenu(); toqueX = null; });

  $('#filtroSegmento').onchange = (e) => { filtroSeg = e.target.value; renderRanking(); };
  $('#segRanking').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    modoRanking = b.dataset.r;
    $$('#segRanking button').forEach((x) => x.classList.toggle('ativo', x === b));
    renderRanking();
  };

  $('#selColportor').onchange = (e) => {
    colportorId = e.target.value;
    store.set('colportor', colportorId);
    editandoMeta = false;
    $('#formMeta').dataset.para = '';
    botoesChat = ['minhas vendas', 'produtos', 'ajuda'];
    ultimoEnvio = null;
    $('#btnReenviar').disabled = true;
    render();
  };

  document.addEventListener('click', (e) => {
    const d = e.target.closest('[data-desfazer]');
    if (d) { d.disabled = true; desfazer(d.dataset.desfazer); }
    const c = e.target.closest('[data-chat]');
    if (c) enviarChat(c.dataset.chat);
    const ir = e.target.closest('[data-ir]');
    if (ir) mostrarAba(ir.dataset.ir);
  });

  // ---------- Nova venda ----------
  const dlg = $('#dlgVenda');
  function atualizarTotal() {
    const p = S.produtos.find((x) => x.id === $('#fProduto').value);
    const q = Number($('#fQtd').value) || 0;
    $('#fTotal').textContent = p ? `Total: ${brl(p.preco * q)}${p.precoPublico && p.precoPublico !== p.preco ? ` · público ${brl(p.precoPublico * q)}` : ''}` : '';
  }
  $('#btnNovaVenda').onclick = () => {
    if (!S) return;
    const c = S.colportores.find((x) => x.id === colportorId);
    $('#dlgColportor').textContent = c ? `${c.nome} · ${c.regiao}` : '';
    const grupos = {};
    for (const p of S.produtos) (grupos[p.grupo || 'Produtos'] ??= []).push(p);
    const ordem = Object.keys(grupos).sort((a, b) => (b === 'Livros') - (a === 'Livros'));   // livros primeiro
    $('#fProduto').innerHTML = ordem.map((g) => `<optgroup label="${esc(g)}">${grupos[g].map((p) =>
      `<option value="${p.id}">${esc(p.nomeCurto || p.nome)} — ${brl(p.preco)}${p.precoPublico && p.precoPublico !== p.preco ? ` (público ${brl(p.precoPublico)})` : ''}</option>`).join('')}</optgroup>`).join('');
    $('#fQtd').value = 1;
    $('#fPagamento').innerHTML = PAGAMENTOS.map((p, i) => `<label><input type="radio" name="pag" value="${p}" ${i === 0 ? 'checked' : ''}/> ${p}</label>`).join('');
    $('#btnSalvar').disabled = false;
    $('#formVenda').dataset.chave = uuid();   // uma chave por venda: cliques repetidos não duplicam
    atualizarTotal();
    dlg.showModal();
  };
  $('#fProduto').onchange = atualizarTotal;
  $('#fQtd').oninput = atualizarTotal;
  $('#btnCancelar').onclick = () => dlg.close();
  $('#formVenda').onsubmit = async (e) => {
    e.preventDefault();
    $('#btnSalvar').disabled = true;
    try {
      const r = await post('/api/vendas', {
        colportorId, produtoId: $('#fProduto').value, qtd: Number($('#fQtd').value),
        pagamento: document.querySelector('input[name=pag]:checked')?.value, chave: $('#formVenda').dataset.chave,
      });
      dlg.close();
      if (r.duplicada) return;   // envio repetido da mesma venda: já registrada, não avisa de novo
      toast(`✅ Venda registrada: ${r.resumo}`, { acao: 'Desfazer', onAcao: () => desfazer(r.venda.id), ms: 10000 });
    } catch (err) {
      $('#btnSalvar').disabled = false;
      toast(err.message);
    }
  };

  // ---------- Simulador de WhatsApp ----------
  async function enviarChat(texto, messageId = `sim-${uuid()}`) {
    if (!texto.trim()) return;
    try {
      const r = await post('/api/simular', { colportorId, texto, messageId });
      if (r.duplicada) {
        toast('🛡️ Mensagem repetida detectada — ignorada, nenhuma venda duplicada.');
        return;
      }
      ultimoEnvio = { texto, messageId };
      $('#btnReenviar').disabled = false;
      const ult = [...(r.respostas || [])].reverse().find((x) => x.botoes);
      botoesChat = ult ? ult.botoes.map((b) => b.toLowerCase()) : ['minhas vendas', 'produtos', 'ajuda'];
      renderColportor();
    } catch (e) { toast(e.message); }
  }
  $('#chatForm').onsubmit = (e) => {
    e.preventDefault();
    const t = $('#chatInput').value;
    $('#chatInput').value = '';
    enviarChat(t);
  };
  $('#btnReenviar').onclick = () => ultimoEnvio && enviarChat(ultimoEnvio.texto, ultimoEnvio.messageId);

  // ---------- Gestão: mensagem do Diretor para a equipe (com o nome de cada um) ----------
  const SUGESTOES_MSG = [
    'Bom dia, {nome}! Hoje é dia de vitória. Deus vai na frente abrindo as portas. Vamos com tudo! 💪',
    '{nome}, cada porta em que você bate leva esperança para uma família. Conte comigo hoje! 🙏',
    'Bom dia, {nome}! Sejam firmes e inabaláveis (1 Co 15:58): o seu trabalho não é em vão. 🏔️',
  ];
  const personalizarMsg = (t, c) => {
    const nome = String(c?.nome || '').trim().split(/\s+/)[0] || '';
    const re = /\{\s*(primeiro\s+)?nome\s*\}/gi;
    return re.test(t) ? t.replace(re, nome) : `Olá, ${nome}! ${t}`;
  };
  const destinoMsg = () => {
    const d = $('#msgDestino').value;
    return d === 'todos' ? S.colportores : S.colportores.filter((c) => c.liderId === d);
  };
  function atualizarMensagem() {
    const t = $('#msgTexto').value.trim();
    const lista = destinoMsg();
    $('#msgConta').textContent = `${$('#msgTexto').value.length}/900`;
    $('#btnMsgEnviar').textContent = `Enviar para ${lista.length} colportor${lista.length === 1 ? '' : 'es'}`;
    $('#btnMsgEnviar').disabled = t.length < 3 || !lista.length;
    const ex = lista.slice(0, 2);
    $('#msgPrevia').hidden = !t || !ex.length;
    $('#msgPrevia').innerHTML = ex.map((c) => `<div class="bolha-previa"><span class="dica">${esc(c.nome)} recebe:</span>${esc(personalizarMsg(t, c))}</div>`).join('');
  }
  async function carregarHistoricoMsg() {
    try {
      const res = await chamar('/api/mensagens');
      if (res.status === 404) { mensagemIndisponivel = true; $('#cardMensagem').hidden = true; return; } // servidor ainda sem o recurso
      if (!res.ok) return;
      const { historico } = await res.json();
      const lider = (id) => S?.gestores?.find((g) => g.id === id)?.nome;
      $('#msgHistorico').innerHTML = historico.slice(0, 5).map((m) => `<li><span class="dica">${new Date(m.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${m.destino === 'todos' ? 'todos' : `grupo de ${esc(lider(m.destino) || '?')}`} · ${m.qtd} enviadas</span>${esc(m.texto)}</li>`).join('');
    } catch { /* sem histórico */ }
  }
  let historicoMsgCarregado = false;
  let mensagemIndisponivel = false;
  function renderMensagem() {
    const card = $('#cardMensagem');
    card.hidden = !eu?.diretor || mensagemIndisponivel;
    if (card.hidden) return;
    const sel = $('#msgDestino');
    const atual = sel.value;
    const lideres = (S.gestores || []).filter((g) => g.perfil === 'lider');
    const opcoes = '<option value="todos">Todos os colportores</option>' + lideres.map((g) => `<option value="${esc(g.id)}">Grupo de ${esc(g.nome)}</option>`).join('');
    if (sel.innerHTML !== opcoes) { sel.innerHTML = opcoes; sel.value = [...sel.options].some((o) => o.value === atual) ? atual : 'todos'; }
    if (!$('#msgSugestoes').children.length) {
      $('#msgSugestoes').innerHTML = SUGESTOES_MSG.map((s, i) => `<button type="button" class="chip" data-i="${i}">${esc(s.slice(0, 38))}…</button>`).join('');
      $('#msgSugestoes').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { $('#msgTexto').value = SUGESTOES_MSG[b.dataset.i]; atualizarMensagem(); } };
    }
    atualizarMensagem();
    if (!historicoMsgCarregado) { historicoMsgCarregado = true; carregarHistoricoMsg(); }
  }
  $('#msgTexto').oninput = atualizarMensagem;
  $('#msgDestino').onchange = atualizarMensagem;
  $('#btnMsgNome').onclick = () => {
    const ta = $('#msgTexto');
    const i = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, i) + '{nome}' + ta.value.slice(ta.selectionEnd ?? i);
    ta.focus(); ta.selectionStart = ta.selectionEnd = i + 6;
    atualizarMensagem();
  };
  $('#btnMsgEnviar').onclick = async () => {
    const texto = $('#msgTexto').value.trim();
    const destino = $('#msgDestino').value;
    const n = destinoMsg().length;
    if (!confirm(`Enviar esta mensagem para ${n} colportor(es), cada um com o próprio nome?`)) return;
    const btn = $('#btnMsgEnviar');
    btn.disabled = true;
    try {
      const r = await post('/api/mensagem', { texto, destino });
      if (r.erro) throw new Error(r.erro);
      toast(`📣 Mensagem enviada para ${r.enviados} colportor(es).`);
      $('#msgTexto').value = '';
      carregarHistoricoMsg();
    } catch (e) { toast(e.message); } finally { atualizarMensagem(); }
  };

  // ---------- Gestão ----------
  $('#btnLembrete').onclick = async () => {
    try {
      const r = await post('/api/lembretes');
      toast(r.enviados.length ? `⏰ Lembrete enviado para ${r.enviados.length} colportor(es).` : 'Nenhum colportor para lembrar.');
    } catch (e) { toast(e.message); }
  };

  // ---------- Cadastro (pelo aplicativo, com código por e-mail) ----------
  const PERFIS = { colportor: 'Colportor', lider: 'Líder/Caixa', diretor: 'Diretor' };
  const CIDADES = ['Iguatu', 'Acopiara', 'Cariús', 'Cedro', 'Crato', 'Deputado Irapuan Pinheiro', 'Icó', 'Jaguaretama', 'Jaguaribe',
    'Juazeiro do Norte', 'Jucás', 'Lavras da Mangabeira', 'Limoeiro do Norte', 'Milhã', 'Mombaça', 'Morada Nova', 'Orós', 'Pereiro',
    'Piquet Carneiro', 'Quixadá', 'Quixelô', 'Quixeré', 'Russas', 'Saboeiro', 'Senador Pompeu', 'Solonópole', 'Tauá', 'Várzea Alegre'];
  $('#listaCidades').innerHTML = CIDADES.map((c) => `<option value="${c}">`).join('');
  let cad = { perfil: null, id: null };

  function passo(n) {
    $$('.cad-passo').forEach((el) => { el.hidden = Number(el.dataset.passo) !== n; });
    $$('.passos span').forEach((el) => {
      const p = Number(el.dataset.p);
      el.classList.toggle('ativo', p === n);
      el.classList.toggle('feito', p < n);
    });
    const foco = { 2: '#formCad input[name=nome]', 3: '#cadCodigo' }[n];
    if (foco) setTimeout(() => $(foco).focus(), 50);
  }
  $$('.perfil').forEach((b) => (b.onclick = () => {
    cad.perfil = b.dataset.perfil;
    $('#cadPerfilChip').textContent = PERFIS[cad.perfil];
    $('#campoCurso').hidden = cad.perfil !== 'colportor';
    $('#campoFaculdade').hidden = cad.perfil !== 'colportor';
    $('#campoSegmento').hidden = cad.perfil !== 'colportor';
    // colportor escolhe a cidade/bairro entre os locais cadastrados pelo Diretor
    const locs = S ? S.locais.filter((l) => l.tipo !== 'sede') : [];
    const usarLista = cad.perfil === 'colportor' && locs.length > 0;
    $('#campoLocal').hidden = !usarLista;
    $('#campoCidade').hidden = usarLista;
    $('#formCad').cidade.required = !usarLista;
    if (usarLista) {
      const grupos = { cidade: 'Cidades', bairro: 'Bairros de Fortaleza' };
      $('#formCad').localId.innerHTML = '<option value="">Escolha…</option>' + Object.entries(grupos).map(([t, rot]) => {
        const itens = locs.filter((l) => l.tipo === t);
        return itens.length ? `<optgroup label="${rot}">${itens.map((l) => `<option value="${l.id}">${esc(l.nome)}</option>`).join('')}</optgroup>` : '';
      }).join('');
    }
    passo(2);
  }));
  $$('[data-voltar]').forEach((b) => (b.onclick = () => passo(Number(b.dataset.voltar))));

  function mostrarErros(erros = {}) {
    $$('#formCad [data-erro]').forEach((el) => { el.textContent = erros[el.dataset.erro] || ''; });
    const erroLocal = $('[data-erro="local"]'); if (erroLocal) erroLocal.textContent = !$('#campoLocal').hidden ? (erros.cidade || '') : '';
    $$('#formCad input').forEach((i) => i.classList.toggle('invalido', Boolean(erros[i.name])));
  }
  function mostrarCodigoTeste(r) {
    $('#cadTeste').hidden = !r.modoTeste;
    if (r.modoTeste) $('#cadTeste').textContent = `Modo de teste (e-mail ainda não configurado no servidor): o código é ${r.codigoTeste}`;
  }

  $('#formCad').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = $('#btnCadEnviar');
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const res = await chamar('/api/cadastro', { method: 'POST', body: { perfil: cad.perfil, ...Object.fromEntries(f) } });
      const r = await res.json();
      if (!res.ok) { mostrarErros(r.erros || { geral: r.erro }); return; }
      if (SB) { // e-mail já confirmado pelo login: vai direto para a aprovação (ou entra, se for o 1º Diretor)
        mostrarErros();
        $('#formCad').reset();
        if (r.status === 'aprovado') { toast('✅ Cadastro concluído!'); await depoisDoLogin(); }
        else mostrarAguardando(`Seu cadastro como ${PERFIS[r.perfil] || ''} foi enviado e está aguardando a aprovação do Diretor. Esta tela se atualiza sozinha quando ele aprovar.`);
        return;
      }
      mostrarErros();
      cad.id = r.id;
      $('#cadEmail').textContent = r.email;
      $('#cadCodigo').value = '';
      $('#cadCodigoErro').textContent = '';
      mostrarCodigoTeste(r);
      passo(3);
    } catch { mostrarErros({ geral: 'Sem conexão com o servidor. Tente de novo.' }); }
    finally { btn.disabled = false; btn.textContent = 'Enviar código para o e-mail'; }
  };

  $('#cadCodigo').oninput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (e.target.value.length === 6) $('#formCodigo').requestSubmit();
  };
  $('#formCodigo').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await post(`/api/cadastro/${cad.id}/verificar`, { codigo: $('#cadCodigo').value });
      const nome = PERFIS[r.perfil] || '';
      if (r.primeiroDiretor) {
        $('#cadFimTitulo').textContent = 'Cadastro concluído — você é o Diretor da equipe';
        $('#cadFimTexto').textContent = 'Como é o primeiro Diretor, o cadastro entrou direto e você já está conectado. A partir de agora, é você quem aprova os novos cadastros.';
        await carregarEu();
      } else if (r.status === 'aprovado') {
        $('#cadFimTitulo').textContent = 'Cadastro concluído!';
        $('#cadFimTexto').textContent = `Você entrou na equipe como ${nome}.`;
      } else {
        $('#cadFimTitulo').textContent = 'E-mail confirmado!';
        $('#cadFimTexto').textContent = `Seu cadastro como ${nome} foi enviado ao Diretor. Você receberá a confirmação por e-mail${r.perfil === 'lider' ? '' : ' e no WhatsApp'} assim que for aprovado.`;
      }
      e.target.reset();
      $('#formCad').reset();
      passo(4);
    } catch (err) {
      $('#cadCodigoErro').textContent = err.message;
      $('#cadCodigo').select();
    }
  };
  $('#btnReenviarCod').onclick = async () => {
    try {
      const r = await post(`/api/cadastro/${cad.id}/reenviar`);
      mostrarCodigoTeste(r);
      toast('📧 Código reenviado.');
    } catch (err) { toast(err.message); }
  };
  $('#btnNovoCad').onclick = () => { cad = { perfil: null, id: null }; passo(1); };

  // ---------- Diretor: entrar e aprovar ----------
  let eu = null;
  let cadastros = [];
  let loginId = null;
  let carregando = null;

  /** Quem está usando. Devolve 'ok', 'sem-sessao' (login vencido/inválido) ou 'falha' (rede/servidor). */
  async function carregarEu() {
    let estado = 'ok';
    try {
      const res = await chamar('/api/eu');
      if (res.ok) eu = await res.json();
      else { estado = res.status === 401 ? 'sem-sessao' : 'falha'; if (estado === 'sem-sessao') eu = null; }
    } catch { estado = 'falha'; }
    renderDiretor();
    if (eu?.diretor) carregarCadastros();
    return estado;
  }

  function carregarCadastros() {
    clearTimeout(carregando);
    carregando = setTimeout(async () => {
      const res = await chamar('/api/cadastros');
      if (res.status === 403) { eu = { ...eu, diretor: null }; renderDiretor(); return; }
      cadastros = (await res.json()).cadastros || [];
      renderDiretor();
    }, 100);
  }

  function renderDiretor() {
    const el = $('#diretorConteudo');
    $('#cardDiretor').hidden = Boolean(SB) && !eu?.gestor;
    $('#btnSairMenu').hidden = !SB;
    if (!eu?.gestor) {
      if (S) renderCursos();
      $('#diretorInfo').textContent = '';
      el.innerHTML = `
        <p class="dica">Diretor e Líder entram com o próprio e-mail e recebem um código. O Diretor aprova os cadastros; o Líder monta a escala de assistência.</p>
        <form id="formLogin" class="form-linha" style="margin-top:10px">
          <input name="email" type="email" placeholder="seu e-mail" autocomplete="email" required ${loginId ? 'hidden' : ''} />
          <input name="codigo" inputmode="numeric" maxlength="6" placeholder="código de 6 dígitos" autocomplete="one-time-code" ${loginId ? '' : 'hidden'} />
          <button class="btn primario">${loginId ? 'Entrar' : 'Receber código'}</button>
        </form>
        <p id="loginMsg" class="dica" style="margin-top:8px"></p>`;
      $('#formLogin').onsubmit = entrar;
      return;
    }
    if (S) renderCursos();
    $('#diretorInfo').innerHTML = `${esc(eu.gestor.nome.split(' ')[0])} (${PERFIS[eu.gestor.perfil]}) · <button class="link" id="btnSair">sair</button>`;
    $('#btnSair').onclick = sairDoApp;
    if (eu.gestor.perfil !== 'diretor') {
      el.innerHTML = `<p class="dica">Você entrou como <b>Líder</b>. Monte a sua escala de assistência da semana no Mapa.</p>
        <button class="btn primario" data-ir="mapa" style="margin-top:10px">🗓️ Abrir a minha escala</button>`;
      return;
    }
    const opcoesLider = '<option value="">Sem líder</option>' + (S ? S.gestores.filter((g) => g.perfil === 'lider').map((l) => `<option value="${l.id}">${esc(l.nome)}</option>`).join('') : '');
    const pend = cadastros.filter((c) => c.status === 'pendente');
    const recus = cadastros.filter((c) => c.status === 'recusado');
    el.innerHTML = (pend.length ? pend.map((c) => `
      <div class="pendente-item">
        <div class="linha"><b>${esc(c.nome)}</b><span class="chip">${PERFIS[c.perfil]}</span></div>
        <span class="dica">${esc(c.email)} · ${esc(c.telefoneFmt)} · ${esc(c.cidade)}${c.curso ? ` · ${esc(c.curso)}` : ''}${c.faculdade ? ` (${esc(c.faculdade)})` : ''}${c.segmento ? ` · ${esc(c.segmento)}` : ''}</span>
        <span class="dica">E-mail confirmado ${new Date(c.emailVerificadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
        ${c.perfil === 'colportor' ? `<label class="dica" style="display:flex;gap:6px;align-items:center">Grupo do líder <select data-lider-para="${c.id}" style="padding:6px 8px;font-size:13px">${opcoesLider}</select></label>` : ''}
        <div class="acoes-pend">
          <button class="btn primario pequeno" data-aprovar="${c.id}">Aprovar</button>
          <button class="btn pequeno perigo" data-recusar="${c.id}">Recusar</button>
        </div>
      </div>`).join('') : '<p class="vazio">Nenhum cadastro aguardando aprovação.</p>')
      + (recus.length ? `<p class="dica" style="margin-top:8px">Recusados: ${recus.map((c) => esc(c.nome)).join(', ')}</p>` : '');
    el.querySelectorAll('[data-aprovar]').forEach((b) => (b.onclick = () => decidir(b.dataset.aprovar, 'aprovar', b)));
    el.querySelectorAll('[data-recusar]').forEach((b) => (b.onclick = () => {
      const c = cadastros.find((x) => x.id === b.dataset.recusar);
      if (confirm(`Recusar o cadastro de ${c?.nome}?`)) decidir(b.dataset.recusar, 'recusar', b);
    }));
  }

  async function decidir(id, acao, btn) {
    btn.disabled = true;
    try {
      const liderId = document.querySelector(`[data-lider-para="${id}"]`)?.value || undefined;
      await post(`/api/cadastros/${id}/${acao}`, { liderId });
      const c = cadastros.find((x) => x.id === id);
      toast(acao === 'aprovar' ? `✅ ${c?.nome} aprovado(a) e avisado(a).` : `Cadastro de ${c?.nome} recusado.`);
      carregarCadastros();
    } catch (err) { btn.disabled = false; toast(err.message); }
  }

  async function entrar(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = $('#loginMsg');
    try {
      if (!loginId) {
        const r = await post('/api/login', { email: f.get('email') });
        loginId = r.id;
        renderDiretor();
        $('#loginMsg').textContent = r.modoTeste
          ? `Modo de teste (e-mail não configurado): o código é ${r.codigoTeste}`
          : 'Se este e-mail for de um Diretor aprovado, o código chegará em instantes.';
        $('#formLogin input[name=codigo]').focus();
      } else {
        await post(`/api/login/${loginId}/verificar`, { codigo: f.get('codigo') });
        loginId = null;
        await carregarEu();
        toast(`Você entrou como ${PERFIS[eu?.gestor?.perfil] || 'gestor'}.`);
        if (S) render();
      }
    } catch (err) {
      msg.textContent = err.message;
      if (/novo|Comece/.test(err.message)) { loginId = null; setTimeout(renderDiretor, 1500); }
    }
  }

  function renderCursos() {
    $('#listaCursos').innerHTML = [...new Set(S.cursos.map((c) => c.nome))].map((n) => `<option value="${esc(n)}">`).join('');
    $('#listaFaculdades').innerHTML = [...new Set(S.cursos.map((c) => c.faculdade).filter(Boolean))].map((n) => `<option value="${esc(n)}">`).join('');
    const ehDiretor = Boolean(eu?.diretor);
    $('#formCurso').hidden = !ehDiretor;
    $('#importarCursos').hidden = !ehDiretor;
    $('#qtdCursos').textContent = S.cursos.length ? `${S.cursos.length} curso(s)` : '';
    $('#cursosDica').textContent = ehDiretor
      ? 'Para alterar um valor, clique em editar ou salve o curso de novo com o mesmo nome.'
      : 'Somente o Diretor cadastra e altera as metas de bolsa.';
    const termo = semAcento($('#buscaCurso').value);
    const visiveis = termo ? S.cursos.filter((c) => semAcento(`${c.nome} ${c.faculdade}`).includes(termo)) : S.cursos;
    $('#buscaCurso').hidden = S.cursos.length < 8;
    $('#listaCursosMeta').innerHTML = !S.cursos.length ? '<li class="vazio">Nenhuma meta de bolsa cadastrada ainda.</li>'
      : !visiveis.length ? '<li class="vazio">Nenhum curso encontrado.</li>' : visiveis.map((c) => `
      <li><div><b>${esc(c.nome)}</b><small>${c.faculdade ? esc(c.faculdade) : 'todas as faculdades'}</small></div><div style="display:flex;gap:10px;align-items:center"><b>${brl0(c.metaBolsa)}</b>
      ${ehDiretor ? `<button class="link" data-editar-curso="${c.id}">editar</button><button class="link" style="color:var(--bad)" data-remover-curso="${c.id}">remover</button>` : ''}</div></li>`).join('')
;
    $$('[data-editar-curso]').forEach((b) => (b.onclick = () => {
      const c = S.cursos.find((x) => x.id === b.dataset.editarCurso);
      const f = $('#formCurso');
      f.nome.value = c.nome; f.faculdade.value = c.faculdade || ''; f.metaBolsa.value = String(c.metaBolsa).replace('.', ','); f.dataset.id = c.id;
      f.metaBolsa.focus();
    }));
    $$('[data-remover-curso]').forEach((b) => (b.onclick = async () => {
      const c = S.cursos.find((x) => x.id === b.dataset.removerCurso);
      if (!confirm(`Remover a meta de bolsa de ${c.nome}?`)) return;
      try { await post(`/api/cursos/${c.id}/remover`); toast('Curso removido.'); } catch (err) { toast(err.message); }
    }));
  }
  $('#buscaCurso').oninput = () => renderCursos();
  $('#formCurso').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await post('/api/cursos', { id: f.dataset.id || undefined, nome: f.nome.value, faculdade: f.faculdade.value, metaBolsa: f.metaBolsa.value });
      f.reset(); f.dataset.id = '';
      toast('🎓 Meta de bolsa salva.');
    } catch (err) { toast(err.message); }
  };

  // ---------- Importar metas de bolsa (planilha) ----------
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  function carregarXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = XLSX_URL;
      s.onload = () => ok(window.XLSX);
      s.onerror = () => erro(new Error('Não foi possível carregar o leitor de planilhas (sem internet?). Tente um arquivo .csv.'));
      document.head.appendChild(s);
    });
  }
  const semAcento = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  /** Lê a planilha e devolve [{ linha, curso, faculdade, meta }], achando as colunas pelo cabeçalho. */
  async function lerPlanilhaCursos(arquivo) {
    const XLSX = await carregarXlsx();
    const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    // procura a linha de cabeçalho nas 15 primeiras linhas
    let cab = -1; let col = {};
    for (let i = 0; i < Math.min(15, linhas.length) && cab < 0; i++) {
      const h = linhas[i].map(semAcento);
      const curso = h.findIndex((x) => /^curso/.test(x) || x === 'graduacao');
      const meta = h.findIndex((x) => /meta|bolsa|valor|alvo/.test(x));
      if (curso >= 0 && meta >= 0 && curso !== meta) {
        cab = i;
        col = { curso, meta, faculdade: h.findIndex((x) => /faculdade|instituicao|universidade|ies|campus/.test(x)) };
      }
    }
    if (cab < 0) throw new Error('Não encontrei as colunas "Curso" e "Meta" no cabeçalho da planilha.');
    return linhas.slice(cab + 1).map((l, i) => ({
      linha: cab + i + 2,
      curso: String(l[col.curso] ?? '').trim(),
      faculdade: col.faculdade >= 0 ? String(l[col.faculdade] ?? '').trim() : '',
      meta: typeof l[col.meta] === 'number' ? l[col.meta] : String(l[col.meta] ?? '').replace(/[^\d,.-]/g, ''),
    })).filter((l) => l.curso || l.meta);
  }

  $('#arqCursos').onchange = async (e) => {
    const arq = e.target.files[0];
    e.target.value = '';
    if (!arq) return;
    try {
      const linhas = await lerPlanilhaCursos(arq);
      if (!linhas.length) throw new Error('A planilha não tem linhas de dados.');
      if (!confirm(`Importar ${linhas.length} linha(s) de "${arq.name}"?`)) return;
      const r = await post('/api/cursos/importar', { linhas });
      const msg = `🎓 Importação: ${r.novos} novo(s), ${r.atualizados} atualizado(s)${r.erros.length ? `, ${r.erros.length} com erro` : ''}.`;
      toast(msg, { ms: 9000 });
      if (r.erros.length) $('#cursosDica').textContent = `Linhas não importadas: ${r.erros.slice(0, 8).map((x) => `linha ${x.linha} (${x.erro})`).join('; ')}${r.erros.length > 8 ? '…' : ''}`;
    } catch (err) { toast(err.message, { ms: 9000 }); }
  };

  document.addEventListener('change', async (e) => {
    const loc = e.target.closest('[data-local-colp]');
    if (loc) { try { await post(`/api/colportores/${loc.dataset.localColp}/local`, { localId: loc.value }); toast('📍 Local atualizado.'); } catch (err) { toast(err.message); } return; }
    const s = e.target.closest('[data-grupo]');
    if (!s) return;
    try { await post(`/api/colportores/${s.dataset.grupo}/lider`, { liderId: s.value || null }); toast('👥 Grupo atualizado.'); }
    catch (err) { toast(err.message); }
  });

  function renderEquipe() {
    renderCursos();
    const pessoas = [
      ...S.gestores.filter((g) => g.perfil === 'diretor'),
      ...S.gestores.filter((g) => g.perfil === 'lider'),
      ...S.colportores.map((c) => ({ ...c, perfil: 'colportor' })),
    ];
    $('#qtdEquipe').textContent = `${S.colportores.length} colportores · ${S.gestores.length} na gestão`;
    const lids = S.gestores.filter((g) => g.perfil === 'lider');
    const ehDir = Boolean(eu?.diretor);
    const nomeLider = (id) => lids.find((l) => l.id === id)?.nome;
    $('#listaEquipe').innerHTML = pessoas.length ? pessoas.map((p) => `
      <li><div><b>${esc(p.nome)}</b><small>${esc(p.regiao || '')}${p.curso ? ` · ${esc(p.curso)}` : ''}${p.faculdade ? ` · ${esc(p.faculdade)}` : ''}${p.segmento ? ` · ${esc(p.segmento)}` : ''}${p.perfil === 'colportor' && !ehDir ? ` · ${p.liderId ? `líder ${esc(nomeLider(p.liderId) || '')}` : 'sem líder'}` : ''}</small>
        ${p.perfil === 'colportor' && ehDir && S.locais.some((l) => l.tipo !== 'sede') ? `<select data-local-colp="${p.id}" style="margin-top:6px;padding:6px 8px;font-size:13px"><option value="">Local…</option>${S.locais.filter((l) => l.tipo !== 'sede').map((l) => `<option value="${l.id}" ${p.localId === l.id ? 'selected' : ''}>📍 ${esc(l.rotulo)}</option>`).join('')}</select>` : ''}
        ${p.perfil === 'colportor' && ehDir && lids.length ? `<select data-grupo="${p.id}" style="margin-top:6px;padding:6px 8px;font-size:13px"><option value="">Sem líder</option>${lids.map((l) => `<option value="${l.id}" ${p.liderId === l.id ? 'selected' : ''}>Líder ${esc(l.nome)}</option>`).join('')}</select>` : ''}</div>
        <span class="chip${p.perfil === 'diretor' ? ' ok' : p.perfil === 'lider' ? ' warn' : ''}"${p.perfil === 'lider' ? ` style="background:${corLider(p.id)};color:#fff"` : ''}>${PERFIS[p.perfil]}</span></li>`).join('')
      : '<li class="vazio">Ninguém cadastrado ainda. O primeiro Diretor a se cadastrar entra direto.</li>';
  }

  // ============================================================
  // Líderes: cores por líder, bonecos no mapa, escala de assistência e painel
  // ============================================================
  const lideresOrd = () => S.gestores.filter((g) => g.perfil === 'lider')
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  // a cor segue o líder (ordem fixa de cadastro), nunca a posição no ranking
  function corLider(id) {
    const i = lideresOrd().findIndex((l) => l.id === id);
    return i >= 0 && i < 3 ? `var(--l${i + 1})` : 'var(--l0)';
  }
  const corReal = (v) => (v.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() : v);
  const primeiro = (n) => String(n || '').split(' ')[0];
  function km(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return 0;
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10;
  }
  const fmtKm = (v) => `≈ ${Math.round(v).toLocaleString('pt-BR')} km`;
  const ORDEM_TURNO = { 'Manhã': 0, 'Dia todo': 1, 'Tarde': 2 };
  const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
  const addDias = (k, n) => new Date(Date.parse(k + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const fmtDia = (k) => new Date(k + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  const sedeCampanha = () => S.locais.find((l) => l.tipo === 'sede') || null;
  /** Roteiro do líder no dia: sede da campanha → visitas (manhã, dia todo, tarde) → volta à sede. */
  function roteiro(liderId, dia) {
    const lider = sedeCampanha();
    const visitas = S.escala.filter((v) => v.liderId === liderId && v.dia === dia)
      .sort((a, b) => ORDEM_TURNO[a.turno] - ORDEM_TURNO[b.turno] || a.id.localeCompare(b.id));
    let ant = lider; let total = 0;
    const pernas = visitas.map((v) => {
      const c = S.colportores.find((x) => x.id === v.colportorId);
      const d = ant ? km(ant, c) : 0; total += d; ant = c || ant;
      return { ...v, colportor: c, km: d };
    });
    const volta = pernas.length && lider ? km(ant, lider) : 0;
    total += volta;
    return { sede: lider, liderId, pernas, volta, total };
  }

  // ---------- ícones: boneco com mochila (colportor) e líder ----------
  function svgBoneco(cor) {
    return `<svg class="fig" viewBox="0 0 32 42" width="32" height="42" aria-hidden="true">
      <ellipse cx="16" cy="40" rx="8" ry="2" fill="rgba(0,0,0,.28)"/>
      <rect x="3.5" y="15" width="9" height="13" rx="3" fill="#8a5426"/>
      <rect x="5" y="20" width="6" height="4" rx="1.2" fill="#b0733a"/>
      <rect x="11" y="27" width="4" height="10" rx="2" fill="#2f3557"/>
      <rect x="17" y="27" width="4" height="10" rx="2" fill="#2f3557"/>
      <path d="M9.5 18c0-3 3-4.5 6.5-4.5s6.5 1.5 6.5 4.5v10h-13z" fill="${cor}"/>
      <path d="M11.5 15.5 14 27" stroke="#5c3613" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="16" cy="8.5" r="5.6" fill="#f3c9a1" stroke="${cor}" stroke-width="1.6"/>
    </svg>`;
  }
  function svgLider(cor) {
    return `<svg class="fig" viewBox="0 0 40 50" width="40" height="50" aria-hidden="true">
      <ellipse cx="20" cy="48" rx="10" ry="2.4" fill="rgba(0,0,0,.28)"/>
      <circle cx="20" cy="22" r="17" fill="${cor}" stroke="#fff" stroke-width="3"/>
      <circle cx="20" cy="16.5" r="5" fill="#fff"/>
      <path d="M11 31c0-5 4-8 9-8s9 3 9 8z" fill="#fff"/>
      <path d="M31 4l2.2 4.5 4.8.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8-3.5-3.4 4.8-.7z" fill="#fbbf24" stroke="#fff" stroke-width="1.2"/>
    </svg>`;
  }
  function iconeBoneco(c, destaque) {
    const cor = corLider(c.liderId);
    // vários colportores no mesmo local ficam lado a lado
    const mesmos = S.colportores.filter((x) => x.localId && x.localId === c.localId);
    const i = Math.max(0, mesmos.findIndex((x) => x.id === c.id));
    const dx = mesmos.length > 1 ? Math.round((i - (mesmos.length - 1) / 2) * 22) : 0;
    return L.divIcon({
      className: `boneco${destaque ? ' destaque' : ''}`,
      html: `<div style="position:relative">${svgBoneco(cor)}<span class="nome-pin" style="background:${cor}">${esc(primeiro(c.nome))}</span></div>`,
      iconSize: [32, 42], iconAnchor: [16 - dx, 40], popupAnchor: [dx, -36],
    });
  }
  const chaveIcone = {};
  let camadaRota = null;
  function atualizarMarcadores() {
    const rota = (escLiderSel && escLiderSel !== 'todos' && escDiaSel) ? roteiro(escLiderSel, escDiaSel) : null;
    const naRota = new Set(rota ? rota.pernas.map((p) => p.colportorId) : []);
    const lider = (id) => S.gestores.find((g) => g.id === id);
    for (const c of S.colportores) {
      const k = `${c.liderId}|${c.nome}|${naRota.has(c.id)}|${document.documentElement.dataset.tema || ''}`;
      const html = `<b>${esc(c.nome)}</b><br>${esc(c.regiao)}${c.liderId ? `<br>Líder: ${esc(lider(c.liderId)?.nome || '')}` : ''}<br>Hoje: ${brl(c.hoje.valorPublico)} ao público (${c.hoje.vendas} vendas)<br>Campanha: ${brl0(c.campanha.valorPublico)}`;
      if (!marcadores[c.id]) marcadores[c.id] = L.marker([c.lat, c.lng], { icon: iconeBoneco(c, naRota.has(c.id)), riseOnHover: true }).addTo(mapa);
      else if (chaveIcone[c.id] !== k) marcadores[c.id].setIcon(iconeBoneco(c, naRota.has(c.id)));
      chaveIcone[c.id] = k;
      marcadores[c.id].bindPopup(html);
    }
    desenharLocais();
    // trajeto do dia selecionado na escala
    if (camadaRota) { mapa.removeLayer(camadaRota); camadaRota = null; }
    if (rota && rota.pernas.length) {
      const paradas = rota.pernas.map((p) => p.colportor).filter(Boolean);
      const pts = (rota.sede ? [rota.sede, ...paradas, rota.sede] : paradas).map((p) => [p.lat, p.lng]);
      const cor = corReal(corLider(rota.liderId));
      camadaRota = L.layerGroup([
        L.polyline(pts, { color: '#ffffff', weight: 7, opacity: 0.8 }),
        L.polyline(pts, { color: cor, weight: 4, opacity: 0.95, dashArray: '8 8' }),
      ]).addTo(mapa);
    }
    const ls = lideresOrd();
    $('#mapaLegenda').innerHTML = (ls.length
      ? ls.map((l) => `<span><i style="background:${corLider(l.id)}"></i>${esc(l.nome)}</span>`).join('') + (S.colportores.some((c) => !c.liderId) ? '<span><i style="background:var(--l0)"></i>Sem líder</span>' : '')
      : '') + '<span>🎒 colportor · 🏠 sede · 📍 local</span>';
  }

  // ---------- Locais da campanha: sede, cidades e bairros (Diretor cadastra) ----------
  const num = (v) => Number(v || 0).toLocaleString('pt-BR');
  const semAcentoL = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  function infoLocal(l, html = true) {
    const i = l.info;
    if (!i) return '';
    const partes = [
      `👥 ${num(i.hab)} hab.`,
      `🏫 ${num(i.escPart)} esc. part. · ${num(i.escMun)} esc. mun.`,
      `⛪ ${num(i.igrejas)} igreja${i.igrejas === 1 ? '' : 's'} · ${num(i.membros)} membros`,
    ];
    if (i.pib) partes.push(`💰 PIB per capita ${brl(i.pib)}`);
    return html ? partes.join('<br>') : partes.join(' · ');
  }
  const marcadoresLocal = {};
  let marcandoNoMapa = false;
  let posNova = null;
  function desenharLocais() {
    const visiveis = locaisNoMapa();
    const ids = new Set(visiveis.map((l) => l.id));
    for (const [id, m] of Object.entries(marcadoresLocal)) if (!ids.has(id)) { mapa.removeLayer(m); delete marcadoresLocal[id]; }
    for (const l of visiveis) {
      const sede = l.tipo === 'sede';
      const reais = S.colportores.filter((c) => c.localId === l.id).length;
      const faltam = Math.max(0, (l.previstos || 0) - reais);
      // onde o Diretor sinalizou colportor e ainda não há cadastro: boneco cinza "previsto"
      const icone = faltam ? L.divIcon({
        className: 'boneco previsto',
        html: `<div style="position:relative">${svgBoneco('var(--l0)')}<span class="qtd-prev">${faltam}</span><span class="nome-pin" style="background:var(--l0)">${esc(l.nome)}</span></div>`,
        iconSize: [32, 42], iconAnchor: reais ? [-6, 40] : [16, 40], popupAnchor: [0, -36],
      }) : L.divIcon({
        className: `local-pin${sede ? ' sede' : ''}${l.tipo === 'bairro' ? ' bairro' : ''}`,
        html: `<span class="pin">${sede ? '🏠' : '📍'}<span>${esc(sede ? `Sede · ${l.nome}` : l.nome)}</span></span>`,
        iconSize: [0, 0],
      });
      if (!marcadoresLocal[l.id]) marcadoresLocal[l.id] = L.marker([l.lat, l.lng], { icon: icone, zIndexOffset: sede ? 900 : -500, keyboard: false }).addTo(mapa);
      else { marcadoresLocal[l.id].setLatLng([l.lat, l.lng]); marcadoresLocal[l.id].setIcon(icone); }
      marcadoresLocal[l.id].bindPopup(popupLocal(l));
    }
  }

  function popupLocal(l) {
    {
      const sede = l.tipo === 'sede';
      const qtd = S.colportores.filter((c) => c.localId === l.id).length;
      const s0 = sedeCampanha();
      return (`<b>${sede ? '🏠 ' : ''}${esc(l.rotulo)}</b><br><small>${esc(l.tipoNome)}${!sede && s0 ? ` · ${fmtKm(km(s0, l))} da sede` : ''}</small>
        ${l.info ? `<div style="margin-top:6px;font-size:12px;line-height:1.5">${infoLocal(l)}</div>` : ''}
        ${l.info?.destaque ? '<div style="margin-top:4px;color:#b45309;font-weight:700">★ destacada na planilha</div>' : ''}
        ${l.conferir ? `<div style="margin-top:4px;color:#b45309">⚠️ Conferir o ponto: ${esc(l.conferir)}</div>` : ''}
        ${sede ? '' : `<div style="margin-top:6px"><b>${qtd}</b> colportor${qtd === 1 ? '' : 'es'} cadastrado${qtd === 1 ? '' : 's'}${l.previstos ? ` · <b>${l.previstos}</b> previsto${l.previstos === 1 ? '' : 's'}` : ''}</div>`}`);
    }
  }

  const temColportor = (l) => (l.previstos || 0) > 0 || S.colportores.some((c) => c.localId === l.id);
  /** No mapa: a sede e os locais com colportor. Enquanto nenhum foi sinalizado, mostra todos (para o Diretor sinalizar). */
  function locaisNoMapa() {
    const com = S.locais.filter((l) => l.tipo === 'sede' || temColportor(l));
    return com.some((l) => l.tipo !== 'sede') ? com : S.locais;
  }

  // menu suspenso: geografia da campanha → leva o mapa até o local escolhido
  let marcadorTemp = null;
  function preencherIrPara() {
    const sel = $('#irPara');
    const grupos = [['sede', '🏠 Sede'], ['cidade', `🏙️ Cidades (${S.locais.filter((l) => l.tipo === 'cidade').length})`], ['bairro', `🏘️ Bairros de Fortaleza (${S.locais.filter((l) => l.tipo === 'bairro').length})`]];
    const html = `<option value="">📍 Geografia da campanha — ver no mapa…</option>` + grupos.map(([t, rot]) => {
      const itens = S.locais.filter((l) => l.tipo === t).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      return itens.length ? `<optgroup label="${rot}">${itens.map((l) => `<option value="${l.id}">${temColportor(l) ? '🎒 ' : ''}${esc(l.nome)}</option>`).join('')}</optgroup>` : '';
    }).join('');
    if (sel.dataset.k !== html) { sel.innerHTML = html; sel.dataset.k = html; }
  }
  $('#irPara').onchange = (e) => {
    const l = S.locais.find((x) => x.id === e.target.value);
    e.target.value = '';
    if (!l || !mapa) return;
    mapa.setView([l.lat, l.lng], l.tipo === 'bairro' ? 14 : 12);
    if (marcadorTemp) { mapa.removeLayer(marcadorTemp); marcadorTemp = null; }
    let m = marcadoresLocal[l.id];
    if (!m) { // local fora do mapa (sem colportor): mostra um alfinete temporário
      m = marcadorTemp = L.marker([l.lat, l.lng], { icon: L.divIcon({ className: 'local-pin', html: `<span class="pin">📍<span>${esc(l.nome)}</span></span>`, iconSize: [0, 0] }) }).addTo(mapa);
      m.bindPopup(popupLocal(l));
    }
    setTimeout(() => m.openPopup(), 350);
    $('#mapa').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  function renderLocais() {
    if (!S) return;
    preencherIrPara();
    renderResumoLocais();
    if (document.activeElement?.matches?.('[data-prev]')) return;
    const ehDir = Boolean(eu?.diretor);
    $('#gerirLocais').hidden = !ehDir;
    if (!ehDir) return;
    const sede = sedeCampanha();
    $('#locaisDica').textContent = ehDir
      ? (sede ? 'Em 🎒, informe quantos colportores ficarão em cada local: os bonecos aparecem no mapa. Para um local novo, use "Localizar" ou marque o ponto no mapa.' : 'Comece pela sede da campanha (Messejana): os trajetos dos líderes saem dela.')
      : 'A sede, as cidades e os bairros são cadastrados pelo Diretor.';
    const ordem = { sede: 0, cidade: 1, bairro: 2 };
    const termo = semAcentoL($('#buscaLocal').value);
    const lista = S.locais.slice().sort((a, b) => ordem[a.tipo] - ordem[b.tipo] || a.nome.localeCompare(b.nome, 'pt-BR'))
      .filter((l) => !termo || (termo === '🎒' ? l.previstos > 0 : semAcentoL(`${l.nome} ${l.tipoNome}`).includes(termo)));
    $('#listaLocais').innerHTML = lista.length ? lista.map((l) => {
      const qtd = S.colportores.filter((c) => c.localId === l.id).length;
      const dist = sede && l.tipo !== 'sede' ? ` · ${fmtKm(km(sede, l))} da sede` : '';
      const prevCtl = l.tipo === 'sede' ? '' : ehDir
        ? `<label class="prev-ctl" title="Colportores previstos neste local">🎒 <input type="number" min="0" max="50" value="${l.previstos || 0}" data-prev="${l.id}" aria-label="Colportores previstos em ${esc(l.nome)}" /></label>`
        : (l.previstos ? `<span class="chip">🎒 ${l.previstos} previsto${l.previstos === 1 ? '' : 's'}</span>` : '');
      return `<li class="${l.tipo === 'sede' ? 'local-sede' : ''}${l.previstos ? ' com-prev' : ''}"><div><b>${l.tipo === 'sede' ? '🏠' : l.tipo === 'bairro' ? '🏘️' : '🏙️'} ${esc(l.rotulo)}${l.info?.destaque ? ' <span class="chip warn">★ destaque</span>' : ''}${l.conferir ? ' <span class="chip warn" title="' + esc(l.conferir) + '">⚠️ conferir ponto</span>' : ''}</b><small>${esc(l.tipoNome)}${l.tipo !== 'sede' ? ` · ${qtd} colportor${qtd === 1 ? '' : 'es'}` : ''}${dist}</small></div>
        <div class="local-acoes">${prevCtl}${ehDir ? `<button class="link" data-editar-local="${l.id}">editar</button><button class="link" style="color:var(--bad)" data-remover-local="${l.id}">remover</button>` : ''}</div></li>`;
    }).join('') : `<li class="vazio">${termo ? 'Nenhum local encontrado.' : 'Nenhum local cadastrado ainda.'}</li>`;
  }

  /** Resumo: só os locais com colportor — quantos, quem é o líder e quanto venderam hoje. */
  function renderResumoLocais() {
    const sede = sedeCampanha();
    const com = S.locais.filter((l) => l.tipo !== 'sede' && temColportor(l))
      .map((l) => {
        const cs = S.colportores.filter((c) => c.localId === l.id);
        return { l, cs, hoje: cs.reduce((s, c) => s + c.hoje.valorPublico, 0) };
      })
      .sort((a, b) => b.hoje - a.hoje || a.l.nome.localeCompare(b.l.nome, 'pt-BR'));
    const totC = com.reduce((s, x) => s + Math.max(x.cs.length, x.l.previstos || 0), 0);
    $('#qtdLocais').textContent = com.length ? `${com.length} locais · ${totC} colportores` : '';
    $('#resumoLocais').innerHTML = (sede ? `<li class="rl-sede"><span>🏠 <b>Sede · ${esc(sede.nome)}</b></span><small>ponto de saída das assistências</small></li>` : '')
      + (com.length ? com.map(({ l, cs, hoje }) => {
        const faltam = Math.max(0, (l.previstos || 0) - cs.length);
        const cores = [...new Set(cs.map((c) => corLider(c.liderId)))].map((c) => `<i class="ponto-lider" style="background:${c}"></i>`).join('');
        return `<li data-local="${l.id}"><span>${cores || '<i class="ponto-lider" style="background:var(--l0)"></i>'} <b>${esc(l.nome)}</b><small> · ${cs.length}${faltam ? ` + ${faltam} prev.` : ''} 🎒${sede ? ` · ${fmtKm(km(sede, l))}` : ''}</small></span><b class="rl-val">${hoje ? brl0(hoje) : '—'}</b></li>`;
      }).join('')
        : `<li class="vazio">${eu?.diretor ? 'Abra "Sinalizar colportores" e informe quantos ficarão em cada cidade ou bairro.' : 'Os locais com colportores aparecem aqui.'}</li>`);
  }
  $('#resumoLocais').addEventListener('click', (e) => {
    const li = e.target.closest('[data-local]');
    if (!li) return;
    $('#irPara').value = li.dataset.local;
    $('#irPara').dispatchEvent(new Event('change'));
  });

  function mostrarPos() {
    $('#localPos').textContent = posNova ? `📍 Ponto marcado: ${posNova.lat.toFixed(4)}, ${posNova.lng.toFixed(4)}${posNova.achado ? ` — ${posNova.achado}` : ''}` : '';
  }
  $('#buscaLocal').oninput = () => renderLocais();
  $('#listaLocais').addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-prev]');
    if (!inp) return;
    try { await post(`/api/locais/${inp.dataset.prev}/previstos`, { qtd: inp.value || 0 }); toast(Number(inp.value) ? `🎒 ${inp.value} colportor(es) previsto(s) — boneco no mapa.` : 'Local sem colportor previsto.'); }
    catch (err) { toast(err.message); }
  });
  // filtro rápido: só os locais com colportor
  $('#buscaLocal').placeholder = 'Buscar bairro ou cidade… (digite 🎒 para ver só os com colportor)';
  $('#formLocal').tipo.onchange = (e) => { $('#formLocal').cidade.hidden = e.target.value !== 'sede'; };
  $('#formLocal').cidade.hidden = true;
  // Localizar pelo nome (OpenStreetMap/Nominatim). Só o nome do lugar é enviado.
  $('#btnLocalizar').onclick = async () => {
    const f = $('#formLocal');
    const nome = f.nome.value.trim();
    if (!nome) { toast('Digite o nome do local.'); return; }
    const q = f.tipo.value === 'cidade' ? `${nome}, Ceará, Brasil` : `${nome}, ${f.cidade.value.trim() || 'Fortaleza'}, Ceará, Brasil`;
    try {
      $('#btnLocalizar').disabled = true;
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
      const [r] = await res.json();
      if (!r) { toast('Não encontrei esse lugar. Marque o ponto no mapa.'); return; }
      posNova = { lat: Number(r.lat), lng: Number(r.lon), achado: r.display_name.split(',').slice(0, 3).join(',') };
      mostrarPos();
      if (mapa) mapa.setView([posNova.lat, posNova.lng], f.tipo.value === 'bairro' ? 14 : 12);
    } catch { toast('Sem conexão para localizar. Marque o ponto no mapa.'); }
    finally { $('#btnLocalizar').disabled = false; }
  };
  $('#btnMarcarMapa').onclick = () => {
    if (!mapa) { toast('O mapa ainda está carregando.'); return; }
    marcandoNoMapa = true;
    $('#mapa').classList.add('marcando');
    $('#mapa').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Toque no mapa onde fica o local.');
    mapa.once('click', (ev) => {
      marcandoNoMapa = false;
      $('#mapa').classList.remove('marcando');
      posNova = { lat: ev.latlng.lat, lng: ev.latlng.lng };
      mostrarPos();
      $('#formLocal').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };
  $('#formLocal').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!posNova) { toast('Use "Localizar" ou "Marcar no mapa" antes de salvar.'); return; }
    try {
      await post('/api/locais', { id: f.dataset.id || undefined, tipo: f.tipo.value, nome: f.nome.value, cidade: f.cidade.value, lat: posNova.lat, lng: posNova.lng });
      toast('📍 Local salvo.');
      f.reset(); f.dataset.id = ''; f.cidade.hidden = true; posNova = null; mostrarPos();
    } catch (err) { toast(err.message); }
  };
  $('#listaLocais').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-editar-local]');
    if (ed) {
      const l = S.locais.find((x) => x.id === ed.dataset.editarLocal);
      const f = $('#formLocal');
      f.tipo.value = l.tipo; f.nome.value = l.nome; f.cidade.value = l.cidade || ''; f.cidade.hidden = l.tipo !== 'sede';
      f.dataset.id = l.id; posNova = { lat: l.lat, lng: l.lng }; mostrarPos();
      f.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const rm = e.target.closest('[data-remover-local]');
    if (rm) {
      const l = S.locais.find((x) => x.id === rm.dataset.removerLocal);
      if (!confirm(`Remover ${l.rotulo}?`)) return;
      try { await post(`/api/locais/${l.id}/remover`); toast('Local removido.'); } catch (err) { toast(err.message); }
    }
  });

  // ---------- Escala de assistência ----------
  let escSemana = null;
  let escLiderSel = null;
  let escDiaSel = null;
  const podeEditar = (liderId) => Boolean(eu?.gestor) && (eu.gestor.perfil === 'diretor' || eu.gestor.id === liderId);

  function renderEscala() {
    if (!S) return;
    escSemana ??= S.semanaAtual;
    const ls = lideresOrd();
    const meuLider = eu?.gestor?.perfil === 'lider' ? eu.gestor.id : null;
    if (escLiderSel === null || (escLiderSel !== 'todos' && !ls.some((l) => l.id === escLiderSel))) escLiderSel = meuLider || 'todos';
    const sel = $('#escLider');
    const opts = '<option value="todos">Todos os líderes</option>' + ls.map((l) => `<option value="${l.id}">${esc(l.nome)}</option>`).join('');
    if (sel.dataset.k !== opts) { sel.innerHTML = opts; sel.dataset.k = opts; }
    sel.value = escLiderSel;
    const dias = DIAS_CURTOS.map((_, i) => addDias(escSemana, i));
    $('#semTitulo').textContent = `${fmtDia(dias[0])} a ${fmtDia(dias[5])}`;
    $('#escInfo').innerHTML = !eu?.gestor
      ? 'Para montar a escala, <button class="link" data-ir="cadastro">entre como Líder</button>.'
      : eu.gestor.perfil === 'diretor' ? 'Diretor: vê e ajusta a escala de todos os líderes.' : `Você: Líder ${esc(primeiro(eu.gestor.nome))}.`;
    const el = $('#escConteudo');
    if (!ls.length) {
      el.innerHTML = '<p class="vazio">Nenhum líder cadastrado ainda. Os líderes se cadastram na aba Cadastro, com o perfil Líder/Caixa.</p>';
      return;
    }
    if (escLiderSel === 'todos') {
      escDiaSel = null;
      el.innerHTML = `<div class="tabela-wrap"><table class="tab-escala">
        <thead><tr><th>Líder</th>${dias.map((d, i) => `<th>${DIAS_CURTOS[i]} ${fmtDia(d)}</th>`).join('')}<th>Semana</th></tr></thead>
        <tbody>${ls.map((l) => {
          let kmSem = 0; let tot = 0; let feitas = 0;
          const cels = dias.map((d) => {
            const r = roteiro(l.id, d);
            kmSem += r.total; tot += r.pernas.length; feitas += r.pernas.filter((p) => p.status === 'realizada').length;
            return `<td>${r.pernas.map((p) => `${p.status === 'realizada' ? '✅' : '🎒'} ${esc(primeiro(p.colportor?.nome))} <small>${esc(p.turno)}</small>`).join('<br>') || '<small>—</small>'}${r.pernas.length ? `<br><small>${fmtKm(r.total)}</small>` : ''}</td>`;
          }).join('');
          return `<tr><td><button class="link" data-ver-lider="${l.id}" style="display:flex;gap:6px;align-items:center;color:var(--text)"><i class="ponto-lider" style="background:${corLider(l.id)}"></i><b>${esc(l.nome)}</b></button></td>${cels}<td><b>${tot}</b> visitas<br><small>${feitas} feitas · ${fmtKm(kmSem)}</small></td></tr>`;
        }).join('')}</tbody></table></div>`;
      return;
    }
    // um líder: cartões por dia
    const lid = escLiderSel;
    const hojeK = S.hoje;
    if (!escDiaSel || !dias.includes(escDiaSel)) escDiaSel = dias.includes(hojeK) ? hojeK : (dias.find((d) => S.escala.some((v) => v.liderId === lid && v.dia === d)) || dias[1]);
    const editar = podeEditar(lid);
    const grupo = S.colportores.filter((c) => c.liderId === lid);
    const outros = S.colportores.filter((c) => c.liderId !== lid);
    const opcoesColp = `<option value="">Colportor…</option>${grupo.length ? `<optgroup label="Do grupo">${grupo.map((c) => `<option value="${c.id}">${esc(c.nome)} — ${esc(c.regiao)}</option>`).join('')}</optgroup>` : ''}${outros.length ? `<optgroup label="Outros">${outros.map((c) => `<option value="${c.id}">${esc(c.nome)} — ${esc(c.regiao)}</option>`).join('')}</optgroup>` : ''}`;
    el.innerHTML = `<div class="dias-escala">${dias.map((d, i) => {
      const r = roteiro(lid, d);
      return `<div class="dia-card${d === hojeK ? ' hoje' : ''}${d === escDiaSel ? ' selecionado' : ''}">
        <div class="dia-topo" data-dia="${d}" title="Ver o trajeto no mapa"><div><b>${['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'][i]}</b> <small>${fmtDia(d)}</small></div><span class="km">${r.pernas.length ? `🗺️ ${fmtKm(r.total)}` : ''}</span></div>
        ${r.pernas.map((p, n) => `
          <div class="visita${p.status === 'realizada' ? ' feita' : ''}">
            ${editar ? `<input type="checkbox" data-feita="${p.id}" ${p.status === 'realizada' ? 'checked' : ''} title="Marcar como realizada" />` : (p.status === 'realizada' ? '✅' : '🎒')}
            <div class="vt"><b>${esc(p.colportor?.nome || '—')}</b><small>${esc(p.colportor?.regiao || '')} · ${esc(p.turno)} · ${n === 0 ? (r.sede ? 'da sede' : '') : 'do anterior'} ${n === 0 && !r.sede ? '' : fmtKm(p.km)}</small></div>
            ${editar ? `<button class="rem" data-rem="${p.id}" aria-label="Tirar da escala">×</button>` : ''}
          </div>`).join('')}
        ${r.pernas.length ? `<small class="dica">${r.sede ? `Volta à sede ${fmtKm(r.volta)}` : 'Cadastre a sede para somar a ida e a volta.'}</small>` : '<small class="dica">Sem visitas.</small>'}
        ${editar ? `<form class="add-visita" data-add="${d}">
          <select name="colportorId" required>${opcoesColp}</select>
          <select name="turno">${S.turnos.map((t) => `<option>${t}</option>`).join('')}</select>
          <button class="btn primario pequeno" aria-label="Adicionar visita">＋</button>
        </form>` : ''}
      </div>`;
    }).join('')}</div>`;
    if (mapa) atualizarMarcadores();
  }

  $('#escLider').onchange = (e) => { escLiderSel = e.target.value; escDiaSel = null; renderEscala(); if (mapa) { atualizarMarcadores(); focarRota(); } };
  $('#semAnt').onclick = () => { escSemana = addDias(escSemana, -7); escDiaSel = null; renderEscala(); };
  $('#semProx').onclick = () => { escSemana = addDias(escSemana, 7); escDiaSel = null; renderEscala(); };
  function focarRota() {
    if (!mapa || !camadaRota) return;
    const b = L.latLngBounds([]);
    camadaRota.eachLayer((l) => l.getLatLngs && b.extend(l.getBounds()));
    if (b.isValid()) mapa.fitBounds(b, { padding: [50, 50], maxZoom: 10 });
  }
  $('#escConteudo').addEventListener('click', async (e) => {
    const dia = e.target.closest('[data-dia]');
    if (dia) { escDiaSel = dia.dataset.dia; renderEscala(); if (mapa) { atualizarMarcadores(); focarRota(); $('#mapa').scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
    const ver = e.target.closest('[data-ver-lider]');
    if (ver) { escLiderSel = ver.dataset.verLider; escDiaSel = null; renderEscala(); return; }
    const rem = e.target.closest('[data-rem]');
    if (rem) { try { await post(`/api/escala/${rem.dataset.rem}/remover`); } catch (err) { toast(err.message); } }
  });
  $('#escConteudo').addEventListener('change', async (e) => {
    const f = e.target.closest('[data-feita]');
    if (!f) return;
    try { await post(`/api/escala/${f.dataset.feita}/status`, { status: f.checked ? 'realizada' : 'planejada' }); toast(f.checked ? '✅ Assistência marcada como realizada.' : 'Assistência voltou para planejada.'); }
    catch (err) { f.checked = !f.checked; toast(err.message); }
  });
  $('#escConteudo').addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-add]');
    if (!f) return;
    e.preventDefault();
    const dados = new FormData(f);
    try {
      await post('/api/escala', { liderId: escLiderSel, dia: f.dataset.add, colportorId: dados.get('colportorId'), turno: dados.get('turno') });
      escDiaSel = f.dataset.add;
      toast('🗓️ Visita adicionada à escala.');
    } catch (err) { toast(err.message); }
  });

  // ---------- Mapa: líderes hoje (acompanhamento) com mini evolução ----------
  function miniLinha(serie, cor) {
    const pts = serie.slice(-14);
    if (pts.length < 2) return '';
    const W = 96; const H = 30; const max = Math.max(1, ...pts.map((p) => p.valor));
    const x = (i) => (i / (pts.length - 1)) * (W - 4) + 2;
    const y = (v) => H - 3 - (v / max) * (H - 6);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ');
    const u = pts.length - 1;
    return `<svg class="mini-linha" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Vendas por dia nos últimos 14 dias">
      <path d="${d}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(u)}" cy="${y(pts[u].valor)}" r="3" fill="${cor}"/></svg>`;
  }
  function renderLideresHoje() {
    if (!S) return;
    const el = $('#lideresHoje');
    if (!S.lideres.length) { el.innerHTML = '<li class="vazio">Os líderes aparecem aqui depois de cadastrados.</li>'; return; }
    const ordem = S.lideres.slice().sort((a, b) => b.hoje.valorPublico - a.hoje.valorPublico || b.campanha.valorPublico - a.campanha.valorPublico);
    el.innerHTML = ordem.map((l, i) => {
      const cor = corLider(l.id);
      const ontem = l.serie.at(-2)?.valor || 0;
      const delta = ontem ? (l.hoje.valorPublico - ontem) / ontem : null;
      return `<li style="--cor:${cor}">
        <div class="lh-nome"><span class="lh-pos">${l.hoje.valorPublico > 0 ? ['🥇', '🥈', '🥉'][i] || `${i + 1}º` : `${i + 1}º`}</span><div><b>${esc(l.nome)}</b><small>${l.colportores} colportor${l.colportores === 1 ? '' : 'es'} · campanha ${brl0(l.campanha.valorPublico)}</small></div></div>
        <div class="lh-dir">
          <div class="lh-val"><b>${brl0(l.hoje.valorPublico)}</b><small>${l.hoje.vendas} vendas${delta != null ? ` · <span class="${delta >= 0 ? 'sobe' : 'desce'}">${delta >= 0 ? '▲' : '▼'}${Math.abs(Math.round(delta * 100))}%</span>` : ''}</small></div>
        </div>
        <div class="lh-mini">${miniLinha(l.serie, cor)}<small>últimos 14 dias</small></div>
      </li>`;
    }).join('');
  }

  // ---------- Tela Líderes: ranking, evolução e assistências ----------
  let modoEvol = 'acumulado';
  $('#segEvol').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    modoEvol = b.dataset.m;
    $$('#segEvol button').forEach((x) => x.classList.toggle('ativo', x === b));
    renderLideres();
  };

  function renderLideres() {
    if (!S) return;
    const L_ = S.lideres;
    const med = ['🥇', '🥈', '🥉'];
    $('#lCards').innerHTML = L_.length ? L_.map((l) => `
      <div class="cartao lider-card" style="--cor:${corLider(l.id)}">
        <div class="lider-topo">
          <div class="avatar">${esc(l.nome.split(' ').slice(0, 2).map((x) => x[0]).join(''))}</div>
          <div><b>${esc(l.nome)}</b><small>${l.colportores} colportor${l.colportores === 1 ? '' : 'es'}</small></div>
          <span class="lider-pos">${l.campanha.valorPublico > 0 && l.pos <= 3 ? med[l.pos - 1] : `${l.pos}º`}</span>
        </div>
        <div class="lider-valor">${brl(l.campanha.valorPublico)}</div>
        <div class="lider-sub">vendido na campanha ao público · colportor ${brl(l.campanha.valor)}</div>
        ${l.pctMeta != null ? `<div class="barra-mini"><div style="width:${Math.min(100, l.pctMeta * 100)}%;background:${corLider(l.id)}"></div></div>
        <small class="dica">Meta do grupo: ${(l.pctMeta * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de ${brl0(l.metaGrupo)} (preço colportor)</small>` : '<small class="dica">O grupo ainda não definiu metas.</small>'}
        <div class="lider-grade">
          <div>Hoje<b>${brl0(l.hoje.valorPublico)}</b>${l.hoje.vendas} vendas</div>
          <div>Semana<b>${brl0(l.semana.valorPublico)}</b>${l.semana.vendas} vendas</div>
          <div>Assistências<b>${l.assist.realizadas}/${l.assist.planejadas}</b>feitas na semana</div>
          <div>Média por colportor<b>${brl0(l.colportores ? l.campanha.valorPublico / l.colportores : 0)}</b>na campanha</div>
        </div>
      </div>`).join('') : '<div class="cartao"><p class="vazio">Nenhum líder cadastrado ainda. Os líderes se cadastram na aba Cadastro (perfil Líder/Caixa) e o Diretor liga cada colportor ao seu líder.</p></div>';

    // legenda (sempre presente com 2+ séries) e gráfico de linhas
    const series = L_.slice().sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    $('#lLegenda').innerHTML = series.length > 1 ? series.map((l) => `<span><i style="background:${corLider(l.id)}"></i>${esc(l.nome)}</span>`).join('') : '';
    // o gráfico usa a largura real do cartão (letras legíveis no celular)
    const largura = Math.max(300, Math.round($('#lGrafico').clientWidth || 640));
    $('#lGrafico').innerHTML = series.length ? graficoLinhas(series, largura) : '';
    ativarMira(series, largura);

    // assistências da semana
    const dias = DIAS_CURTOS.map((_, i) => addDias(S.semanaAtual, i));
    $('#lAssist').innerHTML = L_.length ? `<thead><tr><th>Líder</th><th>Planejadas</th><th>Realizadas</th><th>Distância na semana</th></tr></thead><tbody>${series.map((l) => {
      const kmSem = dias.reduce((s, d) => s + roteiro(l.id, d).total, 0);
      return `<tr><td><span style="display:inline-flex;gap:6px;align-items:center"><i class="ponto-lider" style="background:${corLider(l.id)}"></i><b>${esc(l.nome)}</b></span></td><td class="num">${l.assist.planejadas}</td><td class="num">${l.assist.realizadas}</td><td class="num">${fmtKm(kmSem)}</td></tr>`;
    }).join('')}</tbody>` : '';
  }

  function graficoLinhas(series, W = 640) {
    const H = W < 500 ? 230 : 260; const pl = 46; const pr = 86; const pt = 14; const pb = 26;
    const campo = modoEvol === 'acumulado' ? 'acumulado' : 'valor';
    const n = Math.max(...series.map((s) => s.serie.length));
    const max = Math.max(1, ...series.flatMap((s) => s.serie.map((p) => p[campo])));
    const mag = 10 ** Math.floor(Math.log10(max / 4)); const passo = Math.ceil(max / 4 / mag) * mag; const ymax = passo * 4;
    const x = (i) => pl + (n > 1 ? (i / (n - 1)) * (W - pl - pr) : 0);
    const y = (v) => pt + (1 - v / ymax) * (H - pt - pb);
    const curto = (v) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : Math.round(v).toLocaleString('pt-BR'));
    const datas = series[0].serie.map((p) => p.dia);
    const passoX = W < 500 ? 14 : 7;
    const marcasX = [0, ...datas.map((_, i) => i).filter((i) => i > 0 && i < n - 1 && i % passoX === 0 && n - 1 - i > 3), n - 1];
    // rótulos no fim das linhas, afastados para não se sobreporem
    const fins = series.map((s) => ({ s, v: s.serie.at(-1)?.[campo] || 0 })).map((f) => ({ ...f, y: y(f.v) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < fins.length; i++) if (fins[i].y - fins[i - 1].y < 14) fins[i].y = fins[i - 1].y + 14;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução das vendas dos líderes">
      ${[0, 1, 2, 3, 4].map((k) => `<line x1="${pl}" x2="${W - pr}" y1="${y(k * passo)}" y2="${y(k * passo)}" class="${k ? 'grade' : 'eixo'}"/><text x="${pl - 6}" y="${y(k * passo) + 3}" text-anchor="end">${curto(k * passo)}</text>`).join('')}
      ${marcasX.map((i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtDia(datas[i])}</text>`).join('')}
      ${series.map((s) => `<path class="linha" stroke="${corLider(s.id)}" d="${s.serie.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[campo]).toFixed(1)}`).join(' ')}"/>`).join('')}
      ${series.map((s) => { const u = s.serie.length - 1; return `<circle class="ponto" cx="${x(u)}" cy="${y(s.serie[u]?.[campo] || 0)}" r="4.5" fill="${corLider(s.id)}"/>`; }).join('')}
      ${fins.map((f) => `<text class="rotulo-fim" x="${W - pr + 8}" y="${f.y + 4}">${esc(primeiro(f.s.nome))} ${curto(f.v)}</text>`).join('')}
      <g class="mira-g" style="display:none"><line class="mira" y1="${pt}" y2="${H - pb}"/>${series.map((s) => `<circle class="ponto" r="4.5" fill="${corLider(s.id)}" data-s="${s.id}"/>`).join('')}</g>
      <rect class="alvo-mira" x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" fill="transparent"/>
    </svg><div class="tooltip" hidden></div>`;
  }

  /** Mira (crosshair) + tooltip com o valor de cada líder no dia. */
  function ativarMira(series, W = 640) {
    const box = $('#lGrafico'); const svg = box.querySelector('svg'); if (!svg) return;
    const alvo = svg.querySelector('.alvo-mira'); const g = svg.querySelector('.mira-g'); const tip = box.querySelector('.tooltip');
    const campo = modoEvol === 'acumulado' ? 'acumulado' : 'valor';
    const n = Math.max(...series.map((s) => s.serie.length));
    const pl = 46; const pr = 86; const H = W < 500 ? 230 : 260; const pt = 14; const pb = 26;
    const max = Math.max(1, ...series.flatMap((s) => s.serie.map((p) => p[campo])));
    const mag = 10 ** Math.floor(Math.log10(max / 4)); const ymax = Math.ceil(max / 4 / mag) * mag * 4;
    const y = (v) => pt + (1 - v / ymax) * (H - pt - pb);
    const mostrar = (ev) => {
      const pt0 = svg.createSVGPoint();
      const t = ev.touches ? ev.touches[0] : ev;
      pt0.x = t.clientX; pt0.y = t.clientY;
      const p = pt0.matrixTransform(svg.getScreenCTM().inverse());
      const i = Math.max(0, Math.min(n - 1, Math.round(((p.x - pl) / (W - pl - pr)) * (n - 1))));
      const xi = pl + (n > 1 ? (i / (n - 1)) * (W - pl - pr) : 0);
      g.style.display = '';
      g.querySelector('.mira').setAttribute('x1', xi); g.querySelector('.mira').setAttribute('x2', xi);
      g.querySelectorAll('circle').forEach((c) => { const s = series.find((x) => x.id === c.dataset.s); c.setAttribute('cx', xi); c.setAttribute('cy', y(s.serie[i]?.[campo] || 0)); });
      const linhas = series.map((s) => ({ s, v: s.serie[i]?.[campo] || 0 })).sort((a, b) => b.v - a.v);
      tip.innerHTML = `<b>${new Date(series[0].serie[i].dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</b> <small>${campo === 'acumulado' ? 'acumulado' : 'no dia'} · ao público</small>${linhas.map((l) => `<br><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${corLider(l.s.id)}"></span> ${esc(primeiro(l.s.nome))}: <b>${brl0(l.v)}</b>`).join('')}`;
      tip.hidden = false;
      const r = box.getBoundingClientRect();
      const px = (xi / W) * r.width;
      tip.style.left = `${Math.min(r.width - 195, Math.max(0, px + 10))}px`;
    };
    const esconder = () => { g.style.display = 'none'; tip.hidden = true; };
    alvo.addEventListener('mousemove', mostrar);
    alvo.addEventListener('touchstart', mostrar, { passive: true });
    alvo.addEventListener('touchmove', mostrar, { passive: true });
    alvo.addEventListener('mouseleave', esconder);
  }

  // ---------- Avaliações das assistências: SIGILOSO (só o Diretor; vem do servidor só com login de Diretor) ----------
  let avVersao = -1;
  let avDados = null;
  async function renderAvaliacoes() {
    const card = $('#cardAvaliacoes');
    if (!eu?.diretor) { card.hidden = true; avDados = null; avVersao = -1; $('#avLista').innerHTML = ''; $('#avResumo').innerHTML = ''; return; }
    card.hidden = false;
    if (S && S.avaliacoesVersao !== avVersao) {
      avVersao = S.avaliacoesVersao;
      try {
        const res = await chamar('/api/avaliacoes');
        if (!res.ok) { card.hidden = true; return; }
        avDados = await res.json();
      } catch { return; }
    }
    if (!avDados) return;
    const est = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
    const fmt = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    $('#avResumo').innerHTML = (avDados.resumo.length ? avDados.resumo.map((r) => `
      <div style="--cor:${corLider(r.liderId)}">${esc(r.lider)}<b><span class="estrelas">${est(Math.round(r.media))}</span> ${r.media.toLocaleString('pt-BR')}</b>${r.total} avaliação(ões)${r.ocorrencias ? ` · <span style="color:var(--bad);font-weight:700">${r.ocorrencias} ocorrência(s)</span>` : ''}</div>`).join('') : '')
      + `<div style="--cor:var(--l0)">Aguardando resposta<b>${avDados.pendentes}</b>assistência(s) ainda sem avaliação</div>`;
    $('#avLista').innerHTML = avDados.itens.length ? avDados.itens.map((a) => `
      <li>
        <div class="topo-av"><span><i class="ponto-lider" style="background:${corLider(a.liderId)}"></i> <b>${esc(a.lider)}</b> → ${esc(a.colportor)}</span><span class="dica">${fmt(a.dia)}</span></div>
        <div class="estrelas">${est(a.estrelas)}</div>
        ${a.comentario ? `<div class="coment">💬 ${esc(a.comentario)}</div>` : ''}
        ${a.ocorrencia ? `<div class="ocorr">⚠️ Ocorrência: ${esc(a.ocorrencia)}</div>` : ''}
      </li>`).join('') : '<li class="vazio">Ainda não há avaliações. Elas chegam quando o líder marca a assistência como realizada e o colportor responde no WhatsApp.</li>';
  }

  // ============================================================
  // Modo nuvem (Supabase): entrar com código de e-mail, cadastro, espera e tempo real
  // ============================================================
  function carregarScript(src) {
    return new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => falha(new Error('Sem conexão para carregar o aplicativo.'));
      document.head.appendChild(s);
    });
  }
  let conectado = false;
  let ultimoAviso = null;
  async function carregarPainel() {
    const { data, error } = await sb.from('painel').select('snapshot').eq('id', 1).maybeSingle();
    if (!error && data?.snapshot?.produtos) receberEstado(data.snapshot);
  }
  function conectarNuvem() {
    if (conectado) return;
    conectado = true;
    carregarPainel();
    sb.channel('inab-sinal')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sinal' }, (p) => {
        carregarPainel();
        const a = p.new?.aviso;
        if (a && p.new?.em !== ultimoAviso) { ultimoAviso = p.new.em; receberAviso(a); }
      })
      .subscribe((status) => {
        const ok = status === 'SUBSCRIBED';
        $('#aoVivo').classList.toggle('off', !ok);
        if (!ok) $('#aoVivoTxt').textContent = 'reconectando…';
      });
    setInterval(carregarPainel, 60000); // garantia, caso o tempo real caia
  }
  function mostrarLogin() {
    $('#telaLogin').hidden = false;
    $('#telaAguardando').hidden = true;
    setTimeout(() => $('#formEntrar').email.focus(), 50);
  }
  let esperaTimer = null;
  function mostrarAguardando(texto, conferirAprovacao = true) {
    $('#telaLogin').hidden = true;
    $('#aguardandoTexto').textContent = texto;
    $('#telaAguardando').hidden = false;
    clearInterval(esperaTimer);
    if (!conferirAprovacao) return;
    esperaTimer = setInterval(async () => { // confere se o Diretor já aprovou
      await carregarEu();
      if (eu?.gestor || eu?.colportor) { clearInterval(esperaTimer); $('#telaAguardando').hidden = true; await depoisDoLogin(); toast('✅ Cadastro aprovado! Bem-vindo(a) à equipe.'); }
    }, 20000);
  }
  // Falha de rede/servidor NÃO derruba o login: tenta de novo sozinho, sem pedir outro código.
  let tentativasEu = 0;
  async function depoisDoLogin() {
    $('#telaLogin').hidden = true;
    const estado = await carregarEu();
    if (estado === 'falha') {
      tentativasEu += 1;
      const espera = Math.min(30, 2 ** tentativasEu); // 2, 4, 8, 16, 30 s…
      mostrarAguardando(`Sem conexão com o servidor agora. Tentando de novo em ${espera} s… (você continua conectado)`, false);
      clearTimeout(depoisDoLogin.t);
      depoisDoLogin.t = setTimeout(depoisDoLogin, espera * 1000);
      return;
    }
    tentativasEu = 0;
    if (estado === 'sem-sessao') { await sb.auth.signOut().catch(() => {}); mostrarLogin(); return; }
    if (!eu) { mostrarLogin(); return; }
    if (eu.gestor || eu.colportor) {
      document.body.classList.remove('sem-acesso');
      $('#telaAguardando').hidden = true;
      clearInterval(esperaTimer);
      if (eu.colportor) colportorId = eu.colportor.id;
      conectarNuvem();
      if (S) render();
      return;
    }
    if (eu.cadastro?.status === 'pendente') { mostrarAguardando(`Seu cadastro como ${PERFIS[eu.cadastro.perfil] || ''} está aguardando a aprovação do Diretor. Esta tela se atualiza sozinha quando ele aprovar.`); return; }
    if (eu.cadastro?.status === 'recusado') { mostrarAguardando('Seu cadastro não foi aprovado. Fale com a liderança da equipe.'); clearInterval(esperaTimer); return; }
    // ainda não faz parte da equipe: só o cadastro
    document.body.classList.add('sem-acesso');
    mostrarAba('cadastro');
    const em = $('#formCad').email;
    em.value = eu.email; em.readOnly = true;
    $('#btnCadEnviar').textContent = 'Enviar cadastro';
    if (eu.semDiretor) toast('Você é o primeiro: cadastre-se como Diretor para liberar a equipe.', { ms: 9000 });
  }
  // ---------- Modo apresentação (só na DEMONSTRAÇÃO, só o Diretor): vendas fictícias chegando sozinhas ----------
  let apresentacao = null;
  function vendaFicticia() {
    if (!S?.demo || !S.colportores?.length) return;
    const c = S.colportores[Math.floor(Math.random() * S.colportores.length)];
    const pesos = S.produtos.map((p) => (p.grupo === 'Livros' ? 6 : p.grupo === 'Assinaturas e revistas' ? 3 : 1));
    let x = Math.random() * pesos.reduce((a, b) => a + b, 0);
    const p = S.produtos.find((_, i) => (x -= pesos[i]) <= 0) || S.produtos[0];
    const pag = ['pix', 'pix', 'pix', 'dinheiro', 'credito', 'debito'][Math.floor(Math.random() * 6)];
    const nome = p.nome.toLowerCase();
    post('/api/simular', { colportorId: c.id, texto: `vendi ${Math.random() < 0.8 ? 1 : 2}x ${nome} ${pag}`, messageId: `apres-${Date.now()}` }).catch(() => {});
  }
  function proximaVenda() { apresentacao = setTimeout(() => { vendaFicticia(); proximaVenda(); }, 12000); }
  $('#btnApresentacao').onclick = () => {
    const b = $('#btnApresentacao');
    if (apresentacao) { clearTimeout(apresentacao); apresentacao = null; b.textContent = '▶ Modo apresentação'; toast('Modo apresentação pausado.'); return; }
    vendaFicticia(); proximaVenda();
    b.textContent = '⏸ Pausar apresentação';
    toast('🎬 Modo apresentação: uma venda fictícia a cada 12 s.');
  };

  async function sairDoApp() {
    if (SB && sb) { await sb.auth.signOut(); location.reload(); return; }
    await post('/api/sair');
    eu = { ...eu, gestor: null, diretor: null }; loginId = null; renderDiretor(); if (S) render();
  }
  $('#btnSairMenu').onclick = sairDoApp;
  $('#btnSairAguardando').onclick = sairDoApp;

  let emailEntrar = '';
  $('#btnOutroEmail').onclick = () => {
    const f = $('#formEntrar');
    f.codigo.hidden = true; f.email.hidden = false; f.email.value = ''; emailEntrar = '';
    $('#btnEntrar').textContent = 'Receber código'; $('#btnOutroEmail').hidden = true; $('#entrarMsg').textContent = '';
    $('#loginTexto').textContent = 'Entre com o seu e-mail. Enviaremos um código de 6 dígitos.';
  };
  $('#formEntrar').codigo.oninput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (e.target.value.length === 6) $('#formEntrar').requestSubmit();
  };
  $('#formEntrar').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $('#btnEntrar');
    $('#entrarMsg').textContent = '';
    btn.disabled = true;
    try {
      if (!emailEntrar) {
        const email = f.email.value.trim().toLowerCase();
        const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        if (error) throw error;
        emailEntrar = email;
        f.email.hidden = true; f.codigo.hidden = false; f.codigo.value = ''; f.codigo.focus();
        btn.textContent = 'Entrar';
        $('#btnOutroEmail').hidden = false;
        $('#loginTexto').textContent = `Enviamos um código para ${email}. Digite-o abaixo (confira também a caixa de spam).`;
      } else {
        const { error } = await sb.auth.verifyOtp({ email: emailEntrar, token: f.codigo.value, type: 'email' });
        if (error) throw error;
        await depoisDoLogin();
      }
    } catch (err) {
      const m = String(err.message || err);
      $('#entrarMsg').textContent = /rate|limit|security purposes/i.test(m) ? 'Muitos pedidos de código. Aguarde um minuto e tente de novo.'
        : /expired|invalid|token/i.test(m) ? 'Código incorreto ou vencido. Confira ou peça outro.'
          : m;
    } finally { btn.disabled = false; }
  };

  // Abre direto se houver login salvo. Erro de rede ao renovar o login NÃO pede código de novo: tenta outra vez.
  let tentativasSessao = 0;
  async function conferirSessao() {
    const { data, error } = await sb.auth.getSession();
    const temSalvo = Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k));
    if (!data.session && error && temSalvo && tentativasSessao < 8) {
      tentativasSessao += 1;
      const espera = Math.min(30, 2 ** tentativasSessao);
      mostrarAguardando(`Sem conexão agora. Tentando de novo em ${espera} s… (você continua conectado)`, false);
      setTimeout(conferirSessao, espera * 1000);
      return;
    }
    tentativasSessao = 0;
    if (!data.session) mostrarLogin(); else await depoisDoLogin();
  }

  async function iniciarNuvem() {
    try {
      await carregarScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js');
      sb = window.supabase.createClient(SB.url, SB.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
      await conferirSessao();
      // se o login vencer de verdade (ex.: saiu em outro aparelho), volta para a tela de código
      sb.auth.onAuthStateChange((evento, sessao) => { if (evento === 'SIGNED_OUT' || (!sessao && evento !== 'INITIAL_SESSION')) mostrarLogin(); });
    } catch (err) {
      mostrarLogin();
      $('#entrarMsg').textContent = err.message;
    }
  }

  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (ABAS.includes(h) && h !== aba) mostrarAba(h);
  });
  mostrarAba(aba);
  if (SB) iniciarNuvem();
  else { carregarEu(); conectar(); }
})();

