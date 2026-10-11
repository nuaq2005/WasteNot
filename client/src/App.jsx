// src/App.jsx
import { useState } from 'react'
import CheckFridge from './pages/CheckFridge.jsx'
import ScanReceipt from './pages/ScanReceipt.jsx'
import Health from './pages/Health.jsx'
import Vitals from './pages/Vitals.jsx'
import './App.css'


const tabs = [
  { id: 'fridge', label: 'Check Fridge', Component: CheckFridge },
  { id: 'receipt', label: 'Scan Receipt', Component: ScanReceipt },
  { id: 'health', label: 'Health', Component: Health },
  { id: 'vitals', label: 'Vitals', Component: Vitals },
]

function App() {
  const [active, setActive] = useState('fridge')
  const { Component } = tabs.find((t) => t.id === active)

  return (
    <>
      <header className="app-header">
        <h1 className="app-title">WasteNot</h1>
        <p className="app-subtitle">Cook smart. Spend wisely. Waste less.</p>
      </header>
      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === active ? 'tab active' : 'tab'}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="page-container">
        <Component />
      </main>
    </>
  )
}

export default App
