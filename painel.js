/* Painel (dashboard) — recebe o estado do app.js pelo evento "inab:estado". */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const brl0 = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const curto = (v) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: v >= 10000 ? 0 : 1 })} mil` : Math.round(v).toLocaleString('pt-BR'));
  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const iniciais = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  const reduzMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- número que "conta" até o novo valor ----------
  const valoresAtuais = new WeakMap();
  function animarNumero(el, para, fmt, ms = 900) {
    const de = valoresAtuais.get(el) ?? 0;
    valoresAtuais.set(el, para);
    if (reduzMovimento || de === para) { el.textContent = fmt(para); return; }
    const t0 = performance.now();
    const passo = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      el.textContent = fmt(de + (para - de) * e);
      if (k < 1) requestAnimationFrame(passo);
      else el.textContent = fmt(para);
    };
    requestAnimationFrame(passo);
    if (para > de) { el.classList.remove('subiu'); void el.offsetWidth; el.classList.add('subiu'); }
  }

  // ---------- anel de progresso ----------
  function anel(el, fracao, id) {
    const r = 42; const c = 2 * Math.PI * r;
    const f = Math.max(0, Math.min(1, fracao || 0));
    if (!el.querySelector('svg')) {
      el.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
        <defs><linearGradient id="g-${id}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="var(--grad-a)"/><stop offset="55%" stop-color="var(--grad-b)"/><stop offset="100%" stop-color="var(--grad-c)"/>
        </linearGradient></defs>
        <circle cx="50" cy="50" r="${r}" class="anel-fundo"/>
        <circle cx="50" cy="50" r="${r}" class="anel-valor" stroke="url(#g-${id})" stroke-dasharray="${c}" stroke-dashoffset="${c}" transform="rotate(-90 50 50)"/>
      </svg>`;
    }
    requestAnimationFrame(() => { el.querySelector('.anel-valor').style.strokeDashoffset = c * (1 - f); });
  }

  // ---------- barras verticais (uma série, com detalhe ao tocar/passar) ----------
  function barras(el, itens, { rotulo, valor, destaque, dica }) {
    const W = 320; const H = 150; const pb = 22; const pt = 18;
    const max = Math.max(1, ...itens.map(valor));
    const passo = W / itens.length;
    const larg = Math.max(6, passo - 6);
    const y = (v) => pt + (1 - v / max) * (H - pt - pb);
    const rotX = itens.map((it, i) => (itens.length > 8 ? (i % 2 === 0 || destaque(it)) : true));
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(el.getAttribute('aria-label') || '')}">
      <line x1="0" x2="${W}" y1="${H - pb}" y2="${H - pb}" class="eixo"/>
      <line x1="0" x2="${W}" y1="${y(max / 2)}" y2="${y(max / 2)}" class="grade"/>
      <text x="${W}" y="${y(max / 2) - 4}" text-anchor="end" class="txt-eixo">${curto(max / 2)}</text>
      ${itens.map((it, i) => {
    const v = valor(it); const x = i * passo + (passo - larg) / 2;
    const h = Math.max(v > 0 ? 3 : 0, H - pb - y(v));
    const r = Math.min(4, larg / 2, h);
    // barra com topo arredondado, base reta apoiada no eixo
    const d = h > 0 ? `M${x},${H - pb} v${-(h - r)} q0,${-r} ${r},${-r} h${larg - 2 * r} q${r},0 ${r},${r} v${h - r} z` : '';
    return `<g class="b${destaque(it) ? ' destaque' : ''}" data-i="${i}">
          <rect x="${i * passo}" y="0" width="${passo}" height="${H - pb}" class="alvo"/>
          ${d ? `<path d="${d}" class="barra" style="--atraso:${i * 25}ms"/>` : ''}
          ${destaque(it) && v > 0 ? `<text x="${x + larg / 2}" y="${H - pb - h - 5}" text-anchor="middle" class="txt-valor">${curto(v)}</text>` : ''}
          ${rotX[i] ? `<text x="${x + larg / 2}" y="${H - 6}" text-anchor="middle" class="txt-eixo">${esc(rotulo(it))}</text>` : ''}
        </g>`;
  }).join('')}
    </svg><div class="tooltip" hidden></div>`;
    const tip = el.querySelector('.tooltip');
    const mostrar = (g) => {
      const it = itens[Number(g.dataset.i)];
      tip.innerHTML = dica(it);
      tip.hidden = false;
      const box = el.getBoundingClientRect(); const gb = g.getBoundingClientRect();
      tip.style.left = `${Math.min(box.width - 150, Math.max(0, gb.left - box.left + gb.width / 2 - 75))}px`;
      el.querySelectorAll('g.b').forEach((x) => x.classList.toggle('foco', x === g));
    };
    el.querySelectorAll('g.b').forEach((g) => {
      g.addEventListener('mouseenter', () => mostrar(g));
      g.addEventListener('click', () => mostrar(g));
    });
    el.addEventListener('mouseleave', () => { tip.hidden = true; el.querySelectorAll('g.b').forEach((x) => x.classList.remove('foco')); });
  }

  // ---------- confete (pódio e recordes) ----------
  function confete() {
    if (reduzMovimento) return;
    const cores = ['#00a3dc', '#38bdf8', '#f08a24', '#f7c948', '#24456f'];
    const box = document.createElement('div');
    box.className = 'confete';
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i');
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = cores[i % cores.length];
      p.style.animationDelay = `${Math.random() * 0.4}s`;
      p.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
      p.style.setProperty('--giro', `${Math.random() * 720 - 360}deg`);
      p.style.setProperty('--desvio', `${Math.random() * 120 - 60}px`);
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3500);
  }
  document.addEventListener('inab:aviso', (e) => {
    if (['podio', 'recorde-pessoal', 'recorde-equipe'].includes(e.detail?.tipo)) confete();
  });

  // ---------- render ----------
  let vistos = null;
  function render(S) {
    const P = S.painel;
    const k = S.kpis;
    $('#pHora').textContent = `atualizado ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    animarNumero($('#pHeroValor'), k.valorHojePublico, brl);
    $('#pHeroSub').textContent = `valor colportor ${brl(k.valorHoje)}`;
    const ontem = P.ultimos7.at(-2)?.valorPublico || 0;
    const delta = ontem ? (k.valorHojePublico - ontem) / ontem : null;
    $('#pHeroChips').innerHTML = [
      `<span>🧾 ${k.vendasHoje} vendas</span>`,
      `<span>📦 ${k.itensHoje} itens</span>`,
      `<span>👥 ${k.ativosHoje}/${S.colportores.length} ativos</span>`,
      delta != null ? `<span class="${delta >= 0 ? 'sobe' : 'desce'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(delta * 100))}% vs ontem</span>` : '',
    ].join('');

    // meta da equipe (preço colportor) e fechamentos
    const m = S.meta;
    anel($('#pAnelMeta'), m.pct, 'meta');
    $('#pMetaPct').textContent = m.metaValor ? `${(m.pct * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—';
    $('#pMetaSub').textContent = m.metaValor ? `${brl0(m.realizado)} de ${brl0(m.metaValor)} · projeção ${Math.round(m.projecaoPct * 100)}%` : 'defina as metas em Minha meta';
    const f = S.fechamento;
    anel($('#pAnelFech'), f.total ? f.confirmados / f.total : 0, 'fech');
    $('#pFechTxt').textContent = `${f.confirmados}/${f.total}`;
    $('#pFechSub').textContent = f.total ? `${f.pendentes + f.emAndamento} pendente(s) · prazo 23h59` : 'sem colportores';

    // vendas por hora
    barras($('#pHoras'), P.porHora, {
      rotulo: (it) => `${it.h}h`, valor: (it) => it.valorPublico,
      destaque: (it) => it.h === P.horaAtual,
      dica: (it) => `<b>${it.h}h–${it.h + 1}h</b><br>${brl(it.valorPublico)} ao público<br><small>${brl(it.valor)} colportor · ${it.vendas} venda(s)</small>`,
    });

    // pódio do dia
    const top = S.rankingHoje.filter((r) => r.valorPublico > 0).slice(0, 3);
    const med = ['🥇', '🥈', '🥉'];
    $('#pPodio').innerHTML = top.length ? top.map((r, i) => `
      <div class="mp p${i + 1}">
        <div class="avatar">${esc(iniciais(r.nome))}<span>${med[i]}</span></div>
        <b>${esc(r.nome.split(' ')[0])}</b><small>${brl0(r.valorPublico)}</small>
      </div>`).join('') : '<p class="vazio">O pódio aparece com as primeiras vendas do dia.</p>';

    // feed ao vivo
    const ids = new Set(P.ultimas.map((v) => v.id));
    const novos = vistos ? new Set([...ids].filter((id) => !vistos.has(id))) : new Set();
    vistos = ids;
    $('#pFeedQtd').textContent = `${k.vendasHoje} hoje`;
    $('#pFeed').innerHTML = P.ultimas.length ? P.ultimas.slice(0, 7).map((v) => `
      <li class="${novos.has(v.id) ? 'entrou' : ''}">
        <div class="avatar pequeno">${esc(iniciais(v.colportor))}</div>
        <div class="feed-txt"><b>${esc(v.colportor.split(' ')[0])}</b> vendeu ${v.qtd}x ${esc(v.produto)}<small>${hora(v.criadaEm)} · colportor ${brl(v.valor)}</small></div>
        <span class="feed-val">${brl(v.valorPublico)}</span>
      </li>`).join('') : '<li class="vazio">As vendas aparecem aqui no momento em que são registradas.</li>';

    // segmentos
    const segs = P.segmentos;
    const maxSeg = Math.max(1, ...segs.map((s) => s.valorPublico));
    $('#pSegmentos').innerHTML = segs.length ? segs.map((s) => `
      <div class="bh">
        <div class="bh-topo"><span>${esc(s.segmento)} <small>· ${s.colportores}</small></span><b>${brl0(s.valorPublico)}</b></div>
        <div class="bh-trilho"><div class="bh-barra" style="width:${(s.valorPublico / maxSeg) * 100}%"></div></div>
      </div>`).join('') : '<p class="vazio">Os segmentos aparecem quando houver colportores cadastrados.</p>';

    // últimos 7 dias
    barras($('#p7dias'), P.ultimos7, {
      rotulo: (it) => new Date(it.dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
      valor: (it) => it.valorPublico,
      destaque: (it) => it.dia === S.hoje,
      dica: (it) => `<b>${new Date(it.dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}</b><br>${brl(it.valorPublico)} ao público<br><small>${brl(it.valor)} colportor · ${it.vendas} venda(s)</small>`,
    });
  }

  let ultimo = null;
  document.addEventListener('inab:estado', (e) => { ultimo = e.detail; render(ultimo); });
  // relógio do "atualizado" e redesenho ao voltar para o painel
  document.addEventListener('inab:aba', (e) => { if (e.detail === 'painel' && ultimo) render(ultimo); });
})();
