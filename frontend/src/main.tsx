import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AppRoutes } from '@/router'
import { seedDemoData, stampDbVersion, verifyDataIntegrity } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import { planStore } from '@/stores/planStore'
import { appStore } from '@/stores/appStore'
import '@/styles/index.css'

/** 启动：写入示例数据（仅首次）→ 记录 schemaVersion → 从 IndexedDB 水合全部 store → 校验数据完整性 */
async function bootstrap(): Promise<void> {
  await seedDemoData()
  await stampDbVersion()
  await Promise.all([
    orchardStore.getState().hydrate(),
    colonyStore.getState().hydrate(),
    droppointStore.getState().hydrate(),
    routeStore.getState().hydrate(),
    planStore.getState().hydrate()
  ])
  const integrity = await verifyDataIntegrity()
  appStore.getState().setIntegrity(integrity)
}

void bootstrap()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
)
