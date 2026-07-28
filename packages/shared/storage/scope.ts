/**
 * Storage keys are a persistence contract — never change how a key is derived without shipping a
 * data migration in the same release.
 *
 * A full key is `namespace + relativeKey`, where the namespace comes from the two functions below
 * and then passes through the `scopeWithColon` normalization in `makeHostRuntime`
 * (`packages/widget-runtime/src/host-runtime.ts`). Any edit to the scope prefix, the separator, the
 * `instanceId` / `typeId` values, or a widget's own `relativeKey` silently orphans every existing
 * record: deployed clients read the new key, get a 404, fall back to the empty default, and the old
 * data sits unreachable under the previous key in Valkey and IndexedDB.
 *
 * This already bit us once. Commit 0027a99 ("stop doubling the colon in scoped storage keys")
 * changed `w:t:<id>::` to `w:t:<id>:` and wiped every widget's shared and instance state on deploy;
 * the `root:`-scoped board survived only because its namespace never had the trailing colon.
 *
 * If a key shape must change, rename the old keys to the new ones in the same release, or the data
 * vanishes for users on the next deploy.
 */
export function instanceNamespace(instanceId: string): string {
  return `w:i:${instanceId}:`
}

export function typeNamespace(typeId: string): string {
  return `w:t:${typeId}:`
}

export function toFullKey(namespace: string, relativeKey: string): string {
  return namespace + relativeKey
}

export function toRelativeKey(namespace: string, fullKey: string): string {
  return fullKey.startsWith(namespace) ? fullKey.slice(namespace.length) : fullKey
}
