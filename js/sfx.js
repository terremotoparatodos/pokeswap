// ════════════════════════════════════════════════════════════
// js/sfx.js — POKESWAP AUDIO ENGINE
// Cargado ANTES del script principal
// ════════════════════════════════════════════════════════════

// POKESWAP AUDIO ENGINE v1 — Web Audio API, cero dependencias
// ════════════════════════════════════════════════════════════

const SFX = (() => {
  let ctx = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let currentMusic = null;
  let musicEnabled = true;
  let sfxEnabled = true;
  let _unlocked = false;

  // ── INIT ──
  function init() {
    // Si ya existe y está sano, reutilizar
    if (ctx && ctx.state !== 'closed') return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain(); masterGain.gain.value = 0.7;
      masterGain.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.35;
      musicGain.connect(masterGain);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 1.0;
      sfxGain.connect(masterGain);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 8;
      comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
      masterGain.disconnect(); masterGain.connect(comp); comp.connect(ctx.destination);
    } catch(e) { ctx = null; return null; }
    return ctx;
  }

  function unlock() {
    const c = init(); if (!c) return;
    const start = () => {
      if (!_unlocked) {
        _unlocked = true;
        if (musicEnabled && !currentMusic) setTimeout(()=>musicMap(), 200);
      }
    };
    if (c.state === 'suspended') {
      c.resume().then(start);
    } else {
      start();
    }
  }

  // ── HELPERS DE SÍNTESIS ──

  // Oscilador con envelope ADSR
  function osc(freq, type, vol, attack, decay, sustain, release, dest, startAt) {
    const c = init(); if (!c) return;
    const t = startAt ?? c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(dest || sfxGain);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.linearRampToValueAtTime(vol * sustain, t + attack + decay);
    g.gain.setValueAtTime(vol * sustain, t + attack + decay);
    g.gain.linearRampToValueAtTime(0.0001, t + attack + decay + release);
    const dur = attack + decay + release + 0.01;
    o.start(t); o.stop(t + dur);
    return { osc: o, gain: g, dur };
  }

  // Nota con frecuencia y duración simples
  function note(freq, type, vol, dur, dest, t) {
    return osc(freq, type, vol, 0.003, 0.05, 0.6, dur - 0.05, dest, t);
  }

  // Ruido blanco para percusión
  function noise(vol, dur, lpFreq, dest, t) {
    const c = init(); if (!c) return;
    const now = t ?? c.currentTime;
    const bufSize = c.sampleRate * Math.max(dur, 0.1);
    const buf = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = lpFreq;
    src.connect(lp); lp.connect(g); g.connect(dest || sfxGain);
    src.start(now); src.stop(now + dur + 0.01);
  }

  // Vibrato
  function vibratoOsc(freq, type, vol, dur, vibratoRate, vibratoDepth, dest, t) {
    const c = init(); if (!c) return;
    const now = t ?? c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    const vib = c.createOscillator();
    const vibGain = c.createGain();
    vib.frequency.value = vibratoRate;
    vibGain.gain.value = vibratoDepth;
    vib.connect(vibGain); vibGain.connect(o.frequency);
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(dest || sfxGain);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.02);
    g.gain.setValueAtTime(vol, now + dur - 0.06);
    g.gain.linearRampToValueAtTime(0.0001, now + dur);
    o.start(now); o.stop(now + dur);
    vib.start(now); vib.stop(now + dur);
  }

  // Chord (varias notas a la vez)
  function chord(freqs, type, vol, dur, dest, t) {
    const c = init(); if (!c) return;
    const now = t ?? c.currentTime;
    freqs.forEach((f, i) => note(f, type, vol / freqs.length, dur, dest, now + i * 0.01));
  }

  // ── FRECUENCIAS ──
  const N = {
    C3:130.8, D3:146.8, E3:164.8, F3:174.6, G3:196, A3:220, B3:246.9,
    C4:261.6, D4:293.7, E4:329.6, F4:349.2, G4:392, A4:440, B4:493.9,
    C5:523.3, D5:587.3, E5:659.3, F5:698.5, G5:784, A5:880, B5:987.8,
    C6:1046.5, D6:1174.7, Eb4:311.1, Bb3:233.1, Bb4:466.2, Db4:277.2,
    Ab3:207.7, Ab4:415.3, F3s:185, C3s:138.6, Eb3:155.6,
  };

  // ══════════════════════════════
  // EFECTOS DE SONIDO (SFX)
  // ══════════════════════════════

  const sounds = {

    // ── GENERALES ──
    click() {
      note(N.G5, 'sine', 0.05, 0.06);
    },

    hover() {
      note(N.E5, 'sine', 0.03, 0.04);
    },

    // ── DUNGEON: movimiento ──
    step() {
      noise(0.04, 0.05, 300);
    },

    stairs() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      [N.C4, N.E4, N.G4, N.C5].forEach((f, i) =>
        note(f, 'sine', 0.07, 0.12, null, t + i * 0.09));
    },

    // ── DUNGEON: combate ──
    hit() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      noise(0.12, 0.08, 600, null, t);
      note(N.A3, 'sawtooth', 0.07, 0.12, null, t + 0.01);
    },

    crit() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      noise(0.18, 0.06, 1200, null, t);
      note(N.E3, 'sawtooth', 0.12, 0.18, null, t);
      note(N.B3, 'square', 0.06, 0.1, null, t + 0.05);
    },

    faint() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      // Descendente tipo "ko"
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.6);
      g.gain.setValueAtTime(0.12, t);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g); g.connect(sfxGain);
      o.start(t); o.stop(t + 0.7);
      noise(0.08, 0.3, 400, null, t);
    },

    // ── DUNGEON: item ──
    item() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      [N.G4, N.B4, N.D5, N.G5].forEach((f, i) =>
        note(f, 'triangle', 0.07, 0.1, null, t + i * 0.06));
    },

    // ── VICTORIA ──
    victory() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      // Fanfare 3 notas ascendentes + resolución
      const seq = [
        [N.C4, 0.08], [N.E4, 0.08], [N.G4, 0.08],
        [N.C5, 0.18], [N.E5, 0.06], [N.G5, 0.25],
      ];
      let at = t;
      seq.forEach(([f, d]) => {
        note(f, 'square', 0.09, d, null, at);
        note(f * 2, 'sine', 0.04, d * 0.6, null, at);
        at += d * 0.85;
      });
      // Acorde final
      setTimeout(() => chord([N.C4, N.E4, N.G4, N.C5], 'sine', 0.1, 0.4), (at - t) * 1000);
    },

    // ── SWAP: selección de Pokémon ──
    swapSelect() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      note(N.G4, 'sine', 0.06, 0.08, null, t);
      note(N.B4, 'sine', 0.04, 0.08, null, t + 0.04);
    },

    // ── SWAP: botón confirmar (presionar) ──
    swapConfirm() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      // Sonido de "lanzar pokebola"
      note(N.C4, 'triangle', 0.08, 0.06, null, t);
      note(N.G3, 'square', 0.1, 0.12, null, t + 0.03);
      noise(0.06, 0.15, 800, null, t + 0.05);
    },

    // ── SWAP: bola girando (tick periódico) ──
    swapSpin() {
      noise(0.03, 0.04, 200);
    },

    // ── SWAP: temblor ──
    swapShake() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      noise(0.09, 0.08, 500, null, t);
      note(N.A3, 'square', 0.06, 0.1, null, t + 0.01);
    },

    // ── SWAP: reveal COMÚN ──
    revealCommon() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      [N.C5, N.E5, N.G5].forEach((f, i) =>
        note(f, 'triangle', 0.07, 0.12, null, t + i * 0.07));
    },

    // ── SWAP: reveal POCO COMÚN ──
    revealUncommon() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      const seq = [N.C5, N.E5, N.G5, N.C6];
      seq.forEach((f, i) => {
        note(f, 'triangle', 0.07, 0.14, null, t + i * 0.07);
        note(f * 0.5, 'sine', 0.03, 0.12, null, t + i * 0.07);
      });
    },

    // ── SWAP: reveal RARO ──
    revealRare() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      // Jingle ascendente con armonía
      const seq = [N.C4, N.G4, N.C5, N.E5, N.G5, N.C6];
      seq.forEach((f, i) => {
        note(f, 'square', 0.06, 0.14, null, t + i * 0.065);
        note(f * 1.5, 'sine', 0.03, 0.1, null, t + i * 0.065 + 0.02);
      });
      // Resolución con acorde
      setTimeout(() => chord([N.C4, N.E4, N.G4, N.C5], 'sine', 0.09, 0.35), 420);
    },

    // ── SWAP: reveal ÉPICO ──
    revealEpic() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      // Arpeggio dramático
      noise(0.12, 0.08, 1000, null, t);
      const seq = [N.C3, N.G3, N.C4, N.Eb4, N.G4, N.Bb4, N.C5, N.Eb4+50];
      seq.forEach((f, i) => {
        note(f, 'sawtooth', 0.05, 0.16, null, t + i * 0.06);
        note(f * 2, 'sine', 0.04, 0.12, null, t + i * 0.06 + 0.01);
      });
      // Stinger final
      const stingT = t + seq.length * 0.06;
      chord([N.C4, N.Eb4, N.G4, N.Bb4, N.C5], 'square', 0.07, 0.5, null, stingT);
      note(N.C6, 'sine', 0.08, 0.3, null, stingT + 0.05);
    },

    // ── SWAP: reveal LEGENDARIO ──
    revealLegendary() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      // Fanfare épica full
      noise(0.2, 0.12, 2000, null, t);

      // Primera oleada: tremolo low
      const tremO = c.createOscillator();
      const tremG = c.createGain();
      const tremLFO = c.createOscillator();
      const tremLFOG = c.createGain();
      tremLFO.frequency.value = 12; tremLFOG.gain.value = 0.06;
      tremLFO.connect(tremLFOG); tremLFOG.connect(tremG.gain);
      tremO.type = 'sawtooth'; tremO.frequency.value = N.C3;
      tremO.connect(tremG); tremG.connect(sfxGain);
      tremG.gain.setValueAtTime(0.12, t);
      tremG.gain.linearRampToValueAtTime(0.0001, t + 0.5);
      tremO.start(t); tremO.stop(t + 0.5);
      tremLFO.start(t); tremLFO.stop(t + 0.5);

      // Arpeggio rápido
      const arp = [N.C4, N.E4, N.G4, N.C5, N.E5, N.G5, N.C6, N.G5, N.E5];
      arp.forEach((f, i) => {
        note(f, 'square', 0.07, 0.1, null, t + i * 0.055);
        note(f * 2, 'sine', 0.03, 0.08, null, t + i * 0.055);
      });

      // Fanfare (delay)
      const ft = t + arp.length * 0.055 + 0.05;
      const fanfare = [
        [N.C4, 0.12], [N.C4, 0.06], [N.C4, 0.06],
        [N.Ab3, 0.12], [N.Bb3, 0.12],
        [N.C4, 0.12], [N.Bb3, 0.06], [N.C4, 0.28],
      ];
      let fat = ft;
      fanfare.forEach(([f, d]) => {
        note(f, 'square', 0.09, d, null, fat);
        note(f * 2, 'triangle', 0.05, d * 0.8, null, fat);
        note(f * 3, 'sine', 0.02, d * 0.6, null, fat);
        fat += d;
      });
      // Acorde final legendario
      chord([N.C3, N.G3, N.C4, N.E4, N.G4, N.C5], 'sine', 0.08, 0.7, null, fat);
      noise(0.06, 0.2, 2000, null, fat);
    },

    // ── SWAP: shiny ──
    revealShiny() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      // Tinkle mágico
      const freqs = [N.E6||1318, N.G5, N.B5||987.8, N.D6||1174, N.A5, N.C6, N.E5];
      freqs.forEach((f, i) => {
        vibratoOsc(f, 'sine', 0.06, 0.2, 6, 8, sfxGain, t + i * 0.05);
        if (i % 2 === 0) noise(0.02, 0.05, 4000, null, t + i * 0.05);
      });
    },

    // ── DUNGEON/SENDERO: boss apareció ──
    bossAppear() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      noise(0.15, 0.25, 800, null, t);
      // Tres golpes dramáticos
      [0, 0.18, 0.36].forEach(delay => {
        note(N.C3, 'sawtooth', 0.15, 0.14, null, t + delay);
        noise(0.1, 0.1, 600, null, t + delay);
      });
      // Stinger descendente
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(N.C4, t + 0.5);
      o.frequency.exponentialRampToValueAtTime(N.C3, t + 0.9);
      g.gain.setValueAtTime(0.12, t + 0.5);
      g.gain.linearRampToValueAtTime(0.0001, t + 1.0);
      o.connect(g); g.connect(sfxGain);
      o.start(t + 0.5); o.stop(t + 1.1);
    },

    // ── FASE 2 DEL JEFE ──
    bossPhase2() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      noise(0.2, 0.3, 1500, null, t);
      [N.C3, N.Eb3, N.G3].forEach((f, i) => {
        note(f, 'sawtooth', 0.1, 0.4, null, t + i * 0.04);
      });
      note(N.C2||65.4, 'sawtooth', 0.12, 0.6, null, t + 0.2);
    },

    // ── CURACIÓN ──
    heal() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      [N.G4, N.B4, N.D5, N.G5, N.B5||987.8].forEach((f, i) =>
        vibratoOsc(f, 'sine', 0.06, 0.2, 5, 5, sfxGain, t + i * 0.06));
    },

    // ── COOLDOWN LISTO ──
    swapReady() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      [N.C5, N.G5, N.C6].forEach((f, i) =>
        note(f, 'sine', 0.07, 0.12, null, t + i * 0.1));
    },

    // ── ERROR / TRAMPA ──
    trap() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      noise(0.1, 0.12, 400, null, t);
      note(N.Eb3, 'sawtooth', 0.09, 0.18, null, t + 0.02);
      note(N.Ab3, 'sawtooth', 0.06, 0.14, null, t + 0.06);
    },

    // ── ABRIR COFRE / PORTAL ──
    mystery() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      vibratoOsc(N.E4, 'sine', 0.06, 0.3, 4, 10, sfxGain, t);
      vibratoOsc(N.G4, 'sine', 0.05, 0.28, 5, 8, sfxGain, t + 0.05);
      vibratoOsc(N.B4, 'sine', 0.04, 0.26, 6, 6, sfxGain, t + 0.1);
      note(N.E5, 'triangle', 0.07, 0.2, null, t + 0.18);
    },

    // ── DERROTA ──
    defeat() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      const seq = [N.G4, N.E4, N.C4, N.G3, N.E3, N.C3];
      seq.forEach((f, i) => {
        note(f, 'square', 0.07, 0.18, null, t + i * 0.14);
      });
      noise(0.06, 0.4, 300, null, t + 0.3);
      // Fade largo
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine'; o.frequency.value = N.C3;
      o.connect(g); g.connect(sfxGain);
      g.gain.setValueAtTime(0.06, t + 1.0);
      g.gain.linearRampToValueAtTime(0.0001, t + 2.0);
      o.start(t + 1.0); o.stop(t + 2.1);
    },

    // ── LEVEL UP ──
    levelUp() {
      const c = init(); if (!c) return;
      const t = c.currentTime;
      const seq = [N.C4,N.E4,N.G4,N.C5,N.E5,N.G5,N.C6];
      seq.forEach((f,i) => {
        note(f,'square',0.07,0.12,null,t+i*0.07);
        note(f*2,'sine',0.03,0.1,null,t+i*0.07);
      });
      chord([N.C4,N.E4,N.G4,N.C5],'sine',0.09,0.5,null,t+seq.length*0.07+0.02);
    },
  };

  // ══════════════════════════════
  // MÚSICA GENERATIVA
  // ══════════════════════════════

  // Escala pentatónica menor para el dungeon
  const PENTA_MINOR = [0, 3, 5, 7, 10]; // semitonos desde raíz
  function pentatonicFreq(root, degree) {
    const oct = Math.floor(degree / PENTA_MINOR.length);
    const idx = ((degree % PENTA_MINOR.length) + PENTA_MINOR.length) % PENTA_MINOR.length;
    return root * Math.pow(2, (PENTA_MINOR[idx] + oct * 12) / 12);
  }

  // Escala mayor para el mapa/swap
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  function majorFreq(root, degree) {
    const oct = Math.floor(degree / MAJOR.length);
    const idx = ((degree % MAJOR.length) + MAJOR.length) % MAJOR.length;
    return root * Math.pow(2, (MAJOR[idx] + oct * 12) / 12);
  }

  // ── MÚSICA: MAPA (loop tranquilo, ambient) ──
  function musicMap() {
    if (!musicEnabled) return;
    const c = init(); if (!c) return;
    if (c.state === 'suspended') { c.resume(); }
    stopMusic();
    // Recrear musicGain conectado al contexto actual
    musicGain = c.createGain(); musicGain.gain.value = 0.35;
    musicGain.connect(masterGain);
    const root = N.G3;
    let stopped = false;
    let timeouts = [];

    const playLoop = () => {
      if (stopped || currentMusic !== 'map') return;
      const now = c.currentTime;
      const BPM = 88; const BEAT = 60 / BPM;

      // Bajo: root + quinta cada 2 beats
      [[root, 0], [root * 1.5, BEAT * 2], [root, BEAT * 4], [root * 4/3, BEAT * 6]].forEach(([f, delay]) => {
        if (stopped) return;
        vibratoOsc(f, 'sine', 0.06, BEAT * 1.6, 2, 2, musicGain, now + delay);
      });

      // Melodía ambiente: notas aleatorias de la escala
      for (let i = 0; i < 8; i++) {
        if (stopped) return;
        const degree = Math.floor(Math.random() * 6) + 2;
        const f = majorFreq(root * 2, degree);
        const delay = BEAT * (i * 1.1 + Math.random() * 0.3);
        if (Math.random() < 0.6) {
          vibratoOsc(f, 'sine', 0.025, BEAT * 0.8, 4, 4, musicGain, now + delay);
        }
      }

      // Pad armónico
      chord([root, root * 1.25, root * 1.5, root * 2], 'sine', 0.018, BEAT * 7.5, musicGain, now + BEAT * 0.5);

      const id = setTimeout(playLoop, BEAT * 8 * 1000);
      timeouts.push(id);
    };

    playLoop();
    currentMusic = 'map';
    return () => { stopped = true; timeouts.forEach(clearTimeout); };
  }

  // ── MÚSICA: DUNGEON (inquietante, cromático) ──
  function musicDungeon() {
    if (!musicEnabled) return;
    const c = init(); if (!c) return;
    if (c.state === 'suspended') { c.resume(); }
    stopMusic();
    musicGain = c.createGain(); musicGain.gain.value = 0.35;
    musicGain.connect(masterGain);
    const root = N.C3;
    let stopped = false;
    let timeouts = [];
    let intensity = 0; // 0=normal, 1=boss

    const playLoop = () => {
      if (stopped || currentMusic !== 'dungeon') return;
      const now = c.currentTime;
      const BPM = 110; const BEAT = 60 / BPM;

      // Pulso de bajo tenso
      for (let i = 0; i < 8; i++) {
        if (stopped) return;
        const odd = i % 2 === 1;
        const f = odd ? root * 1.1892 : root; // tritono
        vibratoOsc(f, 'square', 0.04 + intensity * 0.02, BEAT * 0.35, 0.5, 1, musicGain, now + i * BEAT);
      }

      // Melodía pentatónica menor errática
      const steps = 6 + Math.floor(Math.random() * 4);
      for (let i = 0; i < steps; i++) {
        if (stopped) return;
        const degree = Math.floor(Math.random() * 8) - 1;
        const f = pentatonicFreq(root * 2, degree);
        const delay = BEAT * (i * (1.6 - intensity * 0.3) + Math.random() * 0.4);
        if (delay < BEAT * 7.5 && Math.random() < 0.55) {
          note(f, 'triangle', 0.022 + intensity * 0.01, BEAT * 0.6, musicGain, now + delay);
        }
      }

      // Disonancia ocasional (suspense)
      if (Math.random() < 0.35 + intensity * 0.2) {
        const disF = root * Math.pow(2, (Math.random() < 0.5 ? 6 : 10) / 12);
        vibratoOsc(disF, 'sawtooth', 0.012, BEAT * 2.5, 3, 6, musicGain, now + BEAT * 3.5);
      }

      const id = setTimeout(playLoop, BEAT * 8 * 1000);
      timeouts.push(id);
    };

    playLoop();
    currentMusic = 'dungeon';

    return {
      stop: () => { stopped = true; timeouts.forEach(clearTimeout); },
      setIntensity: (v) => { intensity = Math.max(0, Math.min(1, v)); },
    };
  }

  // ── MÚSICA: BOSS (urgente, cromático denso) ──
  function musicBoss() {
    if (!musicEnabled) return;
    const c = init(); if (!c) return;
    if (c.state === 'suspended') { c.resume(); }
    stopMusic();
    musicGain = c.createGain(); musicGain.gain.value = 0.35;
    musicGain.connect(masterGain);
    const root = N.C3;
    let stopped = false;
    let timeouts = [];

    const playLoop = () => {
      if (stopped || currentMusic !== 'boss') return;
      const now = c.currentTime;
      const BPM = 148; const BEAT = 60 / BPM;

      // Bajo obsesivo en ostinato
      for (let i = 0; i < 16; i++) {
        if (stopped) return;
        const pattern = [0, 0, 3, 0, -2, 0, 3, 5, 0, 0, 3, 0, -2, -4, 0, 3];
        const semitone = pattern[i % pattern.length];
        const f = root * Math.pow(2, semitone / 12);
        note(f, 'sawtooth', 0.055, BEAT * 0.4, musicGain, now + i * BEAT * 0.5);
      }

      // Contrapunto agudo
      const upper = [10, 10, 8, 7, 5, 5, 7, 8];
      upper.forEach((s, i) => {
        if (stopped) return;
        const f = root * Math.pow(2, (s + 12) / 12);
        note(f, 'square', 0.025, BEAT * 0.7, musicGain, now + i * BEAT);
      });

      // Tremolo pad
      vibratoOsc(root * 2, 'sawtooth', 0.03, BEAT * 7, 8, 12, musicGain, now + BEAT);

      const id = setTimeout(playLoop, BEAT * 8 * 1000);
      timeouts.push(id);
    };

    playLoop();
    currentMusic = 'boss';
    return () => { stopped = true; timeouts.forEach(clearTimeout); };
  }

  // ── MÚSICA: SWAP (expectante, suave) ──
  function musicSwap() {
    if (!musicEnabled) return;
    const c = init(); if (!c) return;
    stopMusic();
    const root = N.G3;
    let stopped = false;
    let timeouts = [];

    const playLoop = () => {
      if (stopped || currentMusic !== 'swap') return;
      const now = c.currentTime;
      const BPM = 72; const BEAT = 60 / BPM;

      // Arpeggio suave
      const arpSeq = [0, 2, 4, 7, 9, 7, 4, 2];
      arpSeq.forEach((s, i) => {
        if (stopped) return;
        const f = majorFreq(root * 2, s);
        vibratoOsc(f, 'sine', 0.025, BEAT * 0.9, 3, 3, musicGain, now + i * BEAT * 0.5);
      });

      // Pad armónico
      chord([root, root*1.25, root*1.5, root*2], 'sine', 0.015, BEAT*3.5, musicGain, now+BEAT*0.25);
      chord([root*4/3, root*5/3, root*2, root*8/3], 'sine', 0.012, BEAT*3.5, musicGain, now+BEAT*4.25);

      const id = setTimeout(playLoop, BEAT * 8 * 1000);
      timeouts.push(id);
    };

    playLoop();
    currentMusic = 'swap';
    return () => { stopped = true; timeouts.forEach(clearTimeout); };
  }

  // ── STOP ──
  function stopMusic() {
    currentMusic = null;
  }

  // ── FADE IN/OUT ──
  function setMusicVolume(vol, fadeSec = 0.8) {
    const c = init(); if (!c || !musicGain) return;
    const now = c.currentTime;
    musicGain.gain.linearRampToValueAtTime(vol * 0.35, now + fadeSec);
  }

  // ── API PÚBLICA ──
  return {
    unlock,
    ctx: () => ctx,
    play: (name, ...args) => {
      if (!sfxEnabled) return;
      try { unlock(); sounds[name]?.(...args); } catch(e) {}
    },
    musicMap,
    musicDungeon,
    musicBoss,
    musicSwap,
    stopMusic,
    setMusicVolume,
    setMusicEnabled: (v) => { musicEnabled = v; if (!v) stopMusic(); },
    setSfxEnabled:   (v) => { sfxEnabled = v; },
    getMusicEnabled: () => musicEnabled,
    getSfxEnabled:   () => sfxEnabled,
    currentMusic:    () => currentMusic,
    isPlaying:       (name) => currentMusic === name,
  };
})();


function dgSound(kind){
  const map={
    step:'step', hit:'hit', crit:'crit', item:'item',
    stairs:'stairs', faint:'faint', victory:'victory',
  };
  SFX.play(map[kind]||kind);
}


function toggleMusic(){
  const on = !SFX.getMusicEnabled();
  SFX.setMusicEnabled(on);
  const btn = document.getElementById('btn-music');
  if(btn){ btn.textContent = on ? '🎵' : '🔇'; btn.style.opacity = on ? '1' : '.4'; }
  if(on){ SFX.musicMap(); } else { SFX.stopMusic(); }
  toast(on ? '🎵 Música activada' : '🔇 Música desactivada');
}
function toggleSfx(){
  const on = !SFX.getSfxEnabled();
  SFX.setSfxEnabled(on);
  const btn = document.getElementById('btn-sfx');
  if(btn){ btn.textContent = on ? '🔊' : '🔕'; btn.style.opacity = on ? '1' : '.4'; }
  if(on) SFX.play('item'); // confirmar que funciona
  toast(on ? '🔊 Efectos activados' : '🔕 Efectos desactivados');
}


function _sfxUnlockAndPlay(){
  SFX.unlock();
  if(!SFX.currentMusic()) setTimeout(()=>SFX.musicMap(), 300);
}
document.addEventListener('pointerdown', _sfxUnlockAndPlay, {once:true});
document.addEventListener('touchstart',  _sfxUnlockAndPlay, {once:true, passive:true});
document.addEventListener('keydown',     _sfxUnlockAndPlay, {once:true});
document.addEventListener('click',       _sfxUnlockAndPlay, {once:true});
// Reanudar música al volver al tab (iOS Safari lo suspende)
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible'){
    const c = SFX.ctx?.();
    if(c && c.state==='suspended') c.resume();
    if(SFX.getMusicEnabled() && !SFX.currentMusic()) setTimeout(()=>SFX.musicMap(),400);
  }
});
