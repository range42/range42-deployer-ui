import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import ProjectEditor from '../views/ProjectEditor.vue'
import Settings from '../views/Settings.vue'
import CatalogList from '../views/CatalogList.vue'
import CatalogEntryDetail from '../views/CatalogEntryDetail.vue'
import DeploymentsList from '../views/DeploymentsList.vue'
import DeploymentDetail from '../views/DeploymentDetail.vue'
import DeploymentPreflight from '../views/DeploymentPreflight.vue'
import Sources from '../views/Sources.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: Home, meta: { title: 'Home' } },
    { path: '/catalog', name: 'catalog', component: CatalogList, meta: { title: 'Catalog' } },
    {
      path: '/catalog/:source/:entry',
      name: 'catalog-entry',
      component: CatalogEntryDetail,
      props: true,
      meta: { title: 'Catalog entry' },
    },
    {
      path: '/project/:id',
      name: 'project-editor',
      component: ProjectEditor,
      props: true,
      meta: { title: 'Project Editor' },
    },
    { path: '/deployments', name: 'deployments', component: DeploymentsList, meta: { title: 'Deployments' } },
    {
      path: '/deployments/:id',
      name: 'deployment-detail',
      component: DeploymentDetail,
      props: true,
      meta: { title: 'Deployment' },
    },
    {
      path: '/deployments/:id/preflight',
      name: 'deployment-preflight',
      component: DeploymentPreflight,
      props: true,
      meta: { title: 'Preflight' },
    },
    { path: '/sources', name: 'sources', component: Sources, meta: { title: 'Sources' } },
    { path: '/settings', name: 'settings', component: Settings, meta: { title: 'Settings' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} - Range42 Deployer` : 'Range42 Deployer'
})

export default router
