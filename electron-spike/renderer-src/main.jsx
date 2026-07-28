import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import AudioConcurrencySpike from './AudioConcurrencySpike.jsx'
import './styles/onda.css'

function isAudioSpikeHash(hash = window.location.hash) {
  return hash === '#audio-concurrency-spike' || hash === '#/audio-concurrency-spike'
}

function Root() {
  const [spike, setSpike] = useState(() => isAudioSpikeHash())

  useEffect(() => {
    function onHash() {
      setSpike(isAudioSpikeHash())
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return spike ? <AudioConcurrencySpike /> : <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)