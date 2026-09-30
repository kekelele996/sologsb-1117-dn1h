import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from '@/App'
import SchedulePage from '@/pages/SchedulePage'
import PlanPage from '@/pages/PlanPage'
import OrchardsPage from '@/pages/OrchardsPage'
import ColoniesPage from '@/pages/ColoniesPage'
import RoutesPage from '@/pages/RoutesPage'
import MergePage from '@/pages/MergePage'
import ExportPage from '@/pages/ExportPage'

/** 前端路由：/ /plans /orchards /colonies /routes /merge /export */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<SchedulePage />} />
        <Route path="/plans" element={<PlanPage />} />
        <Route path="/orchards" element={<OrchardsPage />} />
        <Route path="/colonies" element={<ColoniesPage />} />
        <Route path="/routes" element={<RoutesPage />} />
        <Route path="/merge" element={<MergePage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
