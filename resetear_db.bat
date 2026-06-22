@echo off
echo ============================================
echo  RESETEAR BASE DE DATOS
echo ============================================
echo.
echo ADVERTENCIA: Esto eliminara la base de datos actual
echo y creara una nueva con la estructura corregida.
echo.
pause

echo.
echo Eliminando base de datos antigua...
if exist data\acueducto.db del data\acueducto.db
if exist data\acueducto.db-shm del data\acueducto.db-shm
if exist data\acueducto.db-wal del data\acueducto.db-wal

echo.
echo Base de datos eliminada.
echo.
echo Ejecuta: npm start
echo Se creara automaticamente la nueva estructura.
echo.
pause
