!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running GRABIX processes before install..."
  nsExec::Exec 'cmd /C taskkill /IM "GRABIX.exe" /F >nul 2>&1'
  Pop $0
  nsExec::Exec 'cmd /C taskkill /IM "grabix-ui.exe" /F >nul 2>&1'
  Pop $0
  nsExec::Exec 'cmd /C taskkill /IM "aria2c.exe" /F >nul 2>&1'
  Pop $0
  nsExec::Exec 'cmd /C taskkill /IM "ffmpeg.exe" /F >nul 2>&1'
  Pop $0
  Sleep 1200
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Safety net: if python311.dll somehow ended up in resources/ instead of
  ; next to the exe, copy it up. build.rs should have handled this already.
  IfFileExists "$INSTDIR\python311.dll" done_dll_copy 0
    IfFileExists "$INSTDIR\resources\python-runtime\python311.dll" 0 done_dll_copy
      DetailPrint "Copying python311.dll to application directory..."
      CopyFiles /SILENT "$INSTDIR\resources\python-runtime\python311.dll" "$INSTDIR\python311.dll"
  done_dll_copy:
!macroend
