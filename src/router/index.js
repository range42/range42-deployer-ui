import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import ProjectEditor from '../views/ProjectEditor.vue'
import Settings from '../views/Settings.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: Dashboard,
      meta: {
        title: 'Dashboard'
      }
    },
    {
      path: '/project/:id',
      name: 'project-editor',
      component: ProjectEditor,
      props: true,
      meta: {
        title: 'Project Editor'
      }
    },
    {
      path: '/settings',
      name: 'settings',
      component: Settings,
      meta: {
        title: 'Settings'
      }
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ]
})

// Navigation guard for page titles
router.beforeEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} - Range42 Deployer` : 'Range42 Deployer'
})

export default router
