import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import App from './App'
import Toaster from './components/ui/Toaster'
import { TopProgress } from './components/ui/Skeleton'
import { installGlobalErrorReporting } from './lib/errorReporting'
import { queryClient } from './lib/queryClient'
import './index.css'
import './brand.css'

installGlobalErrorReporting()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <TopProgress />
        <App />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
