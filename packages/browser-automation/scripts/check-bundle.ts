/**
 * Post-build assertions on `dist/index.cjs`, chained into `pnpm build` so the
 * Dockerfile's build stage fails loudly instead of shipping an image whose
 * entrypoint dies on the first `require()`.
 *
 * The runtime stage copies only `package.json` and `dist/` (see Dockerfile), so
 * anything the bundle leaves external must be resolvable from the production
 * `node_modules` alone. A workspace package is not: its `exports` map points at
 * `.ts` sources that never reach the image. That failure is invisible to the
 * whole test suite — vitest resolves those specifiers itself and never looks at
 * the bundle — so it is asserted here, against the artifact that actually ships.
 */
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

const packageRoot = path.resolve(import.meta.dirname, '..')
const bundlePath = path.join(packageRoot, 'dist', 'index.cjs')

const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
}
// Mirrors rspack.config.ts: errore is ESM-only and must be bundled, so seeing
// it required at runtime is itself a defect.
const runtimeDependencies = new Set(
  Object.keys(manifest.dependencies ?? {}).filter((name) => name !== 'errore'),
)

function packageNameOf(request: string) {
  const segments = request.split('/')
  return request.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

function checkExternals(bundle: string) {
  const failures: string[] = []
  let requireCount = 0
  for (const [, , request] of bundle.matchAll(/require\((["'])([^"']+)\1\)/g)) {
    requireCount += 1
    if (request.startsWith('node:') || builtinModules.includes(request)) continue
    if (runtimeDependencies.has(packageNameOf(request))) continue
    failures.push(
      `dist/index.cjs externalizes "${request}", which is not a declared runtime dependency. ` +
        'Workspace packages must be bundled — the runtime image has no source tree to resolve them from.',
    )
  }
  // A bundle that requires nothing at all means this scan stopped matching the
  // emitted shape, not that everything is fine — playwright and find-my-way are
  // always external.
  if (requireCount === 0) {
    failures.push(
      'Found no require() calls in dist/index.cjs; the externals scan no longer matches the emitted output and is not checking anything.',
    )
  }
  return failures
}

type EvidenceInput = {
  url: string
  status: number
  server: string | null
  cfRay: string | null
  text: string | null
}
type Evidence = Record<string, unknown>

/**
 * `packages/widgets/passport-checker/browser/check.ts` splices this function's
 * *compiled* source into Chromium via `Function.prototype.toString()`, so it
 * must survive swc lowering and minification as a closed term: any leftover
 * reference to a module-scope binding — an swc helper, a hoisted literal — is a
 * `ReferenceError` in the page and nowhere else. Evaluating it in a bare realm
 * and calling it is the only check that actually proves that.
 */
/**
 * Compile-only parse probe. `new Function` compiles its body without running it,
 * so this asks the JavaScript parser "is this a complete expression?" and
 * nothing more. try/catch rather than errore: a SyntaxError here is the probe's
 * expected negative answer, not a failure to report.
 */
function parses(source: string) {
  try {
    new Function(`return (${source})`)
    return true
  } catch {
    return false
  }
}

/**
 * Reads `function <name>(...) { ... }` out of the bundle, letting the parser
 * find where the declaration ends. Counting braces by hand would have to
 * understand string literals *and* regex literals, and this particular body is
 * full of regexes containing quote characters (`["']?challenge-form["']?`) that
 * a naive string tracker mis-pairs. The first closing brace at which the slice
 * parses is the end of the function: any shorter prefix has unbalanced braces
 * and cannot parse. Returns null rather than guessing.
 */
function readFunctionDeclaration(bundle: string, name: string) {
  const declaration = new RegExp(`function\\s+${name.replace(/\$/g, '\\$')}\\s*\\(`).exec(bundle)
  if (!declaration) return null

  for (
    let index = bundle.indexOf('}', declaration.index);
    index !== -1;
    index = bundle.indexOf('}', index + 1)
  ) {
    const candidate = bundle.slice(declaration.index, index + 1)
    if (parses(candidate)) return candidate
  }
  return null
}

function extractSplicedEvidenceSource(bundle: string) {
  const marker = 'const evidenceFromResponseText = '
  const markerIndex = bundle.indexOf(marker)
  if (markerIndex === -1) {
    return new Error(
      `dist/index.cjs contains no "${marker}" splice site — the passport-checker page callback is missing from the bundle.`,
    )
  }
  const start = bundle.indexOf('.concat(', markerIndex)
  const end = bundle.indexOf('.toString()', start)
  if (start === -1 || end === -1 || end <= start) {
    return new Error(
      'Could not extract the spliced evidenceFromResponseText source from dist/index.cjs; the splice shape in check.ts changed.',
    )
  }
  const spliced = bundle.slice(start + '.concat('.length, end).trim()

  // The slice is the whole function expression only while swc inlines it, which
  // it stops doing the moment evidenceFromResponseText gains a second consumer —
  // precisely what the public `browser-automation/user-input/cloudflare` subpath
  // exists to allow. Then the splice site reads `<name>.toString()` and what the
  // page receives is that declaration's own source, so that is what must be
  // proven closed. Evaluating the bare identifier instead would raise a
  // ReferenceError and accuse a perfectly good bundle.
  if (!/^[A-Za-z_$][\w$]*$/.test(spliced)) return spliced

  const declaration = readFunctionDeclaration(bundle, spliced)
  if (declaration === null) {
    return new Error(
      `dist/index.cjs splices "${spliced}.toString()", but no "function ${spliced}(...)" declaration could be read out of the bundle. ` +
        'This is a gap in this check rather than evidence of a defect: teach extractSplicedEvidenceSource the shape the bundler now emits.',
    )
  }
  return declaration
}

/**
 * Realm boundary. `errore.try` cannot be used here: it rethrows any cause that
 * is not `instanceof Error`, and a ReferenceError raised inside the vm realm is
 * exactly that — a foreign-realm object the host `instanceof` does not match.
 * Catching it here is what turns "the splice is broken" into a reportable value
 * instead of an unhandled crash that hides the other findings.
 */
function inBareRealm<T>(what: string, run: () => T): Error | T {
  try {
    return run()
  } catch (cause) {
    return new Error(
      `${what} failed in a bare realm, so the compiled page callback is NOT self-contained and would throw once spliced into Chromium: ${String(cause)}`,
    )
  }
}

function checkSpliceIsSelfContained(bundle: string) {
  const source = extractSplicedEvidenceSource(bundle)
  if (source instanceof Error) return [source.message]

  // An empty context: the page's intrinsics exist, the bundle's module scope
  // does not. A helper or hoisted binding therefore throws here.
  const evidenceFromResponseText = inBareRealm(
    'Evaluating the spliced source',
    () => runInNewContext(`(${source})`, {}) as (input: EvidenceInput) => Evidence,
  )
  if (evidenceFromResponseText instanceof Error) return [evidenceFromResponseText.message]

  const challenge = `<html><head><title>Just a moment...</title></head><body>
    <script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/main.js"></script>
    <form id="challenge-form" action="/cdn-cgi/challenge-platform/h/b/orchestrate/">
    <input name="cf-chl-token" /></form></body></html>`

  const failures: string[] = []
  const matched = inBareRealm('Classifying a Cloudflare interstitial', () =>
    evidenceFromResponseText({
      url: 'https://example.test/solutions/checker',
      status: 403,
      server: 'cloudflare',
      cfRay: 'abc-KBP',
      text: challenge,
    }),
  )
  if (matched instanceof Error) return [matched.message]

  const expectedMatched = {
    url: 'https://example.test/solutions/checker',
    title: 'Just a moment...',
    status: 403,
    server: 'cloudflare',
    cfRay: 'abc-KBP',
    hasChallengeForm: true,
    hasChallengePlatform: true,
    hasChallengeContent: true,
  }
  for (const [key, expected] of Object.entries(expectedMatched)) {
    if (matched[key] !== expected) {
      failures.push(
        `Compiled evidenceFromResponseText returned ${key}=${JSON.stringify(matched[key])}, expected ${JSON.stringify(expected)}.`,
      )
    }
  }

  // Exercises the other side of every `text !== null` branch, so no branch can
  // hide an un-evaluated module-scope reference.
  const empty = inBareRealm('Classifying an empty response body', () =>
    evidenceFromResponseText({
      url: 'https://example.test/',
      status: 200,
      server: null,
      cfRay: null,
      text: null,
    }),
  )
  if (empty instanceof Error) {
    failures.push(empty.message)
    return failures
  }

  const expectedEmpty = {
    title: '',
    hasChallengeForm: false,
    hasChallengePlatform: false,
    hasChallengeContent: false,
  }
  for (const [key, expected] of Object.entries(expectedEmpty)) {
    if (empty[key] !== expected) {
      failures.push(
        `Compiled evidenceFromResponseText returned ${key}=${JSON.stringify(empty[key])} for a null body, expected ${JSON.stringify(expected)}.`,
      )
    }
  }
  return failures
}

const bundle = readFileSync(bundlePath, 'utf8')
const failures = [...checkExternals(bundle), ...checkSpliceIsSelfContained(bundle)]

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`)
  process.exitCode = 1
} else {
  console.log('✓ dist/index.cjs: externals declared, spliced page callback self-contained')
}
