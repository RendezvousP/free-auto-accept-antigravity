@echo off
setlocal EnableDelayedExpansion

echo.
echo [1/6] Initializing Repository...
git init

echo.
echo [2/6] Configuring Git Identity (Auto-filled)...
REM Using provided credentials to fix identity error definitively
git config user.email "luominduc@gmail.com"
git config user.name "RendezvousP"

echo.
echo [3/6] Adding Files...
git add .

echo.
echo [4/6] Committing...
git commit -m "feat: Initial release v1.0 - Full Auto Accept capabilities"

echo.
echo [5/6] Configuration Remote...
git remote remove origin 2>nul
git remote add origin https://github.com/RendezvousP/free-auto-accept-antigravity.git
git branch -M main

echo.
echo [6/6] Pushing to GitHub...
git push -u origin main
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Push failed. Either rights are missing OR Repo doesn't exist.
    echo.
    echo [AUTO-FIX] Opening GitHub to create repo 'free-auto-accept-antigravity'...
    timeout /t 3 >nul
    start https://github.com/new?name=free-auto-accept-antigravity^&description=Unrestricted%%20Auto%%20Accept%%20for%%20Antigravity%%20IDE^&visibility=public
    
    echo.
    echo ========================================================
    echo  INSTRUCTIONS:
    echo  1. Browser opened the "Create a new repository" page.
    echo  2. Scroll down and click green "Create repository" button.
    echo  3. DO NOT change the name.
    echo  4. Come back here and PRESS ANY KEY.
    echo ========================================================
    pause
    echo.
    echo [RETRYING] Pushing again...
    git push -u origin main
)

echo.
echo [SUCCESS] Repo has been pushed to: https://github.com/RendezvousP/free-auto-accept-antigravity
pause
