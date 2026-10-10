import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [codeArg, evidenceArg, mode = 'positive'] = process.argv.slice(2)
assert.equal(process.versions.node.split('.')[0], '22')
const code = resolve(codeArg), evidence = resolve(evidenceArg), fixture = join(dirname(code), 'native-selector-fixture')
await mkdir(fixture, { recursive: true })
const esbuild = await import(pathToFileURL(join(code, 'node_modules/esbuild/lib/main.js')).href)
const sfc = await import(pathToFileURL(join(code, 'node_modules/@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js')).href)
const { EcoCombatants } = await import(pathToFileURL(join(code, 'services/realtime/src/world/ecoCombatants.js')).href)
const { prepareEncounterBattles } = await import(pathToFileURL(join(code, 'services/realtime/src/world/ecosystem/encounterBattle.generated.js')).href)
const prepared = await prepareEncounterBattles()
assert.equal(prepared.ok, true)
let locked = false
const choice = new EcoCombatants({ battles: () => prepared.battles, inBattle: () => locked })
const actor = { id: 'native-selector-player' }, client = { send() {} }
const M = (await import(pathToFileURL(join(code, 'services/realtime/src/world/worldProtocol.js')).href)).WORLD_MESSAGE
const entry = `
import {createApp,h,ref,nextTick} from 'vue';
import {SharedWorld} from './src/features/world/state/sharedWorld';
import Layer from './src/features/world/components/EcoExperimentLayer.vue';
import {KeyboardInput} from './src/features/wildlands/engine/keyboard';
const sent=[],events=[];let interactions=0;const keys=new KeyboardInput({cycleLens(){},toggleGrid(){},skipTime(){},interact(){interactions++}});keys.attach();
const world=new SharedWorld(async()=>null,id=>({id,name:String(id),shiny:false,frames:{}}));
world.attach((type,payload)=>sent.push({type,payload}));
const encounter={id:'eco-n:pradera:selector:1:0',groupId:'g1',speciesId:13,tx:2,ty:0,busy:false};
world.snapshot({now:1,areaId:'pradera',chunks:[],nodes:[],eco:{protocol:1,areaId:'pradera',status:'active',encounters:[encounter]}});
const layer=ref(null),onBattle=ref(false);
const app=createApp({setup:()=>()=>h(Layer,{ref:layer,world,areaId:'pradera',tx:0,ty:0,mapFocus:()=>document.querySelector('#map'),onBattle:open=>onBattle.value=open})});app.mount('#layer');
document.addEventListener('keydown',e=>{const row={key:e.key,trusted:e.isTrusted,target:e.target.tagName,prevented:false};events.push(row);queueMicrotask(()=>row.prevented=e.defaultPrevented)},true);
window.addEventListener('keydown',e=>{const row=events.at(-1);if(row?.key===e.key)row.prevented=e.defaultPrevented});
const state=()=>({sent:sent.slice(),interactions,direction:keys.direction,events:events.slice(),battle:onBattle.value,focus:document.activeElement?.tagName,selects:[...document.querySelectorAll('select')].map(e=>({value:e.value,disabled:e.disabled,options:[...e.options].map(o=>({value:o.value,text:o.textContent}))})),sprites:[...document.querySelectorAll('.eco-choice .eco-sprite')].map(e=>({label:e.getAttribute('aria-label'),style:e.style.backgroundImage})),fight:[...document.querySelectorAll('.eco-card__fight,.eco-dev__actions button:first-child')].map(e=>({disabled:e.disabled,text:e.textContent})),status:[...document.querySelectorAll('.eco-choice [role=status]')].map(e=>e.textContent),details:document.querySelector('.ebp-details')?.textContent});
window.review={state,nextTick,open:()=>layer.value.select(encounter.id),ack:m=>world.ecoBattleMessage('world:eco-combatant-state',m),message:(type,m)=>world.ecoBattleMessage(type,m),detach:()=>world.detach(),detachKeyboard:()=>keys.detach(),unmount:()=>{app.unmount();keys.detach()}};
`
await esbuild.build({ stdin: { contents: entry, resolveDir: code, loader: 'ts', sourcefile: 'review-selector-native.ts' }, bundle: true, format: 'iife', outfile: join(fixture, 'fixture.js'), define: { 'import.meta.env': JSON.stringify({ DEV: true, VITE_ECO_EXPERIMENT: 'on' }) }, plugins: [{ name: 'real-components', setup(build) {
  build.onLoad({ filter: /\.vue$/ }, async args => {
    const { descriptor } = sfc.parse(await readFile(args.path, 'utf8'), { filename: args.path })
    const result = sfc.compileScript(descriptor, { id: 'review-selector', inlineTemplate: true })
    return { contents: result.content + '\nconst css=document.createElement("style");css.textContent=' + JSON.stringify(descriptor.styles.map(s => s.content).join('\n')) + ';document.head.append(css);', loader: 'ts', resolveDir: dirname(args.path) }
  })
} }] })
await writeFile(join(fixture, 'fixture.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#253945}#layer{position:relative;height:700px;width:1000px}#map{position:absolute;width:1000px;height:700px}</style><canvas id="map" tabindex="0"></canvas><div id="layer"></div><script src="/fixture.js"></script>')
const http = createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0]
    const path = url === '/' ? join(fixture, 'fixture.html') : url === '/fixture.js' ? join(fixture, 'fixture.js') : /^\/assets\/overworld\/\d{4}\.png$/.test(url) ? join(code, 'public', url) : null
    if (!path) { res.writeHead(404); res.end(); return }
    res.setHeader('Content-Type', url.endsWith('.png') ? 'image/png' : url.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8')
    res.end(await readFile(path))
  } catch { res.writeHead(404); res.end() }
})
await new Promise(r => http.listen(0, '127.0.0.1', r))
const port = http.address().port
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe', '--user-data-dir=' + join(fixture, 'chrome-profile')], { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'], windowsHide: true })
let serial = 0, buffer = '', stderr = '', keyEvents = 0, version, evaluate, failure
const pending = new Map(), observed = []
browser.stderr.on('data', b => stderr += b)
browser.stdio[4].on('data', b => { buffer += b; let cut; while ((cut = buffer.indexOf('\0')) >= 0) { const raw = buffer.slice(0, cut); buffer = buffer.slice(cut + 1); if (!raw) continue; const m = JSON.parse(raw), p = pending.get(m.id); if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result) } } })
const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error('Timeout ' + method)) }, 10000); pending.set(id, { resolve, reject, timer }); browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0') })
try {
  version = await call('Browser.getVersion')
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
  await call('Page.enable', {}, sessionId); await call('Runtime.enable', {}, sessionId)
  await call('Page.navigate', { url: 'http://127.0.0.1:' + port }, sessionId)
  evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value }
  for (let i = 0; i < 100; i++) { if (await evaluate('!!window.review')) break; await new Promise(r => setTimeout(r, 30)) }
  const run = source => evaluate('(async()=>{' + source + ';await review.nextTick();return review.state()})()')
  const snapshot = async label => { const state = await evaluate('review.state()'); observed.push({ label, state }); return state }
  const edge = async (type, name, code, vk) => { await call('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : name.length === 1 ? {text:name,unmodifiedText:name} : {}) }, sessionId); keyEvents++ }
  const key = async (name, code, vk) => { await edge('keyDown',name,code,vk); await edge('keyUp',name,code,vk) }
  const ack = message => run('review.ack(' + JSON.stringify(message) + ')')
  await run('review.open();document.querySelector(".eco-dev__toggle").click()')
  let s = await snapshot('no server acknowledgement')
  assert.equal(s.selects.length, 2); assert(s.selects.every(x => x.disabled)); assert(s.fight.every(x => x.disabled))
  await ack(choice.state(actor.id))
  s = await snapshot('default confirmed by actual server service')
  assert(s.selects.every(x => x.value === '25' && !x.disabled)); assert(s.fight.every(x => !x.disabled))
  assert.deepEqual(s.selects[0].options.map(o => o.value), ['25', '19', '43', '74', '41', '10'])
  if(mode==='arrows'){
    const findings=[]
    for(const route of ['.eco-card select','.eco-dev select']){
      await run('document.querySelector('+JSON.stringify(route)+').focus()')
      const before=await snapshot(route+' before ArrowDown')
      await edge('keyDown','ArrowDown','ArrowDown',40)
      const held=await snapshot(route+' ArrowDown held')
      await edge('keyUp','ArrowDown','ArrowDown',40)
      const after=await snapshot(route+' ArrowDown released')
      const pass=held.direction===null&&after.sent.length===before.sent.length+1&&after.sent.at(-1)?.payload.speciesId===19
      if(!pass)findings.push({route,expected:{direction:null,newSelection:19},before,held,after})
    }
    await run('review.detachKeyboard();document.querySelector(".eco-card select").focus()')
    await key('ArrowDown','ArrowDown',40)
    const control=await snapshot('same real select, keyboard listener detached only in harness')
    assert.equal(control.sent.length,1);assert.equal(control.sent[0].payload.speciesId,19);assert.equal(control.direction,null)
    await writeFile(join(evidence,'selector-arrows.json'),JSON.stringify({pass:findings.length===0,browser:version.product,nativeKeyEvents:keyEvents,findings,control,observed},null,2))
    console.log(JSON.stringify({pass:findings.length===0,findings:findings.length,control:true}));process.exitCode=findings.length?1:0
    await run('review.unmount()');
  }else{
  const assets = await evaluate('Promise.all([25,19,43,74,41,10].map(id=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve({id,ok:true,width:img.width,height:img.height});img.onerror=()=>resolve({id,ok:false});img.src="/assets/overworld/"+String(id).padStart(4,"0")+".png"})))')
  assert(assets.every(x => x.ok && x.width > 0))
  await run('document.querySelector(".eco-card select").focus()')
  await key('r', 'KeyR', 82)
  s = await snapshot('native card choice awaiting server')
  assert.equal(s.sent.length, 1); assert.equal(s.sent[0].type, M.ECO_COMBATANT_SELECT); assert.equal(s.sent[0].payload.speciesId, 19)
  assert(s.selects.every(x => x.value === '25' && x.disabled)); assert(s.fight.every(x => x.disabled)); assert(s.status.every(x => x.includes('Confirmando'))); assert(s.sprites.every(x => x.style.includes('0025.png'))); assert.equal(s.interactions, 0)
  await ack(choice.select(actor, s.sent[0].payload, client, client))
  s = await snapshot('Rattata acknowledged in both selectors')
  assert(s.selects.every(x => x.value === '19' && !x.disabled)); assert(s.fight.every(x => !x.disabled)); assert(s.sprites.every(x => x.label === 'Rattata' && x.style.includes('0019.png')))
  await run('document.querySelector(".eco-dev select").focus()'); await key('o', 'KeyO', 79)
  s = await snapshot('native debug choice awaiting server')
  assert.equal(s.sent.length, 2); assert.equal(s.sent[1].payload.speciesId, 43); assert(s.selects.every(x => x.value === '19' && x.disabled)); assert(s.fight.every(x => x.disabled))
  await ack(choice.select(actor, s.sent[1].payload, client, client))
  s = await snapshot('Oddish confirmed by actual server service')
  assert(s.selects.every(x => x.value === '43' && !x.disabled)); assert(s.sprites.every(x => x.style.includes('0043.png') && x.label === 'Oddish')); assert.equal(s.interactions, 0)
  await run('document.querySelector(".eco-card__fight").focus()'); await key('Enter', 'Enter', 13)
  s = await snapshot('native fight after confirmation')
  assert.equal(s.sent.length, 3); assert.equal(s.sent[2].type, M.ECO_ENGAGE); assert.equal(s.sent[2].payload.encounterId, 'eco-n:pradera:selector:1:0'); assert.equal(s.interactions, 0)
  const started = prepared.battles.start({ battleId: 'eco-battle-native-00000001', controllerId: actor.id, speciesId: 13, playerSpeciesId: choice.speciesOf(actor.id), seed: 7 })
  assert.equal(started.ok, true); locked = true
  const battle = { battleId: started.battle.battleId, speciesId: 13, fixture: true, fixtureLabel: 'fixture de prueba', expiresInMs: 120000, snapshot: started.battle.snapshot(), joinAck: started.battle.joinAck(actor.id), stage: { owner: { tx: 0, ty: 0 }, wild: { tx: 2, ty: 0 }, pokemon: { tx: 1, ty: 0 }, pokemonFacing: 'right', wildFacing: 'left' } }
  await run('review.message(' + JSON.stringify(M.ECO_ENGAGE_RESULT) + ',' + JSON.stringify({ requestId: s.sent[2].payload.requestId, encounterId: 'eco-n:pradera:selector:1:0', ok: true, battle }) + ')')
  s = await snapshot('running battle locked selector')
  assert.equal(s.selects.length, 1); assert.equal(s.selects[0].value, '43'); assert.equal(s.selects[0].disabled, true)
  await run('document.querySelector(".ebp-info").focus()'); await key('Enter', 'Enter', 13)
  s = await snapshot('battle information for selected combatant')
  assert(s.details.includes('Oddish')); assert(s.details.includes('Nv. 12')); assert(s.details.includes('36/36')); assert.equal(s.interactions, 0)
  const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId)
  await writeFile(join(evidence, 'selector-native.png'), Buffer.from(image.data, 'base64'))
  await run('review.detach()')
  s = await snapshot('disconnect keeps confirmed identity and locks controls')
  assert.equal(s.selects[0].value, ''); assert.equal(s.selects[0].disabled, true); assert(s.sprites[0].style.includes('0043.png')); assert(s.status.includes('Sin conexión.'))
  assert(s.events.length > 0 && s.events.every(x => x.trusted))
  await run('review.unmount()')
  await writeFile(join(evidence, 'selector-native.json'), JSON.stringify({ pass: true, node: process.version, browser: version.product, browserPid: browser.pid, staticPort: port, nativeKeyEvents: keyEvents, assets, observed, limitations: ['Isolated real components; server selection acknowledgements obtained from actual EcoCombatants service and real prepared bundle, delivered by harness.', 'Native trusted Chrome keyboard; no shared game process or active environment. Network transport and reconnection tested separately by real SDK e2e.'] }, null, 2))
  console.log('PASS native selector, authoritative acknowledgement, both entry routes and active/offline lock')
  }
} catch (error) {
  try { failure = await evaluate?.('review.state()') } catch {}
  await writeFile(join(evidence, 'selector-native.json'), JSON.stringify({ pass: false, error: String(error.stack ?? error), browser: version?.product, keyEvents, observed, failure }, null, 2)); throw error
} finally {
  await writeFile(join(evidence, 'selector-browser-stderr.log'), stderr)
  try { await call('Browser.close') } catch { browser.kill() }
  await new Promise(r => { if (browser.exitCode !== null || browser.signalCode !== null) r(); else browser.once('exit', r) })
  http.closeAllConnections(); await new Promise(r => http.close(r))
  await writeFile(join(evidence, 'selector-cleanup.json'), JSON.stringify({ browserPid: browser.pid, browserExit: browser.exitCode, browserSignal: browser.signalCode, staticPort: port, staticServerClosed: !http.listening }, null, 2))
}
