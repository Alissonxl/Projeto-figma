@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title GitHub Upload - Projeto Figma
color 0A

set "REPO=https://github.com/Alissonxl/Projeto-figma.git"
set "BRANCH=main"

echo ================================================
echo              GITHUB UPLOAD AUTOMATICO
echo ================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
color 0C
echo [ERRO] Git nao encontrado.
pause
exit /b 1
)

if not exist ".git" (
echo [INFO] Inicializando repositorio...
git init
)

git rebase --abort >nul 2>&1

git remote get-url origin >nul 2>&1
if errorlevel 1 (
git remote add origin "%REPO%"
) else (
git remote set-url origin "%REPO%"
)

git branch -M %BRANCH%

echo.
git status --short
echo.

set /p mensagem="Mensagem do commit: "
if "!mensagem!"=="" set "mensagem=Atualizacao do projeto"

echo.
echo [1/4] Adicionando arquivos...
git add .
if errorlevel 1 goto erro

git diff --cached --quiet
if not errorlevel 1 (
echo [INFO] Nenhuma alteracao nova para commit.
goto enviar
)

echo [2/4] Criando commit...
git commit -m "!mensagem!"
if errorlevel 1 goto erro

:enviar
echo [3/4] Atualizando referencia do GitHub...
git fetch origin %BRANCH% >nul 2>&1

echo [4/4] Enviando versao do PC para o GitHub...
git push -u origin %BRANCH% --force-with-lease

if errorlevel 1 goto erro

color 0A
echo.
echo ================================================
echo              ENVIO CONCLUIDO
echo ================================================
echo.
echo A versao deste computador agora esta no GitHub.
echo.
git log -1 --pretty=format:"Hash: %%h%nAutor: %%an%nMensagem: %%s"
echo.
echo.
pause
exit /b 0

:erro
color 0C
echo.
echo ================================================
echo                 OCORREU UM ERRO
echo ================================================
echo.
pause
exit /b 1
