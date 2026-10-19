import { ref, type Ref } from 'vue'
import type { Router } from 'vue-router'

const recoveries = new WeakMap<Router, Ref<string>>()

/** Register before router installation so an initial lazy import is covered. */
export function installRouteRecovery(router: Router): Ref<string> {
  const existing = recoveries.get(router)
  if (existing) return existing
  const failedNavigation = ref('')
  recoveries.set(router, failedNavigation)
  router.onError((_error, to) => {
    const destination = new URL(router.resolve(to).href, window.location.href)
    if (destination.origin === window.location.origin) {
      failedNavigation.value = destination.pathname + destination.search + destination.hash
    }
  })
  router.afterEach((_to, _from, failure) => {
    if (!failure) failedNavigation.value = ''
  })
  return failedNavigation
}
