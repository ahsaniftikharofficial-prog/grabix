!macro NSIS_HOOK_PREINSTALL
  ; PyO3 edition: grabix-backend.exe no longer exists as a child process.
  ; Python is embedded inside GRABIX.exe — killing GRABIX.exe is enough.
  DetailPrint "Stopping running GRABIX processes before install..."
  nsExec::Exec 'cmd /C taskkill /IM "GRABIX.exe" /F >nul 2>&1'
  Pop $0
  nsExec::Exec 'cmd /C taskkill /IM "grabix-ui.exe" /F >nul 2>&1'
  Pop $0
  ; aria2c and ffmpeg are download tools — kill any lingering instances
  nsExec::Exec 'cmd /C taskkill /IM "aria2c.exe" /F >nul 2>&1'
  Pop $0
  nsExec::Exec 'cmd /C taskkill /IM "ffmpeg.exe" /F >nul 2>&1'
  Pop $0
  Sleep 1200
!macroend
