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
  ; ask a running YouPlay to close (so the sign-in session is saved), wait for it, force only as a last resort
  nsExec::Exec 'taskkill /IM YouPlay.exe'
  StrCpy $R8 0
  waitloop:
    nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq YouPlay.exe" /NH | find /I "YouPlay.exe"'
    Pop $R7
    StrCmp $R7 "0" 0 closed
    IntOp $R8 $R8 + 1
    IntCmp $R8 30 forcekill 0 forcekill
    Sleep 500
    Goto waitloop
  forcekill:
    nsExec::Exec 'taskkill /F /T /IM YouPlay.exe'
    Sleep 1500
  closed:
  Sleep 1500
  ; replace the previous version completely (retry while Windows still holds files of the old one)
  StrCpy $R8 0
  wipe:
    RMDir /r "$INSTDIR"
    IfFileExists "$INSTDIR\YouPlay.exe" 0 wiped
    IntOp $R8 $R8 + 1
    IntCmp $R8 10 wiped 0 wiped
    nsExec::Exec 'taskkill /F /T /IM YouPlay.exe'
    Sleep 1000
    Goto wipe
  wiped:
  SetOutPath "$INSTDIR"
  File "..\out\app\YouPlay.exe"
  File "..\out\app\Microsoft.Web.WebView2.Core.dll"
  File "..\out\app\Microsoft.Web.WebView2.Wpf.dll"
  File "..\out\app\WebView2Loader.dll"
  File "/oname=icon-${VERSION}.ico" "..\build\icon.ico"
  SetOutPath "$INSTDIR\engine"
  File /r "..\engine\*.*"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall YouPlay.exe"

  ; Microsoft Edge WebView2 Runtime: part of Windows 10/11, installed here only if this PC lacks it
  ReadRegStr $R5 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  StrCmp $R5 "" 0 wvok
  ReadRegStr $R5 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  StrCmp $R5 "" wvinstall wvok
  wvinstall:
    SetOutPath "$TEMP"
    File "..\out\MicrosoftEdgeWebview2Setup.exe"
    ExecWait '"$TEMP\MicrosoftEdgeWebview2Setup.exe" /silent /install'
    Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
    SetOutPath "$INSTDIR"
  wvok:

  ; fresh shortcuts pointing at an icon file with a new name every version,
  ; so Windows cannot keep showing its cached old icon
  Delete "$DESKTOP\YouPlay.lnk"
  Delete "$SMPROGRAMS\YouPlay.lnk"
  Delete "$SMPROGRAMS\YouPlay\*.lnk"
  RMDir "$SMPROGRAMS\YouPlay"
  CreateShortcut "$DESKTOP\YouPlay.lnk" "$INSTDIR\YouPlay.exe" "" "$INSTDIR\icon-${VERSION}.ico" 0 SW_SHOWNORMAL "" "YouPlay — YouTube Music"
  CreateShortcut "$SMPROGRAMS\YouPlay.lnk" "$INSTDIR\YouPlay.exe" "" "$INSTDIR\icon-${VERSION}.ico" 0 SW_SHOWNORMAL "" "YouPlay — YouTube Music"
  ; tell Explorer that icons changed and refresh its icon cache
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\icon-${VERSION}.ico"
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
    Exec '"$INSTDIR\YouPlay.exe"'
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
