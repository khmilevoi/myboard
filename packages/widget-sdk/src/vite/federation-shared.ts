import { readFileSync } from 'node:fs'

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as PackageJson

/** Minimal parser for the flat `catalog:` block in pnpm-workspace.yaml.
 *  Kept dependency-free because this file runs inside every vite.config.ts. */
function catalogVersions() {
  const text = readFileSync(new URL('../../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === 'catalog:')
  const versions: Record<string, string> = {}

  if (start === -1) return versions

  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^ {2}['"]?([^:'"]+?)['"]?:\s*['"]?([^'"\s]+)['"]?\s*$/)
    if (!match) break
    versions[match[1]] = match[2]
  }

  return versions
}

const catalog = catalogVersions()

function dependencyVersion(name: string) {
  const raw = packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name]
  if (!raw) {
    throw new Error(`widget-sdk package.json is missing a version for shared dependency ${name}`)
  }
  if (raw.startsWith('catalog:')) {
    const version = catalog[name]
    if (!version) {
      throw new Error(`pnpm-workspace.yaml catalog is missing shared dependency ${name}`)
    }
    return version
  }
  return raw
}

function singleton(name: string) {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: dependencyVersion(name),
  }
}

export function federationShared() {
  return {
    react: singleton('react'),
    'react-dom': singleton('react-dom'),
    '@reatom/core': singleton('@reatom/core'),
    '@reatom/react': singleton('@reatom/react'),
    'widget-runtime': singleton('widget-runtime'),
    zod: singleton('zod'),
    errore: singleton('errore'),
  } as Record<string, ReturnType<typeof singleton>>
}
