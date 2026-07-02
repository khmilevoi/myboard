/**
 * Collapse the shared Reatom context stack down to its oldest root frame.
 *
 * Reatom v1001 already shares its context stack between duplicate copies of
 * `@reatom/core` via `globalThis.__REATOM.stackFrames` (same-version copies —
 * different versions throw at import). But every copy's module side effect
 * unconditionally pushes ITS OWN fresh root frame (`STACK.push(context.start())`),
 * burying the root that owns all atom state created so far. In a federation
 * host this happens the moment a widget remote whose share-scope negotiation
 * fell back to a bundled copy is imported: the host's board/storage atoms stay
 * in the old root while everything that runs afterwards reads a new, empty one
 * — a split-brain (widget storage subscriptions never connect, deliveries go
 * to a context nobody reads).
 *
 * Dropping the younger import-time roots makes every copy operate over the
 * oldest root's store: the stack array itself is shared, frames are plain
 * objects, and each atom is always processed by the copy that created it, so
 * same-version copies interoperate safely over one root.
 *
 * Deliberately reads `globalThis.__REATOM` instead of importing `@reatom/core`:
 * the caller may be bundled with any of the copies, and the fix must target
 * the shared structure, not one copy's view of it.
 *
 * Call it after a remote's module graph finished loading (its import-time push
 * already happened) and before any of its atoms are first read — e.g. right
 * after the federation `loadComponent` promise resolves.
 */
export function ensureSingleReatomRoot(): void {
  const frames = (globalThis as { __REATOM?: { stackFrames?: unknown[] } }).__REATOM?.stackFrames
  if (!Array.isArray(frames) || frames.length < 2) return

  // A root frame is its own root: `context.start` sets `frame.root = frame.state`.
  const isRoot = (frame: unknown): boolean => {
    if (typeof frame !== 'object' || frame === null) return false
    const { root, state } = frame as { root?: unknown; state?: unknown }
    return root !== undefined && root === state
  }

  // Only collapse a run of root frames sitting on top of the oldest root.
  // A non-root top means we are inside an atom computation — leave it alone.
  while (frames.length > 1 && isRoot(frames[frames.length - 1]) && isRoot(frames[0])) {
    frames.pop()
  }
}
