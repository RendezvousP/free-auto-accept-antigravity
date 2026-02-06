@echo off
setlocal EnableDelayedExpansion

echo.
echo [0/5] Checking Git...
git --version >nul 2>&1
if !errorlevel! neq 0 (
    echo [WARNING] Git command not found in PATH.
    echo Please enter the full path to git.exe
    set /p GIT_PATH="Paste path here (e.g. D:\Git\bin\git.exe): "
    set GIT_PATH=!GIT_PATH:"=!
) else (
    set GIT_PATH=git
)

echo Using Git at: "!GIT_PATH!"

echo.
echo [1/5] Initializing Repository...
"!GIT_PATH!" init

echo.
echo [2/5] Checking Git Identity...
"!GIT_PATH!" config user.email >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo [SETUP] Git identity needed for commit history.
    set /p GIT_EMAIL="Enter your email: "
    set /p GIT_NAME="Enter your name: "
    
    "!GIT_PATH!" config user.email "!GIT_EMAIL!"
    "!GIT_PATH!" config user.name "!GIT_NAME!"
)

echo.
echo [3/5] Adding Files...
"!GIT_PATH!" add .

echo.
echo [4/5] Committing...
"!GIT_PATH!" commit -m "feat: Initial release v1.0 - Full Auto Accept capabilities"

echo.
echo [5/5] Pushing to GitHub...
"!GIT_PATH!" remote remove origin 2>nul
"!GIT_PATH!" remote add origin https://github.com/RendezvousP/free-auto-accept-antigravity.git
"!GIT_PATH!" branch -M main
"!GIT_PATH!" push -u origin main

echo.
echo [SUCCESS] all done!
pause
