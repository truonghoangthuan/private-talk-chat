!macro NSIS_HOOK_POSTINSTALL
  ; Notify Windows Shell to invalidate cached exe/shortcut icons on upgrade.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
