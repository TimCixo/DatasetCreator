import { useEffect } from 'react'
import { useProjectStore } from './stores/useProjectStore'
import { useUIStore } from './stores/useUIStore'
import { STAGE_LABELS, STAGES } from './lib/constants'
import { ImportStage } from './components/stages/ImportStage'
import { SimilarityReviewStage } from './components/stages/SimilarityReviewStage'
import { CleanupStage } from './components/stages/CleanupStage'
import { CropStage } from './components/stages/CropStage'
import { AugmentationStage } from './components/stages/AugmentationStage'
import { FinalReviewStage } from './components/stages/FinalReviewStage'
import { TaggingStage } from './components/stages/TaggingStage'
import { ExportStage } from './components/stages/ExportStage'
import './App.css'

function App() {
  const currentStage = useProjectStore((state) => state.currentStage)
  const setCurrentStage = useProjectStore((state) => state.setCurrentStage)
  const initializeProject = useProjectStore((state) => state.initializeProject)
  const sourceImages = useProjectStore((state) => Object.values(state.sourceImages))
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
    const targetIndex = STAGES.indexOf(stageName as any)
    // Allow going back, only allow forward if images are present for next stage
    if (targetIndex <= currentStageIndex || (targetIndex === 1 && sourceImages.length > 0)) {
      setCurrentStage(stageName as any)
    }
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
          {STAGES.map((stage, index) => {
            const isAccessible = index <= currentStageIndex || (index === 1 && sourceImages.length > 0)
            return (
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
                  ${!isAccessible ? 'opacity-50 cursor-not-allowed' : ''}
                `}
                disabled={!isAccessible}
              >
                <span className="flex items-center gap-2">
                  <span className="text-xs w-5 h-5 rounded-full border border-current flex items-center justify-center">
                    {index + 1}
                  </span>
                  {STAGE_LABELS[stage]}
                </span>
              </button>
            )
          })}
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
            {currentStage === 'import' && <ImportStage />}
            {currentStage === 'select' && <SimilarityReviewStage />}
            {currentStage === 'clean' && <CleanupStage />}
            {currentStage === 'crop' && <CropStage />}
            {currentStage === 'augment' && <AugmentationStage />}
            {currentStage === 'review' && <FinalReviewStage />}
            {currentStage === 'tagging' && <TaggingStage />}
            {currentStage === 'export' && <ExportStage />}
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
