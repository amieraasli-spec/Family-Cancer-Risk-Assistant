import { useMemo, useState } from 'react'
import { t } from './i18n/strings.js'
import { BRANDING } from './config/branding.js'
import { assessAll } from './lib/riskEngine.js'

import DisclaimerGate from './components/DisclaimerGate.jsx'
import Stepper from './components/Stepper.jsx'
import EmergencyBanner from './components/EmergencyBanner.jsx'
import Landing from './components/Landing.jsx'
import StepProfile from './components/StepProfile.jsx'
import StepFamilyHistory from './components/StepFamilyHistory.jsx'
import StepInherited from './components/StepInherited.jsx'
import StepResults from './components/StepResults.jsx'
import SymptomCheck from './components/SymptomCheck.jsx'
import PrintableSummary from './components/PrintableSummary.jsx'
import StepFeedback from './components/StepFeedback.jsx'
import NotebookPanel from './components/NotebookPanel.jsx'
import QuizPanel from './components/QuizPanel.jsx'
import RegistryData from './components/RegistryData.jsx'
import GuidelinesChat from './components/GuidelinesChat.jsx'

/**
 * Application shell.
 *
 * SESSION-ONLY STATE: everything the user enters lives in React state and
 * nowhere else. No localStorage, no sessionStorage, no cookie, no network call
 * carrying answers. Closing the tab destroys it — which is what the entry gate
 * promises, so it has to stay true.
 */
const VIEWS = { HOME: 'home', FLOW: 'flow', NOTEBOOK: 'notebook', QUIZ: 'quiz', DATA: 'data' }

const EMPTY_PROFILE = { age: '', sex: '', ethnicity: '', state: '', smoking: '' }

export default function App () {
  const [lang, setLang] = useState('en')
  const [accepted, setAccepted] = useState(false)
  const [view, setView] = useState(VIEWS.HOME)
  const [step, setStep] = useState(0)

  const [profile, setProfile] = useState(EMPTY_PROFILE)
  const [relatives, setRelatives] = useState([])
  const [inherited, setInherited] = useState([])
  const [flagged, setFlagged] = useState([])
  const [showSummary, setShowSummary] = useState(false)

  const results = useMemo(
    () => (profile.sex ? assessAll(profile, relatives.filter(r => r.cancer), inherited) : []),
    [profile, relatives, inherited]
  )

  function goHome () {
    setView(VIEWS.HOME)
    setStep(0)
    setShowSummary(false)
  }

  function restart () {
    setProfile(EMPTY_PROFILE)
    setRelatives([])
    setInherited([])
    setFlagged([])
    goHome()
  }

  function print () {
    setShowSummary(true)
    requestAnimationFrame(() => window.print())
  }

  if (!accepted) {
    return (
      <>
        <TopBar lang={lang} setLang={setLang} onHome={null} />
        <DisclaimerGate lang={lang} onAccept={() => setAccepted(true)} />
      </>
    )
  }

  return (
    <>
      <TopBar lang={lang} setLang={setLang} onHome={view === VIEWS.HOME ? null : goHome} />

      <main className="shell">
        {view === VIEWS.HOME && (
          <>
            <Landing
              lang={lang}
              onStart={() => { setView(VIEWS.FLOW); setStep(0) }}
              onOpen={key => setView(
                key === 'notebook' ? VIEWS.NOTEBOOK : key === 'quiz' ? VIEWS.QUIZ : VIEWS.DATA
              )}
            />
            <EmergencyBanner lang={lang} />
          </>
        )}

        {view === VIEWS.NOTEBOOK && (
          <>
            <NotebookPanel lang={lang} />
            <GuidelinesChat lang={lang} />
          </>
        )}

        {view === VIEWS.QUIZ && <QuizPanel lang={lang} />}

        {view === VIEWS.DATA && <RegistryData lang={lang} />}

        {view === VIEWS.FLOW && (
          <>
            <Stepper lang={lang} current={step} />

            {step === 0 && (
              <StepProfile
                lang={lang}
                profile={profile}
                onChange={setProfile}
                onNext={() => setStep(1)}
              />
            )}

            {step === 1 && (
              <StepFamilyHistory
                lang={lang}
                relatives={relatives}
                onChange={setRelatives}
                onNext={() => setStep(2)}
                onBack={() => setStep(0)}
              />
            )}

            {step === 2 && (
              <StepInherited
                lang={lang}
                selected={inherited}
                onChange={setInherited}
                onNext={() => setStep(3)}
                onBack={() => setStep(1)}
              />
            )}

            {step === 3 && (
              <StepResults
                lang={lang}
                results={results}
                onPrint={print}
                onNext={() => setStep(4)}
                onBack={() => setStep(2)}
              >
                <SymptomCheck
                  lang={lang}
                  moduleIds={results.map(r => r.moduleId)}
                  flagged={flagged}
                  onChange={setFlagged}
                />
                {showSummary && (
                  <PrintableSummary
                    lang={lang}
                    profile={profile}
                    relatives={relatives}
                    results={results}
                    flagged={flagged}
                  />
                )}
              </StepResults>
            )}

            {step === 4 && (
              <StepFeedback lang={lang} onBack={() => setStep(3)} onHome={restart} />
            )}

            <EmergencyBanner lang={lang} />
          </>
        )}

        <footer className="foot no-print">
          <p>
            {BRANDING.appName} v{BRANDING.version} · {BRANDING.author} · {BRANDING.institution},{' '}
            {BRANDING.ministry}
          </p>
          <p>{BRANDING.summaryFooter}</p>
        </footer>
      </main>
    </>
  )
}

function TopBar ({ lang, setLang, onHome }) {
  return (
    <header className="topbar no-print">
      <span className="brand">
        {lang === 'bm' ? BRANDING.appNameBm : BRANDING.appName}
      </span>
      {onHome && <button onClick={onHome}>⌂ {t('home', lang)}</button>}
      <button onClick={() => setLang(l => (l === 'en' ? 'bm' : 'en'))}>
        {t('langToggle', lang)}
      </button>
    </header>
  )
}
