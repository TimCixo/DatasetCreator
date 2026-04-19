import { useEffect } from 'react'
import { useProjectStore } from './stores/useProjectStore'
import { useUIStore } from './stores/useUIStore'
import { STAGE_LABELS, STAGES } from './lib/constants'
import './App.css'

function App() {
  const { currentStage, setCurrentStage, initializeProject } = useProjectStore()
  const { darkMode, setDarkMode } = useUIStore()

  useEffect(() => {
    // Initialize project on first load
    initializeProject('My Dataset')
    
    // Set dark mode based on system preference or stored value
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    setDarkMode(prefersDark)
  }, [])

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  const currentStageIndex = STAGES.indexOf(currentStage as any)

  const goToStage = (stageName: string) => {
    setCurrentStage(stageName as any)
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar Navigation */}
      <aside className="w-56 border-r border-border bg-card p-6 overflow-y-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Dataset Creator</h1>
          <p className="text-sm text-muted-foreground mt-1">SD Training Preparation</p>
        </div>

        <nav className="space-y-2">
          {STAGES.map((stage, index) => (
            <button
              key={stage}
              onClick={() => goToStage(stage)}
              className={`
                w-full text-left px-4 py-2 rounded-md text-sm font-medium
                transition-colors duration-200
                ${
                  stage === currentStage
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-secondary text-foreground'
                }
                ${index > currentStageIndex ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              disabled={index > currentStageIndex}
            >
              <span className="flex items-center gap-2">
                <span className="text-xs w-5 h-5 rounded-full border border-current flex items-center justify-center">
                  {index + 1}
                </span>
                {STAGE_LABELS[stage]}
              </span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">{STAGE_LABELS[currentStage]}</h2>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-md hover:bg-secondary transition-colors"
              title={darkMode ? 'Light mode' : 'Dark mode'}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
          </div>
        </header>

        {/* Stage Content */}
        <div className="flex-1 overflow-auto">
          <div className="p-6">
            <div className="h-96 flex items-center justify-center rounded-lg border-2 border-dashed border-border bg-secondary/50">
              <p className="text-muted-foreground text-center">
                Stage: <span className="font-semibold">{STAGE_LABELS[currentStage]}</span>
                <br />
                Components coming next...
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
