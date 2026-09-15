(() => {
  'use strict';

  const VERSION = 3;
  const DB_NAME = 'SweetSpotDB';
  const DB_STORE = 'kv';
  const DB_KEY = 'state';
  const LEGACY_KEYS = ['sweetSpotV2', 'sweetSpotState'];
  const RATING_STATES = ['Low', 'Right', 'High'];
  const PILLAR_STATES = ['Good', 'Needs love', 'Later'];
  const MEAL_TAGS = ['Low effort', '15 min', 'Cheap', 'Cold', 'BBQ', 'Comfort', 'Fresh'];

  const moods = [
    {key:'Flat', icon:'😴', label:'Flat'},
    {key:'Good', icon:'😌', label:'Good'},
    {key:'Restless', icon:'⚡', label:'Restless'},
    {key:'Full', icon:'🤯', label:'Full'}
  ];

  const socials = [
    {key:'Need people', label:'Need people'},
    {key:'Balanced', label:'Balanced'},
    {key:'Need space', label:'Need space'}
  ];

  const balanceDefs = [
    {key:'stimulation', icon:'⚡', title:'Stimulation', question:'Bored, engaged, or overloaded?'},
    {key:'recovery', icon:'🌿', title:'Recovery', question:'Running flat or properly recharged?'},
    {key:'connection', icon:'♡', title:'Connection', question:'Need people, or a little space?'},
    {key:'novelty', icon:'✦', title:'Novelty', question:'Too repetitive, fresh, or chaotic?'}
  ];

  const boosters = ['🌤 Outside','🚶 Move','🍜 Good food','♡ People','🎣 Fun','◌ Quiet','🔧 Make something','✦ Something new'];

  const defaultPillars = [
    {id:'work',icon:'🛠',name:'Meaningful work',sub:'Useful, hands-on and creative',state:'Good'},
    {id:'people',icon:'🤝',name:'Good people',sub:'Supportive, straightforward company',state:'Good'},
    {id:'home',icon:'⌂',name:'Home & community',sub:'A grounded base that feels yours',state:'Needs love'},
    {id:'relationships',icon:'♡',name:'Relationships',sub:'Time and attention for your people',state:'Good'},
    {id:'adventure',icon:'⌁',name:'Adventure',sub:'Nature, travel, fishing and novelty',state:'Needs love'},
    {id:'future',icon:'↗',name:'Future',sub:'Move forward without rushing everything',state:'Later'}
  ];

  const defaultMeals = [
    {id:'m1',name:'Chicken wraps',tags:['Low effort','15 min','Cheap']},
    {id:'m2',name:'Cold burritos',tags:['Low effort','Cold','Cheap']},
    {id:'m3',name:'Rice bowl',tags:['15 min','Fresh']},
    {id:'m4',name:'Pasta + protein',tags:['15 min','Comfort']},
    {id:'m5',name:'Eggs on toast',tags:['Low effort','15 min','Cheap']},
    {id:'m6',name:'Toasties',tags:['Low effort','15 min','Comfort']},
    {id:'m7',name:'Tacos',tags:['Fresh','Comfort']},
    {id:'m8',name:'BBQ + salad',tags:['BBQ','Fresh']},
    {id:'m9',name:'Chicken & couscous',tags:['15 min','Fresh']},
    {id:'m10',name:'Freezer backup',tags:['Low effort','15 min']}
  ];

  const adventureIdeas = [
    {title:'Sunset fishing somewhere easy',type:'Outdoors'},
    {title:'Drive somewhere new for a walk and a coffee',type:'Adventure'},
    {title:'Pick a beach or track you haven’t done lately',type:'Outdoors'},
    {title:'Take the camera out for a one-hour photo mission',type:'Adventure'},
    {title:'Plan a simple overnight camp',type:'Outdoors'},
    {title:'Try a restaurant or takeaway you’ve never had',type:'Food'},
    {title:'Cook one completely new thing this weekend',type:'Food'},
    {title:'Message someone and make a small plan',type:'Social'},
    {title:'Do a short snorkel, swim or coast mission',type:'Outdoors'},
    {title:'Take a no-purpose drive and explore one turn-off',type:'Adventure'}
  ];

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  let state;
  let historyDays = 7;
  let selectedHistoryDate = null;
  let toastTimer = null;
  let selectedMealTags = new Set(['Low effort']);
  let pendingWorker = null;
  let refreshingForUpdate = false;

  const storage = {
    db: null,
    async open(){
      if(!('indexedDB' in window)) return null;
      if(this.db) return this.db;
      return new Promise(resolve => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if(!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
        };
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => resolve(null);
      });
    },
    async load(){
      const db = await this.open();
      if(db){
        const found = await new Promise(resolve => {
          const tx = db.transaction(DB_STORE, 'readonly');
          const req = tx.objectStore(DB_STORE).get(DB_KEY);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
        if(found) return normalizeState(found);
      }
      const migrated = migrateLegacy();
      if(migrated){ await this.save(migrated); return migrated; }
      return emptyState();
    },
    async save(value){
      try{
        const db = await this.open();
        if(db){
          await new Promise((resolve,reject) => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).put(value, DB_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          return;
        }
      }catch(e){ console.warn('IndexedDB save failed', e); }
      try{ localStorage.setItem('sweetSpotV3Fallback', JSON.stringify(value)); }catch(_e){}
    },
    async clear(){
      try{
        const db = await this.open();
        if(db){
          await new Promise(resolve => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).delete(DB_KEY);
            tx.oncomplete = resolve; tx.onerror = resolve;
          });
        }
      }catch(_e){}
      ['sweetSpotV3Fallback', ...LEGACY_KEYS].forEach(k => { try{localStorage.removeItem(k);}catch(_e){} });
    }
  };

  function emptyState(){
    return {
      version: VERSION,
      settings:{theme:'system'},
      draft:{date:localDate(),mood:'',social:'',ratings:{},boosters:[],note:'',oneThing:''},
      history:[],
      life:{focus:'',pillars:structuredCloneSafe(defaultPillars),adventures:[]},
      food:{energy:'Normal',lastPickId:'',meals:structuredCloneSafe(defaultMeals)}
    };
  }

  function localDate(d = new Date()){
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function parseDateLocal(s){
    if(!s) return null;
    const [y,m,d] = s.split('-').map(Number);
    if(!y || !m || !d) return null;
    return new Date(y,m-1,d,12,0,0);
  }

  function structuredCloneSafe(value){ return JSON.parse(JSON.stringify(value)); }

  function migrateLegacy(){
    try{
      const fallback = localStorage.getItem('sweetSpotV3Fallback');
      if(fallback) return normalizeState(JSON.parse(fallback));
    }catch(_e){}

    let rawV2 = null;
    try{ rawV2 = localStorage.getItem('sweetSpotV2'); }catch(_e){}
    if(rawV2){
      try{
        const old = JSON.parse(rawV2);
        const fresh = emptyState();
        fresh.settings = {...fresh.settings,...(old.settings||{})};
        fresh.draft = {
          ...fresh.draft,
          ...(old.draft||{}),
          mood: old.draft?.mood || '',
          social: old.draft?.social || '',
          ratings:{...(old.draft?.ratings||{})},
          boosters:[...(old.draft?.boosters||[])]
        };
        fresh.history = (old.history||[]).map(e => ({
          date:e.date,mood:e.mood||'',social:e.social||'',ratings:{...(e.ratings||{})},
          boosters:[...(e.boosters||[])],note:e.note||'',oneThing:e.oneThing||''
        })).filter(e=>e.date);
        fresh.life.focus = old.life?.focus || '';
        fresh.life.pillars = Array.isArray(old.life?.pillars) ? old.life.pillars : fresh.life.pillars;
        fresh.life.adventures = (old.life?.adventures||[]).map(a => ({
          id:a.id||Date.now()+Math.random(),title:a.title||a.text||'',date:a.date||'',type:a.type||'Adventure'
        })).filter(a=>a.title);
        if(Array.isArray(old.food?.meals) && old.food.meals.length){
          fresh.food.meals = old.food.meals.map((m,i) => typeof m === 'string' ? {id:`legacy-${i}-${Date.now()}`,name:m,tags:inferMealTags(m)} : normalizeMeal(m));
        }
        fresh.food.energy = old.food?.energy || 'Normal';
        return normalizeState(fresh);
      }catch(e){ console.warn('V2 migration skipped',e); }
    }

    let rawV1 = null;
    try{ rawV1 = localStorage.getItem('sweetSpotState'); }catch(_e){}
    if(rawV1){
      try{
        const old = JSON.parse(rawV1), fresh = emptyState();
        fresh.life.focus = old.focus || '';
        fresh.history = (old.history||[]).map(e => ({
          date:e.date,mood:'',social:'',ratings:{stimulation:e.stimulation,recovery:e.recovery,connection:e.connection,novelty:e.novelty},
          boosters:Array.isArray(e.boosters)?e.boosters:[],note:e.note||'',oneThing:''
        })).filter(e=>e.date);
        if(old.today){
          fresh.draft = {...fresh.draft,ratings:{stimulation:old.today.stimulation,recovery:old.today.recovery,connection:old.today.connection,novelty:old.today.novelty},boosters:old.today.boosters||[],note:old.today.note||''};
        }
        return normalizeState(fresh);
      }catch(e){ console.warn('V1 migration skipped',e); }
    }
    return null;
  }

  function normalizeState(input){
    const base = emptyState();
    const s = input || {};
    const out = {...base,...s};
    out.version = VERSION;
    out.settings = {...base.settings,...(s.settings||{})};
    out.draft = {...base.draft,...(s.draft||{}),ratings:{...(s.draft?.ratings||{})},boosters:Array.isArray(s.draft?.boosters)?s.draft.boosters:[]};
    if(out.draft.date !== localDate()) out.draft = {...base.draft,date:localDate()};
    out.history = Array.isArray(s.history) ? s.history.map(e => ({date:e.date,mood:e.mood||'',social:e.social||'',ratings:{...(e.ratings||{})},boosters:Array.isArray(e.boosters)?e.boosters:[],note:e.note||'',oneThing:e.oneThing||''})).filter(e=>e.date) : [];
    out.life = {...base.life,...(s.life||{})};
    out.life.pillars = Array.isArray(s.life?.pillars) && s.life.pillars.length ? s.life.pillars : structuredCloneSafe(defaultPillars);
    out.life.adventures = Array.isArray(s.life?.adventures) ? s.life.adventures.map(a => ({id:a.id||`${Date.now()}-${Math.random()}`,title:a.title||a.text||'',date:a.date||'',type:a.type||'Adventure'})).filter(a=>a.title) : [];
    out.food = {...base.food,...(s.food||{})};
    out.food.meals = Array.isArray(s.food?.meals) && s.food.meals.length ? s.food.meals.map((m,i) => typeof m === 'string' ? {id:`meal-${i}-${Date.now()}`,name:m,tags:inferMealTags(m)} : normalizeMeal(m)) : structuredCloneSafe(defaultMeals);
    if(!['Low','Normal','Keen'].includes(out.food.energy)) out.food.energy='Normal';
    return out;
  }

  function normalizeMeal(m){
    return {id:m.id||`meal-${Date.now()}-${Math.random()}`,name:String(m.name||'Meal'),tags:Array.isArray(m.tags)?m.tags.filter(t=>MEAL_TAGS.includes(t)):[]};
  }

  function inferMealTags(name=''){
    const n=name.toLowerCase(), tags=[];
    if(/egg|toast|wrap|burrito|freezer|toastie/.test(n)) tags.push('Low effort');
    if(/egg|toast|wrap|pasta|couscous|rice|freezer/.test(n)) tags.push('15 min');
    if(/egg|toast|burrito|pasta/.test(n)) tags.push('Cheap');
    if(/cold|burrito|sandwich/.test(n)) tags.push('Cold');
    if(/bbq|barbecue/.test(n)) tags.push('BBQ');
    if(/pasta|toastie|taco/.test(n)) tags.push('Comfort');
    if(/salad|couscous|rice|wrap/.test(n)) tags.push('Fresh');
    return [...new Set(tags)];
  }

  function persist(){ storage.save(state); }
  function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),1700); }
  function formatLongDate(dateStr){ const d=parseDateLocal(dateStr); return d ? d.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'}) : ''; }
  function moodDef(key){ return moods.find(m=>m.key===key); }
  function recentHistory(days=14){ const cutoff=new Date(); cutoff.setHours(0,0,0,0); cutoff.setDate(cutoff.getDate()-(days-1)); return state.history.filter(e=>{const d=parseDateLocal(e.date);return d&&d>=cutoff;}).sort((a,b)=>b.date.localeCompare(a.date)); }
  function hasAnyCheckin(e){ return !!(e.mood||e.social||Object.values(e.ratings||{}).some(Boolean)||(e.boosters||[]).length||e.note||e.oneThing); }

  async function init(){
    state = await storage.load();
    applyTheme();
    bindEvents();
    refreshDayIfNeeded();
    renderAll();
    routeFromHash();
    renderInstallCard();
    registerSW();
  }

  function bindEvents(){
    $$('.tab').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.target,true)));
    $('#brandButton').addEventListener('click',()=>showView('today',true));
    $('#topSettingsBtn').addEventListener('click',()=>showView('more',true));
    $('#openLifeBtn').addEventListener('click',()=>showView('life',true));
    $('#saveTodayBtn').addEventListener('click',saveToday);
    $('#saveOneThingBtn').addEventListener('click',()=>{state.draft.oneThing=$('#todayOneThing').value.trim();persist();syncIfSaved();renderSavedPill();toast('One thing saved');});
    $('#todayOneThing').addEventListener('input',e=>{state.draft.oneThing=e.target.value;persist();renderSavedPill();});
    $('#dailyNote').addEventListener('input',e=>{state.draft.note=e.target.value;persist();renderSavedPill();});
    $('#ideaBtn').addEventListener('click',giveIdea);
    $('#useNudgeBtn').addEventListener('click',()=>{const s=getSuggestion();state.draft.oneThing=s.action;$('#todayOneThing').value=s.action;persist();renderSavedPill();toast('Added as today’s one thing');});
    $('#saveFocusBtn').addEventListener('click',()=>{state.life.focus=$('#lifeFocus').value.trim();persist();toast('Focus saved');});
    $('#lifeFocus').addEventListener('input',e=>{state.life.focus=e.target.value;persist();});
    $('#addAdventureBtn').addEventListener('click',addAdventure);
    $('#adventureInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addAdventure();}});
    $('#surpriseAdventureBtn').addEventListener('click',suggestAdventure);
    $('#pickMealBtn').addEventListener('click',pickMeal);
    $('#rerollMealBtn').addEventListener('click',pickMeal);
    $('#addMealBtn').addEventListener('click',addMeal);
    $('#mealInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addMeal();}});
    $('#historyToggle').addEventListener('click',()=>{historyDays=historyDays===7?30:7;$('#historyToggle').textContent=historyDays===7?'30 days':'7 days';renderHistory();});
    $('#themeControl').addEventListener('click',e=>{const b=e.target.closest('button[data-theme]');if(!b)return;state.settings.theme=b.dataset.theme;persist();applyTheme();});
    $('#exportBtn').addEventListener('click',exportBackup);
    $('#importInput').addEventListener('change',importBackup);
    $('#resetBtn').addEventListener('click',resetData);
    $('#closeDayDialog').addEventListener('click',()=>$('#dayDialog').close());
    $('#deleteDayBtn').addEventListener('click',deleteSelectedDay);
    $('#refreshAppBtn').addEventListener('click',activateUpdate);
    window.addEventListener('hashchange',routeFromHash);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshDayIfNeeded();renderToday();}});
  }

  function renderAll(){
    $('#todayLabel').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
    $('#versionLabel').textContent=`Sweet Spot v${VERSION}.0 · Offline-first · IndexedDB`;
    renderToday(); renderPatterns(); renderLife(); renderMore();
  }

  function greeting(){
    const h=new Date().getHours();
    if(h<12)return 'Good morning.';
    if(h<17)return 'Good afternoon.';
    return 'Good evening.';
  }

  function renderToday(){
    $('#todayTitle').textContent=greeting();
    $('#greetingKicker').textContent=new Date().toLocaleDateString(undefined,{weekday:'long'}).toUpperCase();
    renderMood(); renderSocial(); renderBalances(); renderBoosters();
    $('#dailyNote').value=state.draft.note||'';
    $('#todayOneThing').value=state.draft.oneThing||'';
    renderNudge(); renderNextAdventure(); renderSavedPill();
  }

  function renderMood(){
    const wrap=$('#moodGrid'); wrap.innerHTML='';
    moods.forEach(m=>{
      const b=document.createElement('button'); b.type='button'; b.className='mood-btn'+(state.draft.mood===m.key?' selected':'');
      b.innerHTML=`<span>${m.icon}</span>${m.label}`;
      b.addEventListener('click',()=>{state.draft.mood=state.draft.mood===m.key?'':m.key;persist();renderMood();renderNudge();renderSavedPill();});
      wrap.appendChild(b);
    });
  }

  function renderSocial(){
    const wrap=$('#socialRow'); wrap.innerHTML='';
    socials.forEach(s=>{
      const b=document.createElement('button');b.type='button';b.className='social-btn'+(state.draft.social===s.key?' selected':'');b.textContent=s.label;
      b.addEventListener('click',()=>{state.draft.social=state.draft.social===s.key?'':s.key;persist();renderSocial();renderNudge();renderSavedPill();});wrap.appendChild(b);
    });
  }

  function renderBalances(){
    const wrap=$('#balanceGrid');wrap.innerHTML='';let completed=0;
    balanceDefs.forEach(def=>{
      if(state.draft.ratings[def.key])completed++;
      const card=document.createElement('div');card.className='balance-card';
      card.innerHTML=`<div class="balance-top"><div><div class="balance-title">${def.icon} ${def.title}</div><div class="balance-question">${def.question}</div></div></div><div class="segment"></div>`;
      const seg=card.querySelector('.segment');
      RATING_STATES.forEach(label=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.classList.toggle('selected',state.draft.ratings[def.key]===label);b.addEventListener('click',()=>{if(state.draft.ratings[def.key]===label)delete state.draft.ratings[def.key];else state.draft.ratings[def.key]=label;persist();renderBalances();renderNudge();renderSavedPill();});seg.appendChild(b);});
      wrap.appendChild(card);
    });
    $('#deepCompletion').textContent=`${completed}/4`;
  }

  function renderBoosters(){
    const wrap=$('#boosterChips');wrap.innerHTML='';
    boosters.forEach(label=>{const b=document.createElement('button');b.type='button';b.className='chip'+(state.draft.boosters.includes(label)?' selected':'');b.textContent=label;b.addEventListener('click',()=>{const i=state.draft.boosters.indexOf(label);if(i>=0)state.draft.boosters.splice(i,1);else state.draft.boosters.push(label);persist();renderBoosters();renderSavedPill();});wrap.appendChild(b);});
  }

  function getSuggestion(){
    const d=state.draft, r=d.ratings||{}, patterns=analyzePatterns();
    if(d.mood==='Full') return {icon:'◌',title:'Make the day smaller.',reason:'You marked yourself as full. More stimulation probably won’t help as much as reducing inputs.',action:'Take 30 quiet minutes with no extra inputs'};
    if(d.mood==='Restless') return {icon:'⌁',title:'You probably need a change of scene.',reason:'Restlessness often responds better to movement or novelty than trying to force more focus.',action:'Go outside and do something slightly different for 30 minutes'};
    if(d.mood==='Flat' && r.recovery==='Low') return {icon:'🌿',title:'Energy first, novelty second.',reason:'Feeling flat plus low recovery points toward a genuinely easy reset rather than pushing harder.',action:'Have a low-demand hour and get outside briefly'};
    if(d.mood==='Flat') return {icon:'✦',title:'Add one small spark.',reason:'You feel flat, so the goal is not a huge plan — just enough interest or movement to change the texture of the day.',action:'Do one small thing that feels genuinely interesting'};
    if(d.social==='Need people') return {icon:'♡',title:'A little connection may help.',reason:'You said you need people. Keep it light rather than turning it into a big social commitment.',action:'Message one person and make a small plan'};
    if(d.social==='Need space') return {icon:'◌',title:'Protect some solo space.',reason:'You said you need space. A short block with no demands may be more useful than squeezing in another plan.',action:'Take 30 minutes completely to yourself'};
    if(r.recovery==='Low') return {icon:'🌿',title:'Recovery is the one to protect.',reason:'Recovery is low today. Cutting one demand is probably more useful than adding another habit.',action:'Choose one thing you can make easier tonight'};
    if(r.novelty==='Low') return {icon:'✦',title:'You could use a little novelty.',reason:'Today feels repetitive. It does not need to be a big adventure — just something outside the normal loop.',action:randomAdventureAction()};
    if(r.stimulation==='Low') return {icon:'⚡',title:'Give your brain something interesting.',reason:'Stimulation is low. Pick something active, hands-on or curious rather than default scrolling.',action:'Spend 30 minutes making, exploring or learning something'};
    if(r.stimulation==='High') return {icon:'◌',title:'Fewer inputs will probably feel better.',reason:'Stimulation is already high. The useful move is subtracting, not finding more motivation.',action:'Put your phone away and do one familiar low-input thing'};
    if(r.connection==='Low') return {icon:'♡',title:'Add a small bit of contact.',reason:'Connection feels low. A message, phone call or shared meal may be enough.',action:'Reach out to one person you actually want to hear from'};
    if(r.connection==='High') return {icon:'◌',title:'A little solitude might rebalance things.',reason:'Connection is high today. Space can be restorative even when nothing is wrong.',action:'Do one enjoyable thing by yourself'};
    if(r.novelty==='High') return {icon:'⌂',title:'Choose something familiar.',reason:'There has already been plenty of novelty. Familiar food, places and routines may feel better tonight.',action:'Make tonight deliberately simple and familiar'};
    if(patterns.lead && patterns.lead.signal==='novelty' && patterns.lead.state==='Low') return {icon:'✦',title:'Your recent pattern says: more novelty.',reason:patterns.lead.copy,action:randomAdventureAction()};
    if(patterns.lead && patterns.lead.signal==='recovery' && patterns.lead.state==='Low') return {icon:'🌿',title:'Your recent pattern says: protect recovery.',reason:patterns.lead.copy,action:'Block out one proper low-demand period today'};
    if(d.mood==='Good') return {icon:'↗',title:'You’re in a decent place — use it.',reason:'Nothing is obviously asking to be fixed. This is a good day to enjoy momentum instead of optimising it.',action:'Do one thing you have been looking forward to'};
    return {icon:'✦',title:'Start with one honest signal.',reason:'Pick how you feel or open the deeper check-in. Sweet Spot will turn it into one useful nudge.',action:'Choose one small thing that would make today feel better'};
  }

  function renderNudge(){
    const s=getSuggestion(); $('#nudgeIcon').textContent=s.icon;$('#nudgeTitle').textContent=s.title;$('#nudgeReason').textContent=s.reason;
    $('#homeHeadline').textContent=(state.draft.mood||Object.keys(state.draft.ratings).length)?s.title:'Tell Sweet Spot how you feel and it’ll give you one useful nudge.';
  }

  function giveIdea(){
    const idea=randomAdventureAction(); state.draft.oneThing=idea; $('#todayOneThing').value=idea;persist();renderSavedPill();toast('Idea added as your one thing');
  }

  function randomAdventureAction(){
    const upcoming=state.life.adventures.filter(a=>a.title && (!a.date || daysUntil(a.date)>=0));
    if(upcoming.length && Math.random()<0.45){ return upcoming[Math.floor(Math.random()*upcoming.length)].title; }
    return adventureIdeas[Math.floor(Math.random()*adventureIdeas.length)].title;
  }

  function saveToday(){
    state.draft.note=$('#dailyNote').value.trim();state.draft.oneThing=$('#todayOneThing').value.trim();
    if(!hasAnyCheckin(state.draft)){toast('Add at least one thing first');return;}
    const entry=structuredCloneSafe(state.draft);state.history=state.history.filter(e=>e.date!==entry.date);state.history.push(entry);state.history.sort((a,b)=>b.date.localeCompare(a.date));state.history=state.history.slice(0,365);persist();renderSavedPill();renderPatterns();toast('Today saved');
  }

  function syncIfSaved(){
    const idx=state.history.findIndex(e=>e.date===state.draft.date);if(idx<0)return;
    state.history[idx]=structuredCloneSafe(state.draft);persist();renderPatterns();
  }

  function todayMatchesSaved(){
    const e=state.history.find(x=>x.date===state.draft.date);if(!e)return false;
    const pick=x=>JSON.stringify({mood:x.mood||'',social:x.social||'',ratings:x.ratings||{},boosters:x.boosters||[],note:x.note||'',oneThing:x.oneThing||''});
    return pick(e)===pick(state.draft);
  }

  function renderSavedPill(){ $('#savedPill').classList.toggle('hidden',!todayMatchesSaved()); }

  function daysUntil(dateStr){
    const target=parseDateLocal(dateStr);if(!target)return null;const today=parseDateLocal(localDate());return Math.round((target-today)/86400000);
  }

  function futureAdventures(){
    return state.life.adventures.filter(a=>a.title && (!a.date || daysUntil(a.date)>=0)).sort((a,b)=>{
      if(a.date&&b.date)return a.date.localeCompare(b.date);if(a.date)return -1;if(b.date)return 1;return 0;
    });
  }

  function renderNextAdventure(){
    const wrap=$('#nextAdventure'), next=futureAdventures()[0];
    if(!next){wrap.innerHTML='<p class="muted-copy">Nothing here yet. Add a trip, dinner, fishing day, camp or anything else you’re genuinely looking forward to.</p>';return;}
    const n=next.date?daysUntil(next.date):null;let daysLabel='ANYTIME',unit='WHEN IT FITS';
    if(n===0){daysLabel='TODAY';unit='IS THE DAY';}else if(n===1){daysLabel='1';unit='DAY';}else if(n!==null){daysLabel=String(n);unit='DAYS';}
    wrap.innerHTML=`<div class="countdown"><div class="countdown-icon">${adventureIcon(next.type)}</div><div class="countdown-copy"><strong>${escapeHtml(next.title)}</strong><span>${next.date?formatLongDate(next.date):escapeHtml(next.type)}</span></div><div class="countdown-days">${daysLabel}<span>${unit}</span></div></div>`;
  }

  function adventureIcon(type){return ({Outdoors:'🌿',Trip:'✈︎',Social:'♡',Food:'🍜',Adventure:'⌁',Other:'✦'})[type]||'✦';}

  function qualityScore(e){
    const values=balanceDefs.map(d=>e.ratings?.[d.key]).filter(Boolean);let score=values.length?values.reduce((s,v)=>s+(v==='Right'?100:50),0)/values.length:60;
    if(e.mood==='Good')score+=10;if(e.mood==='Full')score-=10;if(e.mood==='Flat')score-=6;if(e.mood==='Restless')score-=4;return Math.max(0,Math.min(100,Math.round(score)));
  }

  function analyzePatterns(){
    const recent=recentHistory(14);const result={lead:null,help:null,weekday:null};
    if(recent.length>=3){
      const candidates=[];
      balanceDefs.forEach(def=>{
        const vals=recent.map(e=>e.ratings?.[def.key]).filter(Boolean);if(vals.length<2)return;
        ['Low','High'].forEach(st=>{const count=vals.filter(v=>v===st).length;if(count>=2)candidates.push({signal:def.key,title:def.title,state:st,count,total:vals.length,ratio:count/vals.length});});
      });
      const sorted=[...recent].sort((a,b)=>b.date.localeCompare(a.date));
      balanceDefs.forEach(def=>{
        if(sorted.length>=2){const a=sorted[0].ratings?.[def.key],b=sorted[1].ratings?.[def.key];if(a&&a===b&&a!=='Right')candidates.push({signal:def.key,title:def.title,state:a,count:2,total:2,ratio:1,consecutive:true});}
      });
      candidates.sort((a,b)=>(b.consecutive?1:0)-(a.consecutive?1:0)||b.ratio-a.ratio||b.count-a.count);
      if(candidates.length){const c=candidates[0];c.copy=patternCopy(c);result.lead=c;}
    }

    if(recent.length>=5){
      const best=[...recent].sort((a,b)=>qualityScore(b)-qualityScore(a)).slice(0,Math.max(3,Math.ceil(recent.length*.4)));
      const counts={};best.forEach(e=>(e.boosters||[]).forEach(b=>counts[b]=(counts[b]||0)+1));
      const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
      if(top && top[1]>=2) result.help={label:stripEmoji(top[0]),count:top[1],bestCount:best.length,copy:`${stripEmoji(top[0])} shows up on ${top[1]} of your ${best.length} better-balanced days.`};
    }

    if(state.history.length>=8){
      const groups={};state.history.forEach(e=>{const d=parseDateLocal(e.date);if(!d)return;const k=d.getDay();groups[k]=groups[k]||[];groups[k].push(qualityScore(e));});
      const avgs=Object.entries(groups).filter(([,arr])=>arr.length>=2).map(([day,arr])=>({day:+day,avg:Math.round(arr.reduce((a,b)=>a+b,0)/arr.length),n:arr.length})).sort((a,b)=>b.avg-a.avg);
      if(avgs.length>=2){const best=avgs[0],worst=avgs[avgs.length-1];result.weekday={best,worst,copy:`${weekdayName(best.day)} has been your easiest day lately; ${weekdayName(worst.day)} tends to run a little rougher.`};}
    }
    return result;
  }

  function patternCopy(c){
    const map={
      stimulation:{Low:'Stimulation has been low repeatedly. Your days may need more interest, movement or hands-on novelty.',High:'Stimulation has been high repeatedly. Fewer inputs and fewer simultaneous plans may help.'},
      recovery:{Low:'Recovery keeps coming up low. Protecting actual downtime matters more than squeezing in another thing.',High:'Recovery has been high several times. You may have room for a little more movement, purpose or novelty.'},
      connection:{Low:'Connection has been low more than once. Small contact may help without needing a big social plan.',High:'Connection has been high repeatedly. A bit more solo space may be useful.'},
      novelty:{Low:'Novelty keeps landing low. A change of scenery or small adventure may do more than adding another routine.',High:'Novelty has been high repeatedly. Familiar, easy choices may feel better for a while.'}
    };
    return map[c.signal]?.[c.state]||'A repeated pattern is starting to show up.';
  }

  function stripEmoji(s){return String(s).replace(/^[^A-Za-z0-9]+\s*/,'').trim();}
  function weekdayName(i){return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i];}

  function renderPatterns(){
    renderWeek();const p=analyzePatterns();
    if(p.lead){$('#leadPatternTitle').textContent=`${p.lead.title} has been ${p.lead.state.toLowerCase()} more than once.`;$('#leadPatternCopy').textContent=p.lead.copy;}
    else{$('#leadPatternTitle').textContent='No strong imbalance is repeating yet.';$('#leadPatternCopy').textContent=state.history.length<3?'Save at least 3 check-ins and Sweet Spot will start noticing repeated highs, lows and consecutive days.':'Your recent check-ins are fairly mixed — that is useful information too.';}
    if(p.help){$('#helpInsight').textContent=p.help.label;$('#helpInsightSub').textContent=p.help.copy;}else{$('#helpInsight').textContent='Still learning';$('#helpInsightSub').textContent='Choose “what helped” during check-ins and this will compare your better days.';}
    if(p.weekday){$('#weekdayInsight').textContent=p.weekday.best?weekdayName(p.weekday.best.day):'Still learning';$('#weekdayInsightSub').textContent=p.weekday.copy;}else{$('#weekdayInsight').textContent='Still learning';$('#weekdayInsightSub').textContent='A couple of weeks of check-ins will reveal whether certain days consistently feel easier.';}
    renderSignalRows();renderHistory();
  }

  function renderWeek(){
    const wrap=$('#weekStrip');wrap.innerHTML='';const today=parseDateLocal(localDate());
    for(let offset=6;offset>=0;offset--){
      const d=new Date(today);d.setDate(d.getDate()-offset);const key=localDate(d),e=state.history.find(x=>x.date===key),m=moodDef(e?.mood);
      const btn=document.createElement('button');btn.type='button';btn.className='day-orb'+(e?' has-data':'')+(e&&qualityScore(e)<55?' issue':'')+(key===localDate()?' today':'');
      btn.innerHTML=`<small>${d.toLocaleDateString(undefined,{weekday:'narrow'})}</small><span class="orb">${m?.icon||(e?'•':'')}</span><strong>${d.getDate()}</strong>`;
      if(e)btn.addEventListener('click',()=>openDay(key));wrap.appendChild(btn);
    }
  }

  function renderSignalRows(){
    const wrap=$('#signalRows');wrap.innerHTML='';const recent=recentHistory(14);
    balanceDefs.forEach(def=>{
      const vals=recent.map(e=>e.ratings?.[def.key]).filter(Boolean),right=vals.filter(v=>v==='Right').length,low=vals.filter(v=>v==='Low').length,high=vals.filter(v=>v==='High').length;
      const pct=vals.length?Math.round(right/vals.length*100):0;let label='No data';if(vals.length){label=right>=Math.max(low,high)?'Mostly right':low>high?'Leaning low':'Leaning high';}
      const row=document.createElement('div');row.className='signal-row';row.innerHTML=`<div class="signal-name">${def.icon} ${def.title}</div><div class="signal-track"><span style="width:${pct}%"></span></div><div class="signal-state">${label}</div>`;wrap.appendChild(row);
    });
  }

  function renderHistory(){
    const wrap=$('#historyList');wrap.innerHTML='';const items=recentHistory(historyDays);
    if(!items.length){wrap.innerHTML='<div class="muted-copy">No check-ins in this period yet.</div>';return;}
    items.forEach(e=>{const d=parseDateLocal(e.date),m=moodDef(e.mood),btn=document.createElement('button');btn.type='button';btn.className='history-row';btn.innerHTML=`<div class="history-day">${d.getDate()}<span>${d.toLocaleDateString(undefined,{month:'short'}).toUpperCase()}</span></div><div class="history-main"><strong>${escapeHtml(e.oneThing||'Daily check-in')}</strong><div>${escapeHtml(e.note||(e.boosters||[]).map(stripEmoji).join(' · ')||'No note')}</div></div><div class="history-mood">${m?.icon||'·'}</div>`;btn.addEventListener('click',()=>openDay(e.date));wrap.appendChild(btn);});
  }

  function openDay(date){
    const e=state.history.find(x=>x.date===date);if(!e)return;selectedHistoryDate=date;$('#dialogDate').textContent=formatLongDate(date);const wrap=$('#dialogSummary');wrap.innerHTML='';
    if(e.mood)addDialogLine(wrap,'How it felt',`${moodDef(e.mood)?.icon||''} ${e.mood}`);if(e.social)addDialogLine(wrap,'Social energy',e.social);
    balanceDefs.forEach(d=>{if(e.ratings?.[d.key])addDialogLine(wrap,`${d.icon} ${d.title}`,e.ratings[d.key]);});
    if(e.oneThing)addDialogLine(wrap,'One thing',e.oneThing);if(e.boosters?.length)addDialogLine(wrap,'What helped',e.boosters.map(stripEmoji).join(', '));if(e.note)addDialogLine(wrap,'Note',e.note);
    $('#dayDialog').showModal();
  }

  function addDialogLine(wrap,label,value){const line=document.createElement('div');line.className='dialog-line';line.innerHTML=`<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;wrap.appendChild(line);}

  function deleteSelectedDay(){
    if(!selectedHistoryDate)return;if(!confirm('Delete this check-in?'))return;state.history=state.history.filter(e=>e.date!==selectedHistoryDate);persist();$('#dayDialog').close();selectedHistoryDate=null;renderPatterns();renderSavedPill();toast('Check-in deleted');
  }

  function renderLife(){
    $('#lifeFocus').value=state.life.focus||'';renderAdventures();renderPillars();
  }

  function addAdventure(){
    const title=$('#adventureInput').value.trim(),date=$('#adventureDate').value,type=$('#adventureType').value;if(!title){toast('Add a name first');return;}
    state.life.adventures.push({id:`a-${Date.now()}`,title,date,type});$('#adventureInput').value='';$('#adventureDate').value='';persist();renderAdventures();renderNextAdventure();toast('Something to look forward to');
  }

  function suggestAdventure(){
    const idea=adventureIdeas[Math.floor(Math.random()*adventureIdeas.length)];$('#adventureInput').value=idea.title;$('#adventureType').value=idea.type;toast('Idea ready to add');
  }

  function renderAdventures(){
    const wrap=$('#adventureList');wrap.innerHTML='';const items=[...state.life.adventures].sort((a,b)=>{if(a.date&&b.date)return a.date.localeCompare(b.date);if(a.date)return -1;if(b.date)return 1;return 0;});
    if(!items.length){wrap.innerHTML='<div class="muted-copy">Add small things as well as big ones. Anticipation works better when there is usually something on the horizon.</div>';return;}
    items.forEach(a=>{
      const d=a.date?parseDateLocal(a.date):null,n=a.date?daysUntil(a.date):null,div=document.createElement('div');div.className='adventure-item';
      const dateBox=d?`${d.getDate()}<span>${d.toLocaleDateString(undefined,{month:'short'}).toUpperCase()}</span>`:`${adventureIcon(a.type)}<span>ANYTIME</span>`;
      let meta=a.type;if(n!==null)meta=n<0?`${Math.abs(n)} days ago`:n===0?'Today':n===1?'Tomorrow':`${n} days away`;
      div.innerHTML=`<div class="adventure-date">${dateBox}</div><div class="adventure-copy"><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(meta)}</span></div><button class="delete-mini" type="button" aria-label="Delete">×</button>`;
      div.querySelector('button').addEventListener('click',()=>{state.life.adventures=state.life.adventures.filter(x=>x.id!==a.id);persist();renderAdventures();renderNextAdventure();});wrap.appendChild(div);
    });
  }

  function renderPillars(){
    const wrap=$('#pillarList');wrap.innerHTML='';state.life.pillars.forEach((p,i)=>{const row=document.createElement('div');row.className='pillar-row';row.innerHTML=`<div class="pillar-icon">${p.icon}</div><div class="pillar-copy"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.sub)}</span></div><button type="button" class="pillar-state" data-state="${p.state}">${p.state}</button>`;row.querySelector('button').addEventListener('click',()=>{const next=(PILLAR_STATES.indexOf(p.state)+1)%PILLAR_STATES.length;state.life.pillars[i].state=PILLAR_STATES[next];persist();renderPillars();});wrap.appendChild(row);});
  }

  function renderMore(){
    renderMealTool();renderTheme();
  }

  function renderMealTool(){
    $('#mealCount').textContent=`${state.food.meals.length} meals`;
    const energy=$('#energyControl');energy.innerHTML='';['Low','Normal','Keen'].forEach(x=>{const b=document.createElement('button');b.type='button';b.textContent=x==='Low'?'Low energy':x==='Normal'?'Normal':'Keen to cook';b.classList.toggle('selected',state.food.energy===x);b.addEventListener('click',()=>{state.food.energy=x;persist();renderMealTool();});energy.appendChild(b);});
    renderMealResult();renderMealList();renderMealTagPicker();
  }

  function eligibleMeals(){
    const meals=state.food.meals;
    if(state.food.energy==='Low'){
      const f=meals.filter(m=>m.tags.includes('Low effort')||m.tags.includes('15 min')||m.tags.includes('Cold'));return f.length?f:meals;
    }
    if(state.food.energy==='Keen'){
      const f=meals.filter(m=>m.tags.includes('BBQ')||m.tags.includes('Fresh')||m.tags.includes('Comfort'));return f.length?f:meals;
    }
    return meals;
  }

  function pickMeal(){
    let choices=eligibleMeals().filter(m=>m.id!==state.food.lastPickId);if(!choices.length)choices=eligibleMeals();if(!choices.length)return;const pick=choices[Math.floor(Math.random()*choices.length)];state.food.lastPickId=pick.id;persist();renderMealResult();
  }

  function renderMealResult(){
    const m=state.food.meals.find(x=>x.id===state.food.lastPickId);const wrap=$('#mealResult');if(!m){wrap.innerHTML='<span>Choose your energy, then let Sweet Spot decide.</span>';return;}wrap.innerHTML=`<div><strong>${escapeHtml(m.name)}</strong><small>${escapeHtml(m.tags.join(' · ')||'No tags')}</small></div>`;
  }

  function renderMealList(){
    const wrap=$('#mealList');wrap.innerHTML='';state.food.meals.forEach(m=>{const row=document.createElement('div');row.className='meal-row';row.innerHTML=`<div><strong>${escapeHtml(m.name)}</strong><span>${escapeHtml(m.tags.join(' · ')||'No tags')}</span></div><button type="button" class="delete-mini" aria-label="Remove">×</button>`;row.querySelector('button').addEventListener('click',()=>{if(state.food.meals.length<=1){toast('Keep at least one meal');return;}state.food.meals=state.food.meals.filter(x=>x.id!==m.id);if(state.food.lastPickId===m.id)state.food.lastPickId='';persist();renderMealTool();});wrap.appendChild(row);});
  }

  function renderMealTagPicker(){
    const wrap=$('#mealTagPicker');wrap.innerHTML='';MEAL_TAGS.forEach(tag=>{const b=document.createElement('button');b.type='button';b.className='tag-toggle'+(selectedMealTags.has(tag)?' selected':'');b.textContent=tag;b.addEventListener('click',()=>{selectedMealTags.has(tag)?selectedMealTags.delete(tag):selectedMealTags.add(tag);renderMealTagPicker();});wrap.appendChild(b);});
  }

  function addMeal(){
    const name=$('#mealInput').value.trim();if(!name)return;if(state.food.meals.some(m=>m.name.toLowerCase()===name.toLowerCase())){toast('That meal is already there');return;}state.food.meals.push({id:`meal-${Date.now()}`,name,tags:[...selectedMealTags]});$('#mealInput').value='';persist();renderMealTool();toast('Meal added');
  }

  function applyTheme(){
    const t=state?.settings?.theme||'system';if(t==='system')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',t);renderTheme();
  }

  function renderTheme(){
    if(!state)return;const t=state.settings.theme||'system';$$('#themeControl button').forEach(b=>b.classList.toggle('selected',b.dataset.theme===t));
  }

  function showView(name,pushHash=false){
    if(!['today','patterns','life','more'].includes(name))name='today';$$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===name));$$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.target===name));
    if(name==='today')renderToday();if(name==='patterns')renderPatterns();if(name==='life')renderLife();if(name==='more')renderMore();if(pushHash&&location.hash!==`#${name}`)history.replaceState(null,'',`#${name}`);window.scrollTo({top:0,behavior:'auto'});
  }

  function routeFromHash(){showView((location.hash||'#today').slice(1),false);}

  function renderInstallCard(){
    const ios=/iphone|ipad|ipod/i.test(navigator.userAgent),standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;$('#installCard').classList.toggle('hidden',!(ios&&!standalone));
  }

  function exportBackup(){
    const payload={app:'Sweet Spot',version:VERSION,exportedAt:new Date().toISOString(),data:state};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`sweet-spot-backup-${localDate()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup exported');
  }

  async function importBackup(ev){
    const file=ev.target.files?.[0];if(!file)return;try{const parsed=JSON.parse(await file.text()),incoming=parsed.data||parsed;if(!incoming.history||!incoming.life||!incoming.food)throw new Error('Not a Sweet Spot backup');if(!confirm('Replace the Sweet Spot data on this device with this backup?')){ev.target.value='';return;}state=normalizeState(incoming);await storage.save(state);applyTheme();renderAll();toast('Backup imported');}catch(e){alert('That file could not be imported as a Sweet Spot backup.');}ev.target.value='';
  }

  async function resetData(){
    if(!confirm('Erase all Sweet Spot data from this device? This cannot be undone unless you exported a backup.'))return;await storage.clear();state=emptyState();await storage.save(state);applyTheme();renderAll();showView('today',true);toast('Sweet Spot reset');
  }

  function refreshDayIfNeeded(){
    if(state.draft.date===localDate())return;state.draft={...emptyState().draft,date:localDate()};persist();$('#todayLabel').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
  }

  function registerSW(){
    if(!('serviceWorker' in navigator))return;
    navigator.serviceWorker.register('./sw.js').then(reg=>{
      if(reg.waiting)showUpdate(reg.waiting);
      reg.addEventListener('updatefound',()=>{const worker=reg.installing;if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate(worker);});});
      setTimeout(()=>reg.update().catch(()=>{}),1200);
    }).catch(e=>console.warn('Service worker registration failed',e));
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshingForUpdate)location.reload();});
  }

  function showUpdate(worker){pendingWorker=worker;$('#updateBanner').classList.remove('hidden');}
  function activateUpdate(){if(!pendingWorker){location.reload();return;}refreshingForUpdate=true;pendingWorker.postMessage({type:'SKIP_WAITING'});}

  init();
})();
