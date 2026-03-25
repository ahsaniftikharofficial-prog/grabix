import React, { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import HomePage from './pages/HomePage'
import DownloaderPage from './pages/DownloaderPage'
import QueuePage from './pages/QueuePage'
import LibraryPage from './pages/LibraryPage'
import AnimePage from './pages/AnimePage'
import MoviesPage from './pages/MoviesPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const [page, setPage] = useState('home')
  const [theme, setTheme] = useState('dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  const props = { theme, onToggleTheme: toggleTheme, onNav: setPage }

  const pages = {
    home: <HomePage {...props} />,
    downloader: <DownloaderPage {...props} />,
    queue: <QueuePage {...props} />,
    library: <LibraryPage {...props} />,
    anime: <AnimePage {...props} />,
    movies: <MoviesPage {...props} />,
    settings: <SettingsPage {...props} />,
  }

  return (
    <div className="layout">
      <Sidebar active={page} onNav={setPage} />
      <main className="main-content">
        {pages[page] || pages.home}
      </main>
    </div>
  )
}
