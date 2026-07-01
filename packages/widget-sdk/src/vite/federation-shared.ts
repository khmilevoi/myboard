import { readFileSync } from 'node:fs'

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as PackageJson

function dependencyVersion(name: string) {
  const version = packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name]
  if (!version) {
    throw new Error(`widget-sdk package.json is missing a version for shared dependency ${name}`)
  }
  return version
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
  } as Record<string, ReturnType<typeof singleton>>
}
