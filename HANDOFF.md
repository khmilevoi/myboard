# Handoff — passport-checker widget stuck on the loading skeleton

**Status:** root cause confirmed, fix written and committed. Device verification still open.

**Where the work happens:** `./.worktrees/widget-controls` (branch `feat/widget-controls`,
HEAD `b5ea2a72`). The main checkout is on `dev` and must not be edited.

---

## Goal

The `passport-checker` widget never leaves the loading state on the reporter's Android phone at
`board-branch.iiskelo.com`. The board renders, `clock` and `ofelia-poop-duty` mount fine, and the
same build works on desktop Chrome. Diagnose, then fix.

---

## Root cause (confirmed)

`@novnc/novnc@1.7.0` → `node_modules/@novnc/novnc/core/util/browser.js` runs a **module-scope
top-level await**:

```js
supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();
```

That probe does not merely feature-detect. It constructs a real `VideoDecoder`, configures it for
1920x1080 `avc1.42401f`, decodes an embedded frame and `await decoder.flush()`. On the phone that
promise never settles; on desktop it resolves in milliseconds.

Because the await is top-level, every module that statically imports novnc stays forever in
"evaluating", and so did everything importing it:

```
ui/PassportChecker.tsx:11  ->  model/rfb.ts:1  ->  @novnc/novnc  ->  core/util/browser.js
```

Consequence chain: `import('./ui/PassportChecker')` never settles → `React.lazy` never gets a
payload → `<Suspense>` in `packages/client/src/widget-host/ui/WidgetFrame.tsx:136` keeps rendering
`WidgetLoadingCard` forever. No error is thrown anywhere, so no error boundary fires.

### Evidence backing this

- On the phone, `definition.loadComponent()` hangs while `loadRemote('passport-checker/client')`
  returns `['default','passportCheckerWidget']` — the hang is strictly inside the widget's own
  `import()`, not in Module Federation.
- Importing every chunk under `/widgets/passport-checker/assets/` one by one: all 17 return `ok`,
  **only** `PassportChecker-B-N52Foc.js` hangs. All 7 of its static imports resolve. No dynamic ones.
- `grep` of the built chunk: `avc1.42401f`, `VideoDecoder`, `EncodedVideoChunk`,
  `optimizeForLatency` each appear exactly once, and only in that chunk.
- `performance.getEntriesByType('resource')` on the phone: all 20 passport assets finished by
  ~1600 ms. FPS ≈ 91 on a 120 Hz screen — the main thread is idle, it waits on a browser API.
- The server never receives `w:t:passport-checker:lastResult`, i.e. React never committed the
  component. `w:t:ofelia-poop-duty:ledger` *is* requested.

---

## The fix (committed as `b5ea2a72`)

`fix(passport-checker): load noVNC lazily so the widget can mount`

- **`model/load-rfb.ts` (new)** — the only module allowed to reach `./rfb`, and only through a
  dynamic `import()`. Owns `RfbLoadError` and `LoadRfb`, converting the rejection to a value at the
  boundary (errore).
- **`model/recovery-model.ts`** — the option is now `loadRfb: LoadRfb`, awaited via
  `Promise.all([transport.issue(widgetId), loadRfb()])`. Parallel is safe: `capability.ts`'s
  `isBusy()` counts only a live socket, and `issue()` supersedes an unused token, so a capability
  this attempt never consumes costs nothing. Still exactly one await and one `isStale()` check
  before the synchronous `makeRfb`/`setInterval` block.
- **New state `viewerUnavailable`** — a viewer that fails to load now shows
  «Не удалось загрузить noVNC» with the reconnect button instead of an endless spinner
  (`ui/parts/NoVncCanvas.tsx`).
- **`ui/PassportChecker.tsx`** — passes `loadRfb: loadNoVncRfb`.
- **`ui/passport-checker-novnc-graph.test.ts` (new)** — mocks `@novnc/novnc` and asserts importing
  `./PassportChecker` never evaluates it. Proven to go red (`expected 1 to be +0`) when the static
  import is put back.

### Verified

- `pnpm --filter widgets-passport-checker test` — 153 passed, 7 skipped; no `act()` warnings
  (the two synchronous Radix-stack tests now await a flush, since the lazy load shifts the
  `issuing -> connecting` transition by a few microtasks).
- `pnpm test` — whole workspace green.
- `pnpm test:e2e:docker` — 27 passed (1.4m), exit 0.
- `pnpm typecheck`, `pnpm lint` — clean.
- `pnpm format:check` — the only offender is `CLAUDE.md`, pre-existing on this branch (it predates
  `ed209ba0`, which took markdown out of oxfmt on `dev`).
- **Built output** (`pnpm --filter widgets-passport-checker build`): `avc1.42401f` /
  `EncodedVideoChunk` now appear only in `rfb-CFZRGaYX.js` (187 kB, split out); the widget chunk
  `PassportChecker-BsSPHMfD.js` (29 kB) has zero novnc markers, and its only reference to that
  chunk in the entire build is `import(\`./rfb-CFZRGaYX.js\`)` — no static importer anywhere.

---

## Next steps

1. **Verify on the device, not just locally.** The stall is device-specific; the green local run
   proves the bundle split, not the phone. After `pnpm run deploy:branch`, bust the phone's service
   worker before judging (memory `branch-deploy-browser-verification`), then confirm the card mounts
   and that the server receives `w:t:passport-checker:lastResult`.
2. **Optional, separate task — host-level safety net.** A chunk that never settles still yields a
   skeleton forever for *any* widget, with no way to tell "loading" from "dead". Consider a deadline
   on the lazy load in `WidgetFrame` that flips to the error card with a retry. Commit `c96f89c8`
   already made the loading card deletable, a partial mitigation of the same trap.
3. **Optional, unrelated defect found on the way.** `packages/client/src/app/model/pwa.ts:17` passes
   `onNeedRefresh`, but `vite.config.ts:146` sets `registerType: 'autoUpdate'`. In
   `vite-plugin-pwa@1.3.0` (`dist/client/build/register.js`) the `onNeedRefresh` branch is only
   registered when `auto === false`, and `applyUpdate()` → `updateServiceWorker()` does nothing in
   auto mode. So `needRefreshAtom` and `UpdateBanner` (`app/ui/App.tsx:25`) are dead code — the user
   has no manual update affordance.

---

## Diagnostic method worth reusing

1. **Split the load chain in the device console.** `loadRemote(id + '/client')` vs
   `definition.loadComponent()` isolates Module Federation from the widget's own import. MF caches
   promises by key, so a second call returns the *same* pending promise as the live mount — the
   probe measures the real failure, not a fresh attempt.
2. **Import every already-fetched chunk individually**, driven off
   `performance.getEntriesByType('resource')`. Resolved modules answer instantly, stuck ones stay
   stuck. The one chunk that hangs while all of its imports return `ok` is a top-level-await stall
   inside that chunk.
3. **Compare a local build's content hash against what the stand serves** — proves the deployed
   widget code equals branch HEAD without shell access to the Pi.
4. `rpi env ls` gives `LAST DEPLOY` as a unix timestamp.
5. `rpi logs myboard--branch --tail N` (positional project name, **not** `--env`) surfaces the nginx
   access log.

## What did NOT work — do not redo these

- **"The stand is stale / the deploy predates the fix."** Deploy was newer than both commits and the
  widget chunk hash matched a local build of HEAD.
- **"The phone runs an old cached build."** `_WidgetLoadingCard` appeared in the phone's stack and
  its host bundle was `main-DELTl9O9.js` — the current one.
- **"The vite preload helper hangs awaiting the stylesheet `load` event."** Resource timing shows the
  CSS completed, and the helper's module-level seen-map makes the second call skip the CSS branch.
- **"React scheduler livelock / branded-promise `lazy()` loop."** The repeated `ie → postMessage → ae`
  frames are Chrome async-stack tagging, not a loop: FPS 91, exactly one loading card in the DOM.
- **"A shared module never finishes negotiating."** All six `loadShare` virtual modules return `ok`.
- **Dumping `shareScopeMap` with `s.loaded` / `s.loading`** — those field names do not exist in this
  MF version; it prints `-` for every package on every instance, including widgets that work.
- **`registerType: 'autoUpdate'` + stale service worker.** The SW passes real network responses
  through (a 404 was observed as `(from service worker)`).
- **Reproducing at a phone viewport with the Chrome extension.** `resize_window` does not change the
  tab's viewport (`innerWidth` stayed 1280).

---

## Handy console probes (run on the affected device)

Split the chain:

```js
(async()=>{
 const inst=globalThis.__FEDERATION__.__INSTANCES__[0];
 const race=(p,ms)=>Promise.race([Promise.resolve(p).then(v=>['ok',v],e=>['err',e]),new Promise(r=>setTimeout(()=>r(['HANG']),ms))]);
 const [s1,m]=await race(inst.loadRemote('passport-checker/client'),8000);
 console.log('loadRemote',s1,m&&Object.keys(m));
 if(s1!=='ok') return;
 console.log('loadComponent',...await race((m.default??m).loadComponent(),8000));
})()
```

Find the stuck chunk:

```js
(async()=>{
 const race=(p,ms)=>Promise.race([Promise.resolve(p).then(()=>'ok  ',()=>'err '),new Promise(r=>setTimeout(()=>r('HANG'),ms))]);
 for(const f of performance.getEntriesByType('resource').map(e=>e.name)
   .filter(n=>n.includes('/passport-checker/assets/')&&n.endsWith('.js')))
  console.log(await race(import(f),4000), f.split('/').pop().slice(0,70));
})()
```

Confirm which half of the novnc probe stalls (still not run — would prove the device theory
directly, and after the fix it should only ever affect the recovery modal):

```js
(async()=>{const t=performance.now();
 const r=await Promise.race([
  VideoDecoder.isConfigSupported({codec:'avc1.42401f',codedWidth:1920,codedHeight:1080,optimizeForLatency:true})
   .then(x=>'supported:'+x.supported,e=>'err:'+e),
  new Promise(r=>setTimeout(()=>r('HANG'),5000))]);
 console.log(r,Math.round(performance.now()-t)+'ms')})()
```
