import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from '@/App'
import SchedulePage from '@/pages/SchedulePage'
import SeasonPlansPage from '@/pages/SeasonPlansPage'
import OrchardsPage from '@/pages/OrchardsPage'
import ColoniesPage from '@/pages/ColoniesPage'
import RoutesPage from '@/pages/RoutesPage'
import SyncPage from '@/pages/SyncPage'
import ExportPage from '@/pages/ExportPage'

/** 前端路由：/ /plans /orchards /colonies /routes /sync /export */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<SchedulePage />} />
        <Route path="/plans" element={<SeasonPlansPage />} />
        <Route path="/orchards" element={<OrchardsPage />} />
        <Route path="/colonies" element={<ColoniesPage />} />
        <Route path="/routes" element={<RoutesPage />} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
