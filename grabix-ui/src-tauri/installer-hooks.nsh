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
  ; Tauri 2 on Windows places resources directly at $INSTDIR\<folder>\
  ; (NOT $INSTDIR\resources\<folder>\).
  ; python311.dll is inside $INSTDIR\python-runtime\ but Windows needs it
  ; RIGHT NEXT TO grabix-ui.exe (i.e. in $INSTDIR\) to load it at startup.
  DetailPrint "Copying Python DLLs to application directory..."
  IfFileExists "$INSTDIR\python-runtime\python311.dll" 0 try_resources_path
    CopyFiles /SILENT "$INSTDIR\python-runtime\python311.dll"    "$INSTDIR\python311.dll"
    CopyFiles /SILENT "$INSTDIR\python-runtime\python3.dll"      "$INSTDIR\python3.dll"
    CopyFiles /SILENT "$INSTDIR\python-runtime\vcruntime140.dll" "$INSTDIR\vcruntime140.dll"
    CopyFiles /SILENT "$INSTDIR\python-runtime\vcruntime140_1.dll" "$INSTDIR\vcruntime140_1.dll"
    Goto dll_copy_done

  try_resources_path:
  ; Fallback: some Tauri versions use resources\ subfolder
  IfFileExists "$INSTDIR\resources\python-runtime\python311.dll" 0 dll_copy_done
    CopyFiles /SILENT "$INSTDIR\resources\python-runtime\python311.dll"    "$INSTDIR\python311.dll"
    CopyFiles /SILENT "$INSTDIR\resources\python-runtime\python3.dll"      "$INSTDIR\python3.dll"
    CopyFiles /SILENT "$INSTDIR\resources\python-runtime\vcruntime140.dll" "$INSTDIR\vcruntime140.dll"
    CopyFiles /SILENT "$INSTDIR\resources\python-runtime\vcruntime140_1.dll" "$INSTDIR\vcruntime140_1.dll"

  dll_copy_done:
!macroend
