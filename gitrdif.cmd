@echo off
rem Runs gitrdif.sh with the portable Git bash. Writes gitrdif00.md... in the repo root.
"%LOCALAPPDATA%\PortableGit\bin\bash.exe" "%~dp0gitrdif.sh" %*
