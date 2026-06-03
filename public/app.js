// ── STATE ─────────────────────────────────────────────────────────────────────
const state = {
  zip: '',
  reps: [],           // raw rep objects from /api/reps
  activeRepIdx: 0,    // which rep tab is selected
  topics: [],         // selected topic strings
  memberCache: {},    // bioguideId → detailed member data from /api/member
  moneyCache: {},      // bioguideId|name → FEC campaign finance data
  votesCache: {},      // bioguideId → congressional vote data
  aiSummaryCache: {},  // bioguideId → {topIssues, legislativeFocus, summary}
};

// ── UTILS ─────────────────────────────────────────────────────────────────────
function initials(name) {
  return name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function partyLabel(code) {
  if (code === 'D') return 'Democrat';
  if (code === 'R') return 'Republican';
  if (code === 'I') return 'Independent';
  return code || '';
}

function partyPillClass(code) {
  if (code === 'D') return 'pill-d';
  if (code === 'R') return 'pill-r';
  return 'pill-tag';
}

function fmtMoney(n) {
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function billStatus(latestActionText) {
  const t = (latestActionText || '').toLowerCase();
  if (t.includes('became public law') || t.includes('signed by president')) return 'law';
  if (t.includes('passed house') && t.includes('passed senate')) return 'passed-both';
  if (t.includes('passed house')) return 'passed-house';
  if (t.includes('passed senate')) return 'passed-senate';
  if (t.includes('failed') || t.includes('rejected') || t.includes('defeated')) return 'failed';
  if (t.includes('vetoed')) return 'vetoed';
  return 'committee';
}

function billStatusLabel(status) {
  return { law: 'Became Law', 'passed-both': 'Passed Both', 'passed-house': 'Passed House',
    'passed-senate': 'Passed Senate', failed: 'Failed', vetoed: 'Vetoed', committee: 'In Committee' }[status] || 'In Committee';
}

function billStatusClass(status) {
  return { law: 'status-law', 'passed-both': 'status-passed', 'passed-house': 'status-passed',
    'passed-senate': 'status-passed', failed: 'status-failed', vetoed: 'status-failed', committee: 'status-committee' }[status] || 'status-committee';
}

function congressGovUrl(bill) {
  if (!bill?.congress || !bill?.type || !bill?.number) return null;
  const typeSlug = { HR: 'house-bill', S: 'senate-bill', HJRES: 'house-joint-resolution',
    SJRES: 'senate-joint-resolution', HCONRES: 'house-concurrent-resolution',
    SCONRES: 'senate-concurrent-resolution', HRES: 'house-resolution', SRES: 'senate-resolution' };
  const slug = typeSlug[bill.type] || bill.type.toLowerCase();
  return `https://www.congress.gov/bill/${bill.congress}th-congress/${slug}/${bill.number}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function billTypeLabel(type) {
  const map = { HR: 'H.R.', S: 'S.', HJRES: 'H.J.Res.', SJRES: 'S.J.Res.', HCONRES: 'H.Con.Res.', SCONRES: 'S.Con.Res.', HRES: 'H.Res.', SRES: 'S.Res.' };
  return map[type] || type;
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── API ───────────────────────────────────────────────────────────────────────
const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '/.netlify/functions/api'
  : '/api';

async function apiFetch(path) {
  const res = await fetch(`${API}/${path}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

async function apiPost(path, data) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

// ── SCREENS ───────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) {
    target.classList.remove('hidden');
    window.scrollTo(0, 0);
  }
}

// ── ZIP SCREEN ────────────────────────────────────────────────────────────────
const zipInput = document.getElementById('zipInput');
const findBtn = document.getElementById('findRepsBtn');
const zipError = document.getElementById('zipError');

function setZipError(msg) {
  if (zipError) {
    zipError.textContent = msg;
    zipError.classList.toggle('hidden', !msg);
  }
}

function setZipLoading(loading) {
  findBtn.disabled = loading;
  findBtn.textContent = loading ? 'Finding...' : 'Find my reps';
}

async function handleZipSubmit() {
  const zip = zipInput.value.trim();
  if (!/^\d{5}$/.test(zip)) {
    setZipError('Please enter a valid 5-digit ZIP code.');
    zipInput.focus();
    return;
  }
  setZipError('');
  setZipLoading(true);

  try {
    const data = await apiFetch(`reps?zip=${zip}`);
    state.zip = zip;
    state.reps = data.reps || [];
    if (!state.reps.length) {
      setZipError('No representatives found for this ZIP code. Please double-check and try again.');
      return;
    }
    showScreen('screenTopics');
  } catch (e) {
    setZipError(e.message || 'Something went wrong. Please try again.');
  } finally {
    setZipLoading(false);
  }
}

findBtn.addEventListener('click', handleZipSubmit);
zipInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleZipSubmit(); });
zipInput.addEventListener('input', () => setZipError(''));

// ── TOPICS SCREEN ─────────────────────────────────────────────────────────────
const MAX_TOPICS = 3;
const topicCounter = document.getElementById('topicCounter');
const topicContinueBtn = document.getElementById('topicContinueBtn');

document.getElementById('topicGrid').addEventListener('click', e => {
  const chip = e.target.closest('.topic-chip');
  if (!chip) return;

  const topic = chip.dataset.topic;
  if (chip.classList.contains('selected')) {
    state.topics = state.topics.filter(t => t !== topic);
    chip.classList.remove('selected');
  } else {
    if (state.topics.length >= MAX_TOPICS) return;
    state.topics.push(topic);
    chip.classList.add('selected');
  }

  const count = state.topics.length;
  topicCounter.innerHTML = count === MAX_TOPICS
    ? `<strong class="maxed">${count}/${MAX_TOPICS} selected</strong>`
    : `Select up to <strong>${MAX_TOPICS} topics</strong> (${count} selected)`;
  topicContinueBtn.disabled = count === 0;

  // Disable unchosen chips when at max
  document.querySelectorAll('.topic-chip').forEach(c => {
    c.classList.toggle('disabled', count >= MAX_TOPICS && !c.classList.contains('selected'));
  });
});

topicContinueBtn.addEventListener('click', () => {
  state.activeRepIdx = 0;
  renderDashboard();
  showScreen('screenDash');
  if (state.reps[0]?.bioguideId) loadMemberDetail(state.reps[0].bioguideId);
});

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  renderRepTabs();
  renderRepHero(state.activeRepIdx);
  renderStatRow(state.activeRepIdx);
  renderAISummary(state.activeRepIdx);
  renderCommittees(state.activeRepIdx);
  renderActivityFeed(state.activeRepIdx);
  _wirePokeBtn();
}

function renderRepTabs() {
  const container = document.getElementById('repTabs');
  container.innerHTML = state.reps.map((rep, i) => {
    const short = rep.role === 'Representative'
      ? `Rep. ${rep.name.split(' ').pop()}`
      : rep.role.replace(' Senator', ' Sen.');
    return `<div class="rep-tab${i === state.activeRepIdx ? ' active' : ''}" data-idx="${i}">
      <div class="tab-av">${esc(initials(rep.name))}</div>
      ${esc(short)}
    </div>`;
  }).join('');

  container.querySelectorAll('.rep-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const idx = parseInt(tab.dataset.idx, 10);
      if (idx === state.activeRepIdx) return;
      state.activeRepIdx = idx;
      renderDashboard();
      const rep = state.reps[idx];
      if (rep?.bioguideId && !state.memberCache[rep.bioguideId]) {
        loadMemberDetail(rep.bioguideId);
      }
    });
  });
}

function renderRepHero(idx) {
  const rep = state.reps[idx];
  if (!rep) return;

  const cached = rep.bioguideId ? state.memberCache[rep.bioguideId] : null;
  const party = cached?.party || rep.party;
  const website = cached?.website || rep.website;
  const depiction = cached?.depiction || rep.depiction;
  const terms = cached?.terms || [];
  const phone = cached?.addressInformation?.phoneNumber || null;
  const birthYear = cached?.birthYear || null;

  const age = birthYear ? (new Date().getFullYear() - birthYear) : null;
  const sinceYear = terms.length ? Math.min(...terms.map(t => t.startYear).filter(Boolean)) : null;
  const yearsServed = sinceYear ? (new Date().getFullYear() - sinceYear) : null;
  const termsCount = terms.length || rep.termsCount || null;

  const chamberWord = rep.role === 'Representative' ? 'HOUSE' : 'SENATE';
  const partyWord = party === 'D' ? 'DEMOCRAT' : party === 'R' ? 'REPUBLICAN' : party || '';
  const badgeText = partyWord ? `${chamberWord} · ${partyWord}` : chamberWord;
  const bannerColor = party === 'D'
    ? 'linear-gradient(135deg,#1a3a6e 0%,#2558a0 100%)'
    : party === 'R'
    ? 'linear-gradient(135deg,#6e1a1a 0%,#a03030 100%)'
    : 'linear-gradient(135deg,#2a3a4e 0%,#3a5068 100%)';

  const avatarHtml = depiction
    ? `<img class="hero-av-lg" src="${esc(depiction)}" alt="${esc(rep.name)}">`
    : `<div class="hero-av-lg hero-av-initials">${esc(initials(rep.name))}</div>`;

  const districtLabel = rep.role === 'Representative' ? `${rep.state}-${rep.district}` : rep.state;

  const tenurePct = yearsServed ? Math.min(100, Math.round((yearsServed / 40) * 100)) : 0;
  const tenureSection = yearsServed ? `
    <div style="padding:0 16px 2px;">
      <div style="font-size:10px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">Tenure · ${yearsServed}y in office</div>
      <div style="height:5px;background:rgba(255,255,255,.2);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${tenurePct}%;background:rgba(255,255,255,.75);border-radius:3px;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:rgba(255,255,255,.45);margin-top:3px;"><span>0y</span><span>10y</span><span>20y</span><span>30y</span><span>40y+</span></div>
    </div>` : '';

  const phoneClean = phone ? phone.replace(/[^\d+]/g, '') : null;
  const actionBtns = [
    phoneClean ? `<a href="tel:${esc(phoneClean)}" class="hero-action-btn">📞 Call</a>` : '',
    website ? `<a href="${esc(website)}" target="_blank" rel="noopener" class="hero-action-btn">🌐 Website</a>` : '',
    `<button class="hero-action-btn hero-poke-btn" id="pokeRepBtn">👋 Poke</button>`,
  ].filter(Boolean).join('');

  const statsHtml = [
    age ? `<div class="hero-stat-item"><span class="hsi-val">${age}</span><span class="hsi-label">Age</span></div>` : '',
    termsCount ? `<div class="hero-stat-item"><span class="hsi-val">${termsCount}</span><span class="hsi-label">Terms</span></div>` : '',
    sinceYear ? `<div class="hero-stat-item"><span class="hsi-val">${sinceYear}</span><span class="hsi-label">Since</span></div>` : '',
  ].filter(Boolean).join('<div class="hero-stat-divider"></div>');

  document.getElementById('repHero').innerHTML = `
    <div class="hero-banner" style="background:${bannerColor};">
      <div class="hero-banner-inner">
        ${avatarHtml}
        <div class="hero-banner-text">
          <div class="hero-chamber-badge">${esc(badgeText)}</div>
          <div class="hero-name-lg">${esc(rep.name)}</div>
          <div class="hero-location">${esc(districtLabel)} · ${esc(rep.role)}</div>
        </div>
      </div>
      ${tenureSection}
      <div class="hero-action-row">${actionBtns}</div>
    </div>
    ${statsHtml ? `<div class="hero-stats-strip">${statsHtml}</div>` : ''}`;
}

function renderStatRow(idx) {
  const rep = state.reps[idx];
  if (!rep) return;
  const cached = rep.bioguideId ? state.memberCache[rep.bioguideId] : null;

  const terms = cached?.terms || [];
  const termsCount = cached ? terms.length : (rep.termsCount ?? '—');

  const sinceYear = terms.length
    ? Math.min(...terms.map(t => t.startYear).filter(Boolean))
    : '—';

  const districtLabel = rep.role === 'Representative'
    ? `${rep.state}-${rep.district}`
    : rep.state;

  const bills = cached?.sponsoredLegislation || [];
  const lawCount = bills.filter(b => billStatus(b.latestAction?.text) === 'law').length;
  const billStat = cached ? (lawCount > 0 ? lawCount : bills.length) : '—';
  const billLabel = cached ? (lawCount > 0 ? 'Laws' : 'Bills') : 'Bills';

  document.getElementById('statRow').innerHTML = `
    <div class="stat"><div class="stat-val">${esc(String(termsCount))}</div><div class="stat-label">Terms</div></div>
    <div class="stat"><div class="stat-val">${esc(String(sinceYear))}</div><div class="stat-label">Since</div></div>
    <div class="stat"><div class="stat-val">${esc(districtLabel)}</div><div class="stat-label">District</div></div>
    <div class="stat"><div class="stat-val">${esc(String(billStat))}</div><div class="stat-label">${esc(billLabel)}</div></div>`;
}

function renderCommittees(idx) {
  const el = document.getElementById('committeeSection');
  if (!el) return;
  const rep = state.reps[idx];
  const cached = rep?.bioguideId ? state.memberCache[rep.bioguideId] : null;
  const committees = cached?.committees || [];
  if (!committees.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:8px;">Committees</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${committees.map(c => {
        const rankLabel = c.rank ? ` · <span style="color:var(--blue)">${esc(c.rank)}</span>` : '';
        return `<span class="committee-chip">${esc(c.name)}${rankLabel}</span>`;
      }).join('')}
    </div>`;
}

function renderActivityFeed(idx) {
  const rep = state.reps[idx];
  if (!rep) return;
  const cached = rep.bioguideId ? state.memberCache[rep.bioguideId] : null;
  const feedEl = document.getElementById('activityFeed');

  if (!cached) {
    feedEl.innerHTML = rep.bioguideId
      ? '<div style="padding:16px;font-size:13px;color:var(--text-muted);">Loading activity…</div>'
      : '<div style="padding:16px;font-size:13px;color:var(--text-muted);">Activity details unavailable without member ID.</div>';
    return;
  }

  const bills = cached.sponsoredLegislation || [];
  if (!bills.length) {
    feedEl.innerHTML = '<div style="padding:16px;font-size:13px;color:var(--text-muted);">No sponsored legislation found.</div>';
    return;
  }

  feedEl.innerHTML = bills.slice(0, 6).map(bill => {
    const label = `${billTypeLabel(bill.type)} ${bill.number}`;
    const date = formatDate(bill.introducedDate);
    const action = bill.latestAction?.text || '';
    const topic = bill.policyArea?.name || '';
    const billText = `${label} — ${bill.title}`;
    const status = billStatus(action);
    const url = congressGovUrl({ congress: bill.congress, type: bill.type, number: bill.number });

    return `<div class="feed-card">
      <div class="feed-top">
        <span class="feed-badge ${billStatusClass(status)}">${esc(billStatusLabel(status))}</span>
        ${topic ? `<span class="feed-badge badge-money" style="background:var(--teal-bg);color:var(--teal-text);">${esc(topic)}</span>` : ''}
        <span class="feed-date">${esc(date)}</span>
      </div>
      <div class="feed-title">${esc(billText)}</div>
      ${action ? `<div class="feed-desc">${esc(action)}</div>` : ''}
      <div class="feed-action">
        <button class="explain-btn" data-text="${esc(billText)}" data-type="bill">What does this mean?</button>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="source-note" style="color:var(--blue);">congress.gov ↗</a>` : ''}
      </div>
    </div>`;
  }).join('');

  // Wire up explain buttons
  feedEl.querySelectorAll('.explain-btn').forEach(btn => {
    btn.addEventListener('click', () => openExplainModal(btn.dataset.text, btn.dataset.type, btn.dataset.text));
  });
}

// ── MEMBER DETAIL LOADER ──────────────────────────────────────────────────────
async function loadMemberDetail(bioguideId) {
  if (state.memberCache[bioguideId]) return;

  try {
    const data = await apiFetch(`member?bioguideId=${bioguideId}`);
    state.memberCache[bioguideId] = data;
    // Re-render whichever rep is currently active if it's this one
    const activeRep = state.reps[state.activeRepIdx];
    if (activeRep?.bioguideId === bioguideId) {
      renderRepHero(state.activeRepIdx);
      renderStatRow(state.activeRepIdx);
      renderAISummary(state.activeRepIdx);
      renderCommittees(state.activeRepIdx);
      renderActivityFeed(state.activeRepIdx);
      _wirePokeBtn();
      _maybeFetchAISummary(bioguideId, data);
    }
  } catch (e) {
    console.warn('Member detail fetch failed for', bioguideId, e.message);
    // Store a sentinel so we don't retry indefinitely
    state.memberCache[bioguideId] = { _failed: true, sponsoredLegislation: [], terms: [] };
    const activeRep = state.reps[state.activeRepIdx];
    if (activeRep?.bioguideId === bioguideId) {
      renderActivityFeed(state.activeRepIdx);
    }
  }
}

// ── SAY VS. DO FEED (dashboard preview) ───────────────────────────────────────
// Placeholder — full Say vs. Do data requires additional sources (future work)
function renderSayVsDoPreview() {
  document.getElementById('sayVsDoFeed').innerHTML = `
    <div style="padding:12px 0;font-size:13px;color:var(--text-muted);font-style:italic;">
      Say vs. Do comparisons require additional data sources. Coming soon.
    </div>`;
}

// ── EXPLAIN MODAL ─────────────────────────────────────────────────────────────
const modal = document.getElementById('explainModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');

function openExplainModal(title, type, text) {
  modalTitle.textContent = title;
  modalBody.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  apiPost('explain', { text, type })
    .then(data => {
      modalBody.textContent = data.explanation;
    })
    .catch(e => {
      modalBody.innerHTML = `<span style="color:var(--red-text);">${esc(e.message || 'Could not load explanation. Please try again.')}</span>`;
    });
}

function closeExplainModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

modalClose.addEventListener('click', closeExplainModal);
modal.addEventListener('click', e => { if (e.target === modal) closeExplainModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeExplainModal(); });

// ── NAVIGATION ────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item[data-screen]').forEach(item => {
  item.addEventListener('click', () => {
    const screenId = item.dataset.screen;
    showScreen(screenId);
    // Update active state on all nav bars
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.screen === screenId);
    });
    // Lazy-load member detail when switching to deeper screens
    const rep = state.reps[state.activeRepIdx];
    if (rep?.bioguideId && !state.memberCache[rep.bioguideId]) {
      loadMemberDetail(rep.bioguideId);
    }
  });
});

document.querySelectorAll('.back-btn[data-back]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

// See-all link wires
document.getElementById('sayVsDoAll')?.addEventListener('click', () => showScreen('screenSVD'));

// ── VOTES SCREEN ──────────────────────────────────────────────────────────────
// Filter state — reset when switching reps
let _votesFilter = { bioguideId: null, status: 'all', topic: 'all' };

function renderVotesScreen() {
  const rep = state.reps[state.activeRepIdx];
  const cached = rep?.bioguideId ? state.memberCache[rep.bioguideId] : null;
  const el = document.getElementById('votesContent');
  if (!rep) return;

  // Reset filters when rep changes
  if (_votesFilter.bioguideId !== rep.bioguideId) {
    _votesFilter = { bioguideId: rep.bioguideId, status: 'all', topic: 'all' };
  }

  // Real roll-call vote data takes priority if available
  const realVotes = rep.bioguideId ? state.votesCache[rep.bioguideId] : null;
  if (realVotes?.length) { _renderRealVotes(el, realVotes); return; }

  if (!cached) {
    el.innerHTML = '<div style="padding:16px;font-size:13px;color:var(--text-muted);">Loading bill history…</div>';
    if (rep.bioguideId && !state.votesCache[rep.bioguideId]) _fetchVotes(rep.bioguideId);
    return;
  }

  const bills = cached.sponsoredLegislation || [];
  if (!bills.length) {
    el.innerHTML = '<div style="padding:16px;font-size:13px;color:var(--text-muted);">No sponsored legislation found.</div>';
    return;
  }

  // Count by status for filter labels
  const counts = { law: 0, passed: 0, failed: 0, committee: 0 };
  bills.forEach(b => {
    const s = billStatus(b.latestAction?.text);
    if (s === 'law') counts.law++;
    else if (s.startsWith('passed')) counts.passed++;
    else if (s === 'failed' || s === 'vetoed') counts.failed++;
    else counts.committee++;
  });

  // Dynamic topic list from actual bill data
  const topics = [...new Set(bills.map(b => b.policyArea?.name).filter(Boolean))].sort();

  const statusOpts = [
    { key: 'all', label: `All (${bills.length})`, cls: '' },
    counts.law     ? { key: 'law',       label: `Became Law (${counts.law})`,       cls: 'status-law' }      : null,
    counts.passed  ? { key: 'passed',    label: `Passed (${counts.passed})`,         cls: 'status-passed' }   : null,
    counts.failed  ? { key: 'failed',    label: `Failed (${counts.failed})`,         cls: 'status-failed' }   : null,
    counts.committee ? { key: 'committee', label: `In Committee (${counts.committee})`, cls: 'status-committee' } : null,
  ].filter(Boolean);

  el.innerHTML = `
    <div style="padding:0 16px 4px;">
      <div class="filter-section-label">Status</div>
      <div class="filter-row" id="voteStatusFilter">
        ${statusOpts.map(o => `<div class="filter-chip${_votesFilter.status === o.key ? ' on' : ''}" data-status="${esc(o.key)}">${esc(o.label)}</div>`).join('')}
      </div>
      <div class="filter-section-label" style="margin-top:10px;">Topic</div>
      <select id="voteTopicFilter" class="topic-select">
        <option value="all">All topics</option>
        ${topics.map(t => `<option value="${esc(t)}"${_votesFilter.topic === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
    </div>
    <div id="votesList"></div>`;

  document.getElementById('voteStatusFilter').addEventListener('click', e => {
    const chip = e.target.closest('[data-status]');
    if (!chip) return;
    _votesFilter.status = chip.dataset.status;
    document.querySelectorAll('#voteStatusFilter .filter-chip').forEach(c =>
      c.classList.toggle('on', c.dataset.status === _votesFilter.status));
    _renderVotesList(bills);
  });

  document.getElementById('voteTopicFilter').addEventListener('change', e => {
    _votesFilter.topic = e.target.value;
    _renderVotesList(bills);
  });

  _renderVotesList(bills);
}

function _renderVotesList(bills) {
  const el = document.getElementById('votesList');
  if (!el) return;

  const filtered = bills.filter(b => {
    const s = billStatus(b.latestAction?.text);
    const statusMatch = _votesFilter.status === 'all'
      || (_votesFilter.status === 'passed' && s.startsWith('passed'))
      || (_votesFilter.status === 'committee' && s === 'committee')
      || s === _votesFilter.status;
    const topicMatch = _votesFilter.topic === 'all' || b.policyArea?.name === _votesFilter.topic;
    return statusMatch && topicMatch;
  });

  if (!filtered.length) {
    el.innerHTML = '<div style="padding:16px;font-size:13px;color:var(--text-muted);">No bills match this filter.</div>';
    return;
  }

  el.innerHTML = filtered.map(bill => {
    const label = `${billTypeLabel(bill.type)} ${bill.number} — ${bill.title}`;
    const date = formatDate(bill.introducedDate);
    const action = bill.latestAction?.text || '';
    const status = billStatus(action);
    const url = congressGovUrl({ congress: bill.congress, type: bill.type, number: bill.number });
    const topic = bill.policyArea?.name || '';
    return `<div class="feed-card" style="margin:0 16px 8px;">
      <div class="feed-top">
        <span class="feed-badge ${billStatusClass(status)}">${esc(billStatusLabel(status))}</span>
        ${topic ? `<span class="feed-badge" style="background:var(--teal-bg);color:var(--teal-text);">${esc(topic)}</span>` : ''}
        <span class="feed-date">${esc(date)}</span>
      </div>
      <div class="feed-title">${esc(label)}</div>
      ${action ? `<div class="feed-desc">${esc(action)}</div>` : ''}
      <div class="feed-action">
        <button class="explain-btn" data-text="${esc(label)}" data-type="bill">What does this mean?</button>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="source-note" style="color:var(--blue);">congress.gov ↗</a>` : ''}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.explain-btn').forEach(btn => {
    btn.addEventListener('click', () => openExplainModal(btn.dataset.text, 'bill', btn.dataset.text));
  });
}

function _renderRealVotes(el, votes) {
  el.innerHTML = `<div style="padding:0 16px 10px;font-size:12px;color:var(--text-hint);">${votes.length} recorded floor votes</div>` +
    votes.map(v => {
      const pos = (v.position || '').toLowerCase();
      const posClass = pos === 'yea' || pos === 'yes' ? 'vote-yes' : pos === 'nay' || pos === 'no' ? 'vote-no' : '';
      const billLabel = v.bill ? `${billTypeLabel(v.bill.type)} ${v.bill.number}` : '';
      const title = v.description || v.question || billLabel || 'Roll Call Vote';
      return `<div class="feed-card" style="margin:0 16px 8px;">
        <div class="feed-top">
          ${posClass ? `<span class="${posClass}">${esc((v.position || '').toUpperCase())}</span>` : ''}
          <span class="feed-badge status-committee">${esc(v.chamber || 'Floor vote')}</span>
          <span class="feed-date">${esc(formatDate(v.date))}</span>
        </div>
        <div class="feed-title">${esc(title)}</div>
        ${v.result ? `<div class="feed-desc">Result: ${esc(v.result)}</div>` : ''}
      </div>`;
    }).join('');
}

async function _fetchVotes(bioguideId) {
  if (state.votesCache[bioguideId] !== undefined) return;
  state.votesCache[bioguideId] = null; // mark in-flight
  try {
    const data = await apiFetch(`votes?bioguideId=${bioguideId}`);
    state.votesCache[bioguideId] = data.votes || [];
    const activeRep = state.reps[state.activeRepIdx];
    if (activeRep?.bioguideId === bioguideId) renderVotesScreen();
  } catch {
    state.votesCache[bioguideId] = [];
  }
}

// ── MONEY SCREEN ──────────────────────────────────────────────────────────────
function renderMoneyScreen() {
  const rep = state.reps[state.activeRepIdx];
  const el = document.getElementById('moneyContent');
  if (!rep) return;

  const cacheKey = rep.bioguideId || rep.name;
  if (state.moneyCache[cacheKey]) {
    _renderMoneyData(el, state.moneyCache[cacheKey], rep);
    return;
  }

  el.innerHTML = '<div style="padding:16px;font-size:13px;color:var(--text-muted);">Loading campaign finance data…</div>';

  const office = rep.role === 'Representative' ? 'H' : 'S';
  const qs = new URLSearchParams({ name: rep.name, state: rep.state, office });
  if (office === 'H' && rep.district) qs.set('district', rep.district);

  apiFetch(`money?${qs}`)
    .then(data => {
      state.moneyCache[cacheKey] = data;
      _renderMoneyData(el, data, rep);
    })
    .catch(e => {
      el.innerHTML = `<div style="padding:16px;font-size:13px;color:var(--red-text);">${esc(e.message)}</div>`;
    });
}

function _renderMoneyData(el, data, rep) {
  if (!data.found || !data.totals) {
    el.innerHTML = `<div class="money-card" style="margin:0 16px;">
      <div style="font-size:13px;color:var(--text-muted);">No FEC campaign finance record found for ${esc(rep.name)}.</div>
    </div>`;
    return;
  }

  const { totals, topEmployers } = data;

  const statsHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      <div class="stat"><div class="stat-val" style="font-size:16px;">${esc(fmtMoney(totals.receipts))}</div><div class="stat-label">Total raised</div></div>
      <div class="stat"><div class="stat-val" style="font-size:16px;">${esc(fmtMoney(totals.disbursements))}</div><div class="stat-label">Total spent</div></div>
      <div class="stat"><div class="stat-val" style="font-size:16px;">${esc(fmtMoney(totals.individualContributions))}</div><div class="stat-label">From individuals</div></div>
      <div class="stat"><div class="stat-val" style="font-size:16px;">${esc(fmtMoney(totals.pacContributions))}</div><div class="stat-label">From PACs</div></div>
    </div>`;

  let employersHtml = '';
  if (topEmployers.length) {
    const maxTotal = topEmployers[0].total || 1;
    employersHtml = `
      <div style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:10px;">Top donor employers</div>
      ${topEmployers.map(e => `
        <div class="money-bar-row">
          <div class="money-bar-label">${esc(e.employer)}</div>
          <div class="money-bar-track"><div class="money-bar-fill" style="width:${Math.round((e.total / maxTotal) * 100)}%"></div></div>
          <div class="money-bar-amt">${esc(fmtMoney(e.total))}</div>
        </div>`).join('')}`;
  } else {
    employersHtml = `<div style="font-size:12px;color:var(--text-hint);margin-bottom:12px;">Employer breakdown not available for this cycle.</div>`;
  }

  let donorsHtml = '';
  const topDonors = data.topDonors || [];
  if (topDonors.length) {
    donorsHtml = `
      <div style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin:16px 0 10px;">Large individual donors</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${topDonors.map(d => `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div style="min-width:0;">
              <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(d.name)}</div>
              ${d.employer || d.occupation ? `<div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc([d.occupation, d.employer].filter(Boolean).join(' · '))}</div>` : ''}
              ${d.city || d.state ? `<div style="font-size:10px;color:var(--text-hint);">${esc([d.city, d.state].filter(Boolean).join(', '))}</div>` : ''}
            </div>
            <div style="font-size:13px;font-weight:600;color:var(--blue);flex-shrink:0;">${esc(fmtMoney(d.amount))}</div>
          </div>`).join('<div style="height:1px;background:var(--border);margin:2px 0;"></div>')}
      </div>`;
  }

  el.innerHTML = `
    <div class="money-card" style="margin:0 16px;">
      <div style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:10px;">${esc(String(totals.cycle))} Election Cycle</div>
      ${statsHtml}
      ${employersHtml}
      ${donorsHtml}
      <div style="font-size:10px;color:var(--text-hint);margin-top:12px;">Source: FEC · Federal Election Commission</div>
    </div>`;
}

// ── SAY VS. DO FULL SCREEN ────────────────────────────────────────────────────
function renderSVDScreen() {
  document.getElementById('svdCards').innerHTML = `
    <div class="svd-card">
      <div style="font-size:13px;color:var(--text-muted);font-style:italic;line-height:1.6;">
        Say vs. Do comparisons match public statements against voting records,
        donor relationships, and stock trades. This feature requires additional
        data sources (Capitol Trades, GDELT, FEC) — coming soon.
      </div>
    </div>`;
}

// ── LEARN SCREEN ──────────────────────────────────────────────────────────────
const LEARN_ITEMS = [
  { title: 'How a bill becomes a law', desc: 'The step-by-step process from introduction to presidential signature.', term: 'How does a bill become a law in the United States Congress?' },
  { title: 'What is a congressional committee?', desc: 'Why most legislative work happens before the floor vote.', term: 'congressional committee' },
  { title: 'Senators vs. Representatives', desc: 'Why Congress has two chambers and how they differ.', term: 'What is the difference between a U.S. Senator and a U.S. House Representative?' },
  { title: 'What is the STOCK Act?', desc: 'The law that requires members of Congress to disclose stock trades.', term: 'STOCK Act' },
  { title: 'What is a PAC?', desc: 'How political action committees raise and spend money.', term: 'political action committee PAC' },
  { title: 'What does "cloture" mean?', desc: 'The Senate procedure used to end debate and force a vote.', term: 'cloture' },
];

function renderLearnScreen() {
  document.getElementById('learnContent').innerHTML = LEARN_ITEMS.map(item =>
    `<div class="learn-card" data-term="${esc(item.term)}" data-title="${esc(item.title)}" style="margin:0 16px 8px;">
      <div class="learn-card-title">${esc(item.title)}</div>
      <div class="learn-card-desc">${esc(item.desc)}</div>
    </div>`
  ).join('');

  document.querySelectorAll('.learn-card').forEach(card => {
    card.addEventListener('click', () =>
      openExplainModal(card.dataset.title, 'term', card.dataset.term)
    );
  });
}

// ── PREMIUM SCREEN ────────────────────────────────────────────────────────────
function renderPremiumScreen() {
  const el = document.getElementById('federalRepList');
  if (!state.reps.length) return;
  el.innerHTML = state.reps.map(rep => {
    const party = rep.party;
    return `<div class="rep-row-card">
      <div class="rep-av-sm">${esc(initials(rep.name))}</div>
      <div>
        <div class="rep-name-sm">${esc(rep.name)}</div>
        <div class="rep-role-sm">${esc(rep.role)} · ${esc(rep.state)}${party ? ` · ${esc(partyLabel(party))}` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

// Wire profile button to premium screen
document.getElementById('profileBtn')?.addEventListener('click', () => {
  renderPremiumScreen();
  showScreen('screenPremium');
});

// ── SCREEN CHANGE HOOKS ───────────────────────────────────────────────────────
// Re-render data-dependent screens when they become visible
const screenRenderMap = {
  screenVotes: renderVotesScreen,
  screenMoney: renderMoneyScreen,
  screenSVD: renderSVDScreen,
  screenLearn: renderLearnScreen,
};

const _origShowScreen = showScreen;
// Override showScreen to trigger screen-specific renders
(function () {
  const original = showScreen;
  // We redefine by wrapping the existing function reference
  window._showScreenWithRender = function (id) {
    original(id);
    if (screenRenderMap[id]) screenRenderMap[id]();
  };
})();

// Patch nav clicks to use the render-aware version
document.querySelectorAll('.nav-item[data-screen]').forEach(item => {
  // Re-wire (the first listener above covers showScreen; we add render here)
  item.addEventListener('click', () => {
    if (screenRenderMap[item.dataset.screen]) screenRenderMap[item.dataset.screen]();
  });
});

// ── AI SUMMARY ────────────────────────────────────────────────────────────────
function renderAISummary(idx) {
  const el = document.getElementById('aiSummarySection');
  if (!el) return;
  const rep = state.reps[idx];
  if (!rep?.bioguideId) { el.innerHTML = ''; return; }

  const cached = state.aiSummaryCache[rep.bioguideId];
  if (!cached) { el.innerHTML = ''; return; } // fetch triggered separately
  if (cached._loading) {
    el.innerHTML = `<div class="ai-summary-card"><div class="ai-summary-header"><span style="font-size:13px;color:var(--text-muted);">Generating AI summary…</span><div class="loading-dots" style="padding:0;"><span></span><span></span><span></span></div></div></div>`;
    return;
  }
  if (cached._failed || !cached.topIssues) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="ai-summary-card">
      <div class="ai-summary-header">
        <span style="font-size:15px;">🤖</span>
        <span class="ai-summary-label">AI Summary</span>
        <span style="font-size:11px;color:var(--text-hint);margin-left:auto;">Generated by Claude</span>
      </div>
      <div class="ai-summary-cols">
        <div class="ai-summary-col" style="border-right:0.5px solid var(--border);">
          <div class="ai-col-title">Top Issues</div>
          <ul class="ai-col-list">${(cached.topIssues || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        </div>
        <div class="ai-summary-col">
          <div class="ai-col-title">Legislative Focus</div>
          <p class="ai-summary-text">${esc(cached.legislativeFocus || '')}</p>
        </div>
      </div>
      ${cached.summary ? `<div style="padding:12px 14px;border-top:0.5px solid var(--border);">
        <div class="ai-col-title" style="margin-bottom:6px;">Summary</div>
        <p class="ai-summary-text">${esc(cached.summary)}</p>
      </div>` : ''}
      <div class="ai-summary-footer">Based on sponsored bills, committees, and FEC data · Always verify with official sources</div>
    </div>`;
}

function _maybeFetchAISummary(bioguideId, memberData) {
  if (state.aiSummaryCache[bioguideId]) return;
  state.aiSummaryCache[bioguideId] = { _loading: true };

  // Build compact context for Claude
  const bills = memberData.sponsoredLegislation || [];
  const topicCounts = {};
  bills.forEach(b => { if (b.policyArea?.name) topicCounts[b.policyArea.name] = (topicCounts[b.policyArea.name] || 0) + 1; });
  const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([t, n]) => `${t} (${n} bills)`).join(', ');

  const committees = (memberData.committees || []).map(c => c.rank ? `${c.name} (${c.rank})` : c.name).join(', ');
  const terms = memberData.terms || [];
  const sinceYear = terms.length ? Math.min(...terms.map(t => t.startYear).filter(Boolean)) : null;

  const context = [
    `Name: ${memberData.name}`,
    `Role: ${memberData.party === 'D' ? 'Democrat' : memberData.party === 'R' ? 'Republican' : ''} ${state.reps[state.activeRepIdx]?.role || ''}`,
    `State: ${memberData.state}${memberData.district ? `, District ${memberData.district}` : ''}`,
    sinceYear ? `Serving since: ${sinceYear} (${terms.length} terms)` : '',
    topTopics ? `Top bill topics: ${topTopics}` : '',
    `Total sponsored: ${bills.length} bills, ${memberData.cosponsoredLegislation?.length || 0} cosponsored`,
    committees ? `Committee assignments: ${committees}` : '',
  ].filter(Boolean).join('\n');

  apiPost('explain', { text: context, type: 'aiprofile' })
    .then(data => {
      try {
        const parsed = JSON.parse(data.explanation);
        state.aiSummaryCache[bioguideId] = parsed;
      } catch {
        state.aiSummaryCache[bioguideId] = { _failed: true };
      }
      const activeRep = state.reps[state.activeRepIdx];
      if (activeRep?.bioguideId === bioguideId) renderAISummary(state.activeRepIdx);
    })
    .catch(() => {
      state.aiSummaryCache[bioguideId] = { _failed: true };
    });

  // Show loading state immediately
  const activeRep = state.reps[state.activeRepIdx];
  if (activeRep?.bioguideId === bioguideId) renderAISummary(state.activeRepIdx);
}

// ── POKE YOUR REP ─────────────────────────────────────────────────────────────
const POKE_REACTIONS = [
  { key: 'support',   emoji: '👍', label: 'Support',   desc: 'I support their stance on this' },
  { key: 'oppose',    emoji: '👎', label: 'Oppose',    desc: 'I disagree with their position' },
  { key: 'explain',  emoji: '❓', label: 'Explain',   desc: 'I want them to explain this' },
  { key: 'concerned', emoji: '⚠️', label: 'Concerned', desc: "I'm worried about this issue" },
];

const POKE_ISSUES = [
  'Healthcare', 'Economy', 'Climate & Energy', 'Defense & Veterans',
  'Immigration', 'Education', 'Housing', 'Taxes', 'Tech & Privacy', 'Other',
];

let _poke = { step: 1, reaction: null, issue: null, message: '', generating: false };

function _wirePokeBtn() {
  const btn = document.getElementById('pokeRepBtn');
  if (btn) btn.addEventListener('click', openPokeModal);
}

function openPokeModal() {
  const rep = state.reps[state.activeRepIdx];
  if (!rep) return;
  _poke = { step: 1, reaction: null, issue: null, message: '', generating: false };
  document.getElementById('pokeModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  _renderPokeStep(rep);
}

function closePokeModal() {
  document.getElementById('pokeModal').classList.add('hidden');
  document.body.style.overflow = '';
}

document.getElementById('pokeModalClose').addEventListener('click', closePokeModal);
document.getElementById('pokeModal').addEventListener('click', e => {
  if (e.target === document.getElementById('pokeModal')) closePokeModal();
});

function _renderPokeStep(rep) {
  const el = document.getElementById('pokeStepContent');
  const title = document.getElementById('pokeModalTitle');

  if (_poke.step === 1) {
    title.textContent = 'How do you feel?';
    el.innerHTML = `
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px;">
        You're sending a message to <strong>${esc(rep.name)}</strong> (${esc(rep.role)}, ${esc(rep.state)}).
      </p>
      <div class="poke-reaction-grid">
        ${POKE_REACTIONS.map(r => `
          <button class="poke-reaction-option" data-reaction="${esc(r.key)}">
            <span class="poke-emoji">${r.emoji}</span>
            <span class="poke-reaction-label">${esc(r.label)}</span>
            <span class="poke-reaction-desc">${esc(r.desc)}</span>
          </button>`).join('')}
      </div>`;
    el.querySelectorAll('.poke-reaction-option').forEach(btn => {
      btn.addEventListener('click', () => {
        _poke.reaction = btn.dataset.reaction;
        _poke.step = 2;
        _renderPokeStep(rep);
      });
    });

  } else if (_poke.step === 2) {
    title.textContent = "What's this about?";
    el.innerHTML = `
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px;">Pick the issue you want to raise.</p>
      <div class="poke-issue-grid">
        ${POKE_ISSUES.map(issue => `
          <button class="poke-issue-chip${_poke.issue === issue ? ' selected' : ''}" data-issue="${esc(issue)}">
            ${esc(issue)}
          </button>`).join('')}
      </div>
      <button class="btn-full" id="pokeContinueBtn" style="margin-top:20px;" ${_poke.issue ? '' : 'disabled'}>
        Generate message →
      </button>
      <button class="poke-back-btn" id="pokeBack1">← Back</button>`;

    el.querySelectorAll('.poke-issue-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        _poke.issue = chip.dataset.issue;
        el.querySelectorAll('.poke-issue-chip').forEach(c => c.classList.toggle('selected', c.dataset.issue === _poke.issue));
        document.getElementById('pokeContinueBtn').disabled = false;
      });
    });
    document.getElementById('pokeContinueBtn').addEventListener('click', () => {
      _poke.step = 3;
      _renderPokeStep(rep);
      _generatePokeMessage(rep);
    });
    document.getElementById('pokeBack1').addEventListener('click', () => { _poke.step = 1; _renderPokeStep(rep); });

  } else if (_poke.step === 3) {
    const reactionObj = POKE_REACTIONS.find(r => r.key === _poke.reaction);
    title.textContent = 'Your message';
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
        <span class="poke-emoji" style="font-size:20px;">${reactionObj?.emoji || '📢'}</span>
        <span style="font-size:13px;color:var(--text-muted);">${esc(reactionObj?.label || '')} · ${esc(_poke.issue)}</span>
      </div>
      ${_poke.generating
        ? `<div class="loading-dots" style="justify-content:flex-start;padding:20px 0;"><span></span><span></span><span></span></div>`
        : `<textarea id="pokeMessageArea" class="poke-message-area" rows="7">${esc(_poke.message)}</textarea>
           <button class="poke-back-btn" id="pokeRegen" style="margin-top:4px;">↺ Regenerate</button>`
      }
      <button class="btn-full" id="pokeSendBtn" style="margin-top:16px;" ${_poke.generating ? 'disabled' : ''}>
        Review &amp; Send →
      </button>
      <button class="poke-back-btn" id="pokeBack2" style="margin-top:8px;">← Back</button>`;

    if (!_poke.generating) {
      document.getElementById('pokeMessageArea').addEventListener('input', e => { _poke.message = e.target.value; });
      document.getElementById('pokeRegen')?.addEventListener('click', () => { _generatePokeMessage(rep); });
      document.getElementById('pokeSendBtn').addEventListener('click', () => { _poke.step = 4; _renderPokeStep(rep); });
    }
    document.getElementById('pokeBack2')?.addEventListener('click', () => { _poke.step = 2; _renderPokeStep(rep); });

  } else if (_poke.step === 4) {
    title.textContent = 'Ready to send';
    const contactUrl = rep.website || `https://www.congress.gov/member/${rep.bioguideId}`;
    const mailtoSubject = encodeURIComponent(`Constituent message re: ${_poke.issue}`);
    const mailtoBody = encodeURIComponent(_poke.message);

    el.innerHTML = `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">
        Review your message, then send it through their official contact form.
      </p>
      <div class="poke-message-preview">${esc(_poke.message)}</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:20px;">
        <a href="${esc(contactUrl)}" target="_blank" rel="noopener" class="btn-primary" style="display:block;text-align:center;text-decoration:none;line-height:48px;">
          Open official contact form ↗
        </a>
        <button class="poke-copy-btn" id="pokeCopyBtn">Copy message to clipboard</button>
      </div>
      <p style="font-size:11px;color:var(--text-hint);margin-top:16px;text-align:center;">
        Civicly never sends anything automatically. You decide what goes out.
      </p>
      <button class="poke-back-btn" id="pokeBack3">← Edit message</button>`;

    document.getElementById('pokeCopyBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(_poke.message).then(() => {
        const btn = document.getElementById('pokeCopyBtn');
        btn.textContent = 'Copied! ✓';
        btn.style.background = 'var(--green-bg)';
        btn.style.color = 'var(--green-text)';
        setTimeout(() => { btn.textContent = 'Copy message to clipboard'; btn.style.background = ''; btn.style.color = ''; }, 2000);
      });
    });
    document.getElementById('pokeBack3').addEventListener('click', () => { _poke.step = 3; _renderPokeStep(rep); });

    // Record locally
    const key = `poke_${rep.bioguideId || rep.name}`;
    localStorage.setItem(key, String((parseInt(localStorage.getItem(key) || '0') + 1)));
  }
}

async function _generatePokeMessage(rep) {
  _poke.generating = true;
  _renderPokeStep(rep);
  const reactionObj = POKE_REACTIONS.find(r => r.key === _poke.reaction);
  const context = [
    `Representative: ${rep.name} (${rep.role}, ${rep.state})`,
    `Constituent reaction: ${reactionObj?.label || _poke.reaction}`,
    `Issue: ${_poke.issue}`,
  ].join('\n');
  try {
    const data = await apiPost('explain', { text: context, type: 'poke' });
    _poke.message = data.explanation || '';
  } catch {
    _poke.message = `${rep.role === 'Representative' ? 'Representative' : 'Senator'} ${rep.name.split(' ').pop()},\n\nI'm reaching out as a constituent about ${_poke.issue}. I'd appreciate hearing your position on this issue and how you're working to address the concerns of people in ${rep.state}.\n\nA constituent from ${rep.state}`;
  }
  _poke.generating = false;
  _renderPokeStep(rep);
}

// ── INIT ──────────────────────────────────────────────────────────────────────
renderSayVsDoPreview();
renderLearnScreen();
showScreen('screenZip');
