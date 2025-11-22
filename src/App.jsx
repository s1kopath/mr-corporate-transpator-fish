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

// Using a fast, available model from Hugging Face Inference Providers
// You can change this to any model available on HF Inference Providers
const MODEL_ID = 'meta-llama/Llama-3.2-3B-Instruct:fastest'
const HF_API_BASE = 'https://router.huggingface.co/v1'

function App() {
  const [mode, setMode] = useState(MODE_CONFIG.corporateToPlain.id)
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState('')
  const [isTranslating, setIsTranslating] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const speechSynthesisRef = useRef(null)
  const [hfToken, setHfToken] = useState(() => {
    // First try environment variable (for production/build)
    // Vite exposes env vars prefixed with VITE_ to the client
    const envToken = import.meta.env.VITE_HF_TOKEN
    if (envToken) return envToken

    // Fallback to localStorage (for development/testing)
    return localStorage.getItem('hf_token') || ''
  })
  const [showTokenInput, setShowTokenInput] = useState(() => {
    // Don't show token input if env var is set
    return !import.meta.env.VITE_HF_TOKEN && !localStorage.getItem('hf_token')
  })

  const recognitionRef = useRef(null)
  const speechInputRef = useRef(false) // Track if input came from speech recognition
  const speechSupported = useMemo(() => Boolean(getSpeechRecognition()), [])

  // Cleanup speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (speechSynthesisRef.current) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

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
        speechInputRef.current = true // Mark that this input came from speech
        setInput(transcript)
        setOutput('')
        // Store transcript for auto-translate
        recognitionRef.current.lastTranscript = transcript
      }
    }

    recognition.onerror = () => {
      setIsListening(false)
      speechInputRef.current = false
      recognitionRef.current.lastTranscript = null
      setError('Microphone hiccup — try again?')
    }

    recognition.onend = () => {
      setIsListening(false)
      // Auto-translate if input came from speech recognition
      const transcript = recognitionRef.current?.lastTranscript
      if (speechInputRef.current && transcript && transcript.trim()) {
        // Pass transcript directly to avoid state timing issues
        setTimeout(() => {
          handleTranslate(transcript)
        }, 100)
      }
      speechInputRef.current = false
      recognitionRef.current.lastTranscript = null
    }

    recognitionRef.current = recognition

    return () => {
      recognition.stop()
    }
  }, [])

  // Save token to localStorage when it changes (only if not using env var)
  useEffect(() => {
    const envToken = import.meta.env.VITE_HF_TOKEN
    // Only save to localStorage if not using env variable
    if (!envToken) {
      if (hfToken) {
        localStorage.setItem('hf_token', hfToken)
        setShowTokenInput(false)
      } else {
        localStorage.removeItem('hf_token')
      }
    } else {
      // If env var is set, hide token input
      setShowTokenInput(false)
    }
  }, [hfToken])

  const playTranslation = (text) => {
    // Stop any ongoing speech
    if (speechSynthesisRef.current) {
      window.speechSynthesis.cancel()
    }

    if (!('speechSynthesis' in window)) {
      alert('Text-to-speech not supported in this browser')
      return
    }

    setIsSpeaking(true)
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.95 // Slightly slower for more natural speech
    utterance.pitch = 1.0
    utterance.volume = 0.9

    utterance.onend = () => {
      setIsSpeaking(false)
      speechSynthesisRef.current = null
    }

    utterance.onerror = () => {
      setIsSpeaking(false)
      speechSynthesisRef.current = null
    }

    speechSynthesisRef.current = utterance
    window.speechSynthesis.speak(utterance)
  }

  const stopSpeaking = () => {
    if (speechSynthesisRef.current) {
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
      speechSynthesisRef.current = null
    }
  }

  const handleToggleMode = (value) => {
    setMode(value)
    setOutput('')
    setError('')
    stopSpeaking()
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
      speechInputRef.current = false // Reset flag
      recognitionRef.current.start()
      setIsListening(true)
      setInput('')
      setOutput('')
    } catch {
      setError('Unable to access the mic right now.')
      setIsListening(false)
      speechInputRef.current = false
    }
  }

  const buildPrompt = (text, translationMode) => {
    if (translationMode === MODE_CONFIG.corporateToPlain.id) {
      return [
        {
          role: 'system',
          content:
            'You are a friendly, conversational translator who converts corporate jargon into natural, human-sounding plain English. Write like a real person would speak - use contractions, natural phrasing, and a warm but direct tone. Keep it concise (1-2 sentences) and make it sound like you\'re explaining it to a friend, not a robot. Avoid phrases like "Here\'s the deal:" or overly structured responses.',
        },
        {
          role: 'user',
          content: `Translate this corporate statement into natural, human-sounding plain English:\n"""${text.trim()}"""\n\nWrite it like a real person would say it in conversation.`,
        },
      ]
    }

    return [
      {
        role: 'system',
        content:
          'You are a warm, professional corporate communications assistant. Transform casual or blunt statements into polished, empathetic corporate language that sounds genuinely human and caring - not robotic or template-like. Use natural phrasing, appropriate warmth, and make it sound like a real person wrote it, not an AI template. Keep it concise (1-2 sentences) and authentic.',
      },
      {
        role: 'user',
        content: `Rewrite this casual statement as a warm, professional corporate message that sounds genuinely human:\n"""${text.trim()}"""\n\nMake it sound like a real person wrote it, not a template.`,
      },
    ]
  }

  const handleTranslate = async (textToTranslate = null) => {
    setError('')
    // Use provided text or fall back to input state
    const text = textToTranslate || input
    if (!text || !text.trim()) {
      setError('Tell the fish something first!')
      return
    }
    const token = import.meta.env.VITE_HF_TOKEN || hfToken
    if (!token) {
      setError('Please enter your Hugging Face token first!')
      setShowTokenInput(true)
      return
    }

    setIsTranslating(true)
    setOutput('')
    try {
      const response = await fetch(`${HF_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_HF_TOKEN || hfToken}`,
        },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: buildPrompt(text, mode),
          max_tokens: 200,
          temperature: mode === MODE_CONFIG.corporateToPlain.id ? 0.8 : 0.75,
          top_p: 0.95,
          stream: false,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }))
        throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      const message = data.choices?.[0]?.message?.content?.trim() ?? ''
      if (!message) {
        setError('The fish is speechless. Try again?')
        return
      }
      setOutput(message)
      // Auto-play the translation with text-to-speech
      playTranslation(message)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(`The fish swallowed a bubble: ${errorMessage}`)
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

        {!showTokenInput && (
          <>
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
                {output ? (
                  <div>
                    <p>{output}</p>
                    {output && (
                      <button
                        className="speech-button"
                        onClick={() => isSpeaking ? stopSpeaking() : playTranslation(output)}
                        title={isSpeaking ? 'Stop speaking' : 'Play translation'}
                      >
                        {isSpeaking ? '🔇 Stop' : '🔊 Play'}
                      </button>
                    )}
                  </div>
                ) : (
                  <p>{activeMode.description}</p>
                )}
              </div>
              <div className={`fishbowl__bowl ${isListening ? 'fishbowl__bowl--listening' : ''} ${isSpeaking ? 'fishbowl__bowl--speaking' : ''}`}>
                <div className="fishbowl__water">
                  <div className={`fish ${isListening ? 'fish--listening' : ''} ${isSpeaking ? 'fish--speaking' : ''}`}>
                    <div className="fish__body">🐟</div>
                    {isSpeaking && (
                      <div className="fish__mouth">
                        <span className="fish__mouth-open"></span>
                      </div>
                    )}
                  </div>
                  <div className="bubbles">
                    <span />
                    <span />
                    <span />
                  </div>
                  {isSpeaking && (
                    <div className="speech-bubbles">
                      <span className="speech-bubble speech-bubble--1" />
                      <span className="speech-bubble speech-bubble--2" />
                      <span className="speech-bubble speech-bubble--3" />
                      <span className="speech-bubble speech-bubble--4" />
                    </div>
                  )}
                </div>
              </div>

              <button
                className={`mic-button ${isListening ? 'mic-button--active' : ''}`}
                onClick={handleMicClick}
                disabled={!speechSupported || isTranslating}
              >
                {isListening ? 'Listening…' : speechSupported ? 'Talk to the Fish' : 'Mic not supported'}
              </button>
            </section>
          </>
        )}

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
            onChange={(event) => {
              speechInputRef.current = false // Mark as manual input
              setInput(event.target.value)
            }}
          />

          <div className="translator__actions">
            <button
              className="translate-button"
              type="button"
              onClick={(e) => {
                e.preventDefault()
                handleTranslate()
              }}
              disabled={isTranslating}
            >
              {isTranslating ? 'Translating…' : 'Translate'}
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
          Powered by{' '}
          <a href="https://huggingface.co/docs/inference-providers" target="_blank" rel="noreferrer">
            Hugging Face Inference Providers
          </a>
          . No local model downloads needed!
        </small>
      </footer>
    </div>
  )
}

export default App
