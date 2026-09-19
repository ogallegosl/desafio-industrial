import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import TeacherProtectedRoute from './components/TeacherProtectedRoute'
import StudentAttemptGuard from './components/StudentAttemptGuard'
import RouteFallback from './components/RouteFallback'

const PublicLayout = lazy(() => import('./layouts/PublicLayout'))
const TeacherLayout = lazy(() => import('./layouts/TeacherLayout'))
const StudentLayout = lazy(() => import('./layouts/StudentLayout'))
const HomePage = lazy(() => import('./pages/HomePage'))
const StudentAccessPage = lazy(() => import('./pages/StudentAccessPage'))
const ExamUnavailablePage = lazy(() => import('./pages/ExamUnavailablePage'))
const TeacherLoginPage = lazy(() => import('./pages/TeacherLoginPage'))
const TeacherDashboardPage = lazy(() => import('./pages/TeacherDashboardPage'))
const TeacherCoursesPage = lazy(() => import('./pages/TeacherCoursesPage'))
const TeacherQuestionBanksPage = lazy(() => import('./pages/TeacherQuestionBanksPage'))
const TeacherExamsPage = lazy(() => import('./pages/TeacherExamsPage'))
const TeacherExamEditorPage = lazy(() => import('./pages/TeacherExamEditorPage'))
const TeacherLiveMonitorPage = lazy(() => import('./pages/TeacherLiveMonitorPage'))
const TeacherResultsPage = lazy(() => import('./pages/TeacherResultsPage'))
const TeacherEvidencePage = lazy(() => import('./pages/TeacherEvidencePage'))
const TeacherManualGradingPage = lazy(() => import('./pages/TeacherManualGradingPage'))
const TeacherSettingsPage = lazy(() => import('./pages/TeacherSettingsPage'))
const StudentInstructionsPage = lazy(() => import('./pages/StudentInstructionsPage'))
const StudentExamPage = lazy(() => import('./pages/StudentExamPage'))
const StudentReviewPage = lazy(() => import('./pages/StudentReviewPage'))
const ExamFinishedPage = lazy(() => import('./pages/ExamFinishedPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/acceso" element={<StudentAccessPage />} />
          <Route path="/examen-no-disponible" element={<ExamUnavailablePage />} />
          <Route path="/docente/login" element={<TeacherLoginPage />} />
        </Route>

        <Route element={<TeacherProtectedRoute />}>
          <Route path="/docente" element={<TeacherLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<TeacherDashboardPage />} />
            <Route path="cursos" element={<TeacherCoursesPage />} />
            <Route path="bancos" element={<TeacherQuestionBanksPage />} />
            <Route path="examenes" element={<TeacherExamsPage />} />
            <Route path="examenes/nuevo" element={<TeacherExamEditorPage />} />
            <Route path="examenes/:examId/editar" element={<TeacherExamEditorPage />} />
            <Route path="examenes/:examId/monitoreo" element={<TeacherLiveMonitorPage />} />
            <Route path="resultados" element={<TeacherResultsPage />} />
            <Route path="evidencias" element={<TeacherEvidencePage />} />
            <Route path="calificacion" element={<TeacherManualGradingPage />} />
            <Route path="configuracion" element={<TeacherSettingsPage />} />
          </Route>
        </Route>

        <Route element={<StudentAttemptGuard />}>
          <Route path="/estudiante" element={<StudentLayout />}>
            <Route index element={<Navigate to="instrucciones" replace />} />
            <Route path="instrucciones" element={<StudentInstructionsPage />} />
            <Route path="examen" element={<StudentExamPage />} />
            <Route path="revisar" element={<StudentReviewPage />} />
            <Route path="finalizado" element={<ExamFinishedPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
