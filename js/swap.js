// ════════════════════════════════════════════════════════════
// js/swap.js — SISTEMA POKESWAP
// Cargado ANTES del script principal
// Depende de: sb, slots, pokemon, user, toast, SFX, profile
// ════════════════════════════════════════════════════════════

// ============================================================
// ===== SISTEMA POKESWAP =====
// ============================================================

const SWAP_COOLDOWN_MS = 8 * 60 * 60 * 1000; // 8 horas
const SWAP_COOLDOWN_KEY = 'pxswap_cd'; // localStorage key
const SWAP_SKIP_TOKENS = 1000;

// Movimientos especiales exclusivos del swap (egg moves / TMs raros)
const SWAP_SPECIAL_MOVES = {
  fire:    [['Envite Ígneo','Flare Blitz','fire',120],['Rueda Fuego','Flame Wheel','fire',60]],
  water:   [['Acua Jet','Aqua Jet','water',40],['Hidrobomba','Hydro Pump','water',110]],
  grass:   [['Bomba Germen','Seed Bomb','grass',80],['Rayo Solar','Solar Beam','grass',120]],
  electric:[['Trueno','Thunder','electric',110],['Chispazo','Discharge','electric',80]],
  psychic: [['Psíquico','Psychic','psychic',90],['Premonición','Future Sight','psychic',120]],
  dragon:  [['Enfado','Outrage','dragon',120],['Pulso Dragón','Dragon Pulse','dragon',85]],
  dark:    [['Tajo Umbrío','Night Slash','dark',70],['Pulso Umbrío','Dark Pulse','dark',80]],
  ghost:   [['Bola Sombra','Shadow Ball','ghost',80],['Puño Sombra','Shadow Punch','ghost',60]],
  ice:     [['Ventisca','Blizzard','ice',110],['Rayo Hielo','Ice Beam','ice',90]],
  fighting:[['A Bocajarro','Close Combat','fighting',120],['Tajo Cruzado','Cross Chop','fighting',100]],
  rock:    [['Roca Afilada','Stone Edge','rock',100],['Pedrada','Rock Blast','rock',25]],
  ground:  [['Terremoto','Earthquake','ground',100],['Tierra Viva','Earth Power','ground',90]],
  normal:  [['Velocidad Extrema','Extreme Speed','normal',80],['Doble Filo','Double-Edge','normal',120]],
  steel:   [['Giro Bola','Gyro Ball','steel',null],['Cabeza de Hierro','Iron Head','steel',80]],
  poison:  [['Lanzamugre','Gunk Shot','poison',120],['Bomba Lodo','Sludge Bomb','poison',90]],
  bug:     [['Zumbido','Bug Buzz','bug',90],['Tijera X','X-Scissor','bug',80]],
  flying:  [['Tajo Aéreo','Air Slash','flying',75],['Pico Taladro','Drill Peck','flying',80]],
};

// Tablas de rareza
const SWAP_RARITY = [
  { id:'common',    label:'Común',      chance:0.55, color:'#aaa',    bg:'sw-rarity-common' },
  { id:'uncommon',  label:'Poco común', chance:0.25, color:'#80e080', bg:'sw-rarity-uncommon' },
  { id:'rare',      label:'Raro',       chance:0.13, color:'#80a0f0', bg:'sw-rarity-rare' },
  { id:'epic',      label:'Épico',      chance:0.06, color:'#c080f0', bg:'sw-rarity-epic' },
  { id:'legendary', label:'¡Legendario!',chance:0.01,color:'#f0c840', bg:'sw-rarity-legendary' },
];
const SWAP_SHINY_CHANCE = 1 / 128;

// Legendarios (ids)
const LEGENDARY_IDS = new Set([144,145,146,150,151]);

// Candidatos raros/épicos (ids) — starters finales, pseudolegendarios
const EPIC_IDS = new Set([3,6,9,130,131,142,143,149]);
const RARE_IDS = new Set([36,40,65,68,76,89,97,103,112,127,128]);

let swapSelectedId = null; // pokemon_id elegido en paso 1
let swapResult = null;     // objeto resultado generado
let swapCdInterval = null; // timer del cooldown

// --- Helpers de cooldown (localStorage) ---
function swapGetCooldownUntil() {
  // Supabase es la fuente de verdad — fallback a localStorage
  if (profile?.swap_cooldown_until) {
    return new Date(profile.swap_cooldown_until).getTime();
  }
  const v = localStorage.getItem(SWAP_COOLDOWN_KEY);
  return v ? parseInt(v) : 0;
}
function swapSetCooldownNow() {
  // Solo como caché local; el servidor ya actualizó Supabase
  localStorage.setItem(SWAP_COOLDOWN_KEY, Date.now() + SWAP_COOLDOWN_MS);
}
function swapIsReady() {
  return Date.now() >= swapGetCooldownUntil();
}
function swapMsLeft() {
  return Math.max(0, swapGetCooldownUntil() - Date.now());
}
function swapFmtTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
}

// --- Actualizar badge del botón nav ---
function swapUpdateNavBadge() {
  const btn = document.getElementById('swap-nav-btn');
  const badge = document.getElementById('swap-cd-badge');
  if (!user || !btn) return;
  btn.style.display = '';
  if (swapIsReady()) {
    badge.innerHTML = '<span class="swap-cd-badge-pill ready">¡LISTO!</span>';
  } else {
    const ms = swapMsLeft();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    badge.innerHTML = `<span class="swap-cd-badge-pill">${h}h${String(m).padStart(2,'0')}m</span>`;
  }
}

// --- Abrir modal ---
function openSwapModal() {
  if (!user) {
    if (TESTER) {
      // En modo tester: inyectar usuario fake para poder probar
      user = { id: 'tester-uid', email: 'tester@pokeswap.lol', user_metadata: { full_name: 'Tester' } };
      if (!profile) profile = { tokens: 9999, username: 'Tester', free_claims_remaining: 5 };
      updateAuthUI();
    } else {
      toast('Iniciá sesión para usar el PokeSwap', 1); return;
    }
  }
  document.getElementById('swap-modal').classList.add('open');
  swapSelectedId = null;
  swapResult = null;
  SFX.unlock();
  SFX.musicSwap();
  swapShowCorrectStep();
}
function closeSwapModal() {
  document.getElementById('swap-modal').classList.remove('open');
  if (swapCdInterval) { clearInterval(swapCdInterval); swapCdInterval = null; }
  SFX.stopMusic();setTimeout(()=>SFX.musicMap(),500);
  mobileNavResetToMap();
}

function swapShowStep(id) {
  ['sw-step-cd','sw-step-pick','sw-step-reveal'].forEach(s => {
    document.getElementById(s).classList.toggle('active', s === id);
  });
}

function swapShowCorrectStep() {
  if (!swapIsReady()) {
    swapShowStep('sw-step-cd');
    swapStartCdTimer();
  } else {
    swapShowStep('sw-step-pick');
    swapBuildPickGrid();
  }
}

// --- Timer del cooldown ---
function swapStartCdTimer() {
  const update = () => {
    const ms = swapMsLeft();
    const total = SWAP_COOLDOWN_MS;
    const pct = Math.max(0, Math.min(100, ((total - ms) / total) * 100));
    document.getElementById('sw-cd-bar').style.width = pct + '%';
    document.getElementById('sw-cd-time').textContent = swapFmtTime(ms);
    document.getElementById('sw-cd-label').textContent = 'Tiempo restante';
    swapUpdateNavBadge();
    if (ms <= 0) {
      clearInterval(swapCdInterval); swapCdInterval = null;
      swapShowStep('sw-step-pick');
      swapBuildPickGrid();
    }
  };
  update();
  swapCdInterval = setInterval(update, 1000);
}

// --- Paso 1: grilla de selección ---
function swapBuildPickGrid() {
  const grid = document.getElementById('sw-pick-grid');
  // Pokémon que son míos
  let mine = pokemon.filter(p => {
    const s = slots[p.id];
    return s && s.owner_id === user.id;
  });
  // En modo tester: si no hay ninguno, usar los primeros 6 del pool
  if (mine.length === 0 && TESTER) {
    mine = pokemon.slice(0, 6);
  }
  if (mine.length === 0) {
    grid.innerHTML = '<div style="font-size:5px;color:var(--text-dim);grid-column:1/-1;text-align:center;padding:20px">No tenés Pokémon adoptados aún</div>';
    return;
  }
  grid.innerHTML = '';
  mine.forEach(p => {
    const lv = swapGetLevel(p.id);
    const div = document.createElement('div');
    div.className = 'sw-card';
    div.dataset.id = p.id;
    div.innerHTML = `<img src="${fbUrl(p.id)}" alt="${p['name_'+lang]||p.name_en}">
      <div class="sw-card-name">${p['name_'+lang]||p.name_en}</div>
      <div class="sw-card-lv">Nv.${lv}</div>`;
    div.onclick = () => swapSelectCard(p.id, div);
    grid.appendChild(div);
  });
}

function swapGetLevel(id) {
  try { const d = JSON.parse(localStorage.getItem('pxp_'+id)||'{}'); return d.level||1; } catch(e){return 1;}
}

function swapSelectCard(id, el) {
  document.querySelectorAll('.sw-card').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  swapSelectedId = id;
  const btn = document.getElementById('sw-confirm-btn');
  if (swapIsReady()) {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.textContent = '🎲 ¡Hacer el Swap!';
  } else {
    btn.disabled = true;
    btn.style.opacity = '0.6';
    // Actualizar el botón con countdown en tiempo real
    if (window._swapBtnTimer) clearInterval(window._swapBtnTimer);
    const updateBtn = () => {
      const ms = swapMsLeft();
      if (ms <= 0) {
        clearInterval(window._swapBtnTimer);
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.textContent = '🎲 ¡Hacer el Swap!';
      } else {
        btn.textContent = `⏳ Disponible en ${swapFmtTime(ms)}`;
      }
    };
    updateBtn();
    window._swapBtnTimer = setInterval(updateBtn, 1000);
  }
  SFX.play('swapSelect');
}

// --- Sorteo del resultado ---
function swapRollResult() {
  // Pool: 50% salvajes, 50% con historial (todos con dueño != null o prev owner)
  const hasOwner = pokemon.filter(p => slots[p.id]?.owner_id);
  const wilds = pokemon.filter(p => !slots[p.id]?.owner_id);
  
  // Excluir el propio pokémon puesto en juego del pool
  const poolOwned = hasOwner.filter(p => p.id !== swapSelectedId);
  const poolWild = wilds.filter(p => p.id !== swapSelectedId);
  
  let pool;
  const useWild = Math.random() < 0.5 || poolOwned.length === 0;
  if (useWild && poolWild.length > 0) {
    pool = poolWild;
  } else if (poolOwned.length > 0) {
    pool = poolOwned;
  } else {
    pool = pokemon.filter(p => p.id !== swapSelectedId);
  }

  // Rareza ponderada según el Pokémon sorteado
  const roll = Math.random();
  let cum = 0; let rarity = SWAP_RARITY[0];
  for (const r of SWAP_RARITY) { cum += r.chance; if (roll < cum) { rarity = r; break; } }
  
  // Filtrar pool por rareza
  let filteredPool;
  if (rarity.id === 'legendary') {
    filteredPool = pool.filter(p => LEGENDARY_IDS.has(p.id));
    if (filteredPool.length === 0) filteredPool = pool; // fallback
  } else if (rarity.id === 'epic') {
    filteredPool = pool.filter(p => EPIC_IDS.has(p.id) && !LEGENDARY_IDS.has(p.id));
    if (filteredPool.length === 0) filteredPool = pool;
  } else if (rarity.id === 'rare') {
    filteredPool = pool.filter(p => RARE_IDS.has(p.id) && !EPIC_IDS.has(p.id) && !LEGENDARY_IDS.has(p.id));
    if (filteredPool.length === 0) filteredPool = pool;
  } else {
    filteredPool = pool.filter(p => !LEGENDARY_IDS.has(p.id) && !EPIC_IDS.has(p.id));
    if (filteredPool.length === 0) filteredPool = pool;
  }

  const picked = filteredPool[Math.floor(Math.random() * filteredPool.length)];
  const isShiny = Math.random() < SWAP_SHINY_CHANCE;
  
  // Movimiento especial según rareza
  let specialMove = null;
  if (rarity.id !== 'common' && picked) {
    const type1 = picked.type1;
    const movList = SWAP_SPECIAL_MOVES[type1] || SWAP_SPECIAL_MOVES['normal'];
    if (movList && movList.length > 0) {
      specialMove = movList[Math.floor(Math.random() * movList.length)];
    }
  }

  // Historial de dueños (simulado por ahora — slot actual y "anterior")
  const prevOwners = [];
  const slotData = picked ? slots[picked.id] : null;
  if (slotData?.owner_id && slotData?.prev_owner_name) prevOwners.push(slotData.prev_owner_name);
  if (slotData?.owner_id && slotData?.owner_name) prevOwners.push(slotData.owner_name);

  return { pokemon: picked, rarity, isShiny, specialMove, prevOwners, fromWild: useWild };
}

// ── SWAP ANIMATIONS ENGINE ──
function swapDelay(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Partículas canvas
function swapFireParticles(color='#c080f0', count=18, spread=80){
  const cv=document.getElementById('sw-particles');
  if(!cv)return;
  const ctx=cv.getContext('2d');
  const W=cv.width,H=cv.height;
  const cx=W/2,cy=H/2;
  const particles=Array.from({length:count},()=>({
    x:cx,y:cy,
    vx:(Math.random()-0.5)*spread*(0.5+Math.random()),
    vy:(Math.random()-0.5)*spread*(0.5+Math.random()),
    r:2+Math.random()*4,
    life:1,
    decay:0.02+Math.random()*0.03,
    color:color,
    shape:Math.random()<0.3?'star':'circle',
  }));
  let raf;
  const tick=()=>{
    ctx.clearRect(0,0,W,H);
    let alive=false;
    for(const p of particles){
      p.x+=p.vx; p.y+=p.vy;
      p.vx*=0.94; p.vy*=0.94;
      p.vy+=0.4; // gravity
      p.life-=p.decay;
      if(p.life<=0)continue;
      alive=true;
      ctx.save();
      ctx.globalAlpha=p.life;
      ctx.fillStyle=p.color;
      if(p.shape==='star'){
        ctx.font=`${p.r*3}px serif`;
        ctx.fillText('★',p.x-p.r,p.y+p.r);
      }else{
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }
    if(alive)raf=requestAnimationFrame(tick);
    else ctx.clearRect(0,0,W,H);
  };
  tick();
}

// Flash de pantalla
function swapFlash(color='white'){
  const el=document.getElementById('sw-flash');
  if(!el)return;
  el.style.background=color;
  el.classList.remove('fire');
  void el.offsetWidth; // reflow
  el.classList.add('fire');
}

// Temblor de la bola
function swapBallShake(){
  const b=document.getElementById('sw-ball');
  if(!b)return;
  b.classList.remove('shaking');
  void b.offsetWidth;
  b.classList.add('shaking');
}

// Colores de rareza para partículas
const RARITY_PARTICLE_COLORS={
  common:   ['#aaaaaa','#cccccc','#888888'],
  uncommon: ['#60d060','#40b840','#80ff80'],
  rare:     ['#4080f0','#6090ff','#80a0ff'],
  epic:     ['#c080f0','#a040d0','#e0b0ff'],
  legendary:['#f0c840','#ff8020','#ff40a0','#40c0ff'],
};

// --- Confirmar swap (versión animada) ---
async function swapConfirm() {
  if (!swapSelectedId) return;
  if (!swapIsReady()) { toast('El cooldown todavía está activo', 1); return; }
  if (!user) { openAuth(); return; }

  swapShowStep('sw-step-reveal');
  const tradedPoke = pokemon.find(p => p.id === swapSelectedId);
  document.getElementById('sw-traded-away').textContent =
    `Pusiste en juego: ${tradedPoke?.['name_'+lang] || tradedPoke?.name_en || '???'}`;

  // Reset estado visual
  const ballEl = document.getElementById('sw-ball');
  const ballWrap = document.getElementById('sw-ball-wrap');
  const revealBox = document.getElementById('sw-reveal-box');
  const label = document.getElementById('sw-ball-label');
  ballEl.className = 'sw-ball';
  ballWrap.style.display = '';
  revealBox.classList.remove('show');
  revealBox.style.display = 'none';
  const cv = document.getElementById('sw-particles');
  if(cv) cv.getContext('2d').clearRect(0,0,cv.width,cv.height);

  // ── Llamar al server PRIMERO — la bola gira mientras esperamos ──
  const { data: { session } } = await sb.auth.getSession();

  // Iniciar animación de espera y request en paralelo
  ballEl.classList.add('spinning');
  label.textContent = 'Sorteando...';
  const _spinTick = setInterval(()=>SFX.play('swapSpin'), 350);

  const serverPromise = fetch(`${SB_URL}/functions/v1/pokeswap-swap`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pokemon_given_id: swapSelectedId })
  }).then(r => r.json()).catch(e => ({ error: e.message }));

  // Animar mínimo 900ms para que la bola gire un poco
  const [serverResult] = await Promise.all([serverPromise, swapDelay(900)]);
  clearInterval(_spinTick);

  // Error del server: abortar antes del reveal
  if (serverResult?.error) {
    ballEl.className = 'sw-ball';
    ballWrap.style.display = 'none';
    swapShowStep('sw-step-pick');
    toast('Error en el intercambio: ' + serverResult.error, 1);
    return;
  }

  // Construir result desde la respuesta real del servidor
  const realReceivedId = serverResult?.received?.pokemon_id;
  const realGivenId = serverResult?.given?.pokemon_id;
  const realPoke = realReceivedId ? pokemon.find(p => p.id === realReceivedId) : null;

  // Calcular rareza basada en el Pokémon real
  let rarity = SWAP_RARITY[0];
  if (realPoke) {
    if (LEGENDARY_IDS.has(realPoke.id)) rarity = SWAP_RARITY.find(r=>r.id==='legendary') || rarity;
    else if (EPIC_IDS.has(realPoke.id))  rarity = SWAP_RARITY.find(r=>r.id==='epic')      || rarity;
    else if (RARE_IDS.has(realPoke.id))  rarity = SWAP_RARITY.find(r=>r.id==='rare')       || rarity;
    else rarity = SWAP_RARITY.find(r=>r.id==='uncommon') || rarity;
  }
  const isShiny = Math.random() < SWAP_SHINY_CHANCE;
  const result = { pokemon: realPoke, rarity, isShiny, specialMove: null, prevOwners: [], fromWild: false };
  swapResult = result;

  swapSetCooldownNow();
  if (serverResult?.cooldown_until) localStorage.setItem(SWAP_COOLDOWN_KEY, serverResult.cooldown_until);
  swapUpdateNavBadge();

  // ── FASE 2: Temblor — algo se mueve adentro (0.5s × 3) ──
  label.textContent = '¡Algo se mueve!';
  for(let i=0;i<3;i++){
    swapBallShake();
    SFX.play('swapShake');
    await swapDelay(480);
  }

  // ── FASE 3: Spin rápido antes de abrir ──
  label.textContent = '¡¡¡';
  ballEl.classList.remove('spinning','shaking');
  ballEl.classList.add('spinning-fast');
  const _fastTick = setInterval(()=>SFX.play('swapSpin'), 80);
  await swapDelay(400);
  clearInterval(_fastTick);

  // ── FASE 4: Apertura con split ──
  ballEl.classList.remove('spinning-fast');
  ballEl.classList.add('open-anim');

  // Parar música de espera
  SFX.stopMusic();

  // Reveal sound según rareza
  const revealSounds = {
    common:'revealCommon', uncommon:'revealUncommon',
    rare:'revealRare', epic:'revealEpic', legendary:'revealLegendary'
  };
  SFX.play(revealSounds[result.rarity.id]||'revealCommon');

  // Flash acorde a rareza
  const flashColors = {common:'rgba(200,200,200,.6)',uncommon:'rgba(60,200,60,.5)',
    rare:'rgba(60,120,255,.5)',epic:'rgba(180,60,255,.5)',legendary:'rgba(255,220,0,.7)'};
  swapFlash(flashColors[result.rarity.id]||'white');

  // Partículas explotan
  const pcols = RARITY_PARTICLE_COLORS[result.rarity.id]||['#fff'];
  const pcount = {common:10,uncommon:16,rare:22,epic:28,legendary:40}[result.rarity.id]||12;
  for(let i=0;i<3;i++){
    setTimeout(()=>swapFireParticles(pcols[i%pcols.length], Math.floor(pcount/2), 70+i*20), i*80);
  }
  await swapDelay(600);

  // Ocultar bola
  ballWrap.style.display = 'none';

  // ── FASE 5: Reveal con datos reales ──
  swapBuildReveal(result);
  revealBox.style.display = 'flex';
  await swapDelay(20);
  revealBox.classList.add('show');

  // Efectos extra según rareza
  if(result.rarity.id === 'legendary'){
    document.getElementById('sw-legendary-stars').classList.add('show');
    await swapDelay(200);
    swapFlash('rgba(240,200,0,.4)');
    swapFireParticles('#f0c840', 20, 90);
  }
  if(['epic','legendary'].includes(result.rarity.id)){
    const sweep = document.getElementById('sw-sweep-glow');
    const sweepColor = result.rarity.id==='legendary'?'#f0c840':'#c080f0';
    sweep.style.color = sweepColor;
    sweep.classList.add('show');
  }
  if(result.isShiny){
    await swapDelay(300);
    SFX.play('revealShiny');
    swapFlash('rgba(255,240,80,.5)');
    swapFireParticles('#ffe060', 16, 60);
    swapFireParticles('#ffffff', 10, 40);
  }

  // Anillos de pulso según rareza
  const ringColors={common:'transparent',uncommon:'#60d060',rare:'#4080f0',epic:'#c080f0',legendary:'#f0c840'};
  const ringColor = ringColors[result.rarity.id]||'transparent';
  ['sw-ring-1','sw-ring-2'].forEach(id=>{
    const r=document.getElementById(id);
    if(r){r.style.color=ringColor;r.style.display=ringColor==='transparent'?'none':'block';}
  });

  // Sprite floating solo para rare+
  if(['rare','epic','legendary'].includes(result.rarity.id)){
    await swapDelay(600);
    document.getElementById('sw-reveal-sprite')?.classList.add('floating');
  }

  if (result.pokemon) dexMarkSeen(result.pokemon.id);

  // Aplicar estado y refrescar
 
  if (serverResult?.success) {
    swapApplyLocalState(realGivenId || swapSelectedId, realReceivedId || result.pokemon?.id);
    await loadProfile();
    await loadSlots();
  } else {
    // Fallback local si no hay sesión real (modo tester)
    swapApplyLocalState(swapSelectedId, result.pokemon?.id);
  }
}

function swapBuildReveal(result) {
  const p = result.pokemon;
  if (!p) {
    document.getElementById('sw-reveal-name').textContent = '???';
    return;
  }

  // Reset estrellas y sweep
  document.getElementById('sw-legendary-stars').classList.remove('show');
  document.getElementById('sw-sweep-glow').classList.remove('show');

  // Sprite con clase de animación según rareza
  const spr = document.getElementById('sw-reveal-sprite');
  spr.src = fbUrl(p.id);
  spr.className = 'sw-reveal-sprite anim-' + result.rarity.id;
  spr.style.filter = result.isShiny
    ? 'hue-rotate(180deg) saturate(2.5) brightness(1.3) drop-shadow(0 0 8px #ffe060)'
    : result.rarity.id==='legendary' ? 'drop-shadow(0 0 12px #f0c840) brightness(1.1)'
    : result.rarity.id==='epic' ? 'drop-shadow(0 0 8px #c080f0)'
    : '';

  document.getElementById('sw-reveal-name').textContent = p['name_'+lang]||p.name_en;
  document.getElementById('sw-reveal-num').textContent = `#${String(p.id).padStart(3,'0')}${result.fromWild?' · Salvaje':' · Con historial'}`;

  // Rareza
  const rb = document.getElementById('sw-rarity-banner');
  rb.textContent = result.rarity.label;
  rb.className = 'sw-rarity-banner ' + result.rarity.bg;

  // Shiny
  const sr = document.getElementById('sw-shiny-row');
  sr.innerHTML = result.isShiny ? '<div class="sw-shiny-badge">✨ ¡SHINY!</div>' : '';

  // Tipos
  const tt = document.getElementById('sw-reveal-types');
  const types = [p.type1, p.type2].filter(Boolean);
  tt.innerHTML = types.map(t => `<span class="tbadge" style="background:${TC[(t||'').toLowerCase()]||'#888'}">${TN[lang]?.[t]||t}</span>`).join('');

  // Movimientos base + especial
  const mv = document.getElementById('sw-reveal-moves');
  const levelMoves = LEVEL_MOVES[p.id]||[];
  const lv = swapGetLevel(p.id);
  const learned = levelMoves.filter(m => m[0]<=lv).slice(-2);
  let movHTML = learned.map(m => `<div class="sw-reveal-move" style="background:${TC[m[3]]||'#555'}">${m[1]} (${m[4]} pwr)</div>`).join('');
  if (result.specialMove) {
    const sm = result.specialMove;
    movHTML += `<div class="sw-reveal-move" style="background:${TC[sm[2]]||'#555'};border:1px solid gold">⭐ ${sm[1]} (${sm[3]||'—'} pwr)</div>`;
  }
  mv.innerHTML = movHTML || '<div style="font-size:4px;color:var(--text-dim)">Sin movimientos</div>';

  // Historial de dueños
  const os = document.getElementById('sw-owners-section');
  if (result.prevOwners && result.prevOwners.length > 0) {
    os.innerHTML = `<div style="font-size:4px;color:var(--text-dim);margin-top:6px;text-align:center">Dueños anteriores:</div>
      <div class="sw-owners-list">${result.prevOwners.map(o=>`<div class="sw-owner-chip">👤 ${o}</div>`).join('')}</div>`;
  } else {
    os.innerHTML = '';
  }
}

// Wrapper animado del confirm
function swapConfirmAnim(){
  const btn = document.getElementById('sw-confirm-btn');
  if(!btn||btn.disabled)return;
  btn.style.animation = 'sw-confirm-press .15s ease-in-out';
  btn.style.transform = 'scale(.95)';
  SFX.play('swapConfirm');
  setTimeout(()=>{btn.style.transform='';btn.style.animation='';},150);
  setTimeout(()=>swapConfirm(),120);
}

// --- Aplicar estado local (sin backend por ahora) ---
function swapApplyLocalState(outId, inId) {
  // Quitar slot del pokémon saliente
  if (slots[outId]) {
    const s = {...slots[outId]};
    s.owner_id = null; s.owner_name = null;
    slots[outId] = s;
  }
  // Dar slot del pokémon entrante (crear slot si no existe aún en cache local)
  if (inId && user) {
    const existing = slots[inId] || {};
    const s = {...existing};
    s.prev_owner_name = s.owner_name || null;
    s.owner_id = user.id;
    s.owner_name = profile?.username || user.user_metadata?.full_name || user.email?.split('@')[0];
    slots[inId] = s;
  }
  // Refrescar UI
  refreshEnts();
  buildRankPanel();
  renderBoxGrid && renderBoxGrid();
  setTimeout(() => drawMM && drawMM(), 1000);
  // Agregar al activity log
  if (inId) {
    const pOut = pokemon.find(p=>p.id===outId);
    const pIn = pokemon.find(p=>p.id===inId);
    activityLog.unshift({
      type:'swap', time:Date.now(),
      nameOut: pOut?.['name_'+lang]||pOut?.name_en||'?',
      nameIn: pIn?.['name_'+lang]||pIn?.name_en||'?',
      user: profile?.username||'vos'
    });
    buildActivityStrip && buildActivityStrip();
  }
}

// --- Saltear cooldown ---
async function swapSkipCooldown(method) {
  if (method === 'tokens') {
    const tok = profile?.tokens || 0;
    if (tok < SWAP_SKIP_TOKENS) {
      toast(`Necesitás ${SWAP_SKIP_TOKENS} PokéTokens (tenés ${tok})`, 1); return;
    }
    try {
      const { data: { session } } = await sb.auth.getSession();
      // Solo desbloquear el cooldown — NO hacer swap
      // Descontar tokens y limpiar cooldown directo en Supabase
      const uid = (await sb.auth.getUser()).data.user.id;
      const { error } = await sb.from('profiles')
        .update({
          tokens: tok - SWAP_SKIP_TOKENS,
          swap_cooldown_until: new Date().toISOString()
        })
        .eq('id', uid);
      if (error) { toast('Error: ' + error.message, 1); return; }
      localStorage.removeItem(SWAP_COOLDOWN_KEY);
      if (swapCdInterval) { clearInterval(swapCdInterval); swapCdInterval = null; }
      if (window._swapBtnTimer) { clearInterval(window._swapBtnTimer); window._swapBtnTimer = null; }
      await loadProfile();
      toast('✓ Cooldown eliminado — ¡hacé tu swap!');
      swapShowStep('sw-step-pick');
      swapBuildPickGrid();
      swapUpdateNavBadge();
    } catch(e) { toast(e.message, 1); }
    return;
  }
  if (method === 'mp' || method === 'paypal') {
    // Pago de $1 para adelantar cooldown
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(`${SB_URL}/functions/v1/create-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'skip_cooldown', method, amount: 1 })
      }).then(x => x.json());
      if (r.error) { toast(r.error, 1); return; }
      if (r.url) window.open(r.url, '_blank');
      else toast('Sistema de pago en construcción', 0);
    } catch(e) { toast('Sistema de pago en construcción', 0); }
  }
}

// --- Botón de tester para swap ---
function tstSwap() {
  localStorage.removeItem(SWAP_COOLDOWN_KEY);
  openSwapModal();
}

// Arrancar el ticker del nav badge cada minuto
setInterval(swapUpdateNavBadge, 1000); // actualizar cada segundo para countdown

// ============================================================
// ===== FIN SISTEMA POKESWAP =====
// ============================================================
