import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// CM-R1 continuity regression: one focus per scenario, no focus recovery between keys/ACKs.
// Node 22 + Chrome; real components, SharedWorld and KeyboardInput, isolated static/choice server.
// node scripts/ecosystem/eco-combatant-keyboard-native.mjs <repo> <new-evidence-dir>
const [codeArg, evidenceArg] = process.argv.slice(2)
assert.equal(process.versions.node.split('.')[0], '22')
const code = resolve(codeArg),
  evidence = resolve(evidenceArg),
  fixture = join(dirname(code), 'native-selector-fixture')
await mkdir(fixture, { recursive: true })
const esbuild = await import(pathToFileURL(join(code, 'node_modules/esbuild/lib/main.js')).href)
const sfc = await import(
  pathToFileURL(join(code, 'node_modules/@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js')).href
)
const { EcoCombatants } = await import(
  pathToFileURL(join(code, 'services/realtime/src/world/ecoCombatants.js')).href
)
const { prepareEncounterBattles } = await import(
  pathToFileURL(join(code, 'services/realtime/src/world/ecosystem/encounterBattle.generated.js'))
    .href
)
const prepared = await prepareEncounterBattles()
assert.equal(prepared.ok, true)
const choice = new EcoCombatants({ battles: () => prepared.battles, inBattle: () => false })
const actor = { id: 'native-selector-player' },
  client = { send() {} }
const serverRequests = []
const replies = []
const M = (
  await import(pathToFileURL(join(code, 'services/realtime/src/world/worldProtocol.js')).href)
).WORLD_MESSAGE
const entry = `
import {createApp,h,ref,nextTick} from 'vue';
import {SharedWorld} from './src/features/world/state/sharedWorld';
import Layer from './src/features/world/components/EcoExperimentLayer.vue';
import {KeyboardInput} from './src/features/wildlands/engine/keyboard';
const sent=[],events=[];let interactions=0;const keys=new KeyboardInput({cycleLens(){},toggleGrid(){},skipTime(){},interact(){interactions++}});keys.attach();
const world=new SharedWorld(async()=>null,id=>({id,name:String(id),shiny:false,frames:{}}));
world.attach((type,payload)=>{
  sent.push({type,payload});
  if(type==='world:eco-combatant-select')fetch('/select',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
    .then(r=>r.json()).then(result=>world.ecoBattleMessage('world:eco-combatant-state',result)).catch(error=>{window.choiceError=String(error)});
});
const encounter={id:'eco-n:pradera:selector:1:0',groupId:'g1',speciesId:13,tx:2,ty:0,busy:false};
world.snapshot({now:1,areaId:'pradera',chunks:[],nodes:[],eco:{protocol:1,areaId:'pradera',status:'active',encounters:[encounter]}});
const layer=ref(null),onBattle=ref(false);
const app=createApp({setup:()=>()=>h(Layer,{ref:layer,world,areaId:'pradera',tx:0,ty:0,mapFocus:()=>document.querySelector('#map'),onBattle:open=>onBattle.value=open})});app.mount('#layer');
document.addEventListener('keydown',e=>{const row={key:e.key,trusted:e.isTrusted,target:e.target.tagName,prevented:false};events.push(row);queueMicrotask(()=>row.prevented=e.defaultPrevented)},true);
window.addEventListener('keydown',e=>{const row=events.at(-1);if(row?.key===e.key)row.prevented=e.defaultPrevented});
const state=()=>({sent:sent.slice(),interactions,direction:keys.direction,events:events.slice(),battle:onBattle.value,focus:document.activeElement?.tagName,focusId:document.activeElement?.id,focusRoute:document.activeElement?.matches('select')?(document.activeElement.closest('.eco-card')?'.eco-card select':'.eco-dev select'):null,choiceError:window.choiceError,selects:[...document.querySelectorAll('select')].map(e=>({value:e.value,disabled:e.disabled,ariaDisabled:e.getAttribute('aria-disabled'),options:[...e.options].map(o=>({value:o.value,text:o.textContent}))})),sprites:[...document.querySelectorAll('.eco-choice .eco-sprite')].map(e=>({label:e.getAttribute('aria-label'),style:e.style.backgroundImage})),fight:[...document.querySelectorAll('.eco-card__fight,.eco-dev__actions button:first-child')].map(e=>({disabled:e.disabled,text:e.textContent})),status:[...document.querySelectorAll('.eco-choice [role=status]')].map(e=>e.textContent),details:document.querySelector('.ebp-details')?.textContent});
window.review={state,nextTick,open:()=>layer.value.select(encounter.id),ack:m=>world.ecoBattleMessage('world:eco-combatant-state',m),message:(type,m)=>world.ecoBattleMessage(type,m),detach:()=>world.detach(),unmount:()=>{app.unmount();keys.detach()}};
`
await esbuild.build({
  stdin: {
    contents: entry,
    resolveDir: code,
    loader: 'ts',
    sourcefile: 'review-selector-native.ts',
  },
  bundle: true,
  format: 'iife',
  outfile: join(fixture, 'fixture.js'),
  define: { 'import.meta.env': JSON.stringify({ DEV: true, VITE_ECO_EXPERIMENT: 'on' }) },
  plugins: [
    {
      name: 'real-components',
      setup(build) {
        build.onLoad({ filter: /\.vue$/ }, async (args) => {
          const { descriptor } = sfc.parse(await readFile(args.path, 'utf8'), {
            filename: args.path,
          })
          const result = sfc.compileScript(descriptor, {
            id: 'review-selector',
            inlineTemplate: true,
          })
          return {
            contents:
              result.content +
              '\nconst css=document.createElement("style");css.textContent=' +
              JSON.stringify(descriptor.styles.map((s) => s.content).join('\n')) +
              ';document.head.append(css);',
            loader: 'ts',
            resolveDir: dirname(args.path),
          }
        })
      },
    },
  ],
})
await writeFile(
  join(fixture, 'fixture.html'),
  '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#253945}#layer{position:relative;height:700px;width:1000px}#map{position:fixed;left:650px;top:0;width:100px;height:40px;z-index:10000;background:#668}#other-controls{position:fixed;left:0;top:0;z-index:10000}</style><canvas id="map" tabindex="0"></canvas><div id="other-controls"><input id="chat" aria-label="Chat de prueba"><button id="other">Otro control</button></div><div id="layer"></div><script src="/fixture.js"></script>',
)
const http = createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0]
    if (req.method === 'POST' && url === '/select') {
      let body = ''
      for await (const chunk of req) body += chunk
      const payload = JSON.parse(body)
      const result = choice.select(actor, payload, client, client)
      serverRequests.push({ payload, result })
      // The driver releases the HTTP reply after pending-key/focus checks, never core timing.
      await new Promise((resolve) => replies.push(resolve))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
      return
    }
    const path =
      url === '/'
        ? join(fixture, 'fixture.html')
        : url === '/fixture.js'
          ? join(fixture, 'fixture.js')
          : /^\/assets\/overworld\/\d{4}\.png$/.test(url)
            ? join(code, 'public', url)
            : null
    if (!path) {
      res.writeHead(404)
      res.end()
      return
    }
    res.setHeader(
      'Content-Type',
      url.endsWith('.png')
        ? 'image/png'
        : url.endsWith('.js')
          ? 'text/javascript'
          : 'text/html; charset=utf-8',
    )
    res.end(await readFile(path))
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => http.listen(0, '127.0.0.1', r))
const port = http.address().port
const browser = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-pipe',
    '--user-data-dir=' + join(fixture, 'chrome-profile'),
  ],
  { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'], windowsHide: true },
)
let serial = 0,
  buffer = '',
  stderr = '',
  keyEvents = 0,
  version,
  evaluate,
  failure
const pending = new Map(),
  observed = []
browser.stderr.on('data', (b) => (stderr += b))
browser.stdio[4].on('data', (b) => {
  buffer += b
  let cut
  while ((cut = buffer.indexOf('\0')) >= 0) {
    const raw = buffer.slice(0, cut)
    buffer = buffer.slice(cut + 1)
    if (!raw) continue
    const m = JSON.parse(raw),
      p = pending.get(m.id)
    if (p) {
      clearTimeout(p.timer)
      pending.delete(m.id)
      if (m.error) p.reject(Error(JSON.stringify(m.error)))
      else p.resolve(m.result)
    }
  }
})
const call = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++serial,
      timer = setTimeout(() => {
        pending.delete(id)
        reject(Error('Timeout ' + method))
      }, 10000)
    pending.set(id, { resolve, reject, timer })
    browser.stdio[3].write(
      JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0',
    )
  })
try {
  version = await call('Browser.getVersion')
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
  await call('Page.enable', {}, sessionId)
  await call('Runtime.enable', {}, sessionId)
  await call('Page.navigate', { url: 'http://127.0.0.1:' + port }, sessionId)
  evaluate = async (expression) => {
    const r = await call(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    )
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  for (let i = 0; i < 100; i++) {
    if (await evaluate('!!window.review')) break
    await new Promise((r) => setTimeout(r, 30))
  }
  const run = (source) =>
    evaluate('(async()=>{' + source + ';await review.nextTick();return review.state()})()')
  const snapshot = async (label) => {
    const state = await evaluate('review.state()')
    // Keep assertions on full state; avoid duplicating the cumulative event/intent history.
    const { events, sent, selects, ...summary } = state
    observed.push({
      label,
      state: {
        ...summary,
        eventCount: events.length,
        lastEvent: events.at(-1),
        sentCount: sent.length,
        lastIntent: sent.at(-1),
        selects: selects.map(({ options, ...control }) => ({
          ...control,
          optionCount: options.length,
        })),
      },
    })
    return state
  }
  const edge = async (type, name, code, vk) => {
    await call(
      'Input.dispatchKeyEvent',
      {
        type,
        key: name,
        code,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
        ...(name === 'Enter'
          ? { text: '\r', unmodifiedText: '\r' }
          : name.length === 1
            ? { text: name, unmodifiedText: name }
            : {}),
      },
      sessionId,
    )
    keyEvents++
  }
  const key = async (name, code, vk) => {
    await edge('keyDown', name, code, vk)
    await edge('keyUp', name, code, vk)
  }
  const ack = (message) => run('review.ack(' + JSON.stringify(message) + ')')
  await run('review.open();document.querySelector(".eco-dev__toggle").click()')
  let s = await snapshot('no server acknowledgement')
  assert.equal(s.selects.length, 2)
  assert(s.selects.every((x) => x.disabled))
  assert(s.fight.every((x) => x.disabled))
  await ack(choice.state(actor.id))
  s = await snapshot('default confirmed by actual server service')
  assert(s.selects.every((x) => x.value === '25' && !x.disabled))
  assert(s.fight.every((x) => !x.disabled))
  assert.deepEqual(
    s.selects[0].options.map((o) => o.value),
    ['25', '19', '43', '74', '41', '10'],
  )
  const checks = []
  const confirmed = async (speciesId) => {
    for (let i = 0; replies.length === 0 && i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert(replies.length > 0, 'choice must reach server before acknowledgement')
    while (replies.length) replies.shift()()
    for (let i = 0; i < 100; i++) {
      const state = await evaluate('review.state()')
      if (
        state.selects.every(
          (x) => x.value === String(speciesId) && !x.disabled && x.ariaDisabled !== 'true',
        )
      )
        return state
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw Error('Timed out waiting for real server confirmation ' + speciesId)
  }
  for (const route of ['.eco-card select', '.eco-dev select']) {
    // Each route starts from actual server state; never changes the select value in script.
    choice.select(actor, { requestId: 1000 + checks.length, speciesId: 25 }, client, client)
    await ack(choice.state(actor.id))
    await run('document.querySelector(' + JSON.stringify(route) + ').focus()') // Once per route.
    for (const [index, [name, vk, speciesId]] of [
      ['ArrowDown', 40, 19],
      ['ArrowUp', 38, 25],
      ['ArrowDown', 40, 19],
      ['ArrowDown', 40, 43],
      ['ArrowUp', 38, 19],
      ['ArrowUp', 38, 25],
    ].entries()) {
      const before = await snapshot(route + ' before ' + name)
      await edge('keyDown', name, name, vk)
      const held = await snapshot(route + ' ' + name + ' held')
      assert.equal(held.direction, null, 'select must not move the map')
      assert.equal(held.interactions, before.interactions, 'select must not activate the map')
      assert.equal(held.events.at(-1).trusted, true)
      assert.equal(held.events.at(-1).prevented, false, 'native select default must be preserved')
      await edge('keyUp', name, name, vk)
      const waiting = await snapshot(route + ' pending after ' + name)
      assert.equal(waiting.focusRoute, route, 'pending must retain selector focus')
      assert(waiting.selects.every((x) => !x.disabled && x.ariaDisabled === 'true'))
      assert(waiting.selects.every((x) => x.value === before.selects[0].value))
      assert(waiting.fight.every((x) => x.disabled))
      // First Down -> ACK -> Up is uninterrupted; later choices also exercise pending keys.
      if (index >= 2) {
        for (const [pendingKey, vk] of [
          ['ArrowDown', 40],
          ['ArrowUp', 38],
        ]) {
          await edge('keyDown', pendingKey, pendingKey, vk)
          const during = await snapshot(route + ' pending ' + pendingKey + ' held')
          assert.equal(during.focusRoute, route)
          assert.equal(during.direction, null)
          assert.equal(during.interactions, before.interactions)
          assert.equal(during.sent.length, before.sent.length + 1)
          assert.equal(during.events.at(-1).trusted, true)
          assert.equal(during.events.at(-1).prevented, false)
          assert(during.selects.every((x) => x.value === before.selects[0].value))
          await edge('keyUp', pendingKey, pendingKey, vk)
        }
      }
      const after = await confirmed(speciesId)
      assert.equal(after.focusRoute, route, 'acknowledgement must retain selector focus')
      assert.equal(after.sent.length, before.sent.length + 1)
      assert.equal(after.sent.at(-1).type, M.ECO_COMBATANT_SELECT)
      assert.equal(after.sent.at(-1).payload.speciesId, speciesId)
      const received = serverRequests.find(
        (r) => r.payload.requestId === after.sent.at(-1).payload.requestId,
      )
      assert(received, 'choice must reach the isolated server')
      assert.equal(received.result.ok, true)
      assert.equal(received.result.speciesId, speciesId)
      assert.equal(choice.speciesOf(actor.id), speciesId)
      assert.equal(after.direction, null)
      await snapshot(route + ' ' + name + ' acknowledged by server')
      checks.push({ route, key: name, speciesId, requestId: received.payload.requestId })
    }
    const beforeEnter = await snapshot(route + ' before Enter')
    await key('Enter', 'Enter', 13)
    const enter = await snapshot(route + ' native Enter')
    assert.equal(enter.direction, null)
    assert.equal(enter.interactions, beforeEnter.interactions)
    assert.equal(enter.events.at(-1).key, 'Enter')
    assert.equal(enter.events.at(-1).trusted, true)
    assert.equal(enter.events.at(-1).prevented, false)
    assert.equal(enter.sent.length, beforeEnter.sent.length)
    // The native popup opened by Enter must still let arrows navigate, then Enter commit it.
    await key('ArrowDown', 'ArrowDown', 40)
    await key('Enter', 'Enter', 13)
    const committed = await confirmed(19)
    assert.equal(committed.focusRoute, route)
    assert.equal(committed.interactions, beforeEnter.interactions)
    assert.equal(committed.direction, null)
    assert.equal(choice.speciesOf(actor.id), 19)
    await snapshot(route + ' Enter committed native popup choice')
    checks.push({ route, key: 'Enter', nativeDefault: true, committedSpeciesId: 19 })

    for (const destination of ['chat', 'map', 'other']) {
      // Independent abandonment scenario: focus initially, then leave by trusted mouse click.
      await run('document.querySelector(' + JSON.stringify(route) + ').focus()')
      const beforeLeave = await snapshot(route + ' before leaving to ' + destination)
      await key('ArrowDown', 'ArrowDown', 40)
      assert.equal((await snapshot(route + ' before voluntary click')).focusRoute, route)
      const point = await evaluate(
        '(()=>{const r=document.getElementById(' +
          JSON.stringify(destination) +
          ').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
      )
      await call(
        'Input.dispatchMouseEvent',
        { type: 'mousePressed', ...point, button: 'left', clickCount: 1 },
        sessionId,
      )
      await call(
        'Input.dispatchMouseEvent',
        { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 },
        sessionId,
      )
      assert.equal(
        (await snapshot(route + ' voluntarily left to ' + destination)).focusId,
        destination,
      )
      const late = await confirmed(43)
      assert.equal(late.focusId, destination, 'late reply must never steal focus')
      assert.equal(late.sent.length, beforeLeave.sent.length + 1)
      await snapshot(route + ' late acknowledgement while at ' + destination)
      await key('ArrowUp', 'ArrowUp', 38)
      const outside = await snapshot(route + ' keyboard after leaving to ' + destination)
      assert.equal(outside.focusId, destination)
      assert.equal(outside.sent.length, late.sent.length)
      assert.equal(outside.interactions, beforeLeave.interactions)
      // Start the next independent scenario from a real confirmed Rattata state.
      choice.select(actor, { requestId: 2000 + checks.length, speciesId: 19 }, client, client)
      await ack(choice.state(actor.id))
      assert.equal((await snapshot(route + ' reset without restoring focus')).focusId, destination)
      checks.push({ route, destination, lateAcknowledgementRespectsFocus: true })
    }
  }
  // No listener detachment: the same real map keyboard must work once focus is elsewhere.
  await run('document.querySelector("#map").focus()')
  await edge('keyDown', 'ArrowDown', 'ArrowDown', 40)
  const mapDown = await snapshot('map ArrowDown held outside selector')
  assert.equal(mapDown.direction, 'down')
  assert.equal(mapDown.events.at(-1).prevented, true)
  await edge('keyUp', 'ArrowDown', 'ArrowDown', 40)
  assert.equal((await snapshot('map ArrowDown released')).direction, null)
  const beforeInteract = await evaluate('review.state()')
  await key(' ', 'Space', 32)
  assert.equal(
    (await snapshot('map native Space interact')).interactions,
    beforeInteract.interactions + 1,
  )
  checks.push({ route: '#map', movement: true, interact: true, listenerRetained: true })
  const image = await call(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true },
    sessionId,
  )
  await writeFile(join(evidence, 'selector-keyboard.png'), Buffer.from(image.data, 'base64'))
  await writeFile(
    join(evidence, 'selector-keyboard.json'),
    JSON.stringify(
      {
        pass: true,
        node: process.version,
        browser: version.product,
        nativeKeyEvents: keyEvents,
        nativeEvents: (await evaluate('review.state()')).events,
        checks,
        serverRequests,
        observed,
        limitations: [
          'One initial focus per continuous route, six successive choices without refocus, pending keydowns and native Enter. Independent voluntary-departure scenarios use trusted mouse clicks.',
          'Selection crosses HTTP to actual EcoCombatants and the existing prepared battle bundle. Colyseus transport is unchanged and its previous verification is retained.',
        ],
      },
      null,
      2,
    ),
  )
  console.log(
    'PASS native continuous choices, pending keys, voluntary focus departure, Enter and map',
  )
  await run('review.unmount()')
} catch (error) {
  try {
    failure = await evaluate?.('review.state()')
  } catch (snapshotError) {
    failure = { snapshotError: String(snapshotError) }
  }
  await writeFile(
    join(evidence, 'selector-native.json'),
    JSON.stringify(
      {
        pass: false,
        error: String(error.stack ?? error),
        browser: version?.product,
        keyEvents,
        observed,
        failure,
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  await writeFile(join(evidence, 'selector-browser-stderr.log'), stderr)
  try {
    await call('Browser.close')
  } catch {
    browser.kill()
  }
  await new Promise((r) => {
    if (browser.exitCode !== null || browser.signalCode !== null) r()
    else browser.once('exit', r)
  })
  http.closeAllConnections()
  await new Promise((r) => http.close(r))
  await writeFile(
    join(evidence, 'selector-cleanup.json'),
    JSON.stringify(
      {
        browserPid: browser.pid,
        browserExit: browser.exitCode,
        browserSignal: browser.signalCode,
        staticPort: port,
        staticServerClosed: !http.listening,
      },
      null,
      2,
    ),
  )
}
