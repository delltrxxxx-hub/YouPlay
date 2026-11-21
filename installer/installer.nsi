; YouPlay one-click installer (per-user, no admin rights)
; build: makensis /DVERSION=x.y.z /DOLDGUID=... installer.nsi   (run from this folder)
Unicode true
SetCompressor /SOLID lzma
!include FileFunc.nsh

!define APP "YouPlay"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\YouPlay"

Name "${APP}"
Caption "Установка ${APP}"
BrandingText "${APP} ${VERSION}"
OutFile "..\dist\YouPlay-Setup-${VERSION}.exe"
Icon "..\build\icon.ico"
UninstallIcon "..\build\icon.ico"
InstallDir "$LOCALAPPDATA\Programs\youplay"
RequestExecutionLevel user
AutoCloseWindow true
ShowInstDetails nevershow
ShowUninstDetails nevershow
SubCaption 3 " "
InstallButtonText "Установить"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "Установка ${APP}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "${APP}"

Page instfiles
UninstPage instfiles

Section "Install"
  SetDetailsPrint none
  ; close a running launcher / the old Electron build of YouPlay (Edge itself keeps playing)
  nsExec::Exec 'taskkill /F /IM YouPlay.exe'
  Sleep 800
  ; replace the previous version completely
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File "..\out\YouPlay.exe"
  File "..\build\icon.ico"
  SetOutPath "$INSTDIR\extension"
  File /r /x _metadata "..\extension\*.*"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall YouPlay.exe"

  CreateShortcut "$DESKTOP\YouPlay.lnk" "$INSTDIR\YouPlay.exe" "" "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL "" "YouPlay — YouTube Music"
  CreateShortcut "$SMPROGRAMS\YouPlay.lnk" "$INSTDIR\YouPlay.exe" "" "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL "" "YouPlay — YouTube Music"

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall YouPlay.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall YouPlay.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ; entry left behind by YouPlay 1.0.0 (Electron build)
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${OLDGUID}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{${OLDGUID}}"

  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/norun" $R1
  IfErrors 0 +2
    Exec '"$INSTDIR\YouPlay.exe" --no-update'
SectionEnd

Section "Uninstall"
  SetDetailsPrint none
  nsExec::Exec 'taskkill /F /IM YouPlay.exe'
  Delete "$DESKTOP\YouPlay.lnk"
  Delete "$SMPROGRAMS\YouPlay.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  ; the sign-in profile in %LOCALAPPDATA%\YouPlay is kept so a reinstall stays signed in
SectionEnd
