import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { StudentAttemptProvider } from './contexts/StudentAttemptContext'
import { GlobalSettingsProvider } from './contexts/GlobalSettingsContext'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <GlobalSettingsProvider>
        <AuthProvider>
          <StudentAttemptProvider>
            <App />
          </StudentAttemptProvider>
        </AuthProvider>
      </GlobalSettingsProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
