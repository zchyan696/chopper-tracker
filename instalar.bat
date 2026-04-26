@echo off
echo =============================================
echo   INSTALANDO DEPENDENCIAS DO SAMPLER
echo =============================================
echo.

echo [1/2] Instalando pytubefix (downloader sem ffmpeg)...
pip install -U pytubefix
echo.

echo [2/2] Verificando...
python -c "import pytubefix; print('  pytubefix OK v' + pytubefix.__version__)"
echo.
echo =============================================
echo   Pronto! Use iniciar_sampler.bat para abrir.
echo =============================================
pause
