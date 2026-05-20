/**
 * Asserts that the three target locales (en, fr, jp) have matching key sets
 * for every shared namespace JSON file. Catalogues any divergent keys so the
 * failure message points at the exact ns + key + missing locale(s).
 *
 * Plan C §C5.2: catalog, deployment, project must be key-parity across
 * en/fr/jp; we also enforce parity for every other shared namespace present
 * in the `en/` locale to prevent regressions.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const localesDir = path.resolve(here, '..', 'locales')
const LOCALES = ['en', 'fr', 'jp']

function listNs(locale) {
  return fs
    .readdirSync(path.join(localesDir, locale))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
}

function loadNs(locale, ns) {
  const filePath = path.join(localesDir, locale, `${ns}.json`)
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function flattenKeys(obj, prefix = '') {
  const keys = []
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) keys.push(prefix)
    return keys
  }
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, next))
    } else {
      keys.push(next)
    }
  }
  return keys
}

describe('i18n locale key parity', () => {
  it('ships the three canonical locales', () => {
    for (const loc of LOCALES) {
      expect(fs.existsSync(path.join(localesDir, loc))).toBe(true)
    }
  })

  it('has matching namespace file lists in en/fr/jp', () => {
    const enNs = listNs('en').sort()
    for (const loc of LOCALES.slice(1)) {
      const locNs = listNs(loc).sort()
      expect(locNs, `${loc} missing namespaces: ${enNs.filter((n) => !locNs.includes(n)).join(', ')}`).toEqual(enNs)
    }
  })

  const enNs = listNs('en')
  for (const ns of enNs) {
    it(`namespace ${ns}: every key present in every locale`, () => {
      const enKeys = new Set(flattenKeys(loadNs('en', ns)))
      for (const loc of LOCALES) {
        const locKeys = new Set(flattenKeys(loadNs(loc, ns)))
        // Find keys present in en but missing here, and vice versa
        const missingInLoc = [...enKeys].filter((k) => !locKeys.has(k))
        const extraInLoc = [...locKeys].filter((k) => !enKeys.has(k))
        expect(
          missingInLoc,
          `${loc}/${ns}.json missing keys: ${missingInLoc.join(', ')}`,
        ).toEqual([])
        expect(
          extraInLoc,
          `${loc}/${ns}.json extra keys not in en: ${extraInLoc.join(', ')}`,
        ).toEqual([])
      }
    })
  }

  describe('required keys per Plan C §C5.2', () => {
    it('catalog.json has required filter/verb/detail/empty keys', () => {
      for (const loc of LOCALES) {
        const ns = loadNs(loc, 'catalog')
        // Spec-required paths
        expect(ns.filters?.kind, `${loc}/catalog filters.kind`).toBeTruthy()
        expect(ns.filters?.source, `${loc}/catalog filters.source`).toBeTruthy()
        expect(ns.filters?.os, `${loc}/catalog filters.os`).toBeTruthy()
        expect(ns.filters?.difficulty, `${loc}/catalog filters.difficulty`).toBeTruthy()
        expect(ns.filters?.search, `${loc}/catalog filters.search`).toBeTruthy()
        expect(ns.verbs?.use, `${loc}/catalog verbs.use`).toBeTruthy()
        expect(ns.verbs?.customize, `${loc}/catalog verbs.customize`).toBeTruthy()
        expect(ns.verbs?.fork, `${loc}/catalog verbs.fork`).toBeTruthy()
        expect(ns.detail?.readme, `${loc}/catalog detail.readme`).toBeTruthy()
      }
    })

    it('deployment.json has list/detail/team/state/phase keys', () => {
      for (const loc of LOCALES) {
        const ns = loadNs(loc, 'deployment')
        expect(ns.list?.active, `${loc}/deployment list.active`).toBeTruthy()
        expect(ns.list?.past, `${loc}/deployment list.past`).toBeTruthy()
        expect(ns.detail?.overview, `${loc}/deployment detail.overview`).toBeTruthy()
        expect(ns.detail?.teams, `${loc}/deployment detail.teams`).toBeTruthy()
        expect(ns.detail?.logs, `${loc}/deployment detail.logs`).toBeTruthy()
        expect(ns.detail?.preflight, `${loc}/deployment detail.preflight`).toBeTruthy()
        expect(ns.detail?.cancel, `${loc}/deployment detail.cancel`).toBeTruthy()
        expect(ns.detail?.pause, `${loc}/deployment detail.pause`).toBeTruthy()
        expect(ns.detail?.teardown, `${loc}/deployment detail.teardown`).toBeTruthy()
        expect(ns.team?.reset, `${loc}/deployment team.reset`).toBeTruthy()
        expect(ns.team?.snapshot, `${loc}/deployment team.snapshot`).toBeTruthy()
        expect(ns.team?.rollback, `${loc}/deployment team.rollback`).toBeTruthy()
        expect(ns.team?.copy_ssh, `${loc}/deployment team.copy_ssh`).toBeTruthy()
        expect(ns.team?.open_terminal, `${loc}/deployment team.open_terminal`).toBeTruthy()
        const states = ['pending', 'preflight_running', 'preflight_review', 'deploying', 'completed', 'partial', 'failed', 'cancelled', 'unknown']
        for (const s of states) {
          expect(ns.states?.[s], `${loc}/deployment states.${s}`).toBeTruthy()
        }
        const phases = ['network', 'router', 'vm', 'install', 'configure', 'validate']
        for (const p of phases) {
          expect(ns.phases?.[p], `${loc}/deployment phases.${p}`).toBeTruthy()
        }
      }
    })

    it('project.json has tabs + problems + palette + fork/drift/save keys', () => {
      for (const loc of LOCALES) {
        const ns = loadNs(loc, 'project')
        const tabs = ['canvas', 'config', 'variables', 'history', 'settings', 'import']
        for (const t of tabs) {
          expect(ns.tabs?.[t], `${loc}/project tabs.${t}`).toBeTruthy()
        }
        expect(ns.problems?.title, `${loc}/project problems.title`).toBeTruthy()
        expect(ns.palette?.placeholder, `${loc}/project palette.placeholder`).toBeTruthy()
        expect(ns.fork_to_override?.action, `${loc}/project fork_to_override.action`).toBeTruthy()
        expect(ns.drift?.banner, `${loc}/project drift.banner`).toBeTruthy()
        expect(ns.save?.success, `${loc}/project save.success`).toBeTruthy()
        expect(ns.save?.pr_opened, `${loc}/project save.pr_opened`).toBeTruthy()
      }
    })
  })
})
