import { Route, Routes } from 'react-router-dom'

import { HealthCheck } from '@/routes/HealthCheck'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HealthCheck />} />
    </Routes>
  )
}
