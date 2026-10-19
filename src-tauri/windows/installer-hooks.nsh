; Plethora NSIS installer hooks — sparse package identity.
;
; Identity is what unlocks the Windows AI APIs for a loose Win32 executable.
; The registration itself lives in windows/register-sparse-identity.ps1, which
; is shipped next to the executable so both the installer and the uninstaller
; can call it (see that file for the trust policy: the package is registered
; only when its signing chain already builds against this machine's stores, and
; no certificate is ever imported into TrustedPeople or Root).
;
; Everything here is BEST EFFORT. Plethora runs without package identity — the
; Windows AI features report `package_identity_missing` and the rest of the app
; is unaffected — so neither a skipped registration nor a failed removal may
; ever fail the install/uninstall.
;
; PowerShell exit codes from the script: 0 = registered / already correct,
; 10 = skipped by policy, 20 = registration failed.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering Plethora package identity (needed for Windows AI features)..."
  ExecWait 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$\"$INSTDIR\register-sparse-identity.ps1$\"" -InstallDir "$\"$INSTDIR$\"" -Msix "$\"$INSTDIR\PlethoraIdentity.msix$\""' $0
  StrCmp $0 "0" plethora_identity_registered
    DetailPrint "Package identity not registered (exit $0). Plethora still runs; Windows AI features stay off. Details: $LOCALAPPDATA\Plethora\logs\identity-registration.log"
  plethora_identity_registered:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing Plethora package identity..."
  IfFileExists "$INSTDIR\register-sparse-identity.ps1" 0 plethora_identity_uninstall_fallback
    ExecWait 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$\"$INSTDIR\register-sparse-identity.ps1$\"" -InstallDir "$\"$INSTDIR$\"" -Msix "$\"$INSTDIR\PlethoraIdentity.msix$\"" -Uninstall' $0
    Goto plethora_identity_uninstall_checked
  plethora_identity_uninstall_fallback:
    ; The helper script is already gone (manual cleanup, partial install). Fall
    ; back to a direct removal; this command contains no literal $ to escape.
    ExecWait 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Get-AppxPackage -Name Plethora.Plethora | Remove-AppxPackage -ErrorAction SilentlyContinue"' $0
  plethora_identity_uninstall_checked:
  StrCmp $0 "0" plethora_identity_uninstall_done
    DetailPrint "Package identity removal reported exit $0; continuing with the uninstall."
  plethora_identity_uninstall_done:
!macroend
