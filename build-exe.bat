@echo off
echo Installing dependencies...
npm install
echo Building executable...
npm run build
echo Done!
echo Your executable is in the dist folder
pause
