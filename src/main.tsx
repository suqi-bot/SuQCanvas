import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { IS_DESKTOP_BUILD } from './buildMode'

if (IS_DESKTOP_BUILD) document.title = 'SuQCanvas 桌面版'

createRoot(document.getElementById('root')!).render(<App />)
