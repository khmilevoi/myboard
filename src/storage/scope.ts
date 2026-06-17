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
