!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running GRABIX processes before install..."
  nsExec::Exec 'cmd /C taskkill /IM "GRABIX.exe" /F >nul 2>&1'
  Pop $0
  nsExec::Exec 'cmd /C taskkill /IM "grabix-ui.exe" /F >nul 2>&1'
  Pop $0
  nsExec::Exec 'cmd /C taskkill /IM "grabix-backend.exe" /F >nul 2>&1'
  Pop $0
  nsExec::Exec 'cmd /C taskkill /IM "aria2c.exe" /F >nul 2>&1'
  Pop $0
  nsExec::Exec 'cmd /C taskkill /IM "ffmpeg.exe" /F >nul 2>&1'
  Pop $0
  Sleep 1200
!macroend
