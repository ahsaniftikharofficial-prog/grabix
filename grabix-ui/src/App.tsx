import { useState, useEffect, useRef } from "react";
import { ThemeProvider } from "./context/ThemeContext";
import Sidebar, { type Page } from "./components/Sidebar";
import DownloaderPage from "./pages/DownloaderPage";
import LibraryPage from "./pages/LibraryPage";
import BrowsePage from "./pages/BrowsePage";
import QueuePage from "./pages/QueuePage";
import SettingsPage from "./pages/SettingsPage";
import { type QueueItem } from "./types/queue";
import "./index.css";

const API = "http://127.0.0.1:8000";

function Inner() {
  const [page, setPage] = useState<Page>("downloader");
  const [backendOk, setBackendOk] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    fetch(`${API}/`)
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
  }, []);

  const activeDownloads = queue.filter(
    q => q.status === "downloading" || q.status === "queued" || q.status === "processing"
  ).length;

  const PAGES: Record<Page, React.ReactNode> = {
    downloader: <DownloaderPage queue={queue} setQueue={setQueue} pollingRef={pollingRef} />,
    queue:      <QueuePage queue={queue} setQueue={setQueue} />,
    library:    <LibraryPage />,
    browse:     <BrowsePage />,
    settings:   <SettingsPage />,
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <Sidebar
        page={page}
        setPage={setPage}
        activeDownloads={activeDownloads}
        backendOk={backendOk}
      />
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--bg-app)" }}>
        {PAGES[page]}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Inner />
    </ThemeProvider>
  );
}
