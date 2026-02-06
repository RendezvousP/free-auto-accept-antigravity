@echo off
echo [1/2] Committing changes...
git add .
git commit -m "docs: Fix mermaid diagram syntax compatibility"

echo.
echo [2/2] Pushing to GitHub...
git push

echo.
echo [SUCCESS] Changes pushed! Check your GitHub now.
pause
