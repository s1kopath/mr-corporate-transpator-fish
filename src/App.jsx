import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const MODE_CONFIG = {
  corporateToPlain: {
    id: 'corporateToPlain',
    label: 'Corporate → Straight Talk',
    title: 'Corporate → Straight Talk',
    description: 'Decode polished corporate speak into what they really mean.',
  },
  plainToCorporate: {
    id: 'plainToCorporate',
    label: 'Straight Talk → Corporate',
    title: 'Straight Talk → Corporate',
    description: 'Polish casual requests into something HR-approved.',
  },
}

const getSpeechRecognition = () => {
  if (typeof window === 'undefined') return null
  return (
    window.SpeechRecognition ||
    window.webkitSpeechRecognition ||
    window.mozSpeechRecognition ||
    window.msSpeechRecognition ||
    null
  )
}

const MODEL_ID = 'Phi-3.5-mini-instruct-q4f16_1-MLC'

function App() {
  const [mode, setMode] = useState(MODE_CONFIG.corporateToPlain.id)
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState('')
  const [engineStatus, setEngineStatus] = useState({ state: 'idle', message: 'Warming up the fish brain...' })
  const [isTranslating, setIsTranslating] = useState(false)
  const [engineReloadToken, setEngineReloadToken] = useState(0)
  const [loadHint, setLoadHint] = useState('')

  const recognitionRef = useRef(null)
  const engineRef = useRef(null)
  const lastProgressRef = useRef({ value: 0, timestamp: Date.now() })
  const speechSupported = useMemo(() => Boolean(getSpeechRecognition()), [])

  useEffect(() => {
    const RecognitionCtor = getSpeechRecognition()
    if (!RecognitionCtor) return undefined

    const recognition = new RecognitionCtor()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? ''
      if (transcript) {
        setInput(transcript)
        setOutput('')
      }
    }

    recognition.onerror = () => {
      setIsListening(false)
      setError('Microphone hiccup — try again?')
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition

    return () => {
      recognition.stop()
    }
  }, [])

  useEffect(() => {
    if (typeof navigator !== 'undefined' && !navigator.gpu) {
      setEngineStatus({
        state: 'error',
        message: 'WebGPU not supported in this browser. Try Chrome 113+ or Edge 113+ on desktop.',
      })
      return
    }

    let isCancelled = false

    const loadEngine = async () => {
      setEngineStatus({ state: 'loading', message: 'Scooping an open-source brain for the fish...' })
      try {
        const { CreateMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm')
        const modelRecord = prebuiltAppConfig.model_list.find((candidate) => candidate.model_id === MODEL_ID)

        if (!modelRecord) {
          throw new Error(`Model ${MODEL_ID} is not available in the prebuilt model list.`)
        }

        const engine = await CreateMLCEngine(MODEL_ID, {
          initProgressCallback: (progress) => {
            if (!isCancelled) {
              const numericProgress =
                typeof progress.progress === 'number' && Number.isFinite(progress.progress) ? progress.progress : null
              if (numericProgress !== null) {
                lastProgressRef.current = { value: numericProgress, timestamp: Date.now() }
                if (numericProgress > 0.99) {
                  setLoadHint('Almost there… prepping the fish to talk.')
                } else {
                  setLoadHint('')
                }
              }
              const percentage = numericProgress !== null ? Math.round(numericProgress * 100) : null
              setEngineStatus({
                state: 'loading',
                message: percentage
                  ? `Loading fish brain… ${percentage}%`
                  : progress.text ?? 'Loading model...',
              })
            }
          },
          appConfig: {
            ...prebuiltAppConfig,
            model_list: prebuiltAppConfig.model_list.filter((candidate) => candidate.model_id === MODEL_ID),
          },
        })

        if (isCancelled) return

        engineRef.current = engine
        setEngineStatus({ state: 'ready', message: 'Fish is ready to translate!' })
        setLoadHint('')
      } catch (err) {
        if (!isCancelled) {
          setEngineStatus({
            state: 'error',
            message:
              err instanceof Error
                ? `Could not load the open-source model: ${err.message}`
                : 'Could not load the open-source model.',
          })
          setLoadHint('')
        }
      }
    }

    if (!engineRef.current) {
      loadEngine()
    }

    return () => {
      isCancelled = true
      const engine = engineRef.current
      if (engine) {
        engineRef.current = null
        if (typeof engine.unload === 'function') {
          engine.unload().catch(() => { })
        }
      }
    }
  }, [engineReloadToken])

  useEffect(() => {
    if (engineStatus.state !== 'loading') {
      if (engineStatus.state === 'ready') {
        setLoadHint('')
      }
      return
    }

    const interval = setInterval(() => {
      const { value, timestamp } = lastProgressRef.current
      if (engineStatus.state === 'loading' && Date.now() - timestamp > 20000 && value < 1) {
        setLoadHint((current) =>
          current ||
          'Download is taking longer than usual. Check your connection or VPN — the fish needs to reach Hugging Face.',
        )
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [engineStatus.state])

  const handleToggleMode = (value) => {
    setMode(value)
    setOutput('')
    setError('')
  }

  const handleMicClick = () => {
    if (!speechSupported || !recognitionRef.current) return

    setError('')
    if (isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
      return
    }

    try {
      recognitionRef.current.start()
      setIsListening(true)
      setInput('')
    } catch {
      setError('Unable to access the mic right now.')
      setIsListening(false)
    }
  }

  const buildPrompt = (text, translationMode) => {
    if (translationMode === MODE_CONFIG.corporateToPlain.id) {
      return [
        {
          role: 'system',
          content:
            'You are a playful but candid corporate jargon translator. You convert formal HR-approved statements into short, punchy plain-speak that keeps the core message intact. Include a wink of humor, but stay respectful and concise (one or two sentences).',
        },
        {
          role: 'user',
          content: `Corporate statement:\n"""${text.trim()}"""\n\nTranslate into straight talk that reveals what the speaker really means.`,
        },
      ]
    }

    return [
      {
        role: 'system',
        content:
          'You are a friendly corporate communications assistant. You take casual or blunt statements and rewrite them into polished, professional corporate language. The result should sound empathetic, respectful, and HR-friendly while keeping the original intent. Aim for one or two sentences.',
      },
      {
        role: 'user',
        content: `Casual statement:\n"""${text.trim()}"""\n\nRewrite this as a polished corporate message.`,
      },
    ]
  }

  const handleTranslate = async () => {
    setError('')
    if (!input.trim()) {
      setError('Tell the fish something first!')
      return
    }
    if (engineStatus.state !== 'ready' || !engineRef.current) {
      setError(engineStatus.state === 'error' ? engineStatus.message : 'Fish brain is still loading…')
      return
    }

    setIsTranslating(true)
    setOutput('')
    try {
      const response = await engineRef.current.chat.completions.create({
        messages: buildPrompt(input, mode),
        max_tokens: 160,
        temperature: mode === MODE_CONFIG.corporateToPlain.id ? 0.65 : 0.55,
        top_p: 0.9,
      })
      const message = response.choices?.[0]?.message?.content?.trim() ?? ''
      if (!message) {
        setError('The fish is speechless. Try again?')
        return
      }
      setOutput(message)
    } catch (err) {
      setError(
        err instanceof Error ? `The fish swallowed a bubble: ${err.message}` : 'The fish is having trouble translating.',
      )
    } finally {
      setIsTranslating(false)
    }
  }

  const activeMode = MODE_CONFIG[mode]

  return (
    <div className="app">
      <header className="app__header">
        <h1>Mr. Translator</h1>
        <p>Let the fish decode corporate lingo — both ways.</p>
      </header>

      <main className="app__content">
        <section className="mode-toggle" role="radiogroup" aria-label="Translation direction">
          {Object.values(MODE_CONFIG).map((modeOption) => (
            <button
              key={modeOption.id}
              className={`mode-toggle__button ${mode === modeOption.id ? 'mode-toggle__button--active' : ''}`}
              onClick={() => handleToggleMode(modeOption.id)}
              role="radio"
              aria-checked={mode === modeOption.id}
            >
              {modeOption.label}
            </button>
          ))}
        </section>

        <section className="fishbowl">
          <div className="fishbowl__bubble">
            {output ? <p>{output}</p> : <p>{activeMode.description}</p>}
          </div>

          <div className={`fishbowl__bowl ${isListening ? 'fishbowl__bowl--listening' : ''}`}>
            <div className="fishbowl__water">
              <div className={`fish ${isListening ? 'fish--listening' : ''}`}>🐟</div>
              <div className="bubbles">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>

          <button
            className={`mic-button ${isListening ? 'mic-button--active' : ''}`}
            onClick={handleMicClick}
            disabled={!speechSupported || isTranslating}
          >
            {isListening ? 'Listening…' : speechSupported ? 'Talk to the Fish' : 'Mic not supported'}
          </button>

          <div className="engine-status">
            {engineStatus.state === 'loading' && <span>{engineStatus.message}</span>}
            {engineStatus.state === 'ready' && <span className="engine-status__ready">🐟 {engineStatus.message}</span>}
            {engineStatus.state === 'error' && (
              <span className="engine-status__error">
                ⚠️ {engineStatus.message}{' '}
                <button
                  type="button"
                  className="engine-status__retry"
                  onClick={() => {
                    engineRef.current = null
                    lastProgressRef.current = { value: 0, timestamp: Date.now() }
                    setEngineStatus({ state: 'loading', message: 'Scooping an open-source brain for the fish...' })
                    setLoadHint('')
                    setEngineReloadToken((token) => token + 1)
                  }}
                >
                  Retry
                </button>
              </span>
            )}
          </div>
          {engineStatus.state === 'loading' && loadHint && <div className="engine-hint">{loadHint}</div>}
          {engineStatus.state === 'error' && (
            <div className="engine-hint">
              If it keeps failing, confirm your browser supports WebGPU and that downloads from{' '}
              <a
                href="https://huggingface.co/mlc-ai/Phi-3.5-mini-instruct-q4f16_1-MLC"
                target="_blank"
                rel="noreferrer"
              >
                Hugging Face
              </a>{' '}
              are allowed on your network.
            </div>
          )}
        </section>

        <section className="translator">
          <label htmlFor="user-input" className="translator__label">
            Say it your way:
          </label>
          <textarea
            id="user-input"
            className="translator__input"
            placeholder="e.g. “We can’t approve vacation right now.”"
            rows={4}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />

          <div className="translator__actions">
            <button
              className="translate-button"
              onClick={handleTranslate}
              disabled={isTranslating || engineStatus.state !== 'ready'}
            >
              {isTranslating ? 'Translating…' : engineStatus.state !== 'ready' ? 'Please wait…' : 'Translate'}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setInput('')
                setOutput('')
                setError('')
              }}
            >
              Reset
            </button>
          </div>

          {error && <p className="translator__error">{error}</p>}
          {isTranslating && <p className="translator__hint">The fish is thinking…</p>}
        </section>
      </main>

      <footer className="app__footer">
        <small>
          Powered by a witty fish. Real AI brains coming soon.
        </small>
      </footer>
    </div>
  )
}

export default App
