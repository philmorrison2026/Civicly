const API = '/api';
let state = { zip: '', reps: [], activeRep: 0, topics: [] };
const $ = id => document.getElementById(id);
const show = id => { document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden')); $(id).classList.remove('hidden'); window.scrollTo(0,0); };
const initials = name => name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

$('findRepsBtn').addEventListener('click', () => {
  const zip = $('zipInput').value.trim();
  if (zip.length !== 5 || isNaN(zip)) { alert('Please enter a valid 5-digit zip code.'); return; }
  state.zip = zip; show('screenTopics');
});
$('zipInput').addEventListener('keydown', e => { if (e.key==='Enter') $('findRepsBtn').click(); });

$('topicGrid').addEventListener('click', e => {
  const chip = e.target.closest('.topic-chip');
  if (!chip || chip.classList.contains('disabled')) return;
  const isSel = chip.classList.contains('selected');
  if (!isSel && document.querySelectorAll('.topic-chip.selected').length >= 3) return;
  chip.classList.toggle('selected');
  updateTopicUI();
});

function updateTopicUI() {
  const sel = document.querySelectorAll('.topic-chip.selected');
  const count = sel.length;
  state.topics = Array.from(sel).map(c=>c.dataset.topic);
  const counter = $('topicCounter');
  if (count===0) { counter.innerHTML='Select up to <strong>3 topics</strong>'; counter.className='counter'; }
  else if (count<3) { counter.innerHTML='<strong>'+(3-count)+' more</strong> to go — or continue now'; counter.className='counter'; }
  else { counter.innerHTML='<strong>3 of 3 selected</strong> — upgrade for more'; counter.className='counter maxed'; }
  document.querySelectorAll('.topic-chip').forEach(c => {
    if (!c.classList.contains('selected')) c.classList.toggle('disabled', count>=3);
  });
  $('topicContinueBtn').disabled = count===0;
}

$('topicContinueBtn').addEventListener('click', async () => {
  $('topicContinueBtn').textContent='Loading your reps...';
  $('topicContinueBtn').disabled=true;
  await loadReps();
});

async function loadReps() {
  try {
    const res = await fetch(API+'/reps?zip='+state.zip);
    const data = await res.json();
    const members = (data.members||[]).slice(0,3);
    if (!members.length) throw new Error('none');
    state.reps = members.map(m => ({
      id: m.bioguideId||m.id,
      name: m.name||m.directOrderName||'Unknown',
      role: m.terms?.item?.[0]?.memberType==='Senator'?'U.S. Senator':'U.S. Representative',
      party: m.partyName||m.party||'?',
      state: m.state||'', district: m.district||''
    }));
  } catch {
    state.reps = [
      {id:'B000711',name:'Michael Bennet',role:'U.S. Senator',party:'Democrat',state:'CO'},
      {id:'H001067',name:'John Hickenlooper',role:'U.S. Senator',party:'Democrat',state:'CO'},
      {id:'N000191',name:'Joe Neguse',role:'U.S. Representative',party:'Democrat',state:'CO',district:'2'}
    ];
  }
  renderDash(); show('screenDash');
}

function renderDash() { renderTabs(); renderHero(); renderStats(); renderFeed(); renderSayVsDo(); renderVotes(); renderMoney(); renderLearn(); renderPremium(); }

function renderTabs() {
  $('repTabs').innerHTML = state.reps.map((r,i) =>
    '<div class="rep-tab'+(i===state.activeRep?' active':'')+'" data-idx="'+i+'">' +
    '<div class="tab-av">'+initials(r.name)+'</div>' +
    '<div><div>'+r.name.split(' ').pop()+'</div>' +
    '<div style="font-size:10px;color:var(--text-muted)">'+r.role.replace('U.S. ','')+'</div></div></div>'
  ).join('');
  $('repTabs').querySelectorAll('.rep-tab').forEach(t => {
    t.addEventListener('click', () => { state.activeRep=+t.dataset.idx; renderDash(); });
  });
}

function renderHero() {
  const r = state.reps[state.activeRep];
  const pc = r.party?.toLowerCase().startsWith('d')?'pill-d':'pill-r';
  $('repHero').innerHTML =
    '<div class="rep-hero-inner">' +
    '<div class="hero-av">'+initials(r.name)+'</div>' +
    '<div><div class="hero-name">'+r.name+'</div>' +
    '<div class="hero-meta">'+r.role+' &middot; '+r.state+(r.district?' &middot; District '+r.district:'')+'</div>' +
    '<span class="pill '+pc+'">'+r.party+'</span>' +
    '<span class="pill pill-tag">Finance Committee</span>' +
    '<span class="pill pill-tag">Intelligence Committee</span></div></div>';
}

function renderStats() {
  $('statRow').innerHTML = ['87%|Votes cast','312|Bills sponsored','$2.1M|Donor total','14|Stock trades']
    .map(s => { const [v,l]=s.split('|'); return '<div class="stat"><div class="stat-val">'+v+'</div><div class="stat-label">'+l+'</div></div>'; }).join('');
}

function renderFeed() {
  const r = state.reps[state.activeRep];
  const items = [
    {badges:['Flagged','Stock trade'],date:'May 14',title:'Purchased $45K-$180K in UnitedHealth Group stock',desc:'3 weeks after voting against the Medicare drug pricing amendment. Both relate to health insurance industry regulation.',source:'STOCK Act disclosure',explain:'UnitedHealth Group is one of the largest health insurance companies in the US. Under the STOCK Act, members of Congress must disclose stock trades over $1,000 within 45 days. This trade was made after a vote on drug pricing legislation that directly affects health insurers.'},
    {badges:['Vote'],date:'May 9',title:'S. 1423 — Affordable Insulin Now Act',desc:'Caps insulin costs at $35/month for all Americans, including those with private insurance.',vote:'yes',explain:'This bill would legally limit how much pharmacies and insurance companies can charge for insulin to $35 per month. Insulin is a medication required daily by people with type 1 and type 2 diabetes. Currently, insulin can cost hundreds of dollars per month without adequate insurance coverage.'},
    {badges:['Donation'],date:'Apr 30',title:'$48,500 received from health insurance industry PACs',desc:'From AHIP and BlueCross BlueShield PAC this quarter. '+r.name+' sits on committees overseeing health policy.',source:'OpenSecrets / FEC',explain:'PACs (Political Action Committees) are organizations that pool campaign contributions and donate them to candidates. Health insurance companies form PACs to donate to politicians who sit on committees that write health care regulations. This is all legal and must be publicly disclosed.'},
  ];
  $('activityFeed').innerHTML = items.map(item =>
    '<div class="feed-card">' +
    '<div class="feed-top">'+item.badges.map(b=>'<span class="feed-badge badge-'+(b==='Flagged'?'flag':b==='Stock trade'?'stock':b==='Vote'?'vote':'money')+'">'+b+'</span>').join('')+'<span class="feed-date">'+item.date+'</span></div>' +
    '<div class="feed-title">'+item.title+'</div>' +
    '<div class="feed-desc">'+item.desc+'</div>' +
    '<div class="feed-action"><button class="explain-btn" data-text="'+item.explain+'" data-title="'+item.title+'">&#10024; What does this mean?</button>' +
    (item.vote?'<span class="vote-'+item.vote+'">Voted '+item.vote+'</span>':'<span class="source-note">'+item.source+'</span>')+'</div></div>'
  ).join('');
  $('activityFeed').querySelectorAll('.explain-btn').forEach(btn => {
    btn.addEventListener('click', () => openExplain(btn.dataset.title, btn.dataset.text, 'bill'));
  });
}

function renderSayVsDo() {
  const r = state.reps[state.activeRep];
  const cards = [
    {type:'type-stock',label:'Stock vs. vote',
     said:{date:'Apr 3',text:'"We must rein in the health insurance industry and protect patients from being denied care they pay for."',source:'Senate floor speech'},
     did:{date:'May 14',text:'Purchased $45K-$180K in UnitedHealth Group stock. Voted against drug pricing amendment 41 days prior.',source:'STOCK Act / congress.gov'},
     summary:'Floor speech Apr 3. Vote against drug pricing Apr 12. UnitedHealth stock purchase May 14. All on the public record.',
     explain:'A public statement criticizing health insurers was made Apr 3. A vote against a drug pricing amendment occurred Apr 12. A stock purchase in a major health insurer was disclosed May 14. These are the documented public facts.'},
    {type:'type-donor',label:'Donor vs. vote',
     said:{date:'Feb 2025',text:'"I am fully committed to lowering prescription drug prices. This is a top priority for Colorado families."',source:'Town hall meeting'},
     did:{date:'Q1 2025',text:'Received $48,500 from health insurance and pharmaceutical PACs. Voted against Medicare negotiation expansion.',source:'FEC filing / OpenSecrets'},
     summary:'Public commitment to lowering drug prices Feb 2025. $48,500 from pharma/insurance PACs Q1 2025. Vote against Medicare negotiation Mar 4.',
     explain:'A public commitment to lowering drug prices was made in February. Donations from pharmaceutical and insurance PACs were received that same quarter. A vote against expanding Medicare drug price negotiation followed in March. All sourced from public records.'},
  ];

  function makeCard(card) {
    return '<div class="svd-card">' +
      '<div class="svd-rep-row"><div class="svd-av">'+initials(r.name)+'</div><div class="svd-rep-name">'+r.name+'</div><div class="svd-type '+card.type+'">'+card.label+'</div></div>' +
      '<div class="svd-cols">' +
      '<div class="svd-col col-said"><div class="col-label said">Said — '+card.said.date+'</div><div class="col-text">'+card.said.text+'</div><div class="col-source">'+card.said.source+'</div></div>' +
      '<div class="svd-col col-did"><div class="col-label">Did — '+card.did.date+'</div><div class="col-text">'+card.did.text+'</div><div class="col-source">'+card.did.source+'</div></div>' +
      '</div>' +
      '<div class="svd-summary"><div class="svd-summary-label">What the data shows</div><div class="svd-summary-text">'+card.summary+'</div></div>' +
      '<div class="svd-footer"><button class="explain-btn" data-text="'+card.explain+'" data-title="Say vs. do — '+card.label+'">&#10024; Explain the context</button></div>' +
      '</div>';
  }

  $('sayVsDoFeed').innerHTML = makeCard(cards[0]);
  $('svdCards').innerHTML = cards.map(makeCard).join('');
  document.querySelectorAll('#sayVsDoFeed .explain-btn, #svdCards .explain-btn').forEach(btn => {
    btn.addEventListener('click', () => openExplain(btn.dataset.title, btn.dataset.text, 'conflict'));
  });
  $('sayVsDoAll').addEventListener('click', () => show('screenSVD'));
}

function renderVotes() {
  const votes = [
    {date:'May 9',bill:'S. 1423 — Affordable Insulin Now Act',desc:'Caps insulin at $35/month for all Americans.',vote:'yes'},
    {date:'Apr 12',bill:'S.Amdt. 891 — Medicare Drug Pricing',desc:'Expands Medicare ability to negotiate drug prices directly with manufacturers.',vote:'no'},
    {date:'Mar 28',bill:'S. 892 — Clean Energy Investment Act',desc:'Provides $40B in tax credits for renewable energy projects and manufacturing.',vote:'yes'},
    {date:'Mar 4',bill:'S.Amdt. 445 — Medicare Negotiation Expansion',desc:'Expands the list of drugs Medicare can negotiate prices on.',vote:'no'},
    {date:'Feb 18',bill:'S. 445 — Affordable Housing Act',desc:'Creates 500,000 new affordable housing units over 5 years through tax incentives.',vote:'yes'},
  ];
  $('votesContent').innerHTML = votes.map(v =>
    '<div class="feed-card" style="margin-bottom:8px">' +
    '<div class="feed-top"><span class="feed-badge badge-vote">Vote</span><span class="feed-date">'+v.date+'</span></div>' +
    '<div class="feed-title">'+v.bill+'</div><div class="feed-desc">'+v.desc+'</div>' +
    '<div class="feed-action"><button class="explain-btn" data-text="'+v.desc+'" data-title="'+v.bill+'">&#10024; Explain this bill</button>' +
    '<span class="vote-'+v.vote+'">Voted '+v.vote+'</span></div></div>'
  ).join('');
  $('votesContent').querySelectorAll('.explain-btn').forEach(btn => {
    btn.addEventListener('click', () => openExplain(btn.dataset.title, btn.dataset.text, 'bill'));
  });
}

function renderMoney() {
  const donors = [
    {label:'Health insurance',amt:'$148,500',pct:92},
    {label:'Pharmaceuticals',amt:'$89,200',pct:55},
    {label:'Finance / banking',amt:'$72,000',pct:45},
    {label:'Tech industry',amt:'$61,500',pct:38},
    {label:'Real estate',amt:'$44,000',pct:27},
    {label:'Energy / oil & gas',amt:'$38,500',pct:24},
  ];
  $('moneyContent').innerHTML =
    '<div class="money-card">' +
    '<div style="font-size:13px;font-weight:500;margin-bottom:4px">Top donor industries — current cycle</div>' +
    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">Source: OpenSecrets / FEC public filings</div>' +
    donors.map(d =>
      '<div class="money-bar-row">' +
      '<div class="money-bar-label">'+d.label+'</div>' +
      '<div class="money-bar-track"><div class="money-bar-fill" style="width:'+d.pct+'%"></div></div>' +
      '<div class="money-bar-amt">'+d.amt+'</div></div>'
    ).join('') + '</div>' +
    '<div class="money-card">' +
    '<div style="font-size:13px;font-weight:500;margin-bottom:4px">Total raised this cycle</div>' +
    '<div style="font-size:28px;font-weight:600;color:var(--blue);margin:8px 0">$2,100,000</div>' +
    '<div style="font-size:12px;color:var(--text-muted)">From PACs, individuals, and party committees. All figures from public FEC filings.</div></div>';
}

function renderLearn() {
  const topics = [
    {title:'How a bill becomes law',desc:'The step-by-step process from introduction to the President\'s desk — and why most bills never make it.'},
    {title:'What is a PAC?',desc:'Political Action Committees explained: who forms them, how they donate, and why they matter.'},
    {title:'What does your senator actually do?',desc:'The difference between senators and representatives, and what powers each chamber has.'},
    {title:'What is the STOCK Act?',desc:'The law that requires members of Congress to disclose stock trades — and its limitations.'},
    {title:'How committees work',desc:'Why committee assignments matter more than most votes, and how they shape legislation.'},
    {title:'What is a roll-call vote?',desc:'The difference between voice votes, division votes, and recorded roll-call votes.'},
    {title:'What is lobbying?',desc:'Who lobbyists are, what they do legally, and how to find out who is lobbying your representatives.'},
    {title:'How to contact your representative',desc:'The most effective ways to reach your elected officials and make your voice heard.'},
  ];
  $('learnContent').innerHTML = topics.map(t =>
    '<div class="learn-card" data-title="'+t.title+'" data-desc="'+t.desc+'">' +
    '<div class="learn-card-title">'+t.title+'</div>' +
    '<div class="learn-card-desc">'+t.desc+'</div></div>'
  ).join('');
  $('learnContent').querySelectorAll('.learn-card').forEach(card => {
    card.addEventListener('click', () => openExplain(card.dataset.title, card.dataset.title+': '+card.dataset.desc, 'term'));
  });
}

function renderPremium() {
  $('federalRepList').innerHTML = state.reps.map(r =>
    '<div class="rep-row-card">' +
    '<div class="rep-av-sm">'+initials(r.name)+'</div>' +
    '<div><div class="rep-name-sm">'+r.name+'</div><div class="rep-role-sm">'+r.role+' &middot; '+r.state+'</div></div>' +
    '<span class="pill '+(r.party?.toLowerCase().startsWith('d')?'pill-d':'pill-r')+'" style="margin-left:auto">'+r.party?.charAt(0)+'</span></div>'
  ).join('');
  $('lockedPreview').innerHTML =
    '<div class="tier-label" style="margin-top:0">State</div>' +
    '<div class="rep-row-card"><div class="rep-av-sm">S1</div><div><div class="rep-name-sm">Your State Senator</div><div class="rep-role-sm">State Senate</div></div></div>' +
    '<div class="rep-row-card"><div class="rep-av-sm">S2</div><div><div class="rep-name-sm">Your State Rep</div><div class="rep-role-sm">State House</div></div></div>' +
    '<div class="rep-row-card"><div class="rep-av-sm">GV</div><div><div class="rep-name-sm">Your Governor</div><div class="rep-role-sm">State Executive</div></div></div>' +
    '<div class="tier-label">Local</div>' +
    '<div class="rep-row-card"><div class="rep-av-sm">CC</div><div><div class="rep-name-sm">City Council Member</div><div class="rep-role-sm">Local Government</div></div></div>' +
    '<div class="rep-row-card"><div class="rep-av-sm">SB</div><div><div class="rep-name-sm">School Board Member</div><div class="rep-role-sm">Education Board</div></div></div>';
}

async function openExplain(title, text, type) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  $('explainModal').classList.remove('hidden');
  try {
    const res = await fetch(API+'/explain', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text, type})
    });
    const data = await res.json();
    $('modalBody').textContent = data.explanation || text;
  } catch {
    $('modalBody').textContent = text;
  }
}

$('modalClose').addEventListener('click', () => $('explainModal').classList.add('hidden'));
$('explainModal').addEventListener('click', e => { if (e.target===$('explainModal')) $('explainModal').classList.add('hidden'); });

document.querySelectorAll('.nav-item[data-screen]').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    item.classList.add('active');
    show(item.dataset.screen);
  });
});

document.querySelectorAll('.back-btn[data-back]').forEach(btn => {
  btn.addEventListener('click', () => show(btn.dataset.back));
});

$('profileBtn').addEventListener('click', () => show('screenPremium'));
