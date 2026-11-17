import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installErrorReporting, reportError } from './net/errorReport'

installErrorReporting()

// iOS home-screen apps with a translucent status bar report CSS viewport units
// (vh, dvh) short by the status bar's height, leaving a black strip at the
// bottom. The window's own height is right, so size the app from that.
const syncAppHeight = () => document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`)
syncAppHeight()
window.addEventListener('resize', syncAppHeight)
window.visualViewport?.addEventListener('resize', syncAppHeight)
window.addEventListener('orientationchange', () => setTimeout(syncAppHeight, 300))

// A component that throws is reported with the components it was rendering in.
const reactError = (error: unknown, info: { componentStack?: string }) =>
  reportError('react', error, { componentStack: info.componentStack?.slice(0, 4000) })

createRoot(document.getElementById('root')!, { onUncaughtError: reactError, onCaughtError: reactError }).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
