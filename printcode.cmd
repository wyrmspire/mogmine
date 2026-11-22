@echo off
rem Runs printcode.sh with the portable Git bash. Writes dump00.md... in the repo root.
"%LOCALAPPDATA%\PortableGit\bin\bash.exe" "%~dp0printcode.sh" %*
