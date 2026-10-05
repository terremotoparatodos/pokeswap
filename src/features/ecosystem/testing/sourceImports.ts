// Real import references of a source file, for the ecosystem isolation guards
// (ECO-2B). Test tooling only: never imported by runtime code.
//
// Uses the TypeScript scanner (`preProcessFile`), so it sees exactly the
// module references the language sees — static imports, `import type`,
// re-exports, `import('literal')` and `require('literal')` — and ignores
// comments and ordinary string literals. A fixture string such as
// "import { x } from 'vue'" inside a test is NOT an import.

import ts from 'typescript'

/** Script blocks of a Vue SFC; the template is not code. */
function scriptOf(fileName: string, source: string): string {
  if (!fileName.endsWith('.vue')) return source
  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n')
}

export function importSpecifiers(fileName: string, source: string): string[] {
  const info = ts.preProcessFile(scriptOf(fileName, source), true, true)
  return info.importedFiles.map(file => file.fileName)
}

/**
 * Resolves a specifier to a repo path (forward slashes) when it is relative or
 * uses the app's `@/` alias; package imports return null.
 */
export function resolveSpecifier(fromFile: string, spec: string, repoRoot: string): string | null {
  const root = repoRoot.replace(/\\/g, '/').replace(/\/$/, '')
  if (spec.startsWith('@/')) return normalise(`${root}/src/${spec.slice(2)}`)
  if (!spec.startsWith('.')) return null
  const dir = fromFile.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
  return normalise(`${dir}/${spec}`)
}

function normalise(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.') out.push(part)
  }
  return out.join('/')
}
