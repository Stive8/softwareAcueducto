@echo off
echo ============================================
echo  Sistema Acueducto Veredal - Instalacion
echo ============================================
echo.

echo [1/3] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js no esta instalado
    echo Por favor instala Node.js desde https://nodejs.org/
    pause
    exit /b 1
)
echo Node.js encontrado: 
node --version
echo.

echo [2/3] Instalando dependencias...
echo Esto puede tardar unos minutos...
echo.
call npm install
if errorlevel 1 (
    echo ERROR: Fallo la instalacion de dependencias
    pause
    exit /b 1
)
echo.

echo [3/3] Instalacion completada!
echo.
echo ============================================
echo  Para ejecutar la aplicacion:
echo    npm start
echo.
echo  Para ejecutar en modo desarrollo:
echo    npm run dev
echo ============================================
echo.
pause
