/**
 * YAML round-trip helpers built on eemeli's `yaml` package.
 *
 * Why a thin wrapper: we want comment-preserving edits when the user saves
 * a YAML file from the config tab. `parseDocument` keeps comments + quoting,
 * and `doc.toString()` with `lineWidth: 0` round-trips them byte-identical
 * for unchanged regions.
 *
 * `hasAnchorsOrAliases` is intentionally **synchronous** — `visit` is
 * imported at the top of this module (NOT via dynamic import). The
 * callback-style visitor walks the full tree synchronously and returns
 * once traversal completes. ConfigTab relies on this being a sync check so
 * the anchor warning banner renders on the same tick as the parse.
 */

import {
  parseDocument,
  visit,
  isAlias,
  isScalar,
  type Document,
} from 'yaml'

export function parseYamlDoc(source: string): Document {
  return parseDocument(source, { prettyErrors: true })
}

export function stringifyYamlDoc(doc: Document): string {
  return doc.toString({ lineWidth: 0, defaultStringType: 'PLAIN' })
}

export function hasAnchorsOrAliases(doc: Document): boolean {
  let found = false
  visit(doc, {
    Alias() {
      if (isAlias) found = true
      else found = true
    },
    Scalar(_key, node) {
      if (isScalar(node) && (node as unknown as { anchor?: string }).anchor) {
        found = true
      }
    },
    Map(_key, node) {
      if ((node as unknown as { anchor?: string }).anchor) found = true
    },
    Seq(_key, node) {
      if ((node as unknown as { anchor?: string }).anchor) found = true
    },
  })
  return found
}
