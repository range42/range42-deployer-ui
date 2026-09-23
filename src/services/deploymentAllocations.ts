import { backendRequest } from './backendApi'

export interface DeploymentAllocation {
  deployment_id: string
  project_sha: string
  host_id: string
  node_name: string
  created_at: string
  assignments: Array<{
    vm_id: number
    vm_name?: string | null
    nics: Array<{ index: number; bridge: string; ip: string }>
  }>
}

const route = (id: string) => `/v1/deployments/${encodeURIComponent(id)}/allocations`
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0

function isAllocation(value: unknown, deploymentId: string): value is DeploymentAllocation {
  return record(value) && value.deployment_id === deploymentId
    && text(value.project_sha) && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value.project_sha)
    && text(value.host_id) && text(value.node_name) && text(value.created_at) && Number.isFinite(Date.parse(value.created_at))
    && Array.isArray(value.assignments) && value.assignments.length <= 4096
    && value.assignments.every(vm => record(vm) && Number.isInteger(vm.vm_id) && Number(vm.vm_id) >= 100
      && Number(vm.vm_id) <= 999999999 && (vm.vm_name == null || typeof vm.vm_name === 'string')
      && Array.isArray(vm.nics) && vm.nics.length <= 32
      && vm.nics.every((nic, index) => record(nic) && nic.index === index && text(nic.bridge) && text(nic.ip)))
}

/** Only a missing claim is absence; an unavailable endpoint is a read failure. */
export async function readDeploymentAllocation(deploymentId: string): Promise<DeploymentAllocation | null> {
  let result: unknown
  try { result = await backendRequest<unknown>(route(deploymentId)) }
  catch (cause) {
    if (record(cause) && cause.status === 404) {
      if (cause.code === 'ALLOCATION_NOT_FOUND') return null
      throw new Error(`${cause.message || 'Allocation status could not be read.'} Confirm the deployment exists and the selected backend supports deployment allocations.`)
    }
    throw cause
  }
  if (!isAllocation(result, deploymentId)) throw new Error('The backend returned an invalid allocation record. Refresh before releasing assignments.')
  return result
}

/** The backend verifies target binding, operation locks and independent VM absence. */
export async function releaseDeploymentAllocation(deploymentId: string): Promise<void> {
  await backendRequest<void>(route(deploymentId), { method: 'DELETE' })
}
