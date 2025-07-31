import { createRouter, createWebHistory } from 'vue-router'
import ProjectView from '@/pages/ProjectView.vue'
import InventoryView from '@/pages/InventoryView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/project'
    },
    {
      path: '/project',
      name: 'project',
      component: ProjectView
    },
    {
      path: '/inventory',
      name: 'inventory',
      component: InventoryView
    }
  ],
})

export default router
