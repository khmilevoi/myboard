import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import * as errore from 'errore'
import type { Plugin } from 'vite'

export class WidgetAssetsIoError extends errore.createTaggedError({
  name: 'WidgetAssetsIoError',
  message: 'Failed to $operation widget build assets at $path',
}) {}

export class MissingWidgetBuildError extends errore.createTaggedError({
  name: 'MissingWidgetBuildError',
  message: 'Widget $widgetId has no production build at $path',
}) {}

type CopyWidgetBuildsOptions = {
  widgetsDir: string
  outDir: string
}

type StageWidgetBuildsOptions = Omit<CopyWidgetBuildsOptions, 'outDir'>

function discoverWidgetIds(widgetsDir: string) {
  const entries = errore.try({
    try: () => readdirSync(widgetsDir, { withFileTypes: true }),
    catch: (cause) => new WidgetAssetsIoError({ operation: 'discover', path: widgetsDir, cause }),
  })
  if (entries instanceof Error) return entries

  return (
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((widgetId) => existsSync(resolve(widgetsDir, widgetId, 'package.json')))
      // A widget is a federation remote (and thus needs a staged dist/) only if
      // it exposes ./client, same criterion scripts/codegen/client.ts uses to
      // decide which widgets get a client-catalog entry. A package that hasn't
      // reached that stage yet (e.g. a browser-task-only widget mid-rollout,
      // like passport-checker before its UI landed) has a package.json but no
      // client.ts, no vite build script, and never produces a dist/ — without
      // this filter every host build fails on it with MissingWidgetBuildError.
      .filter((widgetId) => existsSync(resolve(widgetsDir, widgetId, 'client.ts')))
      .sort((a, b) => a.localeCompare(b))
  )
}

export function copyWidgetBuilds({ widgetsDir, outDir }: CopyWidgetBuildsOptions) {
  const widgetIds = discoverWidgetIds(widgetsDir)
  if (widgetIds instanceof Error) return widgetIds

  const stagedWidgetsDir = resolve(outDir, 'widgets')
  const cleanResult = errore.try({
    try: () => {
      rmSync(stagedWidgetsDir, { recursive: true, force: true })
      mkdirSync(stagedWidgetsDir, { recursive: true })
    },
    catch: (cause) =>
      new WidgetAssetsIoError({ operation: 'clean', path: stagedWidgetsDir, cause }),
  })
  if (cleanResult instanceof Error) return cleanResult

  for (const widgetId of widgetIds) {
    const source = resolve(widgetsDir, widgetId, 'dist')
    if (!existsSync(source)) return new MissingWidgetBuildError({ widgetId, path: source })

    const target = resolve(stagedWidgetsDir, widgetId)
    const copyResult = errore.try({
      try: () => cpSync(source, target, { recursive: true }),
      catch: (cause) => new WidgetAssetsIoError({ operation: 'copy', path: source, cause }),
    })
    if (copyResult instanceof Error) return copyResult
  }

  return widgetIds
}

export function stageWidgetBuilds({ widgetsDir }: StageWidgetBuildsOptions): Plugin {
  return {
    name: 'stage-widget-builds',
    apply: 'build',
    writeBundle(outputOptions) {
      if (!outputOptions.dir) throw new Error('Vite did not provide a build output directory')

      const result = copyWidgetBuilds({ widgetsDir, outDir: outputOptions.dir })
      if (result instanceof Error) {
        throw new Error('Failed to stage widget builds in the host artifact', { cause: result })
      }
    },
  }
}
