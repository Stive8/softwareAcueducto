@echo off
echo ============================================
echo  Solucionando problema better-sqlite3
echo ============================================
echo.

echo [1/3] Desinstalando better-sqlite3...
call npm uninstall better-sqlite3

echo.
echo [2/3] Instalando electron-rebuild...
call npm install --save-dev electron-rebuild

echo.
echo [3/3] Reinstalando better-sqlite3 y recompilando...
call npm install better-sqlite3
call npx electron-rebuild

echo.
echo ============================================
echo  Solucion completada!
echo  Ahora puedes ejecutar: npm start
echo ============================================
echo.
pause
