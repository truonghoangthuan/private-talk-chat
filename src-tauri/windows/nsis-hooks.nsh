!macro _PRIVATE_TALK_STOP_RUNNING_APP
  ; Allow a closing instance to exit, then terminate lingering app/WebView2 processes
  ; so uninstall/install never fails with a locked executable.
  Sleep 500
  nsExec::ExecToStack 'taskkill /IM "${MAINBINARYNAME}.exe" /T /F'
  Pop $0
  Pop $1
  Sleep 300
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro _PRIVATE_TALK_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro _PRIVATE_TALK_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Notify Windows Shell to invalidate cached exe/shortcut icons on upgrade.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
